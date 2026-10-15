#!/usr/bin/env node
// Generates site/hardware/<slug>.html (+ index.html, sitemap if SITE_URL set) from data/*.json using site/advisor.js.
const fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const A = require(path.join(SITE, "advisor.js"));
const read = f => JSON.parse(fs.readFileSync(path.join(SITE, "data", f)));
const data = { hardware: read("hardware.json"), models: read("models.json"), measured: fs.existsSync(path.join(SITE, "data", "measured.json")) ? read("measured.json") : null };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const out = path.join(SITE, "hardware"); fs.mkdirSync(out, { recursive: true });
const CTX = 16384, USES = [["coding", "Coding"], ["chat", "Chat / general"], ["vision", "Vision"]];
const MODE = { gpu: "fits fully", "moe-offload": "MoE offload", "dense-offload": "partial offload", cpu: "CPU" };

function page(t) {
  const input = { kind: t.kind, device: t.device, count: t.count, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type };
  let hwr, sections = "", best = null;
  for (const [use, label] of USES) {
    const r = A.recommend(input, data, { use, ctx: CTX, kvq: "f16" }); hwr = r.hwr;
    const rows = r.results.slice(0, 5);
    if (use === "chat") best = rows[0];
    sections += `<section class="card"><h2>Best for ${label} (${CTX / 1024}k context)</h2>` + (rows.length ? `<table><tr><th>Model</th><th>Quant</th><th>Fit</th><th>Memory (GB)</th><th>tok/s (generation)</th></tr>` +
      rows.map(p => `<tr><td><a href="${p.model.source_url}" rel="noopener">${esc(p.model.name)}</a></td><td>${esc(p.quantLabel)}</td><td>${MODE[p.mode]}</td><td>${(p.weightsGB + p.kvGB).toFixed(1)}</td><td title="${esc(A.speedInfo(p).detail)}">~${p.tps ? p.tps.toFixed(0) : "?"} <span class="badge ${A.speedInfo(p).cls}">${A.speedInfo(p).short}</span>${p.speed ? ` <a href="${p.speed.sources[0].url}" rel="noopener">src</a>` : ""}</td></tr>`).join("") + `</table>
      <p class="mut">Top pick command:</p><pre>${esc(rows[0].command.llama)}</pre><pre>${esc(rows[0].command.ollama)}</pre>${rows[0].command.ollamaNote ? `<p class="mut">${esc(rows[0].command.ollamaNote)}</p>` : ""}`
      : `<p>No model in the dataset fits this config for ${label.toLowerCase()} at this context.</p>`) + `</section>`;
  }
  const comm = ((data.measured && data.measured.community) || []).filter(c => c.hw_id === t.device);
  if (comm.length) sections += `<section class="card"><h2>Community-submitted benchmarks <span class="badge est">unverified</span></h2><p class="mut">Format-reviewed only; not used in the numbers above.</p><table><tr><th>Model</th><th>Quant</th><th>Backend</th><th>pp tok/s</th><th>tg tok/s</th><th>Date</th></tr>${comm.map(c => `<tr><td>${esc(c.model)}</td><td>${esc(c.quant)}</td><td>${esc(c.backend)}</td><td>${c.pp_tps}</td><td>${c.tg_tps}</td><td>${esc(c.date || "")}</td></tr>`).join("")}</table></section>`;
  const nmeas = Object.values(data.measured ? (data.measured.entries[t.device] || []) : []).length;
  const q = new URLSearchParams({ kind: t.kind, device: t.device, count: t.count, mem: t.memory_gb || "", ram: t.ram_gb, ramt: t.ram_type });
  const title = `Best local LLMs for ${t.title}`;
  const desc = `Which local LLM runs on ${t.title}? Memory-fit math with KV cache, estimated speed and copy-paste llama.cpp / ollama commands. Last verified ${data.models.generated}.`;
  const hwline = `${esc(hwr.name)}: ${hwr.pool.toFixed(1)} GB usable for model + KV cache, ${hwr.gpuBw} GB/s memory bandwidth` + (hwr.discrete && !hwr.cpuOnly ? `, ${hwr.ramAvail} GB RAM available for offload` : "") + ".";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Local LLM Advisor</title><meta name="description" content="${esc(desc)}"><link rel="stylesheet" href="../style.css"></head><body><div class="wrap">
<header><p><a href="../index.html">&larr; Local LLM Advisor</a> &middot; <a href="index.html">all hardware</a></p><h1>${esc(title)}</h1><p>${hwline}</p></header>
<div class="slot" data-slot="sponsor-top">PLACEHOLDER: sponsor slot (no sponsor yet, no link)</div>
${sections}
<div class="slot" data-slot="affiliate-upgrade">PLACEHOLDER: affiliate "cheapest upgrade" box for ${esc(t.title)} (no affiliate links yet)</div>
<p><a href="../index.html?${q}">Open the interactive advisor with this hardware</a> to change context length, KV cache type, RAM or use case.</p>
<p class="mut">Speeds marked <span class="badge ok">measured</span> are medians of real runs (short-context generation) from <a href="../data-sources.html">these sources</a>; <span class="badge est">scaled from measured</span> means a measurement of a same-size or same-model-different-quant run, scaled by bytes read; <span class="badge est">estimated</span> comes from memory bandwidth (spec source: <a href="${hwr.source_url}" rel="noopener">${esc(hwr.source_url)}</a>)${hwr.eff ? ` &times; an efficiency factor of ${hwr.eff.toFixed(2)} ${esc(hwr.effSource)}` : ""}. ${nmeas ? nmeas + " measured data point" + (nmeas > 1 ? "s" : "") + " on file for this hardware" : "No measured data on file for this hardware yet"} &middot; <a href="../submit.html">submit your benchmark</a>. ${t.kind === "apple" || t.kind === "unified" ? "Memory size on this page is an example configuration; check what your machine has. " : "System RAM here is an example (" + t.ram_gb + " GB, " + t.ram_type + "). "}Model data last verified ${data.models.generated}. Ranking = fits and fast enough first, then larger; not a quality benchmark.</p>
<footer>Page generated ${new Date().toISOString().slice(0, 10)} by tools/generate_pages.js</footer></div></body></html>`;
}

const index = [];
for (const t of data.hardware.targets) {
  fs.writeFileSync(path.join(out, t.slug + ".html"), page(t));
  index.push(`<li><a href="${t.slug}.html">${esc(t.title)}</a></li>`);
}
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local LLM recommendations by hardware</title><link rel="stylesheet" href="../style.css"></head><body><div class="wrap"><p><a href="../index.html">&larr; Advisor</a></p><h1>Local LLM recommendations by hardware</h1><ul>${index.join("")}</ul></div></body></html>`);
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
    fs.writeFileSync(path.join(SITE, "data-sources.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Data sources | Local LLM Advisor</title><link rel="stylesheet" href="style.css"></head><body><div class="wrap"><p><a href="index.html">&larr; Advisor</a></p><h1>Data sources &amp; attribution</h1>
<p>Measured speeds come from public benchmark data, credited here. Data generated ${esc(M.generated)}. ${M.counts.rows_used} measured rows used; ${M.counts.points} (hardware, model, quant) data points across ${M.counts.hardware} hardware entries.</p>
<ul>${M.attribution.map(a => `<li>${a.url ? `<a href="${a.url}" rel="noopener">${esc(a.name)}</a>` : esc(a.name)}</li>`).join("")}</ul>
<p>LocalScore results are community-submitted averages published on localscore.ai (open-source project, Apache-2.0, by Mozilla Builders / Justine Tunney's llamafile team and cjpais). Only public pages were read, at a low request rate. This site is not affiliated with LocalScore or Mozilla.</p>
<h2>How "measured" and "estimated" work</h2><p>${esc(M.calibration.method)} Global default efficiency before calibration: ${M.calibration.global_assumption}.</p>
<table><tr><th>Hardware id</th><th>Data points</th><th>Sources</th></tr>${rows}</table>
<h2>Community submissions</h2><p>${M.counts.community} reviewed submissions, always shown as unverified. <a href="submit.html">Submit yours</a>.</p></div></body></html>`);
  }
  if (process.env.SITE_URL) {
    const f = path.join(SITE, "sitemap.xml"), base = process.env.SITE_URL.replace(/\/$/, "");
    let x = fs.readFileSync(f, "utf8");
    x = x.replace("</urlset>", ["/submit.html", "/data-sources.html"].map(u => `<url><loc>${base}${u}</loc></url>`).join("") + "</urlset>");
    fs.writeFileSync(f, x);
  }
}
