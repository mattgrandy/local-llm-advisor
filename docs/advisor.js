/* Core recommendation logic. Runs in the browser and in Node (generator). No dependencies.
   All speeds are ESTIMATES from memory bandwidth; see assumptions in data/hardware.json. */
(function (root) {
  const QORDER = ["Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M"]; // best quality first
  const GB = 1e9;

  // KV cache bytes for `ctx` tokens. K and V both counted (conservative: ignores K==V sharing).
  // Bytes per cached value: f16 = 2, q8_0 = 34 bytes per 32 values, q4_0 = 18 bytes per 32 values.
  const KV_BYTES = { f16: 2, q8_0: 1.0625, q4_0: 0.5625 };
  // KV bytes that attention reads per generated token at depth `ctx` (full layers: all ctx tokens; sliding-window layers: at most `window`;
  // linear-attention layers: nothing that grows with ctx). Also what the cache grows by.
  function kvAttnGB(model, ctx, kvq) {
    const k = model.kv, bytes = KV_BYTES[kvq] || 2;
    const full = 2 * k.full_kv_heads * k.full_head_dim * k.full_layers * bytes * ctx;
    let swa = 0;
    if (k.swa_layers) {
      const w = Math.min(ctx, k.window || ctx);
      swa = 2 * k.swa_kv_heads * k.swa_head_dim * k.swa_layers * bytes * w;
    }
    return (full + swa) / GB;
  }
  // Total KV/state memory for `ctx` tokens. K and V both counted (conservative: ignores K==V sharing).
  // Linear-attention (Gated DeltaNet) layers add a fixed-size f32 recurrent state that does not depend on ctx or the KV cache type.
  function kvGB(model, ctx, kvq) { return kvAttnGB(model, ctx, kvq) + (model.kv.linear_state_gb || 0); }

  // ---- context limits ----
  // native = the model's own verified maximum (models.json context_max). Beyond that only models whose card documents YaRN
  // extension (models.json context_extended) are allowed, and results are flagged "extended".
  function ctxLimits(model) {
    const ext = model.context_extended;
    return { native: model.context_max, extended: ext ? Math.max(model.context_max, ext.max) : model.context_max, ext: ext || null };
  }
  function ctxStatus(model, ctx) { // "native" | "extended" | "over"
    const l = ctxLimits(model); return ctx <= l.native ? "native" : ctx <= l.extended ? "extended" : "over";
  }
  // 1,048,576 (a binary "1M", e.g. Nemotron 3.5 config) prints as "1M" like 262,144 prints as "256k"; decimal millions keep up to 2 decimals
  function fmtCtx(n) { return n >= 1e6 ? (n % 1048576 === 0 ? n / 1048576 : +(n / 1e6).toFixed(2)) + "M" : n >= 1024 ? Math.round(n / 1024) + "k" : String(n); }

  // ---- long-context speed (ESTIMATE; constants fitted by tools/calibrate_depth.py, see data/depth_calibration.json) ----
  // Decode: tg(d) = tg0 / (1 + kappa * KVread(d) / Wread).  Prefill: same form per chunk with kappa_pp, integrated over the prompt.
  function depthSpeed(p, ctx, kvq, cal) {
    if (!cal || !(p.tps > 0) || !(p.readGB > 0)) return null;
    const x = kvAttnGB(p.model, ctx, kvq) / p.readGB, tps = p.tps / (1 + cal.kappa * x);
    return { ctx, tps, ratio: tps / p.tps, extrapolated: ctx > cal.max_measured_depth, measuredDepthMax: cal.max_measured_depth };
  }
  // Time to first token for a prompt of `ctx` tokens (seconds), or null when there is no prompt-processing data for this hardware/model
  // or the model does not run fully on GPU/unified memory (offload prefill is not modelled).
  function ttftSeconds(p, ctx, kvq, cal) {
    if (!cal || !(p.pp0 > 0) || p.mode !== "gpu" || !(p.readGB > 0)) return null;
    const N = 64, step = ctx / N; let t = 0;
    for (let i = 0; i < N; i++) { const mid = (i + 0.5) * step; t += step * (1 + cal.kappa_pp * kvAttnGB(p.model, mid, kvq) / p.readGB) / p.pp0; }
    return t;
  }
  function fmtDur(s) { return s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h"; }

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
    const bw = (d.bandwidth_by_mem_gb && d.bandwidth_by_mem_gb[String(input.memory_gb)]) || d.bandwidth_gbps;
    return { kind: input.kind, name: (input.label || d.name) + " " + input.memory_gb + "GB", pool: input.memory_gb * frac - 0.5,
             gpuBw: bw, discrete: false, ramAvail: 0, ramBw: bw, ngpu: 1,
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
      return Object.assign(base, { mode: "gpu", gpuGB: w + kv, cpuGB: 0, pp0: ms && ms.pp ? ms.pp : null, tps: ms ? ms.tps : tps(hwr, A, readGB, 0) * (model.moe && model.active_params_b ? (hwr.moeFactor || 1) : 1), speed: ms });
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
    // Ollama reads context length and KV cache type from the SERVER's environment (default KV f16), not from `ollama run`;
    // a quantized KV cache also needs flash attention. https://github.com/ollama/ollama/blob/main/docs/faq.mdx
    const kvEnv = (opts.kvq === "q8_0" || opts.kvq === "q4_0") ? `OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=${opts.kvq} ` : "";
    const ollama = `${kvEnv}OLLAMA_CONTEXT_LENGTH=${opts.ctx} ollama serve\nollama run hf.co/${repo}:${tag}`;
    let flags = [`-hf ${repo}:${tag}`, `-c ${opts.ctx}`, "-fa on", "--jinja"];
    if (opts.kvq === "q8_0" || opts.kvq === "q4_0") flags.push(`-ctk ${opts.kvq} -ctv ${opts.kvq}`);
    const ext = ctxStatus(p.model, opts.ctx) === "extended";
    if (ext) { const l = ctxLimits(p.model); flags.push(`--rope-scaling yarn --rope-scale ${Math.ceil(opts.ctx / l.native)} --yarn-orig-ctx ${l.native}`); }
    if (p.mode === "gpu") flags.push("-ngl 99");
    else if (p.mode === "moe-offload") flags.push("-ngl 99", `--n-cpu-moe ${p.ncpumoe}`);
    else if (p.mode === "dense-offload") flags.push(`-ngl ${p.ngl}`);
    else if (p.mode === "cpu") flags.push("-ngl 0");
    const serveNote = "Context length" + (kvEnv ? " and the " + opts.kvq + " KV cache are" : " is") + " an Ollama server setting: quit the Ollama app or stop the service first, or set " + (kvEnv ? "these variables" : "it") + " in its environment (launchctl on Mac, systemctl on Linux)." + (kvEnv ? " Without them Ollama uses an f16 KV cache, which needs more memory than shown here." : "");
    const other = ext ? "Beyond the native context this needs YaRN rope scaling, which only the llama.cpp command sets; Ollama's context setting alone does not enable it." : p.mode === "moe-offload" ? "Ollama cannot set --n-cpu-moe; it chooses its own GPU/CPU split, so use the llama.cpp command for MoE offload control." :
                  (p.mode === "dense-offload" || p.mode === "cpu") ? "Ollama picks its own layer split; use llama.cpp for explicit control." : "";
    return { ollama, llama: "llama-server " + flags.join(" "), ollamaNote: (serveNote + (other ? " " + other : "")) };
  }

  // MLX (Apple Silicon only). Repos come from models.json mlx.repos (verified by tools/mlx_repos.py); never invented.
  // Picks the bit class matching the GGUF pick (Q6/Q8/F16 -> 8-bit, else 4-bit) if it fits next to the KV cache, else the largest that fits.
  // Command syntax from the mlx-lm README / SERVER.md and the mlx-vlm README; each repo's own card says which package converted it.
  function mlxCommand(p, opts, hwr) {
    if (!hwr || hwr.kind !== "apple") return null;
    const repos = ((p.model.mlx || {}).repos || []).slice();
    if (!repos.length) return { none: "no-conversion" };
    const want = /^(UD-)?(Q6|Q8|F16|BF16)/.test(p.quantLabel) ? 8 : 4, kv = p.kvGB || 0, fit = r => r.gb + kv <= hwr.pool;
    const r = repos.find(x => x.bits === want && fit(x)) || repos.filter(fit).sort((a, b) => b.bits - a.bits)[0];
    if (!r) return { none: "no-fit", repos };
    const mod = r.tool === "mlx-vlm" ? "mlx_vlm" : "mlx_lm";
    return { repo: r.repo, label: r.label, bits: r.bits, gb: r.gb, tool: r.tool, url: r.url, repos,
      text: `pip install -U ${r.tool}\n${mod}.generate --model ${r.repo} --prompt "Hello" --max-tokens 256\n${mod}.server --model ${r.repo}${r.tool === "mlx-lm" ? " --port 8080" : ""}` };
  }
  // shared HTML for the MLX block (main tool, Mac hardware pages, Mac can-run pages). esc = HTML escaper; id = <pre> id for copy buttons.
  function mlxHtml(mx, esc, id, copy) {
    if (!mx) return "";
    if (mx.none === "no-conversion") return `<p class="mut mlx-none" data-mlx="none">MLX: no MLX conversion yet for this model (none verified in mlx-community), so use llama.cpp or ollama above.</p>`;
    if (mx.none === "no-fit") return `<p class="mut mlx-none" data-mlx="nofit">MLX: the mlx-community conversions (${mx.repos.map(r => esc(r.label) + " " + r.gb + " GB").join(", ")}) do not fit next to the KV cache in this memory.</p>`;
    return `<div class="cmd mlx" data-mlx="${esc(mx.repo)}"><div class="code"><div class="top"><span>MLX &middot; ${esc(mx.tool)} &middot; ${esc(mx.label)}, ${mx.gb} GB</span>${copy ? `<button class="copy" type="button" data-c="${id}">Copy</button>` : ""}</div><pre${id ? ` id="${id}"` : ""}>${esc(mx.text)}</pre></div></div><p class="mut">MLX runs on Apple Silicon only. Repo: <a href="https://huggingface.co/${esc(mx.repo)}" rel="noopener">${esc(mx.repo)}</a> (converted with ${esc(mx.tool)}, per its model card). These commands use MLX's default context handling; there is no MLX speed on this site yet.</p>`;
  }

  // size proxy for ranking: MoE uses geometric mean of total and active. HEURISTIC, not a benchmark.
  function capacity(m) { return m.moe && m.active_params_b ? Math.sqrt(m.params_b * m.active_params_b) : m.params_b; }


  // ---- measured data (site/data/measured.json, built by tools/build_measured.py) ----
  const BPW = { F16: 16, Q8: 8.5, Q6: 6.56, Q5: 5.7, Q4: 4.85, Q3: 3.9, Q2: 3.0 };
  const qc = id => (/^Q(\d)/.exec(id) || [])[1] ? "Q" + /^Q(\d)/.exec(id)[1] : "";
  function measuredReadGB(e) {
    const frac = e.moe && e.active_b && e.params_b ? e.active_b / e.params_b : 1;
    // prefer the measured file's real size (GB) when known (e.g. gpt-oss ships MXFP4 weights, so 'Q8' files are about the same size)
    if (e.size_gb) return e.size_gb * frac;
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
        latest: e.latest, sources: e.sources, backends: e.backends,
        // prompt-processing speed at short context: measured median as-is, or scaled by compute proxy (bytes read) like tg
        pp: e.pp ? (tier === "measured" ? e.pp : e.pp * (measuredReadGB(e) / readGB)) : null });
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

  // ---- sort / filter helpers (pure; used by the page and by tests) ----
  const CTX_STEPS = [4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1000000];
  function familyOf(m) {
    const id = m.id.toLowerCase();
    if (/gemma/.test(id)) return "Gemma"; if (/qwen/.test(id)) return "Qwen"; if (/gpt-oss/.test(id)) return "gpt-oss";
    if (/mistral/.test(id)) return "Mistral"; if (/glm/.test(id)) return "GLM"; if (/llama/.test(id)) return "Llama";
    const o = m.id.split("/")[0]; return o.charAt(0).toUpperCase() + o.slice(1);
  }
  // Largest standard context size (4k..256k, capped at the model's maximum) whose KV cache still fits next to the weights
  // in the same placement (GPU pool, or GPU pool + system RAM when offloading). 0 = does not fit even at 4k.
  function maxCtx(p, hwr, kvq) {
    const cap = hwr.cpuOnly ? hwr.ramAvail : hwr.pool + (p.mode === "gpu" || !hwr.discrete ? 0 : hwr.ramAvail);
    let best = 0;
    for (const c of CTX_STEPS) { if (c > ctxLimits(p.model).extended) break; if (p.weightsGB + kvGB(p.model, c, kvq) <= cap) best = c; }
    return best;
  }
  function qualityOf(Q, m, use) {
    const e = Q && Q.models && Q.models[m.id]; if (!e) return null;
    const c = use === "coding" && e.coding ? e.coding : e.overall; if (!c) return null;
    return { rating: c.rating, rank: c.rank, category: c === e.coding ? "coding" : "overall", votes: c.votes, date: c.date };
  }
  const PERMISSIVE = /^(apache|mit|bsd|isc|unlicense)/i;
  const SORTS = { rec: "Recommended", tps: "Tokens/sec", tpsctx: "Tokens/sec at full context", size: "Model size", quality: "Quality (LMArena)", ctx: "Context that fits", name: "Name" };
  const NATURAL_DIR = { rec: "desc", tps: "desc", tpsctx: "desc", size: "desc", quality: "desc", ctx: "desc", name: "asc" };
  const DEFAULT_VIEW = { sort: "rec", dir: "desc", q: "", src: "all", fit: "all", lic: "all", fam: "all", min: 0 };
  function viewActive(v) { return v.q !== "" || v.src !== "all" || v.fit !== "all" || v.lic !== "all" || v.fam !== "all" || +v.min > 0; }
  function passes(p, v) {
    const si = speedInfo(p).short;
    if (v.q && !(p.model.name + " " + p.quantLabel + " " + p.family + " " + p.model.id).toLowerCase().includes(v.q.trim().toLowerCase())) return false;
    if (v.src === "measured" && si !== "measured") return false;
    if (v.src === "measured+scaled" && si === "estimated") return false;
    if (v.fit === "gpu" && p.mode !== "gpu") return false;
    if (v.fit === "offload" && p.mode === "gpu") return false;
    if (v.lic === "permissive" && !PERMISSIVE.test(p.model.license || "")) return false;
    if (v.fam !== "all" && p.family !== v.fam) return false;
    if (+v.min > 0 && !(p.tps != null && p.tps >= +v.min)) return false;
    return true;
  }
  // Returns filtered + sorted copy. Items missing the sort value (no tps / no LMArena rating) always go last.
  function applyView(results, v) {
    const key = { tps: p => p.tps, tpsctx: p => p.depth && p.depth.tps, size: p => p.model.params_b, quality: p => p.quality && p.quality.rating, ctx: p => p.maxCtx, name: p => p.model.name.toLowerCase() }[v.sort];
    const sgn = v.dir === "asc" ? 1 : -1, rows = results.filter(p => passes(p, v));
    if (v.sort === "rec" || !key) return v.dir === "asc" ? rows.slice().reverse() : rows;
    return rows.map((p, i) => ({ p, i, k: key(p) })).sort((a, b) => {
      const an = a.k == null, bn = b.k == null; if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
      const c = a.k < b.k ? -1 : a.k > b.k ? 1 : 0; return c ? c * sgn : a.i - b.i;
    }).map(x => x.p);
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
    const out = [], excluded = [], cal = data.depth || null;
    for (const m of data.models.models) {
      if (opts.use === "vision" && !m.vision) continue;
      // opts.use === "all": no use-case filter
      if (opts.use === "coding" && !m.tags.includes("coding")) continue;
      if (opts.use === "chat" && !(m.tags.includes("chat") || m.tags.includes("coding"))) continue;
      const cs = ctxStatus(m, opts.ctx);
      if (cs === "over") { excluded.push({ model: m, ctx: opts.ctx, native: ctxLimits(m).native, extended: ctxLimits(m).extended > ctxLimits(m).native ? ctxLimits(m).extended : null }); continue; }
      const p = best(m, hwr, opts, A);
      if (!p) { continue; }
      p.ctxStatus = cs; p.limits = ctxLimits(m);
      p.depth = depthSpeed(p, opts.ctx, opts.kvq, cal);
      p.ttft = ttftSeconds(p, opts.ctx, opts.kvq, cal);
      const effTps = p.depth ? p.depth.tps : p.tps; // judge "usable" at the requested context depth, not at an empty context
      p.usable = effTps != null && effTps >= A.min_usable_tps;
      p.comfortable = effTps != null && effTps >= A.comfortable_tps;
      p.rank = (p.usable ? 1000 : 0) + (p.comfortable ? 500 : 0) + (p.mode === "gpu" ? 200 : 0) - (cs === "extended" ? 20 : 0) + capacity(m) * 3 +
               (opts.use === "coding" && m.tags.length === 1 && m.tags[0] === "coding" ? 15 : 0);
      p.command = command(p, opts, hwr);
      p.mlx = mlxCommand(p, opts, hwr);
      p.family = familyOf(m); p.maxCtx = maxCtx(p, hwr, opts.kvq);
      p.quality = qualityOf(data.quality, m, opts.use);
      out.push(p);
    }
    out.sort((a, b) => b.rank - a.rank);
    return { hwr, results: out, excluded };
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
  const api = { ctxLimits, ctxStatus, fmtCtx, fmtDur, kvAttnGB, depthSpeed, ttftSeconds, KV_BYTES, applyView, viewActive, familyOf, maxCtx, SORTS, NATURAL_DIR, DEFAULT_VIEW, CTX_STEPS, speedInfo, makeLookup, mlxCommand, mlxHtml, calibratedEff, kvGB, resolveHardware, recommend, command, plan };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Advisor = api;
})(typeof window !== "undefined" ? window : globalThis);
