// Growth pages built only from the dataset: /compare/<a>-vs-<b>.html (+hub), /can-run/<model>-on-<hardware>.html (+hub, capped),
// /blog/ (+ first data post), /embed/ (+ per-hardware badge SVGs and iframe cards). No prices are stated anywhere.
// Called by generate_pages.js. A page is only published when it carries data that differs from its siblings; anything else is noindex.
const fs = require("fs"), path = require("path");
const { slugify, TIERS } = require("./generate_seo_pages.js");
const MODE = { gpu: "fits fully", "moe-offload": "MoE offload to CPU", "dense-offload": "partial offload (slow)", cpu: "CPU" };
const CTX = 16384, CAP_CANRUN = 72, CAP_EST = 8, HF_URL = "https://huggingface.co/datasets/LocalLLMAdvisor/local-llm-advisor-benchmarks";
// Curated pairings (target slugs). Only pairs whose pages differ in fit or speed are kept (checked in plan()).
const PAIR_SLUGS = [
  ["rtx-3090-24gb", "rtx-4090-24gb"], ["rtx-4090-24gb", "rtx-5090-32gb"], ["rtx-3090-24gb", "rtx-5090-32gb"], ["rtx-4090-24gb", "rx-7900-xtx-24gb"],
  ["rtx-3090-24gb", "rx-7900-xtx-24gb"], ["rtx-5080-16gb", "rtx-4090-24gb"], ["rtx-5070ti-16gb", "rtx-4060ti-16gb"], ["rtx-5060ti-16gb", "rtx-4060ti-16gb"], ["rtx-5060ti-16gb", "rtx-5070ti-16gb"], ["rtx-4070-12gb", "rtx-5070-12gb"],
  ["rtx-3060-12gb", "rtx-4060-8gb"], ["dual-rtx-3090-48gb", "rtx-5090-32gb"], ["dual-rtx-3090-48gb", "rtx-pro-6000-96gb"], ["strix-halo-128gb", "dgx-spark-128gb"],
  ["macbook-pro-m4-max-128gb", "rtx-4090-24gb"], ["macbook-pro-m5-max-128gb", "macbook-pro-m4-max-128gb"], ["strix-halo-128gb", "macbook-pro-m4-max-128gb"], ["mac-studio-m3-ultra-96gb", "dual-rtx-3090-48gb"],
];
// Hot hardware x model candidates in priority order (hardware target slug, model id). Gated on measured data.
const HOT = [["rtx-4090-24gb", "openai/gpt-oss-20b"], ["rtx-4090-24gb", "Qwen/Qwen3.6-35B-A3B"], ["rtx-4090-24gb", "Qwen/Qwen3-Coder-30B-A3B-Instruct"], ["rtx-4090-24gb", "google/gemma-4-31B-it"], ["rtx-4090-24gb", "Qwen/Qwen3.6-27B"], ["rtx-4090-24gb", "google/gemma-4-26B-A4B-it"],
  ["rtx-3090-24gb", "openai/gpt-oss-20b"], ["rtx-3090-24gb", "Qwen/Qwen3.6-35B-A3B"], ["rtx-3090-24gb", "Qwen/Qwen3-Coder-30B-A3B-Instruct"], ["rtx-3090-24gb", "google/gemma-4-31B-it"], ["rtx-3090-24gb", "Qwen/Qwen3.6-27B"], ["rtx-3090-24gb", "google/gemma-4-26B-A4B-it"],
  ["rtx-5090-32gb", "openai/gpt-oss-120b"], ["rtx-5090-32gb", "Qwen/Qwen3.6-27B"], ["strix-halo-128gb", "openai/gpt-oss-120b"], ["dgx-spark-128gb", "openai/gpt-oss-120b"],
  ["rtx-4060ti-16gb", "openai/gpt-oss-20b"], ["rtx-5070-12gb", "google/gemma-4-12B-it"], ["rtx-4070-12gb", "Qwen/Qwen3.5-9B"], ["rtx-3060-12gb", "Qwen/Qwen3.5-9B"],
  ["rtx-5090-32gb", "Qwen/Qwen3.6-35B-A3B"], ["rtx-5090-32gb", "openai/gpt-oss-20b"], ["rtx-5090-32gb", "google/gemma-4-31B-it"], ["rtx-5090-32gb", "Qwen/Qwen3-Coder-30B-A3B-Instruct"], ["rtx-5090-32gb", "Qwen/Qwen3.8-27B"],
  ["rtx-4060ti-16gb", "Qwen/Qwen3.6-35B-A3B"], ["rtx-4060ti-16gb", "google/gemma-4-12B-it"], ["rtx-4060ti-16gb", "Qwen/Qwen3.5-9B"], ["rtx-4060ti-16gb", "Qwen/Qwen3.6-27B"],
  ["rtx-pro-6000-96gb", "openai/gpt-oss-120b"], ["rtx-pro-6000-96gb", "zai-org/GLM-4.5-Air"], ["rtx-5080-16gb", "openai/gpt-oss-20b"], ["rtx-5070ti-16gb", "openai/gpt-oss-20b"], ["rtx-4060-8gb", "Qwen/Qwen3.5-9B"],
  ["rtx-3090-24gb", "Qwen/Qwen3.8-27B"], ["rtx-4090-24gb", "Qwen/Qwen3.8-27B"], ["dgx-spark-128gb", "zai-org/GLM-4.5-Air"], ["strix-halo-128gb", "Qwen/Qwen3.6-35B-A3B"],
  // Mac M-series: high search interest, little measured data; these may be published as clearly labelled estimates (EST_OK, capped by CAP_EST)
  ["macbook-pro-m5-max-128gb", "openai/gpt-oss-120b"], ["macbook-pro-m4-max-128gb", "openai/gpt-oss-120b"], ["mac-studio-m3-ultra-96gb", "openai/gpt-oss-120b"], ["mac-mini-m6-32gb", "Qwen/Qwen3.6-35B-A3B"],
  ["macbook-air-m5-32gb", "openai/gpt-oss-20b"], ["mac-m4-pro-64gb", "Qwen/Qwen3.6-35B-A3B"], ["mac-m4-16gb", "Qwen/Qwen3.5-9B"], ["macbook-pro-m5-pro-48gb", "Qwen/Qwen3.6-27B"], ["mac-studio-m5-ultra-256gb", "zai-org/GLM-4.5-Air"]];
// Estimated-only pages are allowed for Apple/unified-memory pairs in HOT when the model fits fully (these searches have no other good answer); never for discrete GPUs.
const EST_KINDS = new Set(["apple", "unified"]);
// Day-one release pairs (tools/release_hot.json, written by tools/add_release.js): placed first, may be labelled estimates for any hardware kind,
// expire after RELEASE_DAYS unless measured data arrives (then they qualify through the normal measured path anyway). They add up to CAP_REL pages on top of CAP_CANRUN.
const RELEASE_FILE = path.join(__dirname, "release_hot.json"), RELEASE_DAYS = 45, CAP_REL = 8;
const releasePairs = () => { if (!fs.existsSync(RELEASE_FILE)) return []; const now = Date.now(); return (JSON.parse(fs.readFileSync(RELEASE_FILE, "utf8")).pairs || []).filter(x => !x.added || (now - Date.parse(x.added)) / 864e5 <= RELEASE_DAYS); };
const med = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const r1 = x => Math.round(x * 10) / 10;

let C = null; // context set by init()
function init({ A, data, esc, L, ownRows: ownAll }) {
  const ownRows = ownAll.filter(r => !/excluded from site medians|MoE expert offload/.test(r.notes || "")); // offload-config runs are not comparable across depths
  const hw = data.hardware, T = Object.fromEntries(hw.targets.map(t => [t.slug, t])), M = Object.fromEntries(data.models.models.map(m => [m.id, m]));
  const inputOf = t => ({ kind: t.kind, device: t.device, label: t.config ? (hw.apple_configs.find(c => c.id === t.config) || {}).name : undefined, count: t.count, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type });
  const cache = {};
  const res = slug => cache[slug] || (cache[slug] = (() => { const t = T[slug], r = A.recommend(inputOf(t), data, { use: "all", ctx: CTX, kvq: "f16" }); return { t, hwr: r.hwr, by: Object.fromEntries(r.results.map(p => [p.model.id, p])), all: r.results }; })());
  const estRes = slug => cache["est:" + slug] || (cache["est:" + slug] = (() => { const t = T[slug], r = A.recommend(inputOf(t), { ...data, measured: null }, { use: "all", ctx: CTX, kvq: "f16" }); return Object.fromEntries(r.results.map(p => [p.model.id, p])); })());
  const nameOf = id => (hw.gpus.concat(hw.apple, hw.unified).find(g => g.id === id) || {}).name || id;
  const measuredFor = (t, mid) => (data.measured && !(t.count > 1) ? (data.measured.entries[t.device] || []) : []).filter(e => e.site_id === mid);
  const ownFor = (t, m) => t.count > 1 ? [] : ownRows.filter(r => r.hw_id === t.device && r.model === m.name);
  // ---- plan: pairs
  const pairs = [];
  for (const [a, b] of PAIR_SLUGS) {
    if (!T[a] || !T[b]) continue;
    const ra = res(a), rb = res(b), ms = data.models.models.map(m => ({ m, pa: ra.by[m.id], pb: rb.by[m.id] }));
    const fa = ms.filter(x => x.pa && x.pa.mode === "gpu").length, fb = ms.filter(x => x.pb && x.pb.mode === "gpu").length;
    const both = ms.filter(x => x.pa && x.pb && x.pa.mode === "gpu" && x.pb.mode === "gpu" && x.pa.tps && x.pb.tps);
    const ratios = both.map(x => x.pb.tps / x.pa.tps), gm = ratios.length ? Math.exp(ratios.reduce((s, v) => s + Math.log(v), 0) / ratios.length) : null;
    pairs.push({ a, b, ra, rb, ms, fa, fb, both, gm, slug: `${a}-vs-${b}`, distinct: fa !== fb || (gm && Math.abs(gm - 1) > 0.02) || ra.hwr.pool !== rb.hwr.pool });
  }
  // ---- plan: can-run pages. Priority: HOT list, then pairs with our own depth sweeps, then our own runs, then public medians with >= 3 runs.
  // One page per (device, usable memory, model): two targets sharing a chip and memory size would carry identical numbers.
  const canrun = [], seen = new Set(), dataKey = new Set(); let nEst = 0;
  const hasDepth = (t, m) => ownFor(t, m).some(r => r.depth > 0 && r.tg_tps > 0);
  let cap = CAP_CANRUN, nRel = 0;
  const consider = (slug, mid, allowEst, release) => {
    if (canrun.length >= cap || !T[slug] || !M[mid] || seen.has(slug + "|" + mid)) return;
    const t = T[slug], m = M[mid], p = res(slug).by[mid];
    if (!p) return; // the advisor must produce a plan for it (fit or offload)
    const dk = t.device + "|" + (t.count || 1) + "|" + res(slug).hwr.pool.toFixed(1) + "|" + mid; if (dataKey.has(dk)) return;
    const own = ownFor(t, m), ent = measuredFor(t, mid).filter(e => e.tg > 0), measured = own.some(r => r.tg_tps > 0) || ent.length > 0;
    const est = !measured && allowEst && (release || EST_KINDS.has(t.kind)) && p.mode === "gpu" && p.tps > 0 && (release || nEst < CAP_EST);
    if (!measured && !est) return; // distinct measured data required (or a labelled estimate for a hot Mac/unified pair)
    seen.add(slug + "|" + mid); dataKey.add(dk); if (est && !release) nEst++;
    canrun.push({ slug: `${slugify(m.name)}-on-${slug}`, t, m, own, ent, hwSlug: slug, est, release: !!release });
  };
  for (const x of releasePairs()) { if (nRel >= CAP_REL) break; const n0 = canrun.length; cap = CAP_CANRUN + nRel + 1; consider(x.hw, x.model, true, true); if (canrun.length > n0) nRel++; }
  cap = CAP_CANRUN + nRel;
  for (const [s, m] of HOT) consider(s, m, true);
  const all = hw.targets.flatMap(t => data.models.models.map(m => [t, m]));
  for (const [t, m] of all) if (hasDepth(t, m)) consider(t.slug, m.id);
  for (const [t, m] of all) if (ownFor(t, m).some(r => r.tg_tps > 0)) consider(t.slug, m.id);
  for (const [t, m] of all) if (measuredFor(t, m.id).some(e => e.tg > 0 && e.n >= 3)) consider(t.slug, m.id);
  C = { A, data, esc, L, ownRows, ownAll, hw, T, M, inputOf, res, estRes, nameOf, measuredFor, ownFor, pairs, canrun };
  return C;
}
const compareLinks = (slug, d) => C.pairs.filter(p => p.distinct && (p.a === slug || p.b === slug)).map(p => `<a href="${d}compare/${p.slug}.html">${C.esc(C.T[p.a].title)} vs ${C.esc(C.T[p.b].title)}</a>`);
const canrunLinks = (slug, d) => C.canrun.filter(c => c.hwSlug === slug).map(c => `<a href="${d}can-run/${c.slug}.html">${C.esc(c.m.name)}</a>`);
const canrunLinksModel = (mid, d) => C.canrun.filter(c => c.m.id === mid).map(c => `<a href="${d}can-run/${c.slug}.html">${C.esc(c.t.title)}</a>`);
const canrunFor = (slug, mid) => C.canrun.find(c => c.hwSlug === slug && c.m.id === mid);

function run(SITE) {
  const { A, data, esc, L, hw, T, M, res, estRes, nameOf } = C, canrunFor = (s, mid) => C.canrun.find(c => c.hwSlug === s && c.m.id === mid), fm = A.fmtCtx, th = (l, k) => `<th data-sort="${k}">${l}</th>`;
  const AQ = L.affiliateQueries(hw);
  const wr = (rel, html) => { const f = path.join(SITE, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  const badge = p => { const s = A.speedInfo(p).short; return `<span class="badge ${s === "measured" ? "measured" : s === "estimated" ? "estimated" : "scaled"}">${esc(s)}</span>`; };
  const faq = items => `<section class="card" id="faq"><h2>FAQ</h2>${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join("")}</section>`;
  const tw = (id, head, rows) => `<div class="tw"><table class="sortable" data-status="sort-status-${id}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div><p class="mut" id="sort-status-${id}" role="status" aria-live="polite"></p>`;
  const shell = (d, title, desc, crumbs, h1, lead, body, cur, extraHead) => L.head(d, title, desc).replace("</head>", (extraHead || "") + "</head>") + L.nav(d, cur) + `<main class="wrap"><header class="page-hero"><div class="crumbs">${crumbs}</div><h1>${esc(h1)}</h1><p>${lead}</p></header>${body}<script src="${d}hwtable.js?v=${L.VER}"></script></main>` + L.footer(d);
  const tierLinks = d => TIERS.map(n => `<a href="${d}vram/${n}gb.html">${n} GB</a>`).join(" &middot; ");
  const nf = r => data.models.models.length - r.all.filter(p => p.mode === "gpu").length;
  const stats = { compare: 0, canrun: 0, noindex: 0 };

  // ================= COMPARE =================
  const cmpRows = [];
  for (const P of C.pairs) {
    const { a, b, ra, rb, ms, fa, fb, both, gm } = P, ta = T[a], tb = T[b], na = ta.title, nb = tb.title, d = "../", N = data.models.models.length;
    const onlyA = ms.filter(x => x.pa && x.pa.mode === "gpu" && !(x.pb && x.pb.mode === "gpu")), onlyB = ms.filter(x => x.pb && x.pb.mode === "gpu" && !(x.pa && x.pa.mode === "gpu"));
    const fasterA = both.filter(x => x.pa.tps > x.pb.tps).length, fasterB = both.filter(x => x.pb.tps > x.pa.tps).length;
    const meas = both.filter(x => A.speedInfo(x.pa).short === "measured" && A.speedInfo(x.pb).short === "measured");
    const names = xs => xs.map(x => esc(x.m.name)).join(", ");
    const leadSpeed = gm ? (Math.abs(gm - 1) < 0.05 ? "about the same speed" : gm > 1 ? `${esc(nb)} is faster by a typical ${r1(gm)}x` : `${esc(na)} is faster by a typical ${r1(1 / gm)}x`) : "no overlap to compare speed";
    const hwPick = gm && gm > 1 ? [nb, na] : [na, nb];
    const poolDiff = rb.hwr.pool - ra.hwr.pool;
    const tradeoff = Math.abs(poolDiff) < 0.5 ? `Both offer about the same usable memory (${ra.hwr.pool.toFixed(1)} GB), so the difference is mostly bandwidth (${ra.hwr.gpuBw} vs ${rb.hwr.gpuBw} GB/s).` : `${esc(poolDiff > 0 ? nb : na)} has ${Math.abs(poolDiff).toFixed(1)} GB more usable memory (${ra.hwr.pool.toFixed(1)} vs ${rb.hwr.pool.toFixed(1)} GB) and ${ra.hwr.gpuBw === rb.hwr.gpuBw ? "the same" : ra.hwr.gpuBw > rb.hwr.gpuBw ? "lower" : "higher"} bandwidth than the other${ra.hwr.gpuBw === rb.hwr.gpuBw ? "" : ` (${poolDiff > 0 ? rb.hwr.gpuBw : ra.hwr.gpuBw} vs ${poolDiff > 0 ? ra.hwr.gpuBw : rb.hwr.gpuBw} GB/s)`}.`;
    const title = `${na} vs ${nb} for local LLMs: what fits and tokens/sec (2026) | Local LLM Advisor`;
    const desc = `${na} fits ${fa} of ${N} models fully at 16k context, ${nb} fits ${fb}. ${gm ? `On the ${both.length} models that fit on both, ${gm > 1 ? nb : na} is typically ${r1(gm > 1 ? gm : 1 / gm)}x faster` : "Fit and speed compared"} (measured and estimated speeds labelled).`.replace(/\s+/g, " ");
    const rowsHtml = ms.map(({ m, pa, pb }) => {
      const cell = p => p ? `<td data-v="${p.mode}">${MODE[p.mode]}</td><td class="num" data-v="${p.tps ? p.tps.toFixed(1) : ""}"><b>${p.tps ? Math.round(p.tps) : "?"}</b> ${badge(p)}</td>` : `<td data-v="no">does not fit</td><td class="num" data-v="">-</td>`;
      const win = pa && pb && pa.mode === "gpu" && pb.mode === "gpu" && pa.tps && pb.tps ? (Math.abs(pa.tps / pb.tps - 1) < 0.03 ? "tie" : pa.tps > pb.tps ? na : nb) : (pa && pa.mode === "gpu" && !(pb && pb.mode === "gpu") ? na + " (fits)" : pb && pb.mode === "gpu" && !(pa && pa.mode === "gpu") ? nb + " (fits)" : "-");
      return `<tr><td data-v="${esc(m.name.toLowerCase())}"><a href="${d}models/${slugify(m.name)}.html">${esc(m.name)}</a> <span class="mut">${esc((pa || pb || {}).quantLabel || "")}</span></td>${cell(pa)}${cell(pb)}<td data-v="${esc(win)}">${esc(win)}</td></tr>`;
    }).join("");
    const ctxModels = ms.filter(x => (x.pa && x.pa.mode === "gpu") || (x.pb && x.pb.mode === "gpu")).sort((x, y) => y.m.params_b - x.m.params_b);
    const mc = (p, hwr, k) => { if (!p || p.mode !== "gpu") return `<td class="num" data-v="0">-</td>`; const c = A.maxCtx(p, hwr, k); return `<td class="num" data-v="${c || 0}">${c ? fm(c) : "&lt;4k"}</td>`; };
    const ctxRows = ctxModels.map(({ m, pa, pb }) => `<tr><td data-v="${esc(m.name.toLowerCase())}">${esc(m.name)}</td>${mc(pa, ra.hwr, "f16")}${mc(pb, rb.hwr, "f16")}${mc(pa, ra.hwr, "q8_0")}${mc(pb, rb.hwr, "q8_0")}</tr>`).join("");
    const nmeas = t => data.measured ? (data.measured.entries[t.device] || []).length : 0;
    const specRows = [["Usable memory for model + KV cache", `${ra.hwr.pool.toFixed(1)} GB`, `${rb.hwr.pool.toFixed(1)} GB`], ["Memory bandwidth", `${ra.hwr.gpuBw} GB/s`, `${rb.hwr.gpuBw} GB/s`], ["Models that fit fully at 16k", `${fa} of ${N}`, `${fb} of ${N}`], ["Models that need offload or do not fit", `${N - fa}`, `${N - fb}`], ["Measured data points on file", ta.count > 1 ? "none (multi-GPU is estimated)" : String(nmeas(ta)), tb.count > 1 ? "none (multi-GPU is estimated)" : String(nmeas(tb))]];
    const need = [nf(ra), nf(rb)].some(x => x > 0);
    const largestA = ms.filter(x => x.pa && x.pa.mode === "gpu").sort((x, y) => y.m.params_b - x.m.params_b)[0], largestB = ms.filter(x => x.pb && x.pb.mode === "gpu").sort((x, y) => y.m.params_b - x.m.params_b)[0];
    const crumbs = `<a href="../index.html">Advisor</a> / <a href="index.html">Compare</a> / ${esc(na)} vs ${esc(nb)}`;
    const links = [...compareLinks(a, d), ...compareLinks(b, d)].filter((x, i, arr) => arr.indexOf(x) === i && !x.includes(`/${P.slug}.html`));
    const crLinks = [...canrunLinks(a, d), ...canrunLinks(b, d)];
    const body = `<div class="stats"><div class="stat"><b>${fa} vs ${fb}</b><span>models fit fully (of ${N}) at 16k</span></div><div class="stat"><b>${ra.hwr.pool.toFixed(0)} vs ${rb.hwr.pool.toFixed(0)} GB</b><span>usable memory</span></div><div class="stat"><b>${ra.hwr.gpuBw} vs ${rb.hwr.gpuBw}</b><span>memory bandwidth, GB/s</span></div><div class="stat"><b>${gm ? (gm > 1 ? "x" + r1(gm) : "x" + r1(1 / gm)) : "-"}</b><span>${gm ? esc(hwPick[0]) + " typical speed advantage" : "no common models"}</span></div></div>
<section class="card"><h2>Verdict from the numbers</h2><ul>
<li><b>Fit.</b> ${esc(na)} fits ${fa} of ${N} models fully at 16k context${largestA ? ` (largest: ${esc(largestA.m.name)} ${esc(largestA.pa.quantLabel)})` : ""}; ${esc(nb)} fits ${fb}${largestB ? ` (largest: ${esc(largestB.m.name)} ${esc(largestB.pb.quantLabel)})` : ""}. ${onlyA.length ? `Only ${esc(na)} fits fully: ${names(onlyA)}. ` : ""}${onlyB.length ? `Only ${esc(nb)} fits fully: ${names(onlyB)}.` : ""}${!onlyA.length && !onlyB.length ? "Both fit the same set of models." : ""}</li>
<li><b>Speed.</b> On the ${both.length} models that fit fully on both, ${leadSpeed}. ${esc(na)} is ahead on ${fasterA}, ${esc(nb)} on ${fasterB}. ${meas.length ? `${meas.length} of those comparisons use measured speeds on both sides; the rest involve at least one estimate (see the badges).` : "No model is measured on both machines, so every comparison involves an estimate; read it as a guide."}</li>
<li><b>Trade-off.</b> ${tradeoff}</li></ul></section>
<div class="cmp-boxes"><h2 class="sr-only">Where to check prices</h2>${L.affiliateBox(ta, AQ, { name: na, slot: "compare-page" })}${L.affiliateBox(tb, AQ, { name: nb, slot: "compare-page" })}</div>
<section class="card"><h2>Price tier note</h2><p class="mut">We do not list prices because they move daily and differ between new and used stock. What the data does show is what the memory difference buys: ${poolDiff === 0 ? `both have the same usable memory, so model fit is identical and the choice comes down to speed (${ra.hwr.gpuBw} vs ${rb.hwr.gpuBw} GB/s bandwidth)` : `${esc(poolDiff > 0 ? nb : na)} has ${Math.abs(poolDiff).toFixed(1)} GB more usable memory, which moves ${poolDiff > 0 ? onlyB.length : onlyA.length} of ${N} models into full-GPU fit`}${(poolDiff > 0 ? onlyB : onlyA).length ? ` (${names(poolDiff > 0 ? onlyB : onlyA)})` : ""}. Use the Amazon links above to compare current listings and decide whether the difference is worth it for the models you want to run.</p></section>
<section class="card"><h2>Model by model <span class="mut">&middot; 16k context, f16 KV cache</span></h2>` + tw("cmp", th("Model", "text") + th(`${esc(na)} fit`, "text") + th("tok/s", "num") + th(`${esc(nb)} fit`, "text") + th("tok/s", "num") + th("Faster / fits", "text"), rowsHtml) + `<p class="mut">Badges: <span class="badge measured">measured</span> medians of real llama.cpp runs; <span class="badge scaled">scaled from measured</span> and <span class="badge estimated">estimated</span> come from our bandwidth model. See <a href="../data-sources.html">sources and methods</a>.</p></section>
${need ? L.cloudBox({ slot: "compare-page", hardware: a, d, why: `${esc(na)} cannot fit ${nf(ra)} of ${N} models fully, and ${esc(nb)} cannot fit ${nf(rb)}.` }) : ""}
<section class="card"><h2>How much context fits?</h2><p class="mut">Largest context where weights plus KV cache stay inside usable memory, per model that fits fully on at least one side. q8_0 KV roughly halves the cache.</p>` + tw("ctx", th("Model", "text") + th(`${esc(na)} f16`, "num") + th(`${esc(nb)} f16`, "num") + th(`${esc(na)} q8_0`, "num") + th(`${esc(nb)} q8_0`, "num"), ctxRows) + `</section>
<section class="card"><h2>Spec summary</h2><div class="tw"><table><thead><tr><th></th><th>${esc(na)}</th><th>${esc(nb)}</th></tr></thead><tbody>${specRows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join("")}</tbody></table></div></section>
${faq([[`Which is faster for local LLMs, ${na} or ${nb}?`, gm ? `On the ${both.length} models that fit fully on both, ${Math.abs(gm - 1) < 0.05 ? "they are within 5% of each other" : `${esc(hwPick[0])} is typically ${r1(gm > 1 ? gm : 1 / gm)}x faster`} (geometric mean). ${esc(na)} wins ${fasterA} and ${esc(nb)} wins ${fasterB}. ${meas.length} comparisons are measured on both.` : `No model fits fully on both, so there is no like-for-like speed comparison.`],
      [`Which fits more models, ${na} or ${nb}?`, `${esc(na)} fits ${fa} of ${N} models fully at 16k context and ${esc(nb)} fits ${fb}. ${onlyA.length ? `Only ${esc(na)}: ${names(onlyA)}. ` : ""}${onlyB.length ? `Only ${esc(nb)}: ${names(onlyB)}.` : ""}`],
      [`Can I run long context on ${na} or ${nb}?`, `At f16 KV cache, the largest-model context limits are in the table above (for example ${largestA ? esc(largestA.m.name) + " on " + esc(na) + ": " + (A.maxCtx(largestA.pa, ra.hwr, "f16") ? fm(A.maxCtx(largestA.pa, ra.hwr, "f16")) : "under 4k") : "n/a"}${largestB ? `; ${esc(largestB.m.name)} on ${esc(nb)}: ${A.maxCtx(largestB.pb, rb.hwr, "f16") ? fm(A.maxCtx(largestB.pb, rb.hwr, "f16")) : "under 4k"}` : ""}). A q8_0 KV cache extends it further.`],
      [`Do you state prices for ${na} or ${nb}?`, "No. Prices change daily, so we link to Amazon search results instead and focus on measured and estimated speed and memory fit."]])}
<section class="card"><h2>Related</h2><p><a href="../hardware/${a}.html">${esc(na)}</a> &middot; <a href="../hardware/${b}.html">${esc(nb)}</a>${crLinks.length ? " &middot; Measured model pages: " + crLinks.slice(0, 6).join(" &middot; ") : ""}</p>${links.length ? `<p>More comparisons: ${links.slice(0, 6).join(" &middot; ")} &middot; <a href="index.html">all comparisons</a></p>` : `<p><a href="index.html">All comparisons</a></p>`}<p class="mut">By memory: ${tierLinks("../")}</p></section>`;
    wr(`compare/${P.slug}.html`, shell(d, title, desc, crumbs, `${na} vs ${nb} for local LLMs`, `Memory fit, speed and context compared with the same math as the <a href="../index.html">advisor</a>. ${esc(tradeoff)}`, body, "compare", P.distinct ? "" : '<meta name="robots" content="noindex,follow">'));
    if (!P.distinct) stats.noindex++;
    stats.compare++;
    cmpRows.push({ P, na, nb, fa, fb, gm, nboth: both.length });
  }
  wr("compare/index.html", shell("../", "Compare GPUs and Macs for local LLMs: fit and tokens/sec | Local LLM Advisor", `${cmpRows.length} head-to-head comparisons of popular GPUs, Macs and unified-memory PCs for local LLMs, with fit tables and measured or estimated tokens/sec.`, `<a href="../index.html">Advisor</a> / Compare`, "Compare hardware for local LLMs", "Curated head-to-head pages. Every page has its own fit table, speeds labelled by how they were obtained, and a verdict computed from the data.",
    `<section class="card"><h2>${cmpRows.length} comparisons</h2>` + tw("cmphub", th("Comparison", "text") + th("Fits fully (A / B)", "text") + th("Common models", "num") + th("Typical speed ratio (B / A)", "num"), cmpRows.map(({ P, na, nb, fa, fb, gm, nboth }) => `<tr><td data-v="${esc((na + nb).toLowerCase())}"><a href="${P.slug}.html">${esc(na)} vs ${esc(nb)}</a></td><td data-v="${fa}">${fa} / ${fb} of ${data.models.models.length}</td><td class="num" data-v="${nboth}">${nboth}</td><td class="num" data-v="${gm ? gm.toFixed(3) : ""}">${gm ? r1(gm) + "x" : "-"}</td></tr>`).join("")) + `</section><p class="mut">Ratios are a geometric mean over models that fit fully on both machines; mixed measured and estimated speeds, see each page. <a href="../hardware/index.html">All hardware</a> &middot; <a href="../can-run/index.html">Measured model pages</a> &middot; <a href="../leaderboard.html">Leaderboard</a></p>`, "compare"));

  // ================= CAN-RUN =================
  const crRows = [];
  for (const c of C.canrun) {
    const { t, m, own, ent } = c, r = res(t.slug), p = r.by[m.id], pe = estRes(t.slug)[m.id], d = "../", hwr = r.hwr;
    if (!p) continue;
    const ownD0 = own.filter(x => !x.depth && x.tg_tps > 0), qs = [...new Set(ownD0.map(x => x.quant))];
    const bq = {}; // quant -> {tg,pp,n,own?,min,max}
    for (const e of ent) bq[e.qclass] = { q: e.qclass, tg: e.tg, pp: e.pp, n: e.n, min: e.tg_min, max: e.tg_max, src: e.sources.some(s => s.id === "own-measurement") ? "includes our runs" : "public runs" };
    const qrows = Object.values(bq).sort((x, y) => y.tg - x.tg);
    const ownQ = qs.map(q => { const g = own.filter(x => x.quant === q).sort((x, y) => x.depth - y.depth), d0 = g.find(x => !x.depth); return { q, g, d0 }; });
    const si = A.speedInfo(p), qmatch = ownD0.find(x => p.quantLabel.replace(/^UD-/, "") === x.quant), best = qmatch || ownD0.slice().sort((x, y) => y.tg_tps - x.tg_tps)[0]; // headline row: our run at the advisor's quant when we have it
    const isEst = !!c.est && !best && !qrows.length;
    const headTg = best ? best.tg_tps : qrows.length ? qrows[0].tg : p.tps;
    const headWhat = best ? `${best.quant} on llama.cpp ${best.backend}, ${best.tg_n}-token generation` : qrows.length ? `${qrows[0].q} class, median of ${qrows[0].n} public run${qrows[0].n > 1 ? "s" : ""}` : `${p.quantLabel}, estimated from ${hwr.gpuBw} GB/s memory bandwidth`;
    // speed vs depth at the headline quant (our own runs): depth 0, 16k and the longest depth we measured
    const hq = best ? ownQ.find(o => o.q === best.quant) : null, at = dp => hq && hq.g.find(x => x.depth === dp);
    const d16 = at(16384), dLong = hq ? hq.g.filter(x => x.depth > 16384).sort((x, y) => y.depth - x.depth)[0] : null;
    const pct = x => hq && hq.d0 ? Math.round(x.tg_tps / hq.d0.tg_tps * 100) : null;
    const depthTxt = d16 || dLong ? ` As the context fills it slows down: ${d16 ? `<b>${r1(d16.tg_tps)} tok/s</b> with 16k tokens already in context (${pct(d16)}% of the empty-context speed)` : ""}${d16 && dLong ? " and " : ""}${dLong ? `<b>${r1(dLong.tg_tps)} tok/s</b> at ${fm(dLong.depth)} (${pct(dLong)}%)` : ""}, measured.` : "";
    // alternatives: smaller-memory hardware that still fits, faster hardware, and other models on this hardware
    const link = (slug, mid, label) => { const cr = canrunFor(slug, mid); return `<a href="${cr ? "" : "../hardware/"}${cr ? cr.slug : slug}.html">${esc(label)}</a>`; };
    const others = hw.targets.filter(x => x.slug !== t.slug).map(x => ({ x, q: res(x.slug).by[m.id], hr: res(x.slug).hwr })).filter(o => o.q && o.q.mode === "gpu" && o.q.tps);
    const smaller = others.filter(o => o.hr.pool < hwr.pool - 0.5).sort((a, b) => a.hr.pool - b.hr.pool || b.q.tps - a.q.tps).slice(0, 3);
    const faster = others.filter(o => o.q.tps > headTg * 1.15 && !smaller.includes(o)).sort((a, b) => a.hr.pool - b.hr.pool || b.q.tps - a.q.tps).slice(0, 3);
    const altModels = r.all.filter(q => q.mode === "gpu" && q.model.id !== m.id && q.tps).sort((a, b) => Math.abs(Math.log(a.model.params_b / m.params_b)) - Math.abs(Math.log(b.model.params_b / m.params_b))).slice(0, 4);
    const li = (o, why) => `<li>${link(o.x.slug, m.id, o.x.title)}: ${esc(o.q.quantLabel)}, ${o.hr.pool.toFixed(0)} GB usable, ~${Math.round(o.q.tps)} tok/s <span class="badge ${A.speedInfo(o.q).short === "measured" ? "measured" : A.speedInfo(o.q).short === "estimated" ? "estimated" : "scaled"}">${esc(A.speedInfo(o.q).short)}</span>${why ? " " + why : ""}</li>`;
    const altHtml = `<section class="card" id="alternatives"><h2>Alternatives</h2>${p.mode !== "gpu" && others.length ? `<p>${esc(m.name)} does not fit fully here. It does fit fully on:</p><ul>${others.sort((a, b) => a.hr.pool - b.hr.pool).slice(0, 4).map(o => li(o)).join("")}</ul>` : ""}${p.mode === "gpu" && smaller.length ? `<h3>Less memory that still fits ${esc(m.name)}</h3><p class="mut">Smaller memory usually means a cheaper card or Mac (we do not list prices).</p><ul>${smaller.map(o => li(o)).join("")}</ul>` : ""}${faster.length ? `<h3>Faster for ${esc(m.name)}</h3><ul>${faster.map(o => li(o)).join("")}</ul>` : ""}${altModels.length ? `<h3>Other models on ${esc(t.title)}, similar size</h3><ul>${altModels.map(q => `<li>${link(t.slug, q.model.id, q.model.name)}${canrunFor(t.slug, q.model.id) ? "" : ` <span class="mut">(hardware page)</span>`}: ${esc(q.quantLabel)}, fits fully, ~${Math.round(q.tps)} tok/s (${esc(A.speedInfo(q).short)})</li>`).join("")}</ul>` : ""}</section>`;
    const mem = best && !qmatch ? best.size_gib * 1.073741824 + p.kvGB : p.weightsGB + p.kvGB, qlab = best && !qmatch ? best.quant : p.quantLabel, ex = pe && pe.quantLabel === p.quantLabel && p.speed ? pe : null;
    const depthTable = ownQ.some(o => o.g.length > 1) ? `<section class="card"><h2>Speed vs context depth <span class="badge measured">measured</span></h2><p class="mut">Our own llama-bench runs on ${esc(nameOf(t.device))} (flash attention on, 3 repeats): generation and prompt speed with the given number of tokens already in the context.</p>` + tw("depth", th("Quant", "text") + th("Context depth", "num") + th("Generation tok/s", "num") + th("vs depth 0", "num") + th("Prompt tok/s", "num"), ownQ.flatMap(o => o.g.map(x => `<tr><td data-v="${esc(o.q)}">${esc(o.q)}</td><td class="num" data-v="${x.depth}">${x.depth ? fm(x.depth) : "0"}</td><td class="num" data-v="${x.tg_tps}">${r1(x.tg_tps)}</td><td class="num" data-v="${o.d0 ? (x.tg_tps / o.d0.tg_tps).toFixed(3) : ""}">${o.d0 ? Math.round(x.tg_tps / o.d0.tg_tps * 100) + "%" : "-"}</td><td class="num" data-v="${x.pp_tps}">${Math.round(x.pp_tps)}</td></tr>`)).join("")) + `</section>` : "";
    const src = best ? (best.notes.match(/llama-bench from llama\.cpp (b\d+)/) || [])[1] : null;
    const title = `Can ${t.title} run ${m.name}? ${isEst ? "~" + Math.round(headTg) + " tok/s estimated" : r1(headTg) + " tok/s " + (best || si.short === "measured" ? "measured" : "reported")} (2026) | Local LLM Advisor`;
    const desc = `${m.name} on ${t.title}: ${r1(headTg)} tokens/s (${headWhat}). ${p.mode === "gpu" ? `Fits fully at 16k context in ${mem.toFixed(1)} GB` : MODE[p.mode]}${p.mode === "gpu" && A.maxCtx(p, hwr, "f16") ? `; up to ${fm(A.maxCtx(p, hwr, "f16"))} context with f16 KV` : ""}. Commands and context limits.`;
    const lead = isEst ? `Estimated speed and memory fit for <a href="../models/${slugify(m.name)}.html">${esc(m.name)}</a> (${m.params_b}B${m.moe ? ` MoE${m.params_breakdown ? ` = ${m.params_breakdown.language_model_b}B language model + ${m.params_breakdown.ngram_embedding_b}B n-gram embedding + ${m.params_breakdown.mtp_b}B MTP` : ""}, ${m.active_params_b}B active` : " dense"}) on <a href="../hardware/${t.slug}.html">${esc(t.title)}</a>. We have no measured run for this pair yet, so the speed is an estimate; <a href="../submit.html">submit yours</a>.` : `Measured results for <a href="../models/${slugify(m.name)}.html">${esc(m.name)}</a> (${m.params_b}B${m.moe ? ` MoE${m.params_breakdown ? ` = ${m.params_breakdown.language_model_b}B language model + ${m.params_breakdown.ngram_embedding_b}B n-gram embedding + ${m.params_breakdown.mtp_b}B MTP` : ""}, ${m.active_params_b}B active` : " dense"}) on <a href="../hardware/${t.slug}.html">${esc(t.title)}</a>, plus what fits and the commands to run it.`;
    const need = nf(r) > 0;
    const body = `<div class="stats"><div class="stat"><b>${isEst ? Math.round(headTg) : r1(headTg)}</b><span>generation tok/s (${esc(headWhat)})</span></div>${best ? `<div class="stat"><b>${Math.round(best.pp_tps)}</b><span>prompt tok/s (pp512)</span></div>` : qrows[0] && qrows[0].pp ? `<div class="stat"><b>${Math.round(qrows[0].pp)}</b><span>prompt tok/s, public median</span></div>` : ""}<div class="stat"><b>${mem.toFixed(1)} GB</b><span>${esc(qlab)} + 16k f16 KV, ${MODE[p.mode]}</span></div><div class="stat"><b>${hwr.pool.toFixed(0)} GB</b><span>usable on this hardware</span></div></div>
<section class="card"><h2>Short answer</h2><p>${p.mode === "gpu" ? `Yes. ${esc(m.name)} ${esc(qlab)} fits fully on ${esc(t.title)} at 16k context, using ${mem.toFixed(1)} of ${hwr.pool.toFixed(1)} GB usable, and generates about <b>${isEst ? "~" + Math.round(headTg) : r1(headTg)} tokens/s</b>${best ? " in our own run" : isEst ? " (estimated, not measured)" : ""}.${depthTxt}` : `It runs on ${esc(t.title)} only with ${MODE[p.mode]}: ${mem.toFixed(1)} GB needed against ${hwr.pool.toFixed(1)} GB usable, and the measured speed is about <b>${r1(headTg)} tokens/s</b>.${depthTxt}`}${ex ? ` For ${esc(p.quantLabel)}, our bandwidth-only estimate was ~${Math.round(ex.tps)} tok/s against a measured median of ~${Math.round(p.tps)} (${Math.abs(ex.tps / p.tps - 1) < 0.03 ? "within 3%" : ex.tps > p.tps ? Math.round((ex.tps / p.tps - 1) * 100) + "% too optimistic" : Math.round((1 - ex.tps / p.tps) * 100) + "% too pessimistic"}).` : ""}</p></section>
${L.affiliateBox(t, AQ, { name: t.title, slot: "canrun-page" })}
${need || p.mode !== "gpu" ? L.cloudBox({ slot: "canrun-page", hardware: t.slug, d, why: p.mode !== "gpu" ? `${esc(m.name)} does not fit fully on ${esc(hwr.name)}; a rented GPU with more memory runs it without offload.` : `${nf(r)} of ${data.models.models.length} models in our dataset do not fit ${esc(hwr.name)} fully at 16k context.` }) : ""}
${isEst ? "<!--estimated-pair-->" : ""}<section class="card"><h2>Measured generation speed by quantization</h2>` + (qrows.length || ownQ.length ? tw("q", th("Quant", "text") + th("Generation tok/s", "num") + th("Range", "text") + th("Prompt tok/s", "num") + th("Runs", "num") + th("Origin", "text"),
      (qrows.length ? qrows.map(q => `<tr><td data-v="${esc(q.q)}">${esc(q.q)} class (median)</td><td class="num" data-v="${q.tg}"><b>${r1(q.tg)}</b></td><td data-v="">${r1(q.min)}&ndash;${r1(q.max)}</td><td class="num" data-v="${q.pp || ""}">${q.pp ? Math.round(q.pp) : ""}</td><td class="num" data-v="${q.n}">${q.n}</td><td data-v="${esc(q.src)}">${esc(q.src)}</td></tr>`) : []).concat(ownQ.filter(o => o.d0).map(o => `<tr><td data-v="${esc(o.q)}">${esc(o.q)} (our run, depth 0)</td><td class="num" data-v="${o.d0.tg_tps}"><b>${r1(o.d0.tg_tps)}</b></td><td data-v="">3 repeats</td><td class="num" data-v="${o.d0.pp_tps}">${Math.round(o.d0.pp_tps)}</td><td class="num" data-v="3">3</td><td data-v="own">own measurement</td></tr>`)).join("")) : `<p class="mut">No measured rows for ${esc(m.name)} on ${esc(t.title)} yet. The ~${Math.round(headTg)} tok/s above is a bandwidth estimate (${hwr.gpuBw} GB/s${hwr.eff ? ` &times; ${hwr.eff.toFixed(2)} efficiency` : ""}). Have this machine? <a href="../submit.html">Submit a llama-bench result</a> and this page will switch to measured data.</p>`) + `<p class="mut">Generation = tg128 (128 generated tokens, short context). Public rows are medians of community llama.cpp results (<a href="../data-sources.html">sources</a>); our own runs use llama-bench${src ? " " + src : ""} on a rented GPU.</p></section>
${depthTable}
${altHtml}
<section class="card"><h2>Memory and context limits</h2><p class="mut">${esc(p.quantLabel)} weights are ${p.weightsGB.toFixed(1)} GB; the 16k f16 KV cache adds ${p.kvGB.toFixed(2)} GB. Largest context that fits in ${hwr.pool.toFixed(1)} GB usable:</p>` + tw("ctx", th("KV cache type", "text") + th("Max context", "num"), ["f16", "q8_0", "q4_0"].map(k => { const x = p.mode === "gpu" ? A.maxCtx(p, hwr, k) : 0; return `<tr><td data-v="${k}">${k}</td><td class="num" data-v="${x || 0}">${x ? fm(x) : p.mode === "gpu" ? "&lt;4k" : "-"}</td></tr>`; }).join("")) + `<p class="mut">Native limit ${fm(A.ctxLimits(m).native)}${A.ctxLimits(m).extended > A.ctxLimits(m).native ? `, ${fm(A.ctxLimits(m).extended)} with YaRN` : ""}. <a href="../models/${slugify(m.name)}.html">Full KV cache table for ${esc(m.name)}</a>.</p></section>
<section class="card"><h2>Copy-paste commands</h2><p class="mut">The advisor's pick for this hardware: ${esc(p.quantLabel)}, 16k context.</p><div class="cmd"><div class="code"><div class="top"><span>llama.cpp</span></div><pre>${esc(p.command.llama)}</pre></div><div class="code"><div class="top"><span>ollama</span></div><pre>${esc(p.command.ollama)}</pre></div></div>${A.mlxHtml(p.mlx, esc, "", false)}</section>${t.kind === "apple" ? L.mlxExplainer(d, { short: true }) : ""}
${faq([[`How fast is ${m.name} on ${t.title}?`, `About ${r1(headTg)} tokens/s for generation (${esc(headWhat)})${best ? `, ${Math.round(best.pp_tps)} tokens/s for prompt processing` : ""}. Speed drops as the context fills; see the depth table${ownQ.some(o => o.g.length > 1) ? "" : " on this hardware's other pages"}.`],
      [`How much memory does ${m.name} need on ${t.title}?`, `The advisor's pick, ${esc(p.quantLabel)}, is ${p.weightsGB.toFixed(1)} GB of weights plus ${p.kvGB.toFixed(2)} GB of KV cache at 16k context (${(p.weightsGB + p.kvGB).toFixed(1)} GB), against ${hwr.pool.toFixed(1)} GB usable.${qlab !== p.quantLabel ? ` The measured ${esc(qlab)} run needs ${mem.toFixed(1)} GB.` : ""}`],
      [`Is the ${m.name} speed on ${t.title} measured or estimated?`, isEst ? `Estimated. No measured llama.cpp run for this pair is on file yet, so the figure comes from memory bandwidth and our calibration against measured hardware.` : best ? `Measured: our own llama-bench run on a rented ${esc(nameOf(t.device))}${ownQ.some(o => o.g.length > 1) ? ", including runs with 4k to " + fm(Math.max(...ownQ.flatMap(o => o.g.map(x => x.depth)))) + " tokens already in context" : ""}.` : `Measured: the median of ${qrows[0].n} public llama.cpp result${qrows[0].n > 1 ? "s" : ""} for the ${esc(qrows[0].q)} quant class.`],
      [`What can I use instead of ${t.title} for ${m.name}?`, (p.mode === "gpu" ? (smaller.length ? `With less memory, ${smaller.map(o => esc(o.x.title) + " (~" + Math.round(o.q.tps) + " tok/s)").join(", ")} also fit it fully. ` : `Nothing with less memory in our list fits it fully. `) : `It needs more memory than this hardware has; ${others.slice(0, 3).map(o => esc(o.x.title)).join(", ") || "larger GPUs"} fit it fully. `) + (faster.length ? `Faster: ${faster.map(o => esc(o.x.title) + " (~" + Math.round(o.q.tps) + " tok/s)").join(", ")}.` : "")],
      [`What is the maximum context for ${m.name} on ${t.title}?`, p.mode === "gpu" ? `With an f16 KV cache about ${A.maxCtx(p, hwr, "f16") ? fm(A.maxCtx(p, hwr, "f16")) : "under 4k"} tokens, ${A.maxCtx(p, hwr, "q8_0") ? fm(A.maxCtx(p, hwr, "q8_0")) : "under 4k"} with q8_0 and ${A.maxCtx(p, hwr, "q4_0") ? fm(A.maxCtx(p, hwr, "q4_0")) : "under 4k"} with q4_0, bounded by the model's own limit.` : `It does not fit fully in GPU memory, so context is bounded by offload, not by this table.`]])}
<section class="card"><h2>Related</h2><p><a href="../hardware/${t.slug}.html">All models on ${esc(t.title)}</a> &middot; <a href="../models/${slugify(m.name)}.html">${esc(m.name)} on all hardware</a> &middot; <a href="../vram/${TIERS.reduce((b, n) => Math.abs(n - hwr.vram) < Math.abs(b - hwr.vram) ? n : b, TIERS[0])}gb.html">VRAM tier</a> &middot; <a href="index.html">all measured pages</a> &middot; <a href="../leaderboard.html">leaderboard</a></p>${compareLinks(t.slug, d).length ? `<p>Compare: ${compareLinks(t.slug, d).slice(0, 4).join(" &middot; ")}</p>` : ""}</section>`;
    wr(`can-run/${c.slug}.html`, shell(d, title, desc, `<a href="../index.html">Advisor</a> / <a href="index.html">Can it run?</a> / ${esc(m.name)} on ${esc(t.title)}`, `Can ${t.title} run ${m.name}?`, lead, body, "hw"));
    stats.canrun++; crRows.push({ c, headTg, best: !!best, p, isEst });
  }
  // ---- redirect stubs for can-run URLs that were published before but are no longer generated (cap evictions): never 404
  { const PUBF = path.join(__dirname, "..", "data", "canrun_published.json"), live = new Set(C.canrun.map(c => c.slug));
    let pub = []; try { pub = JSON.parse(fs.readFileSync(PUBF, "utf8")); } catch (e) {}
    const all = [...new Set([...pub, ...live])].sort(); fs.writeFileSync(PUBF, JSON.stringify(all, null, 0).replace(/","/g, '",\n"') + "\n");
    const base = (process.env.SITE_URL || "https://localllmadvisor.com").replace(/\/$/, ""); stats.canrunRedirects = 0;
    wr("redirect.js", '(function(){var s=document.currentScript,u=s&&s.getAttribute("data-to");if(u)location.replace(u);})();\n');
    for (const s of all) { if (live.has(s)) continue; const i = s.lastIndexOf("-on-"), ms = s.slice(0, i), hs = s.slice(i + 4);
      const tgt = data.hardware.targets.some(t => t.slug === hs) ? `hardware/${hs}.html` : data.models.models.some(m => slugify(m.name) === ms) ? `models/${ms}.html` : "can-run/index.html";
      wr(`can-run/${s}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'"><!--canrun-redirect--><meta name="robots" content="noindex"><title>Moved | Local LLM Advisor</title><link rel="canonical" href="${base}/${tgt}"><meta http-equiv="refresh" content="0; url=../${tgt}"><script src="../redirect.js" data-to="../${tgt}"></script></head><body><p>This page moved: <a href="../${tgt}">continue</a>.</p></body></html>\n`); stats.canrunRedirects++; } }
  wr("can-run/index.html", shell("../", "Can my GPU run it? Measured tokens/sec for popular GPU and model pairs | Local LLM Advisor", `${crRows.length} hardware and model pairs: llama.cpp tokens/sec (${crRows.filter(x => !x.isEst).length} measured), memory fit, context limits and alternatives.`, `<a href="../index.html">Advisor</a> / Can it run?`, "Can my hardware run this model?", "Popular GPU, Mac and model pairs with speed, memory fit, context limits and alternatives. Pairs are measured (our own runs or public llama.cpp medians) unless marked as an estimate.",
    `<section class="card"><h2>${crRows.length} pairs (${crRows.filter(x => !x.isEst).length} measured)</h2>` + tw("crhub", th("Hardware", "text") + th("Model", "text") + th("Gen tok/s", "num") + th("Fit", "text") + th("Origin", "text"), crRows.map(({ c, headTg, best, p, isEst }) => `<tr><td data-v="${esc(c.t.title.toLowerCase())}">${esc(c.t.title)}</td><td data-v="${esc(c.m.name.toLowerCase())}"><a href="${c.slug}.html">${esc(c.m.name)}</a></td><td class="num" data-v="${headTg}">${r1(headTg)}</td><td data-v="${p.mode}">${MODE[p.mode]}</td><td data-v="${best ? "own" : isEst ? "estimate" : "public"}">${best ? "own run" : isEst ? "estimate" : "public runs"}</td></tr>`).join("")) + `</section><p class="mut"><a href="../compare/index.html">Compare hardware</a> &middot; <a href="../hardware/index.html">All hardware</a> &middot; <a href="../leaderboard.html">Leaderboard</a></p>`, "hw"));

  // ================= BLOG =================
  const blog = require("./generate_blog.js").run({ A, data, L, esc, SITE, C, shell, tw, th, faq, wr, TIERS, slugify, HF_URL, ownRows: C.ownRows, ownAll: C.ownAll, nameOf, r1, med });
  // ================= EMBED =================
  const emb = require("./generate_embed.js").run({ A, data, L, esc, SITE, C, wr, res, r1, HF_URL });
  return { ...stats, compareIndexable: cmpRows.filter(x => x.P.distinct).length, blog, embed: emb };
}
module.exports = { init, run, compareLinks, canrunLinks, canrunLinksModel, canrunFor, HOT, PAIR_SLUGS, CAP_CANRUN, med, r1, HF_URL, getC: () => C };
