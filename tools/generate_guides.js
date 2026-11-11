// Search-intent guides built from the dataset: /guides/ (hub), /guides/best-local-llm-mac-<N>gb.html,
// /guides/strata-vs-llamacpp.html. VRAM "best local LLM for N GB GPU" pages already live at /vram/;
// this module links them rather than duplicating them. Called by generate_pages.js.
const fs = require("fs"), path = require("path");
const STRATA_URL = "https://github.com/Niko1221/Strata";
const MAC_TIERS = [16, 24, 32];
const GPU_TIERS = [8, 12, 16, 24];
const slugOf = t => t.kind === "gpu" ? (t.device + (t.count > 1 ? "-" + t.count : "")) : t.slug;

function macSetups(N, hw) {
  const out = [];
  for (const c of hw.apple_configs) {
    if (!(c.memory_options_gb || []).includes(N)) continue;
    const chip = hw.apple.find(a => a.id === c.hw);
    if (!chip) continue;
    const bw = (chip.bandwidth_by_mem_gb && chip.bandwidth_by_mem_gb[String(N)]) || chip.bandwidth_gbps;
    out.push({ c, chip, bw, input: { kind: "apple", device: c.hw, label: c.name, count: 1, memory_gb: N, ram_gb: 32, ram_type: "ddr5-5600" } });
  }
  return out.sort((a, b) => b.bw - a.bw || a.c.name.localeCompare(b.c.name));
}
function isBusy(r) {
  const n = (r.notes || "").toLowerCase();
  return r.busy === true || /busy shared host|load average 90/.test(n);
}
function gpuName(r) { return String(r.device_raw || r.hw_id).replace(/^NVIDIA GeForce /, ""); }
function ctxLabel(r) {
  if (r.prompt_kind === "mixed") return "short chat (~100 tok prompt)";
  if (r.prompt_tokens < 1000) return "empty (" + r.prompt_tokens + " tok)";
  return Math.round(r.prompt_tokens / 1024) + "K (" + r.prompt_tokens + " tok)";
}
function refCtx(x) { return x.server ? "short chat (~100 tok prompt)" : x.depth ? Math.round(x.depth / 1024) + "K" : "empty"; }

function run({ A, data, L, esc, SITE, EXTRA }) {
  const hw = data.hardware, M = data.models.models, AQ = L.affiliateQueries(hw);
  const wr = (rel, html) => { const f = path.join(SITE, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  const faq = L.faqSection;
  const th = (l, k) => `<th data-sort="${k}">${l}</th>`;
  const tw = (id, head, rows) => `<div class="tw"><table class="sortable" data-status="sort-status-${id}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div><p class="mut" id="sort-status-${id}" role="status" aria-live="polite"></p>`;
  const shell = (d, title, desc, crumbs, h1, lead, body, cur) => L.head(d, title, desc) + L.nav(d, cur || "guides") + `<main class="wrap"><header class="page-hero"><div class="crumbs">${crumbs}</div><h1>${esc(h1)}</h1><p>${lead}</p></header>${body}<script src="${d}hwtable.js?v=${L.VER}"></script></main>` + L.footer(d);
  const targetFor = (c, N) => hw.targets.find(t => t.kind === "apple" && t.config === c.id && t.memory_gb === N);
  const hwHref = (c, N, d) => { const t = targetFor(c, N); return t ? `${d}hardware/${t.slug}.html` : `${d}index.html?kind=apple&amp;config=${encodeURIComponent(c.id)}&amp;mem=${N}`; };
  const modelLink = (m, d) => `<a href="${d}models/${m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.html">${esc(m.name)}</a>`;
  const out = { mac: [], strata: false };

  // ---------- Mac memory guides ----------
  for (const N of MAC_TIERS) {
    const setups = macSetups(N, hw);
    if (!setups.length) continue;
    const primary = setups.find(s => s.chip.id === "m6") || setups.find(s => /^(m6|m5|m4)$/.test(s.chip.id)) || setups[0];
    const r = A.recommend(primary.input, data, { use: "all", ctx: 16384, kvq: "f16" }), hwr = r.hwr;
    const rows = r.results.slice().sort((a, b) => (b.model.params_b - a.model.params_b));
    const full = rows.filter(p => p.mode === "gpu"), off = rows.filter(p => p.mode !== "gpu");
    const topFull = full.slice().sort((a, b) => b.model.params_b - a.model.params_b);
    const fastest = full.slice().sort((a, b) => (b.tps || 0) - (a.tps || 0))[0];
    const speedTxt = p => p && p.tps ? `~${Math.round(p.tps)} tok/s (${A.speedInfo(p).short})` : "speed unknown";
    const faster = setups.filter(s => s.bw > primary.bw * 1.15);
    const chips = [...new Set(setups.map(s => `${s.chip.name} (${s.bw} GB/s)`))];
    const answer = topFull[0]
      ? `On a ${N}GB Mac (${esc(primary.chip.name)}, ${primary.bw} GB/s), the largest model in our dataset that fits fully at 16k context is ${esc(topFull[0].model.name)} ${esc(topFull[0].quantLabel)} (${(topFull[0].weightsGB + topFull[0].kvGB).toFixed(1)} GB, ${esc(speedTxt(topFull[0]))}).${fastest && fastest.model.id !== topFull[0].model.id ? ` The fastest that fits is ${esc(fastest.model.name)} ${esc(fastest.quantLabel)} at ${esc(speedTxt(fastest))}.` : ""}`
      : `No model in our dataset fits fully in ${N} GB of unified memory at 16k context; ${off.length} run with CPU-side offload.`;
    const title = `Best local LLMs for a ${N}GB Mac: what fits + tokens/sec (2026) | Local LLM Advisor`;
    const desc = topFull[0]
      ? `${N}GB Mac: ${full.length} of ${M.length} models fit fully at 16k context. Largest: ${topFull[0].model.name} ${topFull[0].quantLabel} (${speedTxt(topFull[0])}). Speeds on ${primary.chip.name} (${primary.bw} GB/s).`
      : `${N}GB Mac: no model in the dataset fits fully at 16k context; ${off.length} run with offload.`;
    const lead = `${answer} Unified memory is shared with the system, so about ${hwr.pool.toFixed(1)} GB is usable for the model and KV cache. Speeds are labelled measured, scaled or estimated.`;
    const macList = setups.map(s => {
      const href = hwHref(s.c, N, "../");
      const amz = L.amazonLink({ config: s.c.id, device: s.c.hw, memory_gb: N }, AQ, { mem: N, slot: "guides-mac" });
      return `<li><a href="${href}">${esc(s.c.name)} ${N}GB</a> &middot; ${s.bw} GB/s${amz}${s === primary ? ' <span class="mut">(table below)</span>' : ""}</li>`;
    }).join("");
    const body = `<div class="stats"><div class="stat"><b>${hwr.pool.toFixed(1)} GB</b><span>usable for model + KV cache</span></div><div class="stat"><b>${full.length}/${M.length}</b><span>models fit fully at 16k</span></div><div class="stat"><b>${primary.bw} GB/s</b><span>${esc(primary.chip.name)} bandwidth at ${N}GB</span></div><div class="stat"><b>${setups.length}</b><span>Mac configs with ${N}GB</span></div></div>
<section class="card"><h2>The short answer</h2><p>${answer}</p>${faster.length ? `<p class="mut">Some ${N}GB Macs are much faster than the base ${esc(primary.chip.name)}: ${faster.slice(0, 3).map(s => `${esc(s.c.name)} at ${s.bw} GB/s`).join("; ")}. The table uses the common base chip so the numbers stay conservative.</p>` : ""}</section>
<section class="card"><h2>Macs with ${N} GB of unified memory</h2><ul class="guide-list">${macList}</ul><p class="mut">Bandwidth can change with the memory size (for example M6 is 153 GB/s at 16GB and 170 GB/s at 24/32GB). ${L.AFFILIATE.amazonTag ? "Amazon links are search results, not a price. " + L.AFFILIATE.disclosure : ""}</p></section>
<section class="card"><h2>Models that fit a ${N}GB ${esc(primary.chip.name)}, largest first</h2><p class="mut">16k context, f16 KV cache, ${primary.bw} GB/s. ${chips.length > 1 ? "Other chips at this size: " + chips.filter(c => !c.startsWith(primary.chip.name)).join(", ") + "." : ""}</p>` +
      (rows.length ? tw("mac" + N, th("Model", "text") + th("Params", "num") + th("Quant", "text") + th("Fit", "text") + th("Memory", "num") + th("Tok/s", "num") + "<th>Speed source</th>",
        rows.map(p => `<tr><td data-v="${esc(p.model.name.toLowerCase())}">${modelLink(p.model, "../")}</td><td class="num" data-v="${p.model.params_b}">${p.model.params_b}B${p.model.moe ? " MoE" : ""}</td><td data-v="${esc(p.quantLabel)}">${esc(p.quantLabel)}</td><td data-v="${p.mode}">${p.mode === "gpu" ? "fits fully" : "needs offload"}</td><td class="num" data-v="${(p.weightsGB + p.kvGB).toFixed(1)}">${(p.weightsGB + p.kvGB).toFixed(1)} GB</td><td class="num" data-v="${p.tps ? p.tps.toFixed(1) : ""}">${p.tps ? Math.round(p.tps) : "?"}</td><td>${A.speedInfo(p).short}</td></tr>`).join("")) : `<p class="mut">No model in the dataset runs on ${N} GB at this context.</p>`) +
      `</section>${off.length ? `<section class="card"><h2>What does not fit fully</h2><p class="mut">${off.map(p => `${modelLink(p.model, "../")} (needs ${(p.weightsGB + p.kvGB).toFixed(0)} GB at 16k)`).join("; ")}. ${L.rentLinks({ hardware: "mac-" + N + "gb", slot: "guides-mac-rent" })}</p></section>` : ""}
${L.mlxExplainer("../", { short: true })}
${faq([[`What is the best local LLM for a ${N}GB Mac?`, answer],
  [`Does a ${N}GB Mac share memory with the OS?`, `Yes. We treat about ${hwr.pool.toFixed(1)} GB of the ${N} GB as usable for the model and KV cache, which is why a model whose file is close to ${N} GB may not fit at 16k context.`],
  [`Are these speeds measured on a Mac?`, full.some(p => A.speedInfo(p).short === "measured") ? "Some rows are measured; the rest are scaled from a similar run or estimated from memory bandwidth. Every speed is labelled." : "Most Mac speeds on this page are estimated from memory bandwidth, or scaled from a measured run on similar hardware. They are labelled so you can tell them apart. MLX may be faster than the llama.cpp figures; we do not estimate by how much."],
  [`Which ${N}GB Mac is fastest for local LLMs?`, faster.length ? `At this memory size, higher bandwidth wins: ${faster[0].c.name} is listed at ${faster[0].bw} GB/s, versus ${primary.bw} GB/s for the base ${primary.chip.name}.` : `Among the ${N}GB configs we list, bandwidth is ${primary.bw} GB/s on the ${primary.chip.name}. Pro and Max chips at other memory sizes are faster.`]])}
<p class="mut">Also see: ${MAC_TIERS.filter(n => n !== N).map(n => `<a href="best-local-llm-mac-${n}gb.html">${n}GB Mac</a>`).join(" &middot; ")} &middot; <a href="index.html">all guides</a> &middot; <a href="../vram/${N}gb.html">${N}GB VRAM (GPUs)</a> &middot; <a href="../index.html?kind=apple">interactive advisor</a>.</p>`;
    wr(`guides/best-local-llm-mac-${N}gb.html`, shell("../", title, desc, `<a href="../index.html">Advisor</a> / <a href="index.html">Guides</a> / ${N}GB Mac`, `Best local LLMs for a ${N}GB Mac`, lead, body));
    out.mac.push({ N, full: full.length, top: topFull[0] && topFull[0].model.name, primary: primary.chip.name });
  }

  // ---------- Strata vs llama.cpp ----------
  const strata = (data.measured && data.measured.strata) || [];
  const refs = (data.measured && data.measured.strata_ref) || [];
  if (strata.length) {
    const byHw = {};
    strata.filter(r => !r.variant).forEach(r => (byHw[r.hw_id] = byHw[r.hw_id] || []).push(r));
    const hwOrder = ["rtx-3060", "rtx-3090", "rtx-5060ti-16"].filter(id => byHw[id]);
    const pick = (rows, model, mtp, kind) => rows.find(r => r.model === model && r.mtp === mtp && (kind === "chat" ? r.prompt_kind === "mixed" : kind === "long" ? r.prompt_tokens > 30000 : kind === "empty" ? r.prompt_tokens < 1000 && !r.prompt_kind : true));
    const models = [...new Set(strata.map(r => r.model))];
    // Headline figures (computed, not handwritten)
    const facts = [];
    for (const id of hwOrder) {
      const rows = byHw[id], name = gpuName(rows[0]);
      for (const model of models) {
        const sEmpty = pick(rows, model, "on", "empty") || pick(rows, model, "off", "empty");
        const sChat = pick(rows, model, "off", "chat") || pick(rows, model, "on", "chat");
        const sLong = pick(rows, model, "on", "long") || pick(rows, model, "off", "long");
        const sameQuant = refs.filter(x => x.hw_id === id && (!sEmpty || x.quant === sEmpty.quant || model.indexOf("3.6") >= 0));
        // llama.cpp empty, non-busy, prefer all-on-GPU then lowest n_cpu_moe, depth 0, not server
        const lEmpty = refs.filter(x => x.hw_id === id && !x.server && !x.depth && !isBusy(x) && (sEmpty ? x.quant === sEmpty.quant || /3\.6/.test(model) && /3\.6/.test(x.site_id || "") : /3\.6/.test(x.site_id || ""))).sort((a, b) => (a.n_cpu_moe || 0) - (b.n_cpu_moe || 0))[0];
        const lLong = refs.filter(x => x.hw_id === id && !x.server && x.depth >= 30000 && !isBusy(x)).sort((a, b) => (a.n_cpu_moe || 0) - (b.n_cpu_moe || 0))[0];
        const busyNote = rows.some(r => r.model === model && isBusy(r));
        if (sEmpty && lEmpty && /3\.6/.test(model)) {
          facts.push({ id, name, model, kind: "q36-empty", s: sEmpty.tg_tps, l: lEmpty.tg_tps, busy: busyNote, off: lEmpty.n_cpu_moe || 0 });
        }
        if (sLong && lLong && /3\.6/.test(model)) {
          facts.push({ id, name, model, kind: "q36-long", s: sLong.tg_tps, l: lLong.tg_tps, busy: busyNote, off: lLong.n_cpu_moe || 0 });
        }
        const on = pick(rows, model, "on", "empty"), off = pick(rows, model, "off", "empty");
        if (on && off && /Flash/.test(model)) facts.push({ id, name, model, kind: "flash-mtp", s: on.tg_tps, l: off.tg_tps, busy: busyNote });
      }
    }
    const q36Empty = facts.filter(f => f.kind === "q36-empty" && !f.busy);
    const q36Busy = facts.filter(f => f.kind === "q36-empty" && f.busy);
    const flash = facts.filter(f => f.kind === "flash-mtp");
    const q36Long = facts.filter(f => f.kind === "q36-long" && !f.busy);
    const fmt = n => (Math.round(n * 10) / 10).toFixed(n >= 10 ? 0 : 1);
    const verdictParts = [];
    verdictParts.push("Strata helps most when a MoE model is too big for the GPU's VRAM, because it keeps experts in system RAM.");
    const fullGpu = q36Empty.find(f => f.off === 0);
    const offloadWin = q36Empty.filter(f => f.off > 0 && f.s > f.l);
    if (offloadWin[0]) verdictParts.push(`On an ${offloadWin[0].name}, Strata decoded ${esc(offloadWin[0].model)} at ${fmt(offloadWin[0].s)} tok/s short-context versus ${fmt(offloadWin[0].l)} tok/s for llama.cpp with expert offload.`);
    if (fullGpu) verdictParts.push(`When the same model fits fully in VRAM, llama.cpp is faster: ${fmt(fullGpu.l)} tok/s versus Strata's ${fmt(fullGpu.s)} tok/s on an ${fullGpu.name}.`);
    const longLose = q36Long.find(f => f.s < f.l);
    if (longLose) verdictParts.push(`At ~35K context on the ${longLose.name}, llama.cpp stayed ahead (${fmt(longLose.l)} vs ${fmt(longLose.s)} tok/s).`);
    if (flash[0]) verdictParts.push(`For ${esc(flash[0].model)}, turning MTP drafting on raised short-context decode from ${fmt(flash[0].l)} to ${fmt(flash[0].s)} tok/s on the ${flash[0].name}.`);
    if (q36Busy.length) verdictParts.push(`We do not treat the ${q36Busy[0].name} Strata numbers for ${esc(q36Busy[0].model)} as a fair head-to-head: that Strata run was on a busy shared host (CPU load average about 90–150). The llama.cpp figures for that card come from a quieter rerun.`);
    const noMtp = strata.some(r => /never engaged/.test(r.notes || ""));
    if (noMtp) verdictParts.push("On this Strata build, MTP drafts never engaged for Qwen3.6 35B-A3B on any card we tested, so we would turn MTP off for that model.");
    const ram = strata.find(r => r.ram_used_gib);
    if (ram) verdictParts.push(`Plan for a lot of host RAM: ${gpuName(ram)} used about ${Math.round(ram.ram_used_gib)} GB while running ${esc(ram.model)} ${esc(ram.quant)}.`);
    const verdict = verdictParts.join(" ");

    const hwSlug = { "rtx-3060": "rtx-3060-12gb", "rtx-3090": "rtx-3090-24gb", "rtx-5060ti-16": "rtx-5060ti-16gb" };
    const sections = hwOrder.map(id => {
      const rows = byHw[id].slice().sort((a, b) => a.model.localeCompare(b.model) || (a.mtp < b.mtp ? 1 : a.mtp > b.mtp ? -1 : (a.prompt_kind === "mixed" ? 1 : a.prompt_tokens) - (b.prompt_kind === "mixed" ? 1 : b.prompt_tokens)));
      const h = rows[0], slug = hwSlug[id], t = hw.targets.find(x => x.slug === slug);
      const amz = t ? L.amazonLink(t, AQ, { slot: "guides-strata" }) : "";
      const byModel = {};
      rows.forEach(r => (byModel[r.model] = byModel[r.model] || []).push(r));
      const blocks = Object.entries(byModel).map(([model, hr]) => {
        const body = hr.map(r => `<tr><td>${ctxLabel(r)}</td><td>${r.mtp}</td><td class="num">${(+r.tg_tps).toFixed(1)}</td><td class="num">${r.pp_tps === "" ? "-" : Math.round(r.pp_tps)}</td><td class="num">${r.mtp_accept === "" ? "-" : Math.round(r.mtp_accept * 100) + "%"}</td></tr>`).join("");
        const busy = hr.some(isBusy) ? `<p class="mut"><b>Busy-host caveat.</b> These Strata rows were measured on a busy shared host (other tenants kept the CPUs at a load average of about 90–150). That mostly slows the CPU-side expert work, so treat them as a floor, not a like-for-like comparison with the quieter llama.cpp rerun below.</p>` : (hr.some(r => /host load average 11/.test(r.notes || "")) ? `<p class="mut">Measured on a shared host that was not fully idle (load average about 12–20 during these Strata runs); a dedicated machine may be a little faster.</p>` : "");
        const no = hr.some(r => /never engaged/.test(r.notes || "")) ? `<p class="mut">MTP drafts did not engage for ${esc(model)} on this card (0 drafts). Turning MTP off is the fairer setting.</p>` : "";
        const q = hr[0].quant;
        const ref = refs.filter(x => x.hw_id === id && (x.quant === q || /3\.6/.test(model) && /3\.6/.test(x.site_id || "")) && !isBusy(x)).sort((a, b) => a.depth - b.depth || (a.server - b.server) || (a.n_cpu_moe || 0) - (b.n_cpu_moe || 0));
        const refT = ref.length ? `<p>Same card, llama.cpp (flash attention on)${ref.some(x => x.n_cpu_moe) ? ", with MoE experts offloaded to system RAM where the model does not fit in VRAM" : ""}:</p>` +
          tw("ref-" + id + "-" + model.replace(/\W+/g, ""), "<th>Context</th><th>Setup</th>" + th("Decode tok/s", "num") + th("Prompt tok/s", "num"),
            ref.map(x => `<tr><td>${refCtx(x)}</td><td>${x.server ? "llama-server, " : ""}${x.n_cpu_moe ? "<code>--n-cpu-moe " + x.n_cpu_moe + "</code>" : "all on GPU"}</td><td class="num" data-v="${x.tg_tps}">${(+x.tg_tps).toFixed(1)}</td><td class="num" data-v="${x.pp_tps}">${Math.round(x.pp_tps)}</td></tr>`).join("")) : "";
        return `<h3>${esc(model)} <span class="mut">${esc(q)}</span></h3><div class="tw"><table><thead><tr><th>Context</th><th>MTP</th><th>Decode tok/s</th><th>Prompt tok/s</th><th>MTP accepted</th></tr></thead><tbody>${body}</tbody></table></div>${no}${busy}${refT}`;
      }).join("");
      return `<section class="card" id="${esc(id)}"><h2>${esc(gpuName(h))}${amz}</h2><p class="mut">${Math.round(h.host_ram_gib)} GB host RAM${h.ram_used_gib ? ` (about ${Math.round(h.ram_used_gib)} GB in use by Strata)` : ""}, ${esc((h.cpu || "").split(" (")[0])}. Engine ${esc(h.engine_version)}, measured ${esc(h.date)}. ${slug ? `<a href="../hardware/${slug}.html">Hardware page</a>.` : ""}</p>${blocks}</section>`;
    }).join("");

    const citeUrl = "https://localllmadvisor.com/guides/strata-vs-llamacpp.html";
    const iframe = `<iframe src="https://localllmadvisor.com/embed/card/strata-vs-llamacpp.html" width="420" height="280" style="border:0" loading="lazy" title="Strata vs llama.cpp (Local LLM Advisor)"></iframe>`;
    const img = `<a href="${citeUrl}"><img src="https://localllmadvisor.com/og-image.png" alt="Strata vs llama.cpp measured benchmarks — Local LLM Advisor" width="600"></a>`;
    const title = "Strata vs llama.cpp for local MoE models: measured tokens/sec (2026) | Local LLM Advisor";
    const desc = `Measured Strata vs llama.cpp decode and prefill on RTX 3060 12GB, RTX 3090 and RTX 5060 Ti 16GB, including MTP on/off and a busy-host caveat on the first 5060 Ti run.`;
    const body = `<div class="stats"><div class="stat"><b>${hwOrder.length}</b><span>GPUs we measured both engines on</span></div><div class="stat"><b>${models.length}</b><span>models</span></div><div class="stat"><b>${strata.length}</b><span>Strata runs</span></div><div class="stat"><b>${refs.length}</b><span>llama.cpp comparison runs</span></div></div>
<section class="card"><h2>The short answer</h2><p>${verdict}</p><p class="mut"><a href="${STRATA_URL}" rel="noopener">Strata</a> is a MoE inference engine, not a llama.cpp backend. These numbers are kept out of the llama.cpp medians used elsewhere on the site. We used Strata 0.2.7 (build 0.1.53, engine 0.1.52) and did not rent extra cards for this comparison.</p></section>
${sections}
${L.citeBlock("../", { title: "Strata vs llama.cpp measured benchmarks", url: citeUrl, citeId: "cite-strata" })}
${L.embedBlock("../", { iframe, img, embedId: "emb-strata", preview: `<p class="mut">Preview:</p><iframe src="../embed/card/strata-vs-llamacpp.html" width="420" height="280" style="border:0;max-width:100%" loading="lazy" title="Embed preview"></iframe>` })}
${faq([["Should I use Strata or llama.cpp?", verdict],
  ["Why are the RTX 5060 Ti Qwen3.6 Strata numbers caveated?", "That Strata sweep ran on a busy shared host (CPU load average about 90–150 from other tenants). The load mostly hurts CPU-side expert work. The llama.cpp figures for the same card come from a quieter rerun (load average about 11–51), so they should not be lined up as a tight head-to-head. We do not have a quiet-host Strata run for Qwen3.6 on this card."],
  ["Does MTP always help?", noMtp ? "No. On this Strata build, MTP drafts never engaged for Qwen3.6 35B-A3B (0 drafts on every card), so turning MTP off is the better setting for that model. On Qwen3.8 Flash-Next, MTP was accepted often and raised decode speed." : "It depends on the model. See the MTP-accepted column in the tables."],
  ["How much RAM does Strata need?", ram ? `It keeps experts in system RAM. Our ${gpuName(ram)} run of ${esc(ram.model)} ${esc(ram.quant)} used about ${Math.round(ram.ram_used_gib)} GB of host RAM.` : "It keeps experts in system RAM, so plan for well more than the GPU's VRAM."],
  ["Where is the raw data?", `In the <a href="${L.HF_DATASET}" rel="noopener">benchmark dataset</a> and on the model pages (<a href="../models/qwen3-6-35b-a3b.html#strata">Qwen3.6 35B-A3B</a>, <a href="../models/qwen3-8-flash-next.html#strata">Qwen3.8 Flash-Next</a>).`]])}
<p class="mut">Related: ${hwOrder.map(id => hwSlug[id] ? `<a href="../hardware/${hwSlug[id]}.html">${esc(gpuName(byHw[id][0]))}</a>` : "").filter(Boolean).join(" &middot; ")} &middot; <a href="../compare/rtx-5060ti-16gb-vs-rtx-3060-12gb.html">RTX 5060 Ti vs RTX 3060</a> &middot; <a href="index.html">all guides</a>.</p>`;
    wr("guides/strata-vs-llamacpp.html", shell("../", title, desc, `<a href="../index.html">Advisor</a> / <a href="index.html">Guides</a> / Strata vs llama.cpp`, "Strata vs llama.cpp for local MoE models", verdict, body));

    // Compact noindex embed card (script-free, locked CSP, like hardware cards)
    const cardRows = q36Empty.concat(flash).map(f => {
      const label = f.kind === "flash-mtp" ? `${f.model} MTP on vs off` : `${f.model} short-context`;
      const right = f.kind === "flash-mtp" ? `Strata ${fmt(f.s)} vs ${fmt(f.l)} tok/s without MTP` : `Strata ${fmt(f.s)} vs llama.cpp ${fmt(f.l)} tok/s`;
      return `<tr><td>${esc(f.name)}<br><span class="m">${esc(label)}${f.busy ? " (busy host)" : ""}</span></td><td class="n">${esc(right)}</td></tr>`;
    }).join("");
    wr("embed/card/strata-vs-llamacpp.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="strict-origin-when-cross-origin"><title>Strata vs llama.cpp - Local LLM Advisor</title><style>:root{color-scheme:light dark}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#111}.c{border:1px solid #d5d9e2;border-radius:10px;margin:2px;padding:12px 14px}h1{font-size:15px;margin:0 0 2px}p{margin:0 0 8px;color:#5b6477;font-size:12.5px}table{border-collapse:collapse;width:100%}td{padding:3px 0;border-top:1px solid #e6e9f0;vertical-align:top}.n{text-align:right}.m{color:#5b6477;font-size:11.5px}a{color:#4f46e5}.f{margin-top:8px;font-size:12px}@media(prefers-color-scheme:dark){body{background:#11141a;color:#eceef3}.c{border-color:#2d3442}p,.m{color:#9ba3b4}td{border-color:#222833}a{color:#9aa6ff}}</style></head><body><div class="c"><h1>Strata vs llama.cpp</h1><p>Measured decode on rented GPUs. MTP and busy-host notes are on the full page.</p><table>${cardRows}</table><div class="f"><a href="${citeUrl}" target="_blank" rel="noopener">Full comparison and methods</a> &middot; Data: <a href="https://localllmadvisor.com/" target="_blank" rel="noopener">Matt, Local LLM Advisor</a>, CC BY 4.0</div></div></body></html>\n`);
    out.strata = true;
  }

  // ---------- Guides hub ----------
  const vramLinks = GPU_TIERS.map(n => `<li><a href="../vram/${n}gb.html">Best local LLMs for a ${n}GB GPU</a> &mdash; what fits at 16k context, context limits, and commands.</li>`).join("");
  const macLinks = out.mac.map(v => `<li><a href="best-local-llm-mac-${v.N}gb.html">Best local LLMs for a ${v.N}GB Mac</a>${v.top ? ` &mdash; largest that fits: ${esc(v.top)}` : ""}.</li>`).join("");
  const cmp = "rtx-5060ti-16gb-vs-rtx-3060-12gb";
  const body = `<section class="card"><h2>Best local LLM by memory</h2><p class="mut">Each page is generated from the same fit math and benchmarks as the advisor, and is refreshed when the data is.</p><h3>GPUs</h3><ul class="guide-list">${vramLinks}</ul><p class="mut"><a href="../vram/index.html">All VRAM tiers, 8GB to 512GB</a></p><h3>Macs</h3><ul class="guide-list">${macLinks}</ul></section>
<section class="card"><h2>Head-to-head</h2><ul class="guide-list">
<li><a href="../compare/${cmp}.html">RTX 5060 Ti 16GB vs RTX 3060 12GB for local LLMs</a> &mdash; what fits and how fast, with measured and estimated speeds labelled.</li>
${out.strata ? `<li><a href="strata-vs-llamacpp.html">Strata vs llama.cpp</a> &mdash; measured decode and prefill on the 3060, 3090 and 5060 Ti, including the busy-host caveat.</li>` : ""}
<li><a href="../compare/index.html">All hardware comparisons</a></li>
</ul></section>
<section class="card"><h2>Data</h2><ul class="guide-list"><li><a href="../leaderboard.html">Benchmark leaderboard</a> (sortable, CSV, cite and embed)</li><li><a href="../data-sources.html">Sources and attribution</a></li><li><a href="../embed/index.html">Embed a recommendation badge</a></li></ul></section>
${faq([["What is the best local LLM for a 16GB GPU?", `See the <a href="../vram/16gb.html">16GB VRAM guide</a>: it lists every model in our dataset that fits fully at 16k context, with speeds and commands.`],
  ["What about a 16GB, 24GB or 32GB Mac?", `Those are separate from GPU VRAM because unified memory is shared with the system. Start with the <a href="best-local-llm-mac-16gb.html">16GB Mac</a>, <a href="best-local-llm-mac-24gb.html">24GB Mac</a> or <a href="best-local-llm-mac-32gb.html">32GB Mac</a> guide.`],
  ["Should I use Strata or llama.cpp?", out.strata ? `It depends on whether the model fits in VRAM. The <a href="strata-vs-llamacpp.html">measured comparison</a> walks through the 3060, 3090 and 5060 Ti results.` : "We publish measured comparisons when we have them."],
  ["Do you list prices?", "No. Prices move daily, so where we name a GPU we link to an Amazon search (sponsored) and focus on fit and speed."]])}`;
  wr("guides/index.html", shell("../", "Local LLM guides: best models by GPU, Mac, and engine | Local LLM Advisor", "Data-driven guides to the best local LLMs for 8–24GB GPUs and 16–32GB Macs, plus RTX 5060 Ti vs 3060 and measured Strata vs llama.cpp results.", `<a href="../index.html">Advisor</a> / Guides`, "Guides to local LLMs on your hardware", "Short, data-driven answers to the questions people actually search for. Every table comes from the same dataset as the advisor and is regenerated when the data is refreshed.", body));
  return out;
}
module.exports = { run, MAC_TIERS, GPU_TIERS };
