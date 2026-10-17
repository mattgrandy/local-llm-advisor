#!/usr/bin/env node
// Generates site/hardware/<slug>.html (+ index.html, sitemap if SITE_URL set) from data/*.json using site/advisor.js.
const fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const A = require(path.join(SITE, "advisor.js"));
const read = f => JSON.parse(fs.readFileSync(path.join(SITE, "data", f)));
const data = { hardware: read("hardware.json"), models: read("models.json"), depth: fs.existsSync(path.join(SITE, "data", "depth_calibration.json")) ? read("depth_calibration.json") : null, measured: fs.existsSync(path.join(SITE, "data", "measured.json")) ? read("measured.json") : null };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const out = path.join(SITE, "hardware"); fs.mkdirSync(out, { recursive: true });
const CTX = 16384, USES = [["coding", "Coding"], ["chat", "Chat / general"], ["vision", "Vision"]];
const MODE = { gpu: "fits fully", "moe-offload": "MoE offload", "dense-offload": "partial offload", cpu: "CPU" };

const L = require("./layout.js");
const AQ = L.affiliateQueries(data.hardware);
const bcls = sh => sh === "measured" ? "measured" : sh === "estimated" ? "estimated" : "scaled";
const ANAME = {};
function page(t) {
  const input = { kind: t.kind, device: t.device, label: t.config ? (data.hardware.apple_configs.find(c => c.id === t.config) || {}).name : undefined, count: t.count, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type };
  let hwr, sections = "";
  for (const [use, label] of USES) {
    const r = A.recommend(input, data, { use, ctx: CTX, kvq: "f16" }); hwr = r.hwr;
    const rows = r.results.slice(0, 5);
    sections += `<section class="card"><h2>Best for ${label} <span class="mut">&middot; ${CTX / 1024}k context</span></h2>` + (rows.length ? `<div class="tw"><table><thead><tr><th>Model</th><th>Quant</th><th>Fit</th><th>Memory</th><th>Speed (generation)</th></tr></thead><tbody>` +
      rows.map(p => { const si = A.speedInfo(p); return `<tr><td><a href="${p.model.source_url}" rel="noopener">${esc(p.model.name)}</a></td><td class="num">${esc(p.quantLabel)}</td><td>${MODE[p.mode]}</td><td class="num">${(p.weightsGB + p.kvGB).toFixed(1)} GB</td><td title="${esc(si.detail)}"><b>~${p.tps ? p.tps.toFixed(0) : "?"}</b> tok/s <span class="badge ${bcls(si.short)}">${si.short}</span>${p.speed ? ` <a href="${p.speed.sources[0].url}" rel="noopener">src</a>` : ""}</td></tr>`; }).join("") + `</tbody></table></div>
      <div class="cmd"><div class="code"><div class="top"><span>llama.cpp &middot; top pick</span><button class="copy" type="button" data-c="l-${use}">Copy</button></div><pre id="l-${use}">${esc(rows[0].command.llama)}</pre></div>
      <div class="code"><div class="top"><span>ollama &middot; top pick</span><button class="copy" type="button" data-c="o-${use}">Copy</button></div><pre id="o-${use}">${esc(rows[0].command.ollama)}</pre></div></div>${rows[0].command.ollamaNote ? `<p class="mut">${esc(rows[0].command.ollamaNote)}</p>` : ""}`
      : `<p class="mut">No model in the dataset fits this config for ${label.toLowerCase()} at this context.</p>`) + `</section>`;
  }
  // all models that fit (any use case), sortable client-side; default order = fastest first
  {
    const r = A.recommend(input, data, { use: "all", ctx: CTX, kvq: "f16" });
    const rows = r.results.slice().sort((a, b) => (b.tps || 0) - (a.tps || 0));
    const th = (l, k) => `<th data-sort="${k}">${l}</th>`;
    const sp = rows.filter(p => A.speedInfo(p).short !== "estimated").length;
    sections += `<section class="card" id="all-models"><h2>All ${rows.length} models that fit, fastest first <span class="mut">&middot; ${CTX / 1024}k context</span></h2>` + (rows.length ? `<p class="mut">Click a column header to sort. ${sp} of ${rows.length} speeds here are measured or scaled from measured; the rest are bandwidth estimates. <a href="../index.html?${new URLSearchParams({ kind: t.kind, device: t.device, ...(t.config ? { config: t.config } : {}), count: t.count, mem: t.memory_gb || "", ram: t.ram_gb, ramt: t.ram_type, use: "all", ctx: CTX, sort: "tps" })}">Filter by use case, speed source, fit, license and more in the interactive advisor &rarr;</a></p><p class="sr-only" id="sort-status-${t.slug}" role="status" aria-live="polite"></p>
      <div class="tw"><table class="sortable" data-status="sort-status-${t.slug}"><thead><tr>${th("Model", "text")}${th("Params", "num")}${th("Quant", "text")}${th("Fit", "text")}${th("Memory", "num")}${th("Tok/s", "num")}<th>Source</th></tr></thead><tbody>` +
      rows.map(p => { const si = A.speedInfo(p); return `<tr><td data-v="${esc(p.model.name.toLowerCase())}"><a href="${p.model.source_url}" rel="noopener">${esc(p.model.name)}</a></td><td class="num" data-v="${p.model.params_b}">${p.model.params_b}B${p.model.moe ? " MoE" : ""}</td><td class="num" data-v="${esc(p.quantLabel.toLowerCase())}">${esc(p.quantLabel)}</td><td data-v="${MODE[p.mode]}">${MODE[p.mode]}</td><td class="num" data-v="${(p.weightsGB + p.kvGB).toFixed(2)}">${(p.weightsGB + p.kvGB).toFixed(1)} GB</td><td class="num" data-v="${p.tps ? p.tps.toFixed(1) : ""}"><b>~${p.tps ? p.tps.toFixed(0) : "?"}</b></td><td title="${esc(si.detail)}"><span class="badge ${bcls(si.short)}">${si.short}</span></td></tr>`; }).join("") + `</tbody></table></div>` : `<p class="mut">No model fits this config at this context.</p>`) + `</section>`;
  }
  // long context: max context that fits per model and KV type, with the estimated speed at that depth
  {
    const r = A.recommend(input, data, { use: "all", ctx: 16384, kvq: "f16" });
    const hw = r.hwr, fm = A.fmtCtx, th = (l, k) => `<th data-sort="${k}">${l}</th>`;
    const cell = (p, kvq) => { const c = A.maxCtx(p, hw, kvq); if (!c) return `<td class="num" data-v="0">&lt;4k</td>`; const ext = c > p.model.context_max;
      return `<td class="num" data-v="${c}">${fm(c)}${ext ? ' <span class="badge est" title="Beyond the native context: needs YaRN rope scaling documented on the model card">extended</span>' : ""}</td>`; };
    const rows = r.results.slice().sort((a, b) => A.maxCtx(b, hw, "f16") - A.maxCtx(a, hw, "f16") || (b.tps || 0) - (a.tps || 0));
    const dl = c => `../index.html?${new URLSearchParams({ kind: t.kind, device: t.device, ...(t.config ? { config: t.config } : {}), count: t.count, mem: t.memory_gb || "", ram: t.ram_gb, ramt: t.ram_type, use: "all", ctx: c, sort: "ctx" })}`;
    sections += `<section class="card" id="long-context"><h2>Long context on this hardware <span class="mut">&middot; up to 1M tokens</span></h2><p class="mut">Largest context whose KV cache still fits next to the weights (same placement as the 16k result, KV types f16 / q8_0 / q4_0). Models are capped at their verified maximum; <b>extended</b> means beyond the native maximum using YaRN, only listed where the model card documents it. Long context needs flash attention (<code>-fa on</code>, already in the commands) and a lot of memory; a quantized KV cache saves memory but can cost accuracy. Speed at depth is an <b>estimate</b> (penalty fitted to measured depth runs up to ${data.depth ? fm(data.depth.max_measured_depth) : "n/a"}).</p>
      <p>Try it in the advisor: ${[131072, 262144, 524288, 1000000].map(c => `<a href="${dl(c)}">${fm(c)}</a>`).join(" &middot; ")}</p>` + (rows.length ? `<div class="tw"><table class="sortable" data-status="sort-status-${t.slug}"><thead><tr>${th("Model", "text")}${th("Native max", "num")}${th("Max ctx f16", "num")}${th("Max ctx q8_0", "num")}${th("Max ctx q4_0", "num")}${th("Est. tok/s at max f16 ctx", "num")}</tr></thead><tbody>` +
      rows.map(p => { const c = A.maxCtx(p, hw, "f16"), d = c ? A.depthSpeed(p, c, "f16", data.depth) : null;
        return `<tr><td data-v="${esc(p.model.name.toLowerCase())}"><a href="${p.model.source_url}" rel="noopener">${esc(p.model.name)}</a> <span class="mut">${esc(p.quantLabel)}</span></td><td class="num" data-v="${p.model.context_max}">${fm(p.model.context_max)}</td>${cell(p, "f16")}${cell(p, "q8_0")}${cell(p, "q4_0")}<td class="num" data-v="${d ? d.tps.toFixed(1) : ""}">${d ? "~" + Math.round(d.tps) + " <span class=\"badge estimated\">estimated</span>" : "&ndash;"}</td></tr>`; }).join("") + `</tbody></table></div>` : `<p class="mut">No model fits this config.</p>`) + `</section>`;
  }
  const comm = ((data.measured && data.measured.community) || []).filter(c => c.hw_id === t.device);
  if (comm.length) sections += `<section class="card"><h2>Community-submitted benchmarks <span class="badge est">unverified</span></h2><p class="mut">Format-reviewed only; not used in the numbers above.</p><div class="tw"><table><thead><tr><th>Model</th><th>Quant</th><th>Backend</th><th>pp tok/s</th><th>tg tok/s</th><th>Date</th></tr></thead><tbody>${comm.map(c => `<tr><td>${esc(c.model)}</td><td>${esc(c.quant)}</td><td>${esc(c.backend)}</td><td class="num">${c.pp_tps}</td><td class="num">${c.tg_tps}</td><td class="num">${esc(c.date || "")}</td></tr>`).join("")}</tbody></table></div></section>`;
  const nmeas = Object.values(data.measured ? (data.measured.entries[t.device] || []) : []).length;
  const q = new URLSearchParams({ kind: t.kind, device: t.device, ...(t.config ? { config: t.config } : {}), count: t.count, mem: t.memory_gb || "", ram: t.ram_gb, ramt: t.ram_type });
  const title = `Best local LLMs for ${t.title}`;
  const desc = `Which local LLM runs on ${t.title}? Memory-fit math with KV cache, estimated speed and copy-paste llama.cpp / ollama commands. Last verified ${data.models.generated}.`;
  const stats = `<div class="stats"><div class="stat"><b>${hwr.pool.toFixed(1)} GB</b><span>usable for model + KV cache</span></div><div class="stat"><b>${hwr.gpuBw} GB/s</b><span>memory bandwidth</span></div>${hwr.discrete && !hwr.cpuOnly ? `<div class="stat"><b>${hwr.ramAvail} GB</b><span>RAM available for offload</span></div>` : ""}<div class="stat"><b>${nmeas}</b><span>measured data point${nmeas === 1 ? "" : "s"} on file</span></div></div>`;
  return L.head("../", `${title} | Local LLM Advisor`, desc) + L.nav("../", "hw") + `<main class="wrap">
<header class="page-hero"><div class="crumbs"><a href="../index.html">Advisor</a> / <a href="index.html">Hardware</a> / ${esc(t.title)}</div><h1>${esc(title)}</h1><p>${esc(hwr.name)}. Memory-fit math with KV cache, speeds labelled by how they were obtained, and commands you can paste.</p></header>
${stats}
${L.affiliateBox(t, AQ)}
<div class="slot" data-slot="sponsor-top"><span>Sponsor slot. No sponsor yet and no link.</span></div>
${sections}
<p><a class="btn" href="../index.html?${q}">Open the interactive advisor with this hardware &rarr;</a></p>
<p class="mut">Speeds marked <span class="badge measured">measured</span> are medians of real runs (short-context generation) from <a href="../data-sources.html">these sources</a>; <span class="badge scaled">scaled from measured</span> means a measurement of a same-size or same-model-different-quant run, scaled by bytes read; <span class="badge estimated">estimated</span> comes from memory bandwidth (spec source: <a href="${hwr.source_url}" rel="noopener">${esc(hwr.source_url)}</a>)${hwr.eff ? ` &times; an efficiency factor of ${hwr.eff.toFixed(2)} ${esc(hwr.effSource)}` : ""}. ${nmeas ? nmeas + " measured data point" + (nmeas > 1 ? "s" : "") + " on file for this hardware" : "No measured data on file for this hardware yet"} &middot; <a href="../submit.html">submit your benchmark</a>. ${t.kind === "apple" || t.kind === "unified" ? "Memory size on this page is an example configuration; check what your machine has. " : "System RAM here is an example (" + t.ram_gb + " GB, " + t.ram_type + "). "}Model data last verified ${data.models.generated}. Ranking = fits and fast enough first, then larger; not a quality benchmark.</p>
<script src="../hwtable.js?v=20261016f"></script>
<p class="mut">Page generated ${new Date().toISOString().slice(0, 10)} by tools/generate_pages.js</p></main>` + L.footer("../");
}

const index = [];
const KLABEL = { gpu: "Discrete GPU", apple: "Apple Silicon", unified: "Unified memory", cpu: "CPU" };
for (const t of data.hardware.targets) {
  fs.writeFileSync(path.join(out, t.slug + ".html"), page(t));
  const hwr0 = A.recommend({ kind: t.kind, device: t.device, count: t.count, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type }, data, { use: "chat", ctx: CTX, kvq: "f16" }).hwr;
  index.push(`<a class="hw" style="animation-delay:${index.length * 35}ms" href="${t.slug}.html"><span class="ic">${L.ICON[t.kind] || L.ICON.gpu}</span><b>${esc(t.title)}</b><span class="badges"><span class="badge plain">${KLABEL[t.kind] || t.kind}</span><span class="badge plain">${hwr0.pool.toFixed(0)} GB usable</span><span class="badge plain">${hwr0.gpuBw} GB/s</span></span><span class="go">See recommendations &rarr;</span></a>`);
}
fs.writeFileSync(path.join(out, "index.html"), L.head("../", "Local LLM recommendations by hardware | Local LLM Advisor", "Best local LLMs for popular GPUs, Macs and unified-memory PCs, with memory-fit math and copy-paste commands.") + L.nav("../", "hw") + `<main class="wrap"><header class="page-hero"><div class="crumbs"><a href="../index.html">Advisor</a> / Hardware</div><h1>Local LLM recommendations by hardware</h1><p>${data.hardware.targets.length} popular setups, each with the best models for coding, chat and vision, and commands to run them.</p></header><div class="grid">${index.join("")}</div></main>` + L.footer("../"));
if (process.env.SITE_URL) {
  const base = process.env.SITE_URL.replace(/\/$/, "");
  const urls = ["/index.html", "/hardware/index.html", ...data.hardware.targets.map(t => `/hardware/${t.slug}.html`)];
  fs.writeFileSync(path.join(SITE, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${base}${u}</loc></url>`).join("")}</urlset>`);
}
console.log("generated", data.hardware.targets.length, "pages in", out);

// ---- submit + data-sources are static hand-written/generated pages; add to sitemap, generate data-sources.html
{
  const M = data.measured;
  if (M) {
    const rows = Object.entries(M.entries).map(([h, es]) => `<tr><td>${esc(h)}</td><td>${es.length}</td><td>${esc([...new Set(es.flatMap(e => e.sources.map(s => s.id)))].join(", "))}</td></tr>`).join("");
    fs.writeFileSync(path.join(SITE, "data-sources.html"), L.head("", "Data sources | Local LLM Advisor", "Where the measured benchmark data comes from, with attribution.") + L.nav("", "data") + `<main class="wrap"><header class="page-hero"><div class="crumbs"><a href="index.html">Advisor</a> / Data sources</div><h1>Data sources &amp; attribution</h1><p>Measured speeds come from public benchmark data, credited here. Data generated ${esc(M.generated)}.</p></header>
<div class="stats"><div class="stat"><b>${M.counts.rows_used}</b><span>measured rows used</span></div><div class="stat"><b>${M.counts.points}</b><span>(hardware, model, quant) points</span></div><div class="stat"><b>${M.counts.hardware}</b><span>hardware entries</span></div><div class="stat"><b>${M.counts.community}</b><span>community submissions</span></div></div>
<section class="card"><h2>Sources</h2><ul>${M.attribution.map(a => `<li>${a.url ? `<a href="${a.url}" rel="noopener">${esc(a.name)}</a>` : esc(a.name)}</li>`).join("")}</ul>
<p class="mut">LocalScore results are community-submitted averages published on localscore.ai (open-source project, Apache-2.0, by Mozilla Builders / Justine Tunney's llamafile team and cjpais). Only public pages were read, at a low request rate. This site is not affiliated with LocalScore or Mozilla.</p></section>
<section class="card"><h2>Quality ratings</h2><p class="mut">Quality sort uses the <a href="https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset" rel="noopener">LMArena leaderboard dataset</a> (text, overall; coding category when the Coding use case is selected), licensed CC-BY-4.0, data dated 2026-10-13. Only models matched by exact name and version are rated; others show &ldquo;not rated&rdquo;. The rank is as published by LMArena and includes closed models. Not affiliated with LMArena.</p></section>
<section class="card"><h2>How &ldquo;measured&rdquo; and &ldquo;estimated&rdquo; work</h2><p class="mut">${esc(M.calibration.method)} Global default efficiency before calibration: ${M.calibration.global_assumption}.</p></section>
<section class="card"><h2>Coverage by hardware</h2><div class="tw"><table><thead><tr><th>Hardware id</th><th>Data points</th><th>Sources</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="card" id="data-license"><h2>Using our data</h2><p class="mut">Local LLM Advisor\'s own measurements and curated data are licensed <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>. Please attribute as: <b>Data: <a href="https://localllmadvisor.com">Local LLM Advisor (localllmadvisor.com)</a></b>. Third-party rows keep their upstream licenses (see sources above). Code is MIT; see the <a href="https://github.com/mattgrandy/local-llm-advisor" rel="noopener">GitHub repo</a>.</p></section>
<section class="card" id="affiliate-disclosure"><h2>Affiliate disclosure</h2><p class="mut">${L.AFFILIATE.disclosure} Some hardware links on this site go to Amazon search results and carry our Associates tracking tag; if you buy after clicking, we may earn a small commission at no extra cost to you. Links never change the recommendations, which come only from memory-fit math and benchmark data. We do not show Amazon prices; check the price on Amazon.</p></section>
<section class="card" id="privacy"><h2>Privacy &amp; analytics</h2><p class="mut">This site uses <a href="https://umami.is" rel="noopener">Umami</a> Cloud for anonymous, cookie-free analytics: page views and which options are chosen (hardware type, device, use case, context length, sort and filter names, whether a command or link was copied, theme, and clicks on submit/sponsor/affiliate links, including which hardware an Amazon link was for). We never record what you type in search or the benchmark form, and no personal data is stored in events. Browsers that send Do Not Track are not counted, and blockers work fine; the site behaves the same either way.</p></section>
<section class="card"><h2>Community submissions</h2><p class="mut">${M.counts.community} reviewed submissions, always shown as unverified. <a href="submit.html">Submit yours</a>.</p></section></main>` + L.footer(""));
    fs.writeFileSync(path.join(SITE, "index.html"), L.head("", "Local LLM Advisor - which local LLM should you run on your hardware?", "Free tool: pick your GPU, Mac or RAM and get local LLM recommendations with memory-fit math (incl. KV cache), measured or estimated speed and copy-paste ollama / llama.cpp commands.") + L.nav("", "home") + fs.readFileSync(path.join(__dirname, "pages", "index.body.html"), "utf8") + L.footer("").replace(/<\/body><\/html>$/, "") + "</body></html>");
    fs.writeFileSync(path.join(SITE, "submit.html"), L.head("", "Submit your benchmark | Local LLM Advisor", "Share a llama-bench result so others with the same hardware know what to expect.") + L.nav("", "submit") + fs.readFileSync(path.join(__dirname, "pages", "submit.body.html"), "utf8") + L.footer("").replace(/<\/body><\/html>$/, "") + "</body></html>");
  }
  if (process.env.SITE_URL) {
    const f = path.join(SITE, "sitemap.xml"), base = process.env.SITE_URL.replace(/\/$/, "");
    let x = fs.readFileSync(f, "utf8");
    x = x.replace("</urlset>", ["/submit.html", "/data-sources.html"].map(u => `<url><loc>${base}${u}</loc></url>`).join("") + "</urlset>");
    fs.writeFileSync(f, x);
  }
}

fs.writeFileSync(path.join(SITE, "affiliate.js"), L.affiliateJs(data.hardware));

// ---- SEO pass (canonical/OG/JSON-LD, sitemap.xml, robots.txt, CNAME); SITE_URL defaults to https://localllmadvisor.com
console.log("seo pass:", require("./seo").run(SITE), "pages");
