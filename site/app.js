(async function () {
  const $ = id => document.getElementById(id);
  const [hardware, models, measured] = await Promise.all(["data/hardware.json", "data/models.json", "data/measured.json"].map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)));
  const data = { hardware, models, measured };
  const opt = (v, t) => `<option value="${v}">${t}</option>`;
  $("ramt").innerHTML = hardware.ram_types.map(r => opt(r.id, r.name)).join("");
  $("ramt").value = "ddr5-5600";
  const cfgOf = id => (hardware.apple_configs || []).find(c => c.id === id);
  function fillMem() {
    const c = cfgOf($("device").value); if (!c) return;
    const prev = +$("mem").value;
    $("mem").innerHTML = c.memory_options_gb.map(m => opt(m, m + " GB" + ((c.memory_notes || {})[m] ? " (" + c.memory_notes[m] + ")" : ""))).join("");
    const keep = c.memory_options_gb.includes(prev) ? prev : (c.memory_options_gb.includes(32) ? 32 : c.memory_options_gb[0]);
    $("mem").value = keep;
  }
  function fillDevices() {
    const k = $("kind").value;
    const mem = $("mem");
    if (k === "apple") {
      const groups = {};
      hardware.apple_configs.forEach(c => (groups[c.form_factor] = groups[c.form_factor] || []).push(c));
      $("device").innerHTML = ["Mac Studio", "MacBook Pro", "MacBook Air", "Mac mini", "iMac"].filter(g => groups[g]).map(g => `<optgroup label="${g}">${groups[g].map(c => opt(c.id, c.name)).join("")}</optgroup>`).join("");
      fillMem();
    } else {
      const list = k === "gpu" ? hardware.gpus : k === "unified" ? hardware.unified : [];
      $("device").innerHTML = list.map(d => opt(d.id, d.name + (d.vram_gb ? ` (${d.vram_gb}GB)` : ""))).join("");
      const mems = k === "unified" ? [64, 96, 128] : [];
      mem.innerHTML = mems.map(m => opt(m, m + " GB")).join("");
      if (k === "unified") mem.value = 128;
    }
    $("l-device").hidden = k === "cpu"; $("l-count").hidden = k !== "gpu";
    $("l-mem").hidden = !(k === "apple" || k === "unified");
    $("l-ram").hidden = !(k === "gpu" || k === "cpu"); $("l-ramt").hidden = $("l-ram").hidden;
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const MODE = { gpu: "Fits fully in GPU/unified memory", "moe-offload": "MoE: experts partly on CPU (--n-cpu-moe)", "dense-offload": "Partial layer offload to CPU (slow)", cpu: "CPU only" };
  // segmented controls: enhance <select data-seg> without changing the select's API
  const segs = [];
  document.querySelectorAll("select[data-seg]").forEach(sel => {
    const wrap = document.createElement("div"); wrap.className = "seg" + (sel.dataset.seg === "small" ? " small" : ""); wrap.setAttribute("role", "radiogroup"); wrap.setAttribute("aria-label", sel.getAttribute("aria-label") || sel.id);
    const btns = [];
    // Plain <button type="button"> with an explicit click handler: no hidden radios, no label-activation, no :has(), so it behaves the same in Safari/WebKit.
    [...sel.options].forEach(op => {
      const b = document.createElement("button"); b.type = "button"; b.className = "opt"; b.dataset.value = op.value; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false");
      b.innerHTML = `<b>${esc(op.textContent)}</b>` + (op.dataset.sub ? `<small>${esc(op.dataset.sub)}</small>` : "");
      b.addEventListener("click", ev => { ev.preventDefault(); if (sel.value !== op.value) { sel.value = op.value; sel.dispatchEvent(new Event("change", { bubbles: true })); } else { syncSegs(); } });
      btns.push(b); wrap.append(b);
    });
    sel.hidden = true; sel.after(wrap);
    segs.push(() => btns.forEach(b => { const on = b.dataset.value === sel.value; b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false"); }));
  });
  const syncSegs = () => segs.forEach(f => f());
  function render() {
    syncSegs();
    const k = $("kind").value;
    const cfg = k === "apple" ? cfgOf($("device").value) : null;
    const input = { kind: k, device: cfg ? cfg.hw : $("device").value, label: cfg ? cfg.name : undefined, count: +$("count").value, memory_gb: +$("mem").value,
                    ram_gb: +$("ram").value, ram_type: $("ramt").value };
    const o = { use: $("use").value, ctx: +$("ctx").value, kvq: $("kvq").value };
    const { hwr, results } = Advisor.recommend(input, data, o);
    $("hwinfo").innerHTML = `Using <b>${esc(hwr.name)}</b>: ${hwr.pool.toFixed(1)} GB usable for model + KV` +
      (hwr.discrete && !hwr.cpuOnly ? `, ${hwr.ramAvail.toFixed(0)} GB RAM available for offload` : "") +
      (hwr.frac ? ` (assumes ${Math.round(hwr.frac * 100)}% of unified memory usable)` : "") + `, ${hwr.gpuBw} GB/s memory bandwidth.` +
      (hwr.eff ? ` Estimated speeds use an efficiency factor of ${hwr.eff.toFixed(2)}, ${esc(hwr.effSource)}.` : "");
    const comm = ((measured && measured.community) || []).filter(c => c.hw_id === input.device);
    $("cfgnote").textContent = cfg && cfg.note ? cfg.note : "";
    $("community").innerHTML = comm.length ? `<section class="card"><h2>Community-submitted benchmarks <span class="badge est">unverified</span></h2>
      <p class="mut">Reviewed for format only; not independently verified and never used in the estimates above.</p><div class="tw"><table><tr><th>Model</th><th>Quant</th><th>Backend</th><th>pp tok/s</th><th>tg tok/s</th><th>llama.cpp build</th><th>Date</th></tr>` +
      comm.map(c => `<tr><td>${esc(c.model)}</td><td>${esc(c.quant)}</td><td>${esc(c.backend)}</td><td>${c.pp_tps}</td><td>${c.tg_tps}</td><td>${esc(c.build || "")}</td><td>${esc(c.date || "")}</td></tr>`).join("") + `</table></div></section>` : "";
    if (!results.length) { $("results").innerHTML = `<div class="card">Nothing in the dataset fits this setup at ${o.ctx} context. Try a shorter context, q8_0 KV, or more memory.</div>`; return; }
    const total = hwr.pool, ramTot = hwr.cpuOnly ? hwr.pool : (hwr.ramAvail || hwr.pool);
    const meter = (label, used, cap, cls) => { const pct = cap > 0 ? Math.min(100, used / cap * 100) : 0; return `<div class="meter"><div class="row"><span>${label}</span><span><b>${used.toFixed(1)}</b> / ${cap.toFixed(0)} GB &middot; ${Math.round(pct)}%</span></div><div class="bar" role="img" aria-label="${label} ${Math.round(pct)} percent used"><i class="${cls || (pct > 92 ? "warn" : "")}" style="width:${pct}%"></i></div></div>`; };
    $("results").innerHTML = results.slice(0, 8).map((p, i) => {
      const m = p.model, si = Advisor.speedInfo(p), bc = si.short === "measured" ? "measured" : si.short === "estimated" ? "estimated" : "scaled";
      return `<article class="card res hov" style="animation-delay:${i * 45}ms"><div class="res-h"><span class="n">#${i + 1}</span><h3>${esc(m.name)}</h3><span class="q">${esc(p.quantLabel)}</span>
      <div class="tps"><b>~${p.tps ? Math.round(p.tps) : "?"}</b><span>tok/s generation</span></div></div>
      <div class="badges"><span class="badge ${bc}" title="${esc(si.detail)}">${esc(si.short)}</span><span class="badge ${p.mode === "gpu" ? "ok" : "est"}">${MODE[p.mode]}</span>${p.usable ? "" : '<span class="badge est">likely too slow</span>'}
      <span class="badge plain">${m.moe ? `MoE ${m.params_b}B total / ${m.active_params_b}B active` : m.params_b + "B dense"}</span><span class="badge plain">${esc(m.license || "license: see source")}</span></div>
      ${hwr.cpuOnly ? "" : meter(hwr.discrete ? "VRAM" : "Unified memory", p.gpuGB, total)}${p.cpuGB > 0.05 || hwr.cpuOnly ? meter("System RAM", p.cpuGB, ramTot, "ram") : ""}
      <p class="mut">${esc(si.detail)}${p.speed ? " Source: " + p.speed.sources.map(x => `<a href="${x.url}" rel="noopener">${esc(x.id)}</a>`).join(", ") + ", latest " + esc(p.speed.latest) + "." : ""} Memory: weights ${p.weightsGB.toFixed(1)} GB + KV cache ${p.kvGB.toFixed(2)} GB @ ${o.ctx} ctx.</p>
      <div class="cmd"><div class="code"><div class="top"><span>llama.cpp</span><button class="copy" type="button" data-c="l${i}">Copy</button></div><pre id="l${i}">${esc(p.command.llama)}</pre></div>
      <div class="code"><div class="top"><span>ollama</span><button class="copy" type="button" data-c="o${i}">Copy</button></div><pre id="o${i}">${esc(p.command.ollama)}</pre></div></div>
      ${p.command.ollamaNote ? `<p class="mut">${esc(p.command.ollamaNote)}</p>` : ""}
      <p class="src">Source: <a href="${m.source_url}" rel="noopener">${esc(m.id)}</a> &middot; GGUF: <a href="${m.gguf_source_url}" rel="noopener">${esc(m.gguf_repo)}</a> &middot; last verified ${m.last_verified}</p></article>`;
    }).join("");
  }
  $("kind").addEventListener("change", () => { fillDevices(); render(); });
  $("device").addEventListener("change", () => { if ($("kind").value === "apple") fillMem(); });
  document.querySelectorAll("#f select,#f input").forEach(e => { if (e.id !== "kind" && !e.closest(".seg")) e.addEventListener("change", render); });
  document.querySelectorAll("#f input[type=number]").forEach(e => e.addEventListener("input", render));
  // prefill from query string (used by generated pages): ?kind=&device=&count=&mem=&ram=&ramt=&use=
  const q = new URLSearchParams(location.search);
  if (q.get("kind")) $("kind").value = q.get("kind");
  fillDevices();
  if (q.get("config") && cfgOf(q.get("config")) && $("kind").value === "apple") { $("device").value = q.get("config"); fillMem(); }
  else if ($("kind").value === "apple" && q.get("device")) { const c = hardware.apple_configs.find(c => c.hw === q.get("device")); if (c) { $("device").value = c.id; fillMem(); } }
  [["mem", "mem"], ["ram", "ram"], ["ramt", "ramt"], ["use", "use"], ["ctx", "ctx"]].forEach(([p, id]) => { if (q.get(p)) $(id).value = q.get(p); });
  if ($("kind").value !== "apple") [["device", "device"], ["count", "count"]].forEach(([p, id]) => { if (q.get(p)) $(id).value = q.get(p); });
  $("changelog").innerHTML = models.changelog.map(c => `<b>${c.date}</b><ul>${c.changes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`).join("");
  render();
})();
