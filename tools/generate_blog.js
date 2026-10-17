// /blog/ hub + the first data post. Every number is computed here from the data files (site/data/*.json, data/benchmarks/own/*.json).
// No prices appear: the dataset has none, so "value" is shown as speed per memory tier and per GB/s of bandwidth instead.
const REP = { 8: "rtx-4060", 12: "rtx-4070", 16: "rtx-5070ti", 24: "rtx-4090", 32: "rtx-5090", 48: "rtx-pro-6000", 64: "rtx-pro-6000", 96: "rtx-pro-6000", 128: "rtx-pro-6000", 192: "rtx-pro-6000", 256: "rtx-pro-6000", 512: "rtx-pro-6000" };
const SLUG = "state-of-local-llm-hardware-oct-2026", DATE = "2026-10-17";
function hbar(items, { unit = "", w = 760, lab = 250, aria = "" } = {}) {
  const rowH = 26, mx = Math.max(...items.map(i => i.value)), bw = w - lab - 70, h = items.length * rowH + 8, e = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${e(aria)}" preserveAspectRatio="xMinYMin meet">${items.map((it, i) => { const y = i * rowH + 4, bl = Math.max(2, it.value / mx * bw); return `<text x="${lab - 8}" y="${y + 15}" text-anchor="end">${e(it.label)}</text><rect class="bar ${it.cls || ""}" x="${lab}" y="${y + 3}" width="${bl.toFixed(1)}" height="16" rx="3"/><text class="val" x="${(lab + bl + 6).toFixed(1)}" y="${y + 15}">${e(it.text != null ? it.text : it.value)}${e(unit)}</text>`; }).join("")}</svg>`;
}
function run({ A, data, L, esc, SITE, C, shell, tw, th, wr, TIERS, slugify, HF_URL, ownRows, ownAll, nameOf, r1, med }) {
  const hw = data.hardware, M = data.measured, models = data.models.models, N = models.length, byName = Object.fromEntries(models.map(m => [m.name, m]));
  const fig = (id, cap, svg, tbl) => `<figure id="${id}">${svg}<figcaption class="mut">${cap}</figcaption><details><summary>Data table</summary>${tbl}</details></figure>`;
  const simple = (head, rows) => `<div class="tw"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const ownHw = [...new Set(ownRows.map(r => r.hw_id))], ownTg = ownRows.filter(r => !r.depth);
  const totalRows = M.counts.rows_used, points = M.counts.points, nHw = M.counts.hardware;
  const builds = [...new Set(ownRows.map(r => r.build_num))].sort(), cuda = [...new Set(ownRows.map(r => (r.notes.match(/CUDA ([\d.]+)/) || [])[1]).filter(Boolean))];
  const dates = [...new Set(ownRows.map(r => r.date))].sort();

  // 1. gpt-oss 20B Q4 across hardware
  const bw = id => { const t = hw.targets.find(t => t.device === id && t.count === 1); return t ? A.recommend({ kind: t.kind, device: t.device, count: 1, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type }, data, { use: "chat", ctx: 4096, kvq: "f16" }).hwr.gpuBw : null; };
  const g20 = [];
  for (const [id, es] of Object.entries(M.entries)) { const e = es.find(e => e.site_id === "openai/gpt-oss-20b" && e.qclass === "Q4" && e.tg > 0); if (e) g20.push({ id, name: nameOf(id), tg: e.tg, n: e.n, own: e.sources.some(s => s.id === "own-measurement"), bw: bw(id) }); }
  g20.sort((a, b) => b.tg - a.tg);
  const c1 = fig("gptoss20", `Median generation speed (tg128) of gpt-oss 20B at Q4, by hardware. Green bars include our own runs; blue bars are public community medians only. ${g20.length} hardware entries have this model measured.`,
    hbar(g20.map(g => ({ label: g.name, value: g.tg, cls: g.own ? "own" : "", text: r1(g.tg) })), { unit: " tok/s", aria: "gpt-oss 20B Q4 generation tokens per second by hardware" }),
    simple(["Hardware", "Gen tok/s", "Runs", "Bandwidth GB/s", "tok/s per 100 GB/s", "Origin"], g20.map(g => [esc(g.name), r1(g.tg), g.n, g.bw || "-", g.bw ? r1(g.tg / g.bw * 100) : "-", g.own ? "includes our runs" : "public"])));
  const perBw = g20.filter(g => g.bw), bestEff = perBw.slice().sort((a, b) => b.tg / b.bw - a.tg / a.bw)[0], worstEff = perBw.slice().sort((a, b) => a.tg / a.bw - b.tg / b.bw)[0];

  // 2. What fits per VRAM tier
  const tierRows = TIERS.map(n => { const rep = hw.gpus.find(g => g.id === REP[n]), exact = rep.vram_gb === n, d2 = exact ? data : { ...data, measured: null };
    const r = A.recommend({ kind: "gpu", device: rep.id, count: 1, vram_gb: n, ram_gb: 32, ram_type: "ddr5-5600" }, d2, { use: "all", ctx: 16384, kvq: "f16" }), full = r.results.filter(p => p.mode === "gpu"), big = full.slice().sort((a, b) => b.model.params_b - a.model.params_b)[0];
    return { n, fit: full.length, big }; });
  const c2 = fig("tiers", `Models (of ${N} in the dataset) that fit fully in GPU memory at 16k context with an f16 KV cache, by memory size. Bandwidth is assumed from a representative card for each tier, so this chart is about fit only.`,
    hbar(tierRows.map(t => ({ label: t.n + " GB", value: t.fit, text: t.fit + " of " + N })), { aria: "models that fit by memory tier", lab: 80 }),
    simple(["Memory", "Models that fit", "Largest that fits"], tierRows.map(t => [t.n + " GB", t.fit, t.big ? esc(t.big.model.name) + " " + esc(t.big.quantLabel) : "none"])));
  const firstAll = tierRows.find(t => t.fit === N);

  // 3. Depth penalty (own measurements)
  const grp = {}; for (const r of ownRows) (grp[r.hw_id + "|" + r.model + "|" + r.quant] = grp[r.hw_id + "|" + r.model + "|" + r.quant] || {})[r.depth] = r;
  const ret = d => Object.entries(grp).filter(([, g]) => g[0] && g[d]).map(([k, g]) => ({ k, hw: k.split("|")[0], model: k.split("|")[1], quant: k.split("|")[2], r: g[d].tg_tps / g[0].tg_tps, moe: !!(byName[k.split("|")[1]] || {}).moe }));
  const r4 = ret(4096), r16 = ret(16384), pct = x => Math.round(x * 100);
  const dense16 = r16.filter(x => !x.moe).map(x => x.r), moe16 = r16.filter(x => x.moe).map(x => x.r);
  const q4_4090 = r16.filter(x => x.hw === "rtx-4090" && x.quant === "Q4_K_M").sort((a, b) => a.r - b.r);
  const c3 = fig("depth", `Share of depth-0 generation speed that remains with 16k tokens already in the context, RTX 4090, Q4_K_M, our own llama-bench runs. Lower means a bigger penalty.`,
    hbar(q4_4090.map(x => ({ label: x.model + (x.moe ? " (MoE)" : ""), value: x.r * 100, cls: "own", text: pct(x.r) + "%" })), { aria: "speed retained at 16k context by model on RTX 4090", lab: 230 }),
    simple(["Model", "Type", "Retained at 4k", "Retained at 16k"], q4_4090.map(x => [esc(x.model), x.moe ? "MoE" : "dense", pct(ret(4096).find(y => y.k === x.k).r) + "%", pct(x.r) + "%"])));
  const cal = require("path").join(SITE, "data", "depth_calibration.json"), dc = JSON.parse(require("fs").readFileSync(cal, "utf8"));

  // 4. MoE vs dense
  const pairs = [["Gemma 4 26B-A4B", "Gemma 4 31B"], ["Qwen3.6 35B-A3B", "Qwen3.6 27B"]], moeRows = [];
  for (const hid of ownHw) for (const [mo, de] of pairs) { const a = ownTg.find(r => r.hw_id === hid && r.model === mo && r.quant === "Q4_K_M"), b = ownTg.find(r => r.hw_id === hid && r.model === de && r.quant === "Q4_K_M"); if (a && b) moeRows.push({ hid, mo, de, a: a.tg_tps, b: b.tg_tps, x: a.tg_tps / b.tg_tps }); }
  const moeMed = med(moeRows.map(r => r.x)), moeMin = Math.min(...moeRows.map(r => r.x)), moeMax = Math.max(...moeRows.map(r => r.x));
  const c4 = fig("moe", `Generation speed at Q4_K_M, depth 0, own runs: a mixture-of-experts model against a dense model of similar total size on the same GPU. ${moeRows.length} comparisons.`,
    hbar(moeRows.flatMap(r => [{ label: nameOf(r.hid).replace("NVIDIA GeForce ", "") + ": " + r.mo + " (MoE)", value: r.a, cls: "own", text: r1(r.a) }, { label: nameOf(r.hid).replace("NVIDIA GeForce ", "") + ": " + r.de + " (dense)", value: r.b, text: r1(r.b) }]).slice(0, 12), { unit: " tok/s", w: 820, lab: 330, aria: "MoE versus dense generation speed" }),
    simple(["GPU", "MoE model", "tok/s", "Dense model", "tok/s", "MoE advantage"], moeRows.map(r => [esc(nameOf(r.hid)), esc(r.mo), r1(r.a), esc(r.de), r1(r.b), r1(r.x) + "x"])));

  // 5. Quant cost
  const qr = [];
  for (const k of Object.keys(grp)) { const [h, m, q] = k.split("|"); if (q !== "Q8_0") continue; const g4 = grp[`${h}|${m}|Q4_K_M`]; if (g4 && g4[0] && grp[k][0]) qr.push({ h, m, x: grp[k][0].tg_tps / g4[0].tg_tps, moe: !!(byName[m] || {}).moe }); }
  const qDense = qr.filter(x => !x.moe).map(x => x.x), qMoe = qr.filter(x => x.moe).map(x => x.x);

  // 6. coverage
  const cov = Object.entries(M.entries).map(([id, es]) => ({ id, name: nameOf(id), n: es.length, own: ownAll.filter(r => r.hw_id === id).length })).sort((a, b) => b.n - a.n);
  const covChart = fig("coverage", `Measured (hardware, model, quantization) points on file per hardware entry. Green = we also ran it ourselves (our rows, including offload configurations, shown in the table).`, hbar(cov.map(c => ({ label: c.name, value: c.n, cls: c.own ? "own" : "", text: String(c.n) })), { aria: "measured points per hardware", lab: 250 }),
    simple(["Hardware", "Measured points", "Our llama-bench runs"], cov.map(c => [esc(c.name), c.n, c.own || "-"])));

  const q4g = (id) => (g20.find(g => g.id === id) || {});
  const title = "State of local LLM hardware, October 2026: what we measured | Local LLM Advisor";
  const desc = `${ownAll.length} llama-bench rows on ${ownHw.length} GPUs plus ${totalRows} public rows across ${nHw} hardware entries: what fits per memory tier, how much speed long context costs, MoE vs dense and Q8 vs Q4.`;
  const lead = `A first look at the data behind Local LLM Advisor: ${totalRows} measured benchmark rows (${points} hardware, model and quant points on ${nHw} hardware entries), plus ${ownAll.length} rows from our own llama-bench runs on ${ownHw.length} GPUs. Every number below is computed from the open dataset.`;
  const body = `<div class="stats"><div class="stat"><b>${totalRows}</b><span>measured rows used</span></div><div class="stat"><b>${points}</b><span>hardware / model / quant points</span></div><div class="stat"><b>${ownAll.length}</b><span>our own llama-bench rows (${ownRows.length} used below)</span></div><div class="stat"><b>${ownHw.length}</b><span>GPUs we measured ourselves</span></div></div>
<p class="mut">Published ${DATE}. Data generated ${esc(M.generated)}. By Matt, who runs this site; the site has Amazon and cloud GPU affiliate links, which never change the data or rankings (<a href="../data-sources.html#affiliate-disclosure">disclosure</a>).</p>
<section class="card"><h2>Key findings</h2><ul>
<li><b>Memory decides what you can run; bandwidth decides how fast.</b> At 16k context, ${tierRows[0].n} GB fits ${tierRows[0].fit} of the ${N} models; every model fits from ${firstAll ? firstAll.n : "n/a"} GB up (<a href="#tiers">chart</a>).</li>
<li><b>Mixture-of-experts models are much faster than dense models of similar size.</b> On the same GPU at Q4_K_M, the MoE model generated ${r1(moeMed)}x as many tokens per second as its dense counterpart (range ${r1(moeMin)}x to ${r1(moeMax)}x over ${moeRows.length} comparisons) (<a href="#moe">chart</a>).</li>
<li><b>Long context costs speed${med(dense16) < med(moe16) ? ", and dense models paid more in our runs" : ""}.</b> At 16k tokens of context, generation kept a median of ${pct(med(dense16))}% of its depth-0 speed for dense models and ${pct(med(moe16))}% for MoE models across ${r16.length} full-GPU runs (<a href="#depth">chart</a>).</li>
<li><b>Q8_0 costs speed relative to Q4_K_M.</b> Median Q8_0 speed was ${pct(med(qDense))}% of Q4_K_M for dense models (${qDense.length} comparisons) and ${qMoe.length ? pct(med(qMoe)) + "% for MoE models (" + qMoe.length + ")" : "not measured for MoE"}.</li>
<li><b>Same model, wide spread.</b> gpt-oss 20B at Q4 ranges from ${r1(g20[g20.length - 1].tg)} tok/s on ${esc(g20[g20.length - 1].name)} to ${r1(g20[0].tg)} tok/s on ${esc(g20[0].name)}; per 100 GB/s of memory bandwidth the spread runs from ${r1(worstEff.tg / worstEff.bw * 100)} (${esc(worstEff.name)}) to ${r1(bestEff.tg / bestEff.bw * 100)} (${esc(bestEff.name)}) (<a href="#gptoss20">chart</a>).</li></ul></section>
<section class="card"><h2>Speed by hardware, on one model</h2><p class="mut">The same model on every machine that has it measured removes the model as a variable. We have no price data in the dataset and do not state prices, so instead of price tiers this compares speed per memory bandwidth; memory sizes are on each <a href="../hardware/index.html">hardware page</a>.</p>${c1}<p class="mut">Bars mix our own runs with public community medians (different drivers, builds and backends), so small gaps are within noise. gpt-oss 20B is the one model with the widest hardware coverage in the dataset.</p></section>
<section class="card"><h2>What fits at each memory tier</h2>${c2}<p class="mut">Same fit math as the <a href="../vram/index.html">VRAM tier pages</a>; ${tierRows.filter(t => t.fit > 0).length ? `the largest model that fits fully at ${tierRows[tierRows.length - 1].n} GB is ${tierRows[tierRows.length - 1].big ? esc(tierRows[tierRows.length - 1].big.model.name) : "n/a"}` : ""}. Offload to system RAM (not counted here) extends this at a large speed cost for dense models.</p></section>
<section class="card"><h2>The cost of long context</h2><p class="mut">We ran each model at depth 0, 4096 and 16384 tokens with llama-bench (flash attention on). Median retention across ${r4.length} full-GPU runs at 4k was ${pct(med(r4.map(x => x.r)))}% (min ${pct(Math.min(...r4.map(x => x.r)))}%, max ${pct(Math.max(...r4.map(x => x.r)))}%) and at 16k ${pct(med(r16.map(x => x.r)))}% (min ${pct(Math.min(...r16.map(x => x.r)))}%, max ${pct(Math.max(...r16.map(x => x.r)))}%).</p>${c3}<p class="mut">Beyond our own runs, the site's depth model (fitted on ${dc.n_points} measured points, up to ${A.fmtCtx(dc.max_measured_depth)} tokens of depth, median absolute error ${dc.median_abs_error_pct}%) estimates the speed at long context, up to 1M tokens where a model supports it; those figures are labelled estimated on each page.</p></section>
<section class="card"><h2>MoE versus dense</h2>${c4}<p class="mut">MoE models read only their active experts per token, so generation is limited by active parameters rather than total size, while the whole model still has to fit in memory.</p></section>
<section class="card"><h2>Which hardware we have measured</h2>${covChart}<p class="mut">Public rows come from community llama.cpp results (<a href="../data-sources.html">sources</a>); entries without our own runs are medians of other people's benchmarks. We have not yet measured Macs or AMD GPUs ourselves, so those numbers are public data. Send yours via <a href="../submit.html">the submit form</a>.</p></section>
<section class="card" id="methods"><h2>Methods</h2><ul>
<li><b>Our runs:</b> llama-bench from llama.cpp (build${builds.length > 1 ? "s" : ""} ${builds.map(b => "b" + b).join(", ")})${cuda.length ? ", CUDA " + cuda.join("/") : ""}, flash attention on, all layers on GPU, ubatch ${ownRows[0].ubatch}, 3 repeats (median reported), pp512 and tg128, run on rented GPUs (vast.ai) on ${dates.join(", ")}. Quants are GGUF Q4_K_M and Q8_0 from public repositories. Per-run details are in the dataset. ${ownAll.length - ownRows.length} of the ${ownAll.length} rows used MoE expert offload to system RAM (different <code>--n-cpu-moe</code> settings per depth) and are left out of the depth, MoE and quantization comparisons, because offload settings differ between rows.</li>
<li><b>Public rows:</b> medians of community llama.cpp benchmarks, aggregated per hardware, model and quantization class; see <a href="../data-sources.html">sources and attribution</a>.</li>
<li><b>Fit math:</b> weights plus KV cache at 16k context (f16) plus about 1 GB overhead must fit in GPU memory; model sizes come from the published GGUF files.</li>
<li><b>Limits:</b> single-user generation speed, short prompts; not a quality benchmark; GPU clocks, drivers and build versions differ between sources; our runs cover ${ownHw.length} GPUs only.</li></ul></section>
<section class="card" id="license"><h2>Reuse and attribution</h2><p>Our own measurements and curated data are licensed <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>. Please attribute as <b>Data: <a href="../index.html">Local LLM Advisor (localllmadvisor.com)</a></b> and link to this post or the <a href="../leaderboard.html">leaderboard</a>. Download the <a href="../data/leaderboard.csv" download>CSV</a> or the <a href="${HF_URL}" rel="noopener">Hugging Face dataset</a>. Third-party rows keep their upstream licenses. Charts on this page are inline SVG you may copy with the same attribution.</p></section>
<p class="mut"><a href="../hardware/index.html">All hardware</a> &middot; <a href="../compare/index.html">Compare hardware</a> &middot; <a href="../can-run/index.html">Measured model pages</a> &middot; <a href="../leaderboard.html">Leaderboard</a> &middot; <a href="index.html">Blog</a></p>`;
  wr(`blog/${SLUG}.html`, shell("../", title, desc, `<a href="../index.html">Advisor</a> / <a href="index.html">Blog</a> / State of local LLM hardware, Oct 2026`, "State of local LLM hardware, October 2026", lead, body, "blog", `<meta name="llma:article" content="${DATE}">`));
  wr("blog/index.html", shell("../", "Local LLM Advisor blog: benchmarks and hardware data", "Data posts built from Local LLM Advisor's own llama.cpp measurements and open dataset.", `<a href="../index.html">Advisor</a> / Blog`, "Blog", "Posts built from our own measurements and open dataset. Every number is computed from the data files.",
    `<section class="card"><h2><a href="${SLUG}.html">State of local LLM hardware, October 2026</a></h2><p class="mut">${DATE} &middot; ${esc(desc)}</p></section><p class="mut">Data is CC BY 4.0, see <a href="../data-sources.html#data-license">using our data</a>.</p>`, "blog"));
  return { post: `blog/${SLUG}.html`, charts: 5, ownRows: ownRows.length, depthRuns: r16.length };
}
module.exports = { run, hbar, SLUG, DATE };
