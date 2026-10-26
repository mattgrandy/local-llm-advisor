(async function () {
  const fc = Advisor.fmtCtx;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (Number.isFinite(+v) ? +v : "");
  const safeUrl = u => (/^https?:\/\//i.test(String(u)) ? esc(u) : "#");
  const [hardware, models, measured, quality, depth] = await Promise.all(["data/hardware.json", "data/models.json", "data/measured.json", "data/quality.json", "data/depth_calibration.json"].map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)));
  const data = { hardware, models, measured, quality, depth };
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
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
      $("device").innerHTML = ["Mac Studio", "MacBook Pro", "MacBook Air", "Mac mini", "iMac"].filter(g => groups[g]).map(g => `<optgroup label="${esc(g)}">${groups[g].map(c => opt(c.id, c.name)).join("")}</optgroup>`).join("");
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
  // ---- sort & filter state (lives outside the hardware form, so it survives hardware changes) ----
  const view = Object.assign({}, Advisor.DEFAULT_VIEW, { all: false });
  const SORTS = Advisor.SORTS;
  const families = [...new Set(models.models.map(m => Advisor.familyOf(m)))].sort();
  $("v-fam").innerHTML = opt("all", "All families") + families.map(f => opt(f, f)).join("");
  const dirText = () => view.sort === "name" ? (view.dir === "asc" ? "A \u2192 Z" : "Z \u2192 A") : (view.dir === "desc" ? "High \u2192 low" : "Low \u2192 high");
  function syncView(sortOpts, maxTps) {
    if (sortOpts) { $("v-sort").innerHTML = sortOpts.map(k => opt(k, SORTS[k])).join(""); }
    const eff = sortOpts && !sortOpts.includes(view.sort) ? "rec" : view.sort;
    $("v-sort").value = eff;
    $("v-dir").textContent = dirText(); $("v-dir").setAttribute("aria-label", "Sort order: " + dirText() + ". Activate to reverse.");
    $("v-q").value = view.q; $("v-src").value = view.src; $("v-fit").value = view.fit; $("v-lic").value = view.lic; $("v-fam").value = view.fam;
    if (maxTps != null) $("v-min").max = Math.max(10, Math.ceil(maxTps / 10) * 10, +view.min);
    $("v-min").value = view.min; $("v-minout").textContent = +view.min > 0 ? view.min + " tok/s" : "any";
    return eff;
  }
  function writeUrl() {
    const k = $("kind").value, cfg = k === "apple" ? cfgOf($("device").value) : null, q = new URLSearchParams();
    q.set("kind", k);
    if (k !== "cpu") q.set("device", cfg ? cfg.hw : $("device").value);
    if (cfg) q.set("config", cfg.id);
    if (k === "gpu") q.set("count", $("count").value);
    if (k === "apple" || k === "unified") q.set("mem", $("mem").value);
    if (k === "gpu" || k === "cpu") { q.set("ram", $("ram").value); q.set("ramt", $("ramt").value); }
    q.set("use", $("use").value); q.set("ctx", $("ctx").value); q.set("kvq", $("kvq").value);
    const D = Advisor.DEFAULT_VIEW;
    if (view.sort !== "rec") q.set("sort", view.sort);
    if (view.dir !== Advisor.NATURAL_DIR[view.sort]) q.set("dir", view.dir);
    ["q", "src", "fit", "lic", "fam"].forEach(x => { if (view[x] !== D[x]) q.set(x, view[x]); });
    if (+view.min > 0) q.set("min", view.min);
    if (view.all) q.set("all", "1");
    try { history.replaceState(null, "", "?" + q.toString()); } catch (e) { /* e.g. file:// in some browsers */ }
  }
  const rerender = () => render();
  $("v-sort").addEventListener("change", () => { view.sort = $("v-sort").value; view.dir = Advisor.NATURAL_DIR[view.sort]; rerender(); });
  $("v-dir").addEventListener("click", ev => { ev.preventDefault(); view.dir = view.dir === "asc" ? "desc" : "asc"; rerender(); });
  [["v-src", "src"], ["v-fit", "fit"], ["v-lic", "lic"], ["v-fam", "fam"]].forEach(([id, k]) => $(id).addEventListener("change", () => { view[k] = $(id).value; rerender(); }));
  $("v-q").addEventListener("input", () => { view.q = $("v-q").value; rerender(); });
  $("v-min").addEventListener("input", () => { view.min = +$("v-min").value; rerender(); });
  $("v-reset").addEventListener("click", ev => { ev.preventDefault(); Object.assign(view, Advisor.DEFAULT_VIEW, { all: false }); rerender(); });
  $("v-all").addEventListener("click", ev => { ev.preventDefault(); view.all = !view.all; rerender(); });
  $("v-copy").addEventListener("click", async ev => {
    ev.preventDefault(); const b = $("v-copy"), url = location.href; let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { try { const t = document.createElement("textarea"); t.value = url; t.style.position = "fixed"; t.style.opacity = "0"; document.body.append(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch (e2) { /* ignore */ } }
    b.textContent = ok ? "Link copied" : "Copy failed: use the address bar"; setTimeout(() => { b.textContent = "Copy link to this view"; }, 1800);
  });
  // estimated speed at the selected depth + time to first token; never claims measurement at depth
  function longBlock(p, o) {
    if (o.ctx < 8192 || !p.depth) return "";
    const d = p.depth, ex = d.extrapolated;
    const tt = p.ttft != null ? `Time to first token for a full ${Advisor.fmtCtx(o.ctx)} prompt: <b>~${Advisor.fmtDur(p.ttft)}</b> (estimated).` : "Time to first token: not estimated (no prompt-processing data for this hardware, or the model is offloaded).";
    return `<p class="mut depthline"><span class="badge est">estimated</span> At ${Advisor.fmtCtx(o.ctx)} depth: <b>~${Math.round(d.tps)} tok/s</b> generation (${Math.round(d.ratio * 100)}% of the short-context speed). ${tt}${ex ? ` Beyond ${Advisor.fmtCtx(d.measuredDepthMax)} the slowdown is extrapolated; there are no measurements that deep for this model.` : ` Penalty fitted to measured runs up to ${Advisor.fmtCtx(d.measuredDepthMax)}; no measurement for this exact model and hardware at this depth.`}</p>`;
  }
  function affiliateSlot(input, cfg, hwr) {
    const A = window.LLMA_AFF;
    const key = cfg ? cfg.id : input.device, e = A && A.tag && A.q[key];
    if (!e) return "";
    const q = e.q + (e.mem && input.memory_gb ? " " + input.memory_gb + "GB" : "");
    const url = "https://www.amazon.com/s?k=" + encodeURIComponent(q).replace(/%20/g, "+") + "&tag=" + encodeURIComponent(A.tag);
    return `<aside class="card aff aff-v2" data-slot="affiliate-upgrade" data-placement="v2"><b>Shopping for ${esc(hwr.name)}?</b> <a class="btn" href="${esc(url)}" target="_blank" rel="sponsored noopener nofollow" data-affiliate="amazon" data-hardware="${esc(key)}" data-slot-id="advisor-results">${e.kind === "gpu" ? "Check price on Amazon" : "Search Amazon for this hardware"} &rarr;</a><p class="mut">Amazon search results for &ldquo;${esc(q)}&rdquo;; prices and stock are shown on Amazon. ${esc(A.disclosure)} <a href="data-sources.html#affiliate-disclosure">Disclosure</a></p></aside>`;
  }
  // Cloud GPU rental slot (referral). Prominent when the hardware cannot run the top models fully; compact otherwise. No prices.
  function cloudSlot(input, cfg, hwr, allRes) {
    const A = window.LLMA_AFF, ps = A && A.cloud && A.cloud.partners || [];
    if (!ps.length) return "";
    const total = data.models.models.length, full = allRes.filter(p => p.mode === "gpu").length;
    const strong = !allRes.length || !allRes[0] || allRes[0].mode !== "gpu" || full < total / 2;
    const key = cfg ? cfg.id : input.device;
    const links = ps.map(p => `<a class="btn" href="${esc(p.url)}" target="_blank" rel="sponsored noopener nofollow" data-sponsor="${esc(p.id)}" data-hardware="${esc(key)}" data-slot-id="advisor-results">Rent a cloud GPU on ${esc(p.name)} &rarr;</a>`).join(" ");
    const why = !allRes.length ? `Nothing in the dataset fits ${esc(hwr.name)} at this setting.` : strong ? `${total - full} of ${total} models do not fit ${esc(hwr.name)} fully at this setting.` : "";
    const disc = ps.length > 1 ? A.cloud.disclosure.replace("this link", "these links") : A.cloud.disclosure;
    return `<aside class="card aff cloud${strong ? " cloud-strong" : ""}" data-slot="cloud-gpu"><b>Rent a cloud GPU instead</b> ${links}<p class="mut">${why ? why + " " : ""}Renting by the hour is an option when you want to try a model before buying hardware. Check current rates on the provider's site. ${esc(disc)} <a href="data-sources.html#affiliate-disclosure">Disclosure</a></p></aside>`;
  }
  function render() {
    syncSegs();
    writeUrl();
    const k = $("kind").value;
    const cfg = k === "apple" ? cfgOf($("device").value) : null;
    const input = { kind: k, device: cfg ? cfg.hw : $("device").value, label: cfg ? cfg.name : undefined, count: +$("count").value, memory_gb: +$("mem").value,
                    ram_gb: +$("ram").value, ram_type: $("ramt").value };
    const o = { use: $("use").value, ctx: +$("ctx").value, kvq: $("kvq").value };
    const { hwr, results: allRes, excluded } = Advisor.recommend(input, data, o);
    $("hwinfo").innerHTML = `Using <b>${esc(hwr.name)}</b>: ${hwr.pool.toFixed(1)} GB usable for model + KV` +
      (hwr.discrete && !hwr.cpuOnly ? `, ${hwr.ramAvail.toFixed(0)} GB RAM available for offload` : "") +
      (hwr.frac ? ` (assumes ${Math.round(hwr.frac * 100)}% of unified memory usable)` : "") + `, ${hwr.gpuBw} GB/s memory bandwidth.` +
      (hwr.eff ? ` Estimated speeds use an efficiency factor of ${hwr.eff.toFixed(2)}, ${esc(hwr.effSource)}.` : "");
    const comm = ((measured && measured.community) || []).filter(c => c.hw_id === input.device);
    const affHtml = affiliateSlot(input, cfg, hwr) + cloudSlot(input, cfg, hwr, allRes); $("aff-slot").innerHTML = "";
    $("cfgnote").textContent = cfg && cfg.note ? cfg.note : "";
    $("community").innerHTML = comm.length ? `<section class="card"><h2>Community-submitted benchmarks <span class="badge est">unverified</span></h2>
      <p class="mut">Reviewed for format only; not independently verified and never used in the estimates above.</p><div class="tw"><table><tr><th>Model</th><th>Quant</th><th>Backend</th><th>pp tok/s</th><th>tg tok/s</th><th>llama.cpp build</th><th>Date</th></tr>` +
      comm.map(c => `<tr><td>${esc(c.model)}</td><td>${esc(c.quant)}</td><td>${esc(c.backend)}</td><td>${num(c.pp_tps)}</td><td>${num(c.tg_tps)}</td><td>${esc(c.build || "")}</td><td>${esc(c.date || "")}</td></tr>`).join("") + `</table></div></section>` : "";
    const sortOpts = ["rec", "tps", ...(allRes.some(p => p.depth) ? ["tpsctx"] : []), "size", ...(allRes.some(p => p.quality) ? ["quality"] : []), "ctx", "name"];
    const effSort = syncView(sortOpts, Math.max(0, ...allRes.map(p => p.tps || 0)));
    const filtered = Advisor.applyView(allRes, Object.assign({}, view, { sort: effSort }));
    const active = Advisor.viewActive(view), limited = effSort === "rec" && !active && !view.all && filtered.length > 8;
    const results = limited ? filtered.slice(0, 8) : filtered;
    const exc = excluded || [], extCount = allRes.filter(p => p.ctxStatus === "extended").length;
    $("ctxnote").innerHTML = o.ctx >= 262144 ? `<b>${fc(o.ctx)} context</b> needs flash attention (<code>-fa on</code>, included in the commands) and a lot of memory; prompt processing takes minutes to hours and generation slows down. Speeds at this depth are estimates.` : o.ctx >= 65536 ? "Long context needs flash attention and extra memory; generation slows as the context fills (speed at depth is estimated)." : "";
    $("excluded").innerHTML = exc.length ? `<div class="callout"><b>${exc.length} model${exc.length > 1 ? "s" : ""} not shown at ${fc(o.ctx)}:</b> context is capped at each model's verified maximum. ` + exc.map(e => `${esc(e.model.name)} (max context ${fc(e.native)})`).join(", ") + `.${extCount ? ` ${extCount} shown model${extCount > 1 ? "s are" : " is"} <b>extended</b> beyond the native maximum with YaRN, as documented on the model card.` : ""}</div>` : (extCount ? `<div class="callout">${extCount} model${extCount > 1 ? "s are" : " is"} <b>extended</b> beyond the native maximum with YaRN, as documented on the model card.</div>` : "");
    $("v-count").textContent = allRes.length ? `Showing ${results.length} of ${allRes.length} models that fit${active ? " (filters on)" : ""}.` : "";
    const canToggle = effSort === "rec" && !active && allRes.length > 8;
    $("v-all").hidden = !canToggle; if (canToggle) $("v-all").textContent = view.all ? "Show top 8 only" : `Show all ${allRes.length} models`;
    $("viewbar").hidden = !allRes.length;
    if (!allRes.length) { $("results").innerHTML = `<div class="card">Nothing in the dataset fits this setup at ${Advisor.fmtCtx(o.ctx)} context. Try a shorter context, a q8_0 or q4_0 KV cache, or more memory.</div>` + affHtml; return; }
    if (!results.length) { $("results").innerHTML = `<div class="card">No models match these filters. Use <b>Reset sort &amp; filters</b> above, or loosen a filter (the minimum tokens/sec and speed source are the strictest).</div>` + affHtml; return; }
    const total = hwr.pool, ramTot = hwr.cpuOnly ? hwr.pool : (hwr.ramAvail || hwr.pool);
    const meter = (label, used, cap, cls) => { const pct = cap > 0 ? Math.min(100, used / cap * 100) : 0; return `<div class="meter"><div class="row"><span>${label}</span><span><b>${used.toFixed(1)}</b> / ${cap.toFixed(0)} GB &middot; ${Math.round(pct)}%</span></div><div class="bar" role="img" aria-label="${label} ${Math.round(pct)} percent used"><i class="${cls || (pct > 92 ? "warn" : "")}" style="width:${pct}%"></i></div></div>`; };
    $("results").innerHTML = results.map((p, i) => {
      const m = p.model, si = Advisor.speedInfo(p), bc = si.short === "measured" ? "measured" : si.short === "estimated" ? "estimated" : "scaled";
      return `<article class="card res hov" style="animation-delay:${i * 45}ms"><div class="res-h"><span class="n">#${i + 1}</span><h3>${esc(m.name)}</h3><span class="q">${esc(p.quantLabel)}</span>
      <div class="tps"><b>~${p.tps ? Math.round(p.tps) : "?"}</b><span>tok/s generation${o.ctx >= 8192 && p.depth ? " (short ctx)" : ""}</span></div></div>
      <div class="badges"><span class="badge ${esc(bc)}" title="${esc(si.detail)}">${esc(si.short)}</span><span class="badge ${p.mode === "gpu" ? "ok" : "est"}">${MODE[p.mode]}</span>${p.usable ? "" : '<span class="badge est">likely too slow</span>'}
      <span class="badge plain">${m.moe ? `MoE ${m.params_b}B total / ${m.active_params_b}B active` : m.params_b + "B dense"}</span>${m.params_breakdown ? `<span class="badge plain" title="${esc(m.params_breakdown.note)}">incl. ${m.params_breakdown.ngram_embedding_b}B n-gram embedding + ${m.params_breakdown.mtp_b}B MTP</span>` : ""}<span class="badge plain">${esc(m.license || "license: see source")}</span>${p.ctxStatus === "extended" ? '<span class="badge est">extended context (YaRN)</span>' : ""}</div>
      ${hwr.cpuOnly ? "" : meter(hwr.discrete ? "VRAM" : "Unified memory", p.gpuGB, total)}${p.cpuGB > 0.05 || hwr.cpuOnly ? meter("System RAM", p.cpuGB, ramTot, "ram") : ""}
      <p class="mut q-line">${p.quality ? `LMArena ${esc(p.quality.category)} rank #${num(p.quality.rank)} (rating ${num(p.quality.rating)}, ${esc(p.quality.date)})` : "LMArena: not rated"} &middot; max context that fits here: ${p.maxCtx ? fc(p.maxCtx) : "under 4k"}${p.maxCtx > m.context_max ? " (extended)" : ""} &middot; model max context ${fc(m.context_max)}${p.limits.extended > m.context_max ? `, ${fc(p.limits.extended)} extended with YaRN` : ""}</p>
      ${p.ctxStatus === "extended" ? `<p class="mut ctxwarn"><span class="badge est">extended context</span> ${fc(o.ctx)} is beyond this model's native ${fc(m.context_max)}. ${esc(m.context_extended.source)}. ${esc(m.context_extended.caveat)}</p>` : ""}
      ${longBlock(p, o)}
      <p class="mut">${esc(si.detail)}${p.speed ? " Source: " + p.speed.sources.map(x => `<a href="${safeUrl(x.url)}" rel="noopener">${esc(x.id)}</a>`).join(", ") + ", latest " + esc(p.speed.latest) + "." : ""} Memory: weights ${p.weightsGB.toFixed(1)} GB + KV cache ${p.kvGB.toFixed(2)} GB @ ${fc(o.ctx)} ctx (${o.kvq}${m.kv.linear_state_gb ? `, incl. ${m.kv.linear_state_gb.toFixed(2)} GB fixed linear-attention state` : ""}).</p>
      <div class="cmd"><div class="code"><div class="top"><span>llama.cpp</span><button class="copy" type="button" data-c="l${i}">Copy</button></div><pre id="l${i}">${esc(p.command.llama)}</pre></div>
      <div class="code"><div class="top"><span>ollama</span><button class="copy" type="button" data-c="o${i}">Copy</button></div><pre id="o${i}">${esc(p.command.ollama)}</pre></div></div>
      ${p.command.ollamaNote ? `<p class="mut">${esc(p.command.ollamaNote)}</p>` : ""}
      ${Advisor.mlxHtml(p.mlx, esc, "x" + i, true)}
      <p class="src">Source: <a href="${safeUrl(m.source_url)}" rel="noopener">${esc(m.id)}</a> &middot; GGUF: <a href="${safeUrl(m.gguf_source_url)}" rel="noopener">${esc(m.gguf_repo)}</a> &middot; last verified ${esc(m.last_verified)}</p></article>`;
    }).map((h, i) => i === 0 ? h + affHtml : h).join(""); // price box directly under the top recommendation
  }
  $("kind").addEventListener("change", () => { fillDevices(); render(); });
  $("device").addEventListener("change", () => { if ($("kind").value === "apple") fillMem(); });
  document.querySelectorAll("#f select,#f input").forEach(e => { if (e.id !== "kind" && !e.closest(".seg")) e.addEventListener("change", render); });
  document.querySelectorAll("#f input[type=number]").forEach(e => e.addEventListener("input", render));
  $("f").addEventListener("submit", ev => ev.preventDefault()); // (was an inline onsubmit; inline handlers are blocked by the CSP)
  // prefill from query string (used by generated pages): ?kind=&device=&count=&mem=&ram=&ramt=&use=
  const q = new URLSearchParams(location.search);
  const setIf = (id, v) => { if (v && [...$(id).options].some(op => op.value === v)) $(id).value = v; };
  setIf("kind", q.get("kind")); // bad ?kind= falls back to the default
  fillDevices();
  if (q.get("config") && cfgOf(q.get("config")) && $("kind").value === "apple") { $("device").value = q.get("config"); fillMem(); }
  else if ($("kind").value === "apple" && q.get("device")) { const c = hardware.apple_configs.find(c => c.hw === q.get("device")); if (c) { $("device").value = c.id; fillMem(); } }
  ["mem", "ramt", "use"].forEach(id => setIf(id, q.get(id)));
  { const r = +q.get("ram"); if (q.get("ram") && Number.isFinite(r) && r >= 4 && r <= 1024) $("ram").value = r; } // ram is a number input: clamp to its range
  setIf("ctx", q.get("ctx")); setIf("kvq", q.get("kvq")); // ignore values that are not an offered option (a bad ?ctx= must not blank the select)
  if ($("kind").value !== "apple") ["device", "count"].forEach(id => setIf(id, q.get(id)));
  if (SORTS[q.get("sort")]) view.sort = q.get("sort");
  view.dir = q.get("dir") === "asc" || q.get("dir") === "desc" ? q.get("dir") : Advisor.NATURAL_DIR[view.sort];
  view.q = q.get("q") || ""; if (["all", "measured", "measured+scaled"].includes(q.get("src"))) view.src = q.get("src");
  if (["all", "gpu", "offload"].includes(q.get("fit"))) view.fit = q.get("fit"); if (["all", "permissive"].includes(q.get("lic"))) view.lic = q.get("lic");
  if (families.includes(q.get("fam"))) view.fam = q.get("fam"); view.min = Math.max(0, +q.get("min") || 0); view.all = q.get("all") === "1";
  $("changelog").innerHTML = models.changelog.map(c => `<b>${esc(c.date)}</b><ul>${c.changes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`).join("");
  render();
})();
