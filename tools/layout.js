// Shared layout (head, nav, footer) for all pages. `d` is the relative prefix to site root: "" or "../".
const ICON = {
  gpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="11" rx="2"/><circle cx="9" cy="11.5" r="2.5"/><path d="M15 9.5h4M15 13.5h4M6 20h12"/></svg>',
  apple: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20M9 16v4M15 16v4"/></svg>',
  unified: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>'
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function head(d, title, desc) {
  return `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="color-scheme" content="dark light">
<script src="${d}theme.js"></script><link rel="stylesheet" href="${d}style.css"></head><body>`;
}
function nav(d, cur) {
  const a = (href, label, key, opt) => `<a class="l${opt ? " opt" : ""}" href="${d}${href}"${cur === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="nav" aria-label="Main"><div class="wrap"><a class="brand" href="${d}index.html"><span class="logo" aria-hidden="true">&gt;_</span>Local LLM Advisor</a>
${a("hardware/index.html", "Hardware", "hw")}${a("submit.html", "Submit benchmark", "submit", true)}${a("data-sources.html", "Data", "data", true)}
<button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle theme"><svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button></div></nav>`;
}
function footer(d) {
  return `<footer class="site"><div class="wrap"><div class="cols"><div><b style="color:var(--fg)">Local LLM Advisor</b><p>Free, no sign-up, no trackers. Sponsored and affiliate boxes will be clearly labelled when added. Model facts link to their source and show a last-verified date.</p></div>
<div><h4>Explore</h4><ul><li><a href="${d}index.html">Advisor</a></li><li><a href="${d}hardware/index.html">All hardware</a></li></ul></div>
<div><h4>Data</h4><ul><li><a href="${d}submit.html">Submit a benchmark</a></li><li><a href="${d}data-sources.html">Sources &amp; attribution</a></li><li><a href="https://github.com/mattgrandy/local-llm-advisor" rel="noopener">GitHub</a></li></ul></div></div></div></footer></body></html>`;
}
const slot = text => `<div class="slot" data-slot="${text.slot}"><span>${esc(text.t)}</span></div>`;
module.exports = { head, nav, footer, esc, ICON, slot };
