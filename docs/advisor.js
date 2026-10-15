/* Core recommendation logic. Runs in the browser and in Node (generator). No dependencies.
   All speeds are ESTIMATES from memory bandwidth; see assumptions in data/hardware.json. */
(function (root) {
  const QORDER = ["Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M"]; // best quality first
  const GB = 1e9;

  // KV cache bytes for `ctx` tokens. K and V both counted (conservative: ignores K==V sharing).
  function kvGB(model, ctx, kvq) {
    const k = model.kv, bytes = kvq === "q8_0" ? 1.0625 : 2; // q8_0 = 34 bytes per 32 values
    const full = 2 * k.full_kv_heads * k.full_head_dim * k.full_layers * bytes * ctx;
    let swa = 0;
    if (k.swa_layers) {
      const w = Math.min(ctx, k.window || ctx);
      swa = 2 * k.swa_kv_heads * k.swa_head_dim * k.swa_layers * bytes * w;
    }
    return (full + swa) / GB;
  }

  function resolveHardware(input, hw) {
    const A = hw.assumptions;
    const ramBw = (hw.ram_types.find(r => r.id === input.ram_type) || hw.ram_types[1]).bandwidth_gbps;
    if (input.kind === "gpu") {
      const d = hw.gpus.find(g => g.id === input.device);
      const n = input.count || 1;
      const vram = (input.vram_gb != null ? input.vram_gb : d.vram_gb * n);
      return { kind: "gpu", name: (n > 1 ? n + "x " : "") + d.name, pool: vram - A.gpu_overhead_gb * n,
               gpuBw: d.bandwidth_gbps, discrete: true, ramAvail: Math.max(0, input.ram_gb - A.os_reserve_ram_gb),
               ramBw, ngpu: n, vram, source_url: d.source_url };
    }
    if (input.kind === "cpu") {
      return { kind: "cpu", name: "CPU only", pool: 0, gpuBw: ramBw, discrete: true,
               ramAvail: Math.max(0, input.ram_gb - A.os_reserve_ram_gb), ramBw, ngpu: 0, vram: 0, cpuOnly: true };
    }
    const list = input.kind === "apple" ? hw.apple : hw.unified;
    const d = list.find(x => x.id === input.device);
    const frac = A.unified_usable_fraction[input.kind];
    return { kind: input.kind, name: d.name + " " + input.memory_gb + "GB", pool: input.memory_gb * frac - 0.5,
             gpuBw: d.bandwidth_gbps, discrete: false, ramAvail: 0, ramBw: d.bandwidth_gbps, ngpu: 1,
             vram: input.memory_gb, frac, source_url: d.source_url };
  }

  function tps(hwr, A, gpuBytesGB, cpuBytesGB) {
    const t = gpuBytesGB / ((hwr.eff || A.speed_efficiency) * hwr.gpuBw) + cpuBytesGB / (A.cpu_speed_efficiency * hwr.ramBw);
    return t > 0 ? 1 / t : null;
  }

  // Evaluate one model at one quant. Returns plan or null.
  function plan(model, qid, hwr, opts, A) {
    const q = model.quants[qid]; if (!q) return null;
    const w = q.gb, L = model.kv.layers;
    const kv = kvGB(model, opts.ctx, opts.kvq);
    const activeFrac = model.moe && model.active_params_b && model.params_b ? model.active_params_b / model.params_b : 1;
    const readGB = w * activeFrac; // bytes touched per generated token (approx.)
    const base = { model, quant: qid, quantLabel: q.label, weightsGB: w, kvGB: kv, readGB };
    if (!hwr.cpuOnly && w + kv <= hwr.pool) {
      const ms = hwr.lookup ? hwr.lookup(model, qid, readGB) : null; // measured / scaled-from-measured speed, else null
      return Object.assign(base, { mode: "gpu", gpuGB: w + kv, cpuGB: 0, tps: ms ? ms.tps : tps(hwr, A, readGB, 0) * (model.moe && model.active_params_b ? (hwr.moeFactor || 1) : 1), speed: ms });
    }
    if (!hwr.discrete) return null; // unified memory: no offload tier
    if (hwr.cpuOnly) {
      if (w + kv > hwr.ramAvail) return null;
      return Object.assign(base, { mode: "cpu", gpuGB: 0, cpuGB: w + kv, tps: tps(hwr, A, 0, readGB) });
    }
    const f = A.expert_weight_fraction_moe;
    if (model.moe && model.active_params_b) {
      const fixed = w * (1 - f) + kv; // attention/shared on GPU + KV
      if (fixed > hwr.pool) return null;
      const perLayer = (w * f) / L;
      const k = Math.min(L, Math.floor((hwr.pool - fixed) / perLayer)); // expert layers kept on GPU
      const cpuLayers = L - k, cpuGB = cpuLayers * perLayer;
      if (cpuGB > hwr.ramAvail) return null;
      const cpuFracRead = (cpuLayers / L) * f;
      return Object.assign(base, { mode: "moe-offload", ncpumoe: cpuLayers, gpuGB: w + kv - cpuGB, cpuGB,
        tps: tps(hwr, A, readGB * (1 - cpuFracRead), readGB * cpuFracRead) });
    }
    // dense partial offload: layers split between GPU and CPU
    const perLayer = (w + kv) / L;
    const g = Math.floor(hwr.pool / perLayer);
    if (g < 1) return null;
    const cpuGB = (L - g) * perLayer;
    if (cpuGB > hwr.ramAvail) return null;
    const cf = (L - g) / L;
    return Object.assign(base, { mode: "dense-offload", ngl: g, gpuGB: g * perLayer, cpuGB,
      tps: tps(hwr, A, readGB * (1 - cf), readGB * cf) });
  }

  function best(model, hwr, opts, A) {
    // Highest-quality quant that fits fully AND is estimated comfortable (>= comfortable_tps);
    // else the smallest quant that fits fully; else Q4_K_M with offload.
    const fits = [];
    for (const q of QORDER) { const p = plan(model, q, hwr, opts, A); if (p && p.mode === "gpu") fits.push(p); }
    if (fits.length) return fits.find(p => p.tps >= A.comfortable_tps) || fits[fits.length - 1];
    return plan(model, "Q4_K_M", hwr, opts, A);
  }

  function command(p, opts, hwr) {
    const repo = p.model.gguf_repo, tag = p.quantLabel;
    const ollama = `OLLAMA_CONTEXT_LENGTH=${opts.ctx} ollama run hf.co/${repo}:${tag}`;
    let flags = [`-hf ${repo}:${tag}`, `-c ${opts.ctx}`, "-fa on", "--jinja"];
    if (opts.kvq === "q8_0") flags.push("-ctk q8_0 -ctv q8_0");
    if (p.mode === "gpu") flags.push("-ngl 99");
    else if (p.mode === "moe-offload") flags.push("-ngl 99", `--n-cpu-moe ${p.ncpumoe}`);
    else if (p.mode === "dense-offload") flags.push(`-ngl ${p.ngl}`);
    else if (p.mode === "cpu") flags.push("-ngl 0");
    return { ollama, llama: "llama-server " + flags.join(" "),
      ollamaNote: p.mode === "moe-offload" ? "Ollama cannot set --n-cpu-moe; it chooses its own GPU/CPU split, so use the llama.cpp command for MoE offload control." :
                  (p.mode === "dense-offload" || p.mode === "cpu") ? "Ollama picks its own layer split; use llama.cpp for explicit control." : "" };
  }

  // size proxy for ranking: MoE uses geometric mean of total and active. HEURISTIC, not a benchmark.
  function capacity(m) { return m.moe && m.active_params_b ? Math.sqrt(m.params_b * m.active_params_b) : m.params_b; }


  // ---- measured data (site/data/measured.json, built by tools/build_measured.py) ----
  const BPW = { F16: 16, Q8: 8.5, Q6: 6.56, Q5: 5.7, Q4: 4.85, Q3: 3.9, Q2: 3.0 };
  const qc = id => (/^Q(\d)/.exec(id) || [])[1] ? "Q" + /^Q(\d)/.exec(id)[1] : "";
  function measuredReadGB(e) {
    const frac = e.moe && e.active_b && e.params_b ? e.active_b / e.params_b : 1;
    return e.params_b * (BPW[e.qclass] || 0) / 8 * frac;
  }
  // tier "measured": same model + same quant class on this hardware (median of N submitted runs).
  // tier "scaled-quant": same model, different quant class: measured tok/s x (bytes read measured / bytes read here).
  // tier "scaled-similar": different model of the same kind (dense/MoE) and similar size (bytes read within 0.6-1.67x).
  // Scaling is the bandwidth-bound approximation; it is labelled as scaled, never as plain "measured".
  function makeLookup(entries) {
    if (!entries || !entries.length) return null;
    return function (model, qid, readGB) {
      const cls = qc(qid);
      const mk = (e, tier, tps) => ({ tier, tps, from: e.model, fromQuant: e.qclass, n: e.n, tgMin: e.tg_min, tgMax: e.tg_max,
        latest: e.latest, sources: e.sources, backends: e.backends });
      const same = entries.filter(e => e.site_id === model.id);
      const exact = same.find(e => e.qclass === cls);
      if (exact) return mk(exact, "measured", exact.tg);
      const pick = (list, ok) => {
        let best = null;
        for (const e of list) {
          const r = measuredReadGB(e) / readGB; if (!(r > 0) || !ok(e, r)) continue;
          const d = Math.abs(Math.log(r));
          if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) < 1e-9 && e.n > best.e.n)) best = { e, d, r };
        }
        return best;
      };
      const sq = pick(same, () => true);
      if (sq) return mk(sq.e, "scaled-quant", sq.e.tg * sq.r);
      const moe = !!(model.moe && model.active_params_b);
      const sim = pick(entries.filter(e => e.site_id !== model.id && !!(e.moe && e.active_b) === moe), (e, r) =>
        r >= 0.6 && r <= 1.67 && (!moe || (e.params_b / model.params_b >= 0.6 && e.params_b / model.params_b <= 1.67)));
      return sim ? mk(sim.e, "scaled-similar", sim.e.tg * sim.r) : null;
    };
  }
  function calibratedEff(cal, hwId, kind) {
    if (!cal) return null;
    const e = (cal.by_hw && cal.by_hw[hwId] ? cal.by_hw[hwId] : cal.by_kind && cal.by_kind[kind]) || null;
    return e ? Math.min(cal.clamp[1], Math.max(cal.clamp[0], e.efficiency)) : null;
  }

  function recommend(input, data, opts) {
    const hw = data.hardware, A = hw.assumptions;
    const hwr = resolveHardware(input, hw);
    const M = data.measured || null;
    if (M && input.kind !== "cpu") {
      hwr.eff = calibratedEff(M.calibration, input.device, input.kind);
      hwr.moeFactor = M.calibration.moe_factor ? M.calibration.moe_factor.value : null;
      hwr.effSource = hwr.eff ? (M.calibration.by_hw[input.device] ? "calibrated to measured runs on this hardware" : "calibrated to measured runs on this hardware class") : null;
      if (input.kind !== "gpu" || (input.count || 1) === 1) hwr.lookup = makeLookup(M.entries[input.device]);
    }
    const out = [];
    for (const m of data.models.models) {
      if (opts.use === "vision" && !m.vision) continue;
      if (opts.use === "coding" && !m.tags.includes("coding")) continue;
      if (opts.use === "chat" && !(m.tags.includes("chat") || m.tags.includes("coding"))) continue;
      if (opts.ctx > m.context_max) continue;
      const p = best(m, hwr, opts, A);
      if (!p) { continue; }
      p.usable = p.tps != null && p.tps >= A.min_usable_tps;
      p.comfortable = p.tps != null && p.tps >= A.comfortable_tps;
      p.rank = (p.usable ? 1000 : 0) + (p.comfortable ? 500 : 0) + (p.mode === "gpu" ? 200 : 0) + capacity(m) * 3 +
               (opts.use === "coding" && m.tags.length === 1 && m.tags[0] === "coding" ? 15 : 0);
      p.command = command(p, opts, hwr);
      out.push(p);
    }
    out.sort((a, b) => b.rank - a.rank);
    return { hwr, results: out };
  }

  // Human label for a plan's speed provenance. cls: css class (ok=measured, est=estimated/scaled).
  function speedInfo(p) {
    const v = p.tps ? Math.round(p.tps) : "?", sp = p.speed;
    if (!sp) return { cls: "est", short: "estimated", text: "estimated ~" + v + " tok/s", detail: "Estimated from memory bandwidth (not measured)." };
    const runs = sp.n + " run" + (sp.n > 1 ? "s" : "") + (sp.n > 1 ? ", range " + Math.round(sp.tgMin) + "-" + Math.round(sp.tgMax) : "");
    if (sp.tier === "measured") return { cls: "ok", short: "measured", text: "measured ~" + v + " tok/s",
      detail: "Median of " + runs + " for this model and quant class on this hardware (short-context generation)." };
    const how = sp.tier === "scaled-quant" ? "same model at " + sp.fromQuant : "similar model " + sp.from + " at " + sp.fromQuant;
    return { cls: "est", short: "scaled from measured", text: "scaled from measured ~" + v + " tok/s",
      detail: "Not measured directly: scaled by bytes read from a measurement of " + how + " (" + runs + "). Treat as an estimate." };
  }
  const api = { speedInfo, makeLookup, calibratedEff, kvGB, resolveHardware, recommend, command, plan };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Advisor = api;
})(typeof window !== "undefined" ? window : globalThis);
