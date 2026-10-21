// Shared layout (head, nav, footer) for all pages. `d` is the relative prefix to site root: "" or "../".
const ICON = {
  gpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="11" rx="2"/><circle cx="9" cy="11.5" r="2.5"/><path d="M15 9.5h4M15 13.5h4M6 20h12"/></svg>',
  apple: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20M9 16v4M15 16v4"/></svg>',
  unified: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>'
};
// Analytics config: change the website id (or set to "" to disable analytics everywhere) here only.
const ANALYTICS = { websiteId: "43daf16b-1b1a-4306-93fc-7c1e00fa0db9", src: "https://cloud.umami.is/script.js", doNotTrack: true };
const VER = "20261020a";
// Amazon Associates config: change the tracking tag (or set to "" to turn all Amazon links off) here only.
const AFFILIATE = {
  amazonTag: "localllmadvis-20", disclosure: "As an Amazon Associate I earn from qualifying purchases.",
  // Cloud GPU rental referral links. A partner with an empty url is hidden everywhere; clear a url to hide that partner.
  cloud: {
    disclosure: "We may earn a referral credit if you sign up through this link.",
    partners: [
      { id: "vast", name: "Vast.ai", url: "https://cloud.vast.ai/?ref_id=749586" },
      { id: "runpod", name: "RunPod", url: "https://runpod.io?ref=w3uudui6" },
    ],
  },
};
const cloudPartners = () => AFFILIATE.cloud.partners.filter(p => p.url && /^https:\/\//.test(p.url));
const amazonUrl = q => `https://www.amazon.com/s?k=${encodeURIComponent(q).replace(/%20/g, "+")}&tag=${AFFILIATE.amazonTag}`;
// Base Amazon search phrase per hardware id (GPU id, Apple config id, unified id). Missing id => no link (unreleased, cloud-only, not sold as a unit).
function affiliateQueries(hw) {
  const m = {}, skip = /^(studio-m5-ultra|mini-m6)/;
  for (const g of hw.gpus) m[g.id] = { q: (/^rx-/.test(g.id) ? "AMD " : /^rtx-pro/.test(g.id) ? "NVIDIA " : "NVIDIA ") + g.name.replace(/ Workstation$/, "") + " graphics card" + (/12GB|16GB/.test(g.name) ? "" : ""), kind: "gpu" };
  for (const c of hw.apple_configs) if (!skip.test(c.id)) m[c.id] = { q: c.name.replace(/ — /g, " ").replace(/\s*\(\d+-core GPU\)/, "").replace(/14\/16 /, ""), kind: "apple", mem: true };
  m["strix-halo"] = { q: "AMD Ryzen AI Max+ 395 mini PC 128GB", kind: "unified" };
  m["dgx-spark"] = { q: "NVIDIA DGX Spark", kind: "unified" };
  return m;
}
// Static link box for hardware pages. t = target, name = a.q key lookup done by caller.
function affiliateBox(t, aq, o) {
  o = o || {};
  const e = aq[t.config || t.device]; if (!AFFILIATE.amazonTag || !e) return "";
  const q = e.q + (e.mem && t.memory_gb ? " " + t.memory_gb + "GB" : "");
  const label = e.kind === "gpu" ? "Check price on Amazon" : "Search Amazon for this hardware";
  return `<aside class="card aff aff-v2" data-slot="affiliate-upgrade" data-placement="v2"><b>${o.name ? "Shopping for the " + esc(o.name) + "?" : "Shopping for this?"}</b> <a class="btn" href="${esc(amazonUrl(q))}" target="_blank" rel="sponsored noopener nofollow" data-affiliate="amazon" data-hardware="${esc(t.slug)}" data-slot-id="${esc(o.slot || "hardware-page")}">${label} &rarr;</a><p class="mut">Amazon search results for &ldquo;${esc(q)}&rdquo;. Prices and stock are shown on Amazon and may change. ${AFFILIATE.disclosure}${t.count > 1 ? " Search is for a single card; you need " + t.count + "." : ""}</p></aside>`;
}
// Cloud GPU rental slot (static HTML). o = { slot, hardware, why, d (path prefix to site root) }. Never states prices.
function cloudBox(o) {
  const ps = cloudPartners(); if (!ps.length) return "";
  const links = ps.map(p => `<a class="btn" href="${esc(p.url)}" target="_blank" rel="sponsored noopener nofollow" data-sponsor="${esc(p.id)}" data-hardware="${esc(o.hardware || "")}" data-slot-id="${esc(o.slot)}">Rent a cloud GPU on ${esc(p.name)} &rarr;</a>`).join(" ");
  return `<aside class="card aff cloud" data-slot="cloud-gpu"><b>Rent a cloud GPU instead</b> ${links}<p class="mut">${o.why ? esc(o.why) + " " : ""}Renting by the hour is an option when you want to try a model before buying hardware. Check current rates on the provider's site. ${ps.length > 1 ? AFFILIATE.cloud.disclosure.replace("this link", "these links") : AFFILIATE.cloud.disclosure} <a href="${o.d || ""}data-sources.html#affiliate-disclosure">Disclosure</a></p></aside>`;
}
const affiliateJs = hw => `/* generated by tools/generate_pages.js; edit the tag and cloud links in tools/layout.js */\nwindow.LLMA_AFF = ${JSON.stringify({ tag: AFFILIATE.amazonTag, disclosure: AFFILIATE.disclosure, cloud: { disclosure: AFFILIATE.cloud.disclosure, partners: cloudPartners().map(({ id, name, url }) => ({ id, name, url })) }, q: affiliateQueries(hw) })};\n`;
const analyticsTag = d => `<script defer src="${d}analytics.js?v=${VER}"></script>` + (ANALYTICS.websiteId ? `<script defer src="${ANALYTICS.src}" data-website-id="${ANALYTICS.websiteId}"${ANALYTICS.doNotTrack ? ' data-do-not-track="true"' : ""}></script>` : "");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// CSP via <meta> (GitHub Pages cannot send headers). 'unsafe-inline' is for style only: the advisor sets inline style attributes (bar widths, animation delay). Scripts stay 'self' + Umami.
// frame-ancestors / report-uri are not supported in meta CSP, so they are omitted.
const CSP = "default-src 'self'; script-src 'self' https://cloud.umami.is; connect-src 'self' https://cloud.umami.is https://gateway.umami.is; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self' https://github.com; object-src 'none'";
const SECURITY = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="strict-origin-when-cross-origin">`;
function head(d, title, desc) {
  return `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="color-scheme" content="dark light">${SECURITY}<link rel="icon" href="${d}favicon.svg" type="image/svg+xml"><link rel="icon" href="${d}favicon.ico" sizes="any">
<script src="${d}theme.js?v=${VER}"></script>${analyticsTag(d)}<link rel="stylesheet" href="${d}style.css?v=${VER}"></head><body>`;
}
function nav(d, cur) {
  const a = (href, label, key, opt) => `<a class="l${opt ? " opt" : ""}" href="${d}${href}"${cur === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="nav" aria-label="Main"><div class="wrap"><a class="brand" href="${d}index.html"><span class="logo" aria-hidden="true">&gt;_</span>Local LLM Advisor</a>
${a("hardware/index.html", "Hardware", "hw")}${a("compare/index.html", "Compare", "compare", true)}${a("blog/index.html", "Blog", "blog", true)}${a("submit.html", "Submit benchmark", "submit", true)}${a("data-sources.html", "Data", "data", true)}
<button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle theme"><svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button></div></nav>`;
}
function footer(d) {
  return `<footer class="site"><div class="wrap"><div class="cols"><div><b style="color:var(--fg)">Local LLM Advisor</b><p>Free, no sign-up, no cookies. Sponsored and affiliate links are labelled. ${AFFILIATE.disclosure} <a href="${d}data-sources.html#affiliate-disclosure">Disclosure</a>. Model facts link to their source and show a last-verified date.</p><p class="mut" id="privacy">Privacy: anonymous, cookie-free analytics (Umami) count visits and which options are used. No personal data, no search text, and Do Not Track is respected. <a href="${d}data-sources.html#privacy">Details</a></p></div>
<div><h4>Explore</h4><ul><li><a href="${d}index.html">Advisor</a></li><li><a href="${d}hardware/index.html">All hardware</a></li><li><a href="${d}vram/index.html">By VRAM</a></li><li><a href="${d}models/index.html">Models</a></li><li><a href="${d}leaderboard.html">Leaderboard</a></li><li><a href="${d}compare/index.html">Compare hardware</a></li><li><a href="${d}can-run/index.html">Can it run?</a></li><li><a href="${d}blog/index.html">Blog</a></li></ul></div>
<div><h4>Data</h4><ul><li><a href="${d}submit.html">Submit a benchmark</a></li><li><a href="${d}embed/index.html">Embed a badge</a></li><li><a href="${d}data-sources.html">Sources &amp; attribution</a></li><li><a href="https://github.com/mattgrandy/local-llm-advisor" rel="noopener">GitHub</a></li></ul></div></div></div></footer></body></html>`;
}
// Direct sponsor/ad slots. Config-driven: a slot renders ONLY when SPONSOR_SLOTS[id].url is set (https). Empty = nothing rendered.
// To re-enable: SPONSOR_SLOTS["sponsor-top"] = { url: "https://...", text: "Sponsored by X" }
const SPONSOR_SLOTS = {};
const slot = id => { const c = SPONSOR_SLOTS[id]; return c && /^https:\/\//.test(c.url || "") ? `<aside class="slot" data-slot="${esc(id)}"><a href="${esc(c.url)}" target="_blank" rel="sponsored noopener nofollow" data-sponsor="${esc(id)}" data-slot-id="${esc(id)}">${esc(c.text || c.url)}</a></aside>` : ""; };
// ---- MLX explainer (Apple Silicon). Only sourced facts; MLX speeds are not shown on the site yet.
const MLX_SRC = {
  mlxQuant: "https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.quantize.html",
  ggufBpw: "https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md",
  kquants: "https://github.com/ggml-org/llama.cpp/pull/1684",
  mlxLm: "https://github.com/ml-explore/mlx-lm",
  mlxVlm: "https://github.com/Blaizzy/mlx-vlm",
  study1: "https://arxiv.org/abs/2511.05502",
  study2: "https://arxiv.org/abs/2601.19139"
};
function mlxExplainer(d, opts) {
  const o = opts || {}, short = !!o.short;
  const facts = `<ul>
<li><b>File size.</b> MLX's default quantization is affine with a group size of 64, and every group stores a scale and a bias (<a href="${MLX_SRC.mlxQuant}" rel="noopener">MLX docs</a>). With 16-bit scales and biases that works out to about 4.5 bits per weight at 4-bit and 8.5 at 8-bit. llama.cpp lists Q4_K_M at about 4.89 and Q8_0 at about 8.50 bits per weight (<a href="${MLX_SRC.ggufBpw}" rel="noopener">llama.cpp quantize README</a>). So an MLX 4-bit repo is usually a little smaller than Q4_K_M and MLX 8-bit is about the same size as Q8_0. Real repos differ because some layers (embeddings, vision towers, MoE experts in MXFP4 for gpt-oss) are stored differently, so we show each repo's actual size.</li>
<li><b>Quality.</b> They are different schemes. MLX 4-bit applies one bit width with per-group scale and bias, while Q4_K_M is a K-quant mix that keeps some tensors at higher precision (<a href="${MLX_SRC.kquants}" rel="noopener">llama.cpp k-quants PR</a>). We have not found a rigorous like-for-like quality comparison, so we only pair them by bit class: MLX 4-bit with Q4-class GGUF and MLX 8-bit with Q8_0.</li>
<li><b>Speed.</b> MLX speeds are not shown on this site yet. Published comparisons often find MLX faster than llama.cpp on Macs: an M2 Ultra study measured about 230 tok/s for MLX against about 150 for llama.cpp (short context) on Qwen-2.5 models (<a href="${MLX_SRC.study1}" rel="noopener">arXiv 2511.05502</a>), and an M4 Max table shows mlx-lm ahead of llama.cpp on most 4-bit text models but behind on Gemma 3 4B (<a href="${MLX_SRC.study2}" rel="noopener">arXiv 2601.19139</a>). So MLX may well run faster than the llama.cpp numbers shown here, but not for every model, and we do not estimate by how much.</li>
<li><b>Which package.</b> Text-only conversions run with <a href="${MLX_SRC.mlxLm}" rel="noopener">mlx-lm</a>. Many recent mlx-community repos (Gemma 4, Qwen3.5/3.6/3.8, Qwen3-VL) were converted with <a href="${MLX_SRC.mlxVlm}" rel="noopener">mlx-vlm</a> and their model cards say to run them with it, so the command we show follows each repo's card.</li></ul>`;
  if (short) return `<section class="card" id="mlx"><h2>MLX on this Mac</h2><p class="mut">MLX is Apple's machine-learning framework for Apple Silicon. Where an mlx-community conversion exists, the commands above include an MLX block next to llama.cpp and ollama.</p>${facts}<p class="mut">Repos are checked against the Hugging Face API (<a href="${d}data-sources.html#mlx">how</a>).</p></section>`;
  return `<section class="card" id="mlx"><h2>MLX conversions (Apple Silicon)</h2><p class="mut">On Apple hardware the advisor also shows an MLX command when a verified mlx-community conversion exists. Each repo id is found and checked through the Hugging Face API by <code>tools/mlx_repos.py</code>: the repo must exist, ship .safetensors weights and name the original model as its base. Models without a match say "no MLX conversion yet". MLX commands never appear for NVIDIA, AMD or CPU setups.</p>${facts}${o.table || ""}</section>`;
}
module.exports = { mlxExplainer, MLX_SRC, AFFILIATE, cloudPartners, cloudBox, amazonUrl, affiliateQueries, affiliateBox, affiliateJs, ANALYTICS, VER, head, nav, footer, esc, ICON, slot, SPONSOR_SLOTS };
