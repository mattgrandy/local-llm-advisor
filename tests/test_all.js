// node tests/test_all.js
const assert = require("assert"), fs = require("fs"), path = require("path");
const S = path.join(__dirname, "..", "site"), A = require(S + "/advisor.js"), Sub = require(S + "/submit.js");
const rd = f => JSON.parse(fs.readFileSync(path.join(S, "data", f)));
const data = { hardware: rd("hardware.json"), models: rd("models.json"), measured: rd("measured.json") };
const nom = { ...data, measured: null };
// 1. measured tiers appear, estimates remain for unmeasured hardware, and nothing throws across all targets
let tiers = {}, total = 0;
for (const t of data.hardware.targets) {
  const inp = { kind: t.kind, device: t.device, count: t.count, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type };
  for (const use of ["coding", "chat", "vision"]) {
    const r = A.recommend(inp, data, { use, ctx: 16384, kvq: "f16" });
    for (const p of r.results) { const k = A.speedInfo(p).short; tiers[k] = (tiers[k] || 0) + 1; total++; assert(p.tps > 0 || p.tps === null); }
  }
}
console.log("speed provenance over all target pages x uses:", tiers, "of", total);
assert(tiers.measured > 0, "expected some exact measured results"); assert(tiers.estimated > 0);
// 2. 3090 + gpt-oss-20b: measured result must equal the table median, estimate path unaffected without measured data
const inp = { kind: "gpu", device: "rtx-3090", count: 1, ram_gb: 32, ram_type: "ddr5-5600" };
const withM = A.recommend(inp, data, { use: "chat", ctx: 4096, kvq: "f16" }), without = A.recommend(inp, nom, { use: "chat", ctx: 4096, kvq: "f16" });
for (const p of withM.results.filter(p => p.speed)) console.log("3090", p.model.name, p.quantLabel, A.speedInfo(p).short, p.tps.toFixed(1), "(pure estimate", without.results.find(q => q.model.id === p.model.id).tps.toFixed(1) + ")");
assert(without.results.every(p => !p.speed));
// 3. multi-GPU never gets single-device measurements
const two = A.recommend({ ...inp, count: 2 }, data, { use: "chat", ctx: 4096, kvq: "f16" });
assert(two.results.every(p => !p.speed), "2x GPU must not use single-GPU measured rows");
// 4. submit.js
const good = { hardware_id: "rtx-3090", model: "gpt-oss-20b", quant: "MXFP4", backend: "CUDA", pp_tps: "3200", tg_tps: "160.5", build: "b6123", os: "Linux", consent: true };
const ids = [...data.hardware.gpus, ...data.hardware.apple, ...data.hardware.unified].map(d => d.id);
let v = Sub.validate(good, ids); assert(v.ok, JSON.stringify(v.errors)); assert.strictEqual(v.clean.pp_n, 512);
assert(!Sub.validate({ ...good, tg_tps: "-3" }, ids).ok); assert(!Sub.validate({ ...good, tg_tps: "abc" }, ids).ok);
assert(!Sub.validate({ ...good, hardware_id: "rtx-9999" }, ids).ok); assert(!Sub.validate({ ...good, build: "latest" }, ids).ok);
assert(!Sub.validate({ ...good, consent: false }, ids).ok); assert(!Sub.validate({ ...good, website: "http://spam" }, ids).ok);
assert(!Sub.validate({ ...good, contact: "not valid!!" }, ids).ok); assert(!Sub.validate({ ...good, hardware_id: "other" }, ids).ok);
assert(Sub.validate({ ...good, pp_tps: "100", tg_tps: "200" }, ids).warnings.length === 1);
const pb = Sub.parseLlamaBench(`| model | size | params | backend | ngl | test | t/s |
| ------ | ---: | ---: | ------ | --: | ----: | ---: |
| llama 8B Q4_K - Medium | 4.58 GiB | 8.03 B | CUDA | 99 | pp512 | 7594.49 ± 12.1 |
| llama 8B Q4_K - Medium | 4.58 GiB | 8.03 B | CUDA | 99 | tg128 | 119.61 ± 0.3 |`);
assert.strictEqual(pb.pp, 7594.49); assert.strictEqual(pb.tg, 119.61); assert.strictEqual(pb.backendRaw, "CUDA");
assert.strictEqual(Sub.issueUrl({ mode: "none", github_issue: { repo: "" } }, v.clean), null);
assert(Sub.issueUrl({ github_issue: { repo: "me/repo" } }, v.clean).startsWith("https://github.com/me/repo/issues/new?"));
// 5. Apple configs: every config maps to a chip, has memory options + an Apple source, every target's memory is an official option, M5 Ultra present, no M4 Ultra
{
  const H = data.hardware, chips = Object.fromEntries(H.apple.map(c => [c.id, c]));
  assert(chips["m5-ultra"] && !Object.keys(chips).some(k => /m4-ultra/.test(k)), "M5 Ultra present, no M4 Ultra");
  for (const c of H.apple_configs) {
    assert(chips[c.hw], "config chip " + c.id); assert(c.memory_options_gb.length && c.memory_options_gb.every(Number.isInteger)); assert(/apple\.com/.test(c.source_url), "Apple source " + c.id);
    assert(/^(Mac Studio|MacBook Pro|MacBook Air|Mac mini|iMac)/.test(c.name) && / — /.test(c.name), "descriptive name " + c.name);
  }
  for (const c of H.apple) assert(/apple\.com/.test(c.source_url), "chip source is Apple " + c.id);
  for (const t of H.targets.filter(t => t.kind === "apple")) { const c = H.apple_configs.find(c => c.id === t.config); assert(c, "target config " + t.slug); assert(c.hw === t.device && c.memory_options_gb.includes(t.memory_gb), "target memory is an official option " + t.slug); }
  const m6 = A.recommend({ kind: "apple", device: "m6", memory_gb: 16, ram_gb: 32, ram_type: "ddr5-5600" }, data, { use: "chat", ctx: 4096, kvq: "f16" }).hwr, m6b = A.recommend({ kind: "apple", device: "m6", memory_gb: 32, ram_gb: 32, ram_type: "ddr5-5600" }, data, { use: "chat", ctx: 4096, kvq: "f16" }).hwr;
  assert.strictEqual(m6.gpuBw, 153); assert.strictEqual(m6b.gpuBw, 170);
}
// 5. sort / filter (applyView)
{
  const dq = { ...data, quality: rd("quality.json") };
  const r = A.recommend({ kind: "gpu", device: "rtx-5090", count: 1, ram_gb: 64, ram_type: "ddr5-5600" }, dq, { use: "all", ctx: 16384, kvq: "f16" }).results;
  const V = o => ({ ...A.DEFAULT_VIEW, ...o });
  assert(r.length > 8 && A.applyView(r, V({})).length === r.length, "default view keeps every model");
  const by = A.applyView(r, V({ sort: "tps" })); assert(by.every((p, i) => !i || by[i - 1].tps >= p.tps));
  assert.deepStrictEqual(A.applyView(r, V({ sort: "tps", dir: "asc" })).map(p => p.model.id), by.map(p => p.model.id).reverse());
  const ql = A.applyView(r, V({ sort: "quality", dir: "asc" })); const firstNull = ql.findIndex(p => !p.quality); assert(firstNull < 0 || ql.slice(firstNull).every(p => !p.quality), "unrated last even ascending");
  assert(A.applyView(r, V({ src: "measured" })).every(p => A.speedInfo(p).short === "measured"));
  assert(A.applyView(r, V({ src: "measured+scaled" })).every(p => A.speedInfo(p).short !== "estimated"));
  assert(A.applyView(r, V({ fit: "gpu" })).every(p => p.mode === "gpu") && A.applyView(r, V({ fit: "offload" })).every(p => p.mode !== "gpu"));
  assert(A.applyView(r, V({ min: 100 })).every(p => p.tps >= 100)); assert(A.applyView(r, V({ q: "QWEN" })).every(p => /qwen/i.test(p.model.id)));
  assert(r.every(p => p.maxCtx >= 16384), "everything shown fits the chosen context, so max context >= it"); assert(r.every(p => p.maxCtx <= A.ctxLimits(p.model).extended));
  assert(r.filter(p => p.quality).every(p => p.quality.rank > 0 && p.quality.rating > 1000)); assert(!A.viewActive(A.DEFAULT_VIEW) && A.viewActive(V({ fam: "Qwen" })));
  console.log("sort/filter ok on", r.length, "models;", r.filter(p => p.quality).length, "with LMArena rating");
}
// 6. long context (up to 1M): caps, extension, KV math, depth penalty, TTFT
{
  const dd = { ...data, depth: rd("depth_calibration.json") }, M = Object.fromEntries(data.models.models.map(m => [m.id, m]));
  const big = { kind: "apple", device: "m5-ultra", label: "Mac Studio", memory_gb: 512, ram_gb: 32, ram_type: "ddr5-5600" };
  assert.deepStrictEqual(A.CTX_STEPS.slice(-3), [262144, 524288, 1000000]);
  // 6a. nobody shown beyond its real max; extended only with documented YaRN
  for (const ctx of A.CTX_STEPS) for (const kvq of ["f16", "q8_0", "q4_0"]) {
    const r = A.recommend(big, dd, { use: "all", ctx, kvq });
    for (const p of r.results) {
      const l = A.ctxLimits(p.model); assert(ctx <= l.extended, p.model.id + " shown at " + ctx);
      assert.strictEqual(p.ctxStatus, ctx > p.model.context_max ? "extended" : "native");
      if (p.ctxStatus === "extended") { assert(p.model.context_extended && /yarn/i.test(p.model.context_extended.method) && p.model.context_extended.source_url && p.model.context_extended.source); assert(/--rope-scaling yarn --rope-scale \d+ --yarn-orig-ctx 262144/.test(p.command.llama), p.command.llama); }
      else assert(!/rope-scaling/.test(p.command.llama));
    }
    assert.strictEqual(r.results.length + r.excluded.length, data.models.models.filter(m => A.recommend(big, dd, { use: "all", ctx: 4096, kvq }).results.some(p => p.model.id === m.id)).length);
  }
  const at1m = A.recommend(big, dd, { use: "all", ctx: 1000000, kvq: "f16" });
  const ids1m = at1m.results.map(p => p.model.id).sort(); console.log("models at 1M on M5 Ultra 512GB:", ids1m.join(", "));
  assert.deepStrictEqual(ids1m, ["Qwen/Qwen3-Coder-30B-A3B-Instruct", "Qwen/Qwen3-VL-8B-Instruct", "Qwen/Qwen3.5-4B", "Qwen/Qwen3.5-9B", "Qwen/Qwen3.6-27B", "Qwen/Qwen3.6-35B-A3B", "Qwen/Qwen3.8-27B", "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16"]);
  assert(at1m.excluded.some(e => e.model.id === "openai/gpt-oss-120b" && e.native === 131072) && at1m.excluded.every(e => !e.model.context_extended));
  // 1M is beyond the native window of every model except those whose own config allows >= 1M (Nemotron 3.5 Super VL: 1,048,576): those run native, no YaRN
  assert(at1m.results.every(p => p.model.context_max >= 1000000 ? p.ctxStatus === "native" && !/rope-scaling/.test(p.command.llama) : p.ctxStatus === "extended" && p.command.llama.includes("--rope-scale 4")));
  assert(at1m.results.some(p => p.ctxStatus === "native") && at1m.results.filter(p => p.ctxStatus === "extended").length === 7);
  const at512 = A.recommend(big, dd, { use: "all", ctx: 524288, kvq: "f16" }); assert(at512.results.every(p => p.model.context_max >= 524288 ? p.ctxStatus === "native" && !/rope-scaling/.test(p.command.llama) : /--rope-scale 2 /.test(p.command.llama)));
  assert(!A.recommend(big, dd, { use: "all", ctx: 262144, kvq: "f16" }).results.some(p => /gpt-oss|Mistral|GLM/.test(p.model.id)), "128k-max models excluded at 256k");
  assert(A.recommend(big, dd, { use: "all", ctx: 262144, kvq: "f16" }).results.some(p => /gemma-4/.test(p.model.id) && p.ctxStatus === "native"), "gemma native at 256k");
  // 6b. KV math, per architecture
  const GBn = 1e9, q = M["Qwen/Qwen3-Coder-30B-A3B-Instruct"], g = M["google/gemma-4-31B-it"], h = M["Qwen/Qwen3.5-9B"], o = M["openai/gpt-oss-20b"];
  assert(Math.abs(A.kvGB(q, 262144, "f16") - 2 * 4 * 128 * 48 * 2 * 262144 / GBn) < 1e-9, "plain GQA: 2*kvheads*dim*layers*bytes*ctx");
  assert(Math.abs(A.kvGB(q, 1e6, "f16") / A.kvGB(q, 1e5, "f16") - 10) < 1e-9, "full-attention KV is linear in ctx");
  const swaPart = c => A.kvGB(g, c, "f16"); assert(swaPart(1e6) - swaPart(5e5) === 2 * 4 * 512 * 10 * 2 * 5e5 / GBn || Math.abs(swaPart(1e6) - swaPart(5e5) - 2 * 4 * 512 * 10 * 2 * 5e5 / GBn) < 1e-9, "sliding-window layers stop growing past the window");
  assert(Math.abs(A.kvGB(g, 512, "f16") - (2 * 4 * 512 * 10 * 2 * 512 + 2 * 16 * 256 * 50 * 2 * 512) / GBn) < 1e-9, "below the window SWA layers cache every token");
  assert(Math.abs((A.kvGB(h, 2e6, "f16") - A.kvGB(h, 1e6, "f16")) - 2 * 4 * 256 * 8 * 2 * 1e6 / GBn) < 1e-9 && h.kv.linear_state_gb > 0, "linear-attention layers add only a constant state");
  assert(Math.abs(A.kvGB(h, 1000, "q4_0") - h.kv.linear_state_gb - (A.kvGB(h, 1000, "f16") - h.kv.linear_state_gb) * 0.5625 / 2) < 1e-12);
  assert(A.kvGB(h, 1e6, "q4_0") < A.kvGB(h, 1e6, "q8_0") && A.kvGB(h, 1e6, "q8_0") < A.kvGB(h, 1e6, "f16"));
  console.log("KV @1M f16 GB:", Object.fromEntries(data.models.models.map(m => [m.name, +A.kvGB(m, 1e6, "f16").toFixed(1)])));
  assert(A.command({ model: h, quantLabel: "Q4_K_M", mode: "gpu" }, { ctx: 1e6, kvq: "q4_0" }, {}).llama.includes("-ctk q4_0 -ctv q4_0"));
  { // Ollama: KV type and context are server env vars (default KV f16), so the command must set them on `ollama serve`
    const c4 = A.command({ model: h, quantLabel: "Q4_K_M", mode: "gpu" }, { ctx: 131072, kvq: "q4_0" }, {}), cf = A.command({ model: h, quantLabel: "Q4_K_M", mode: "gpu" }, { ctx: 16384, kvq: "f16" }, {});
    assert(/^OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q4_0 OLLAMA_CONTEXT_LENGTH=131072 ollama serve\nollama run hf\.co\//.test(c4.ollama), c4.ollama);
    assert(/^OLLAMA_CONTEXT_LENGTH=16384 ollama serve\nollama run /.test(cf.ollama) && !/KV_CACHE_TYPE/.test(cf.ollama), cf.ollama);
    assert(/f16 KV cache/.test(c4.ollamaNote) && !/f16 KV cache/.test(cf.ollamaNote)); }
  // 6c. memory gating: a 24GB card cannot take 1M of Qwen3.5-9B at f16 but the 512GB Mac can
  const g24 = A.recommend({ kind: "gpu", device: "rtx-4090", count: 1, ram_gb: 64, ram_type: "ddr5-5600" }, dd, { use: "all", ctx: 1000000, kvq: "f16" });
  assert(!g24.results.some(p => p.model.id === "Qwen/Qwen3.5-9B" && p.mode === "gpu"), "4090 can't hold 1M f16 KV for a 9B in VRAM");
  assert(at1m.results.every(p => p.mode === "gpu" && p.weightsGB + p.kvGB < at1m.hwr.pool));
  // 6d. depth penalty: monotonic, bounded, flagged extrapolated beyond measured depth, documented + calibrated from data
  const cal = dd.depth; assert(cal.kappa > 0 && cal.n_points > 100 && cal.median_abs_error_pct < 10 && cal.max_measured_depth === 131072 && /fitted/.test(cal.method));
  const base = A.recommend(big, dd, { use: "all", ctx: 4096, kvq: "f16" }).results.find(p => p.model.id === "openai/gpt-oss-20b");
  let last = Infinity; for (const c of [8192, 32768, 131072]) { const d = A.depthSpeed(base, c, "f16", cal); assert(d.tps < last && d.tps > 0 && d.ratio < 1 && !d.extrapolated); last = d.tps; }
  assert(A.depthSpeed(base, 262144, "f16", cal) === null || A.depthSpeed(base, 262144, "f16", cal).extrapolated === true);
  assert(at1m.results.every(p => p.depth && p.depth.extrapolated && p.depth.tps < p.tps), "1M speeds are extrapolated + slower");
  assert.strictEqual(A.depthSpeed(base, 16384, "f16", null), null, "no calibration file -> no depth claim");
  // fit sanity vs raw measured depth rows: gpt-oss-120b on DGX Spark (measured ratio at 32k ~0.69-0.73)
  const syn = { model: M["openai/gpt-oss-120b"], tps: 50, readGB: 63 * 5.1 / 117 };
  const r32 = A.depthSpeed(syn, 32768, "f16", cal).ratio; assert(r32 > 0.6 && r32 < 0.85, "gpt-oss-120b 32k ratio " + r32);
  // 6e. TTFT only where prompt-processing data exists; grows superlinearly; never for offload
  const withPp = at1m.results.filter(p => p.ttft != null); const small = A.recommend(big, dd, { use: "all", ctx: 32768, kvq: "f16" }).results.filter(p => p.ttft != null);
  console.log("TTFT estimates at 1M:", withPp.map(p => p.model.name + " " + A.fmtDur(p.ttft)).join("; "), "| results with pp data at 32k:", small.length);
  { const g5 = { kind: "gpu", device: "rtx-5090", count: 1, ram_gb: 64, ram_type: "ddr5-5600" }, a = A.recommend(g5, dd, { use: "all", ctx: 32768, kvq: "f16" }).results.filter(p => p.ttft != null), b = A.recommend(g5, dd, { use: "all", ctx: 131072, kvq: "f16" }).results;
    assert(a.length >= 5); for (const p of a) { const p2 = b.find(x => x.model.id === p.model.id && x.quant === p.quant); if (p2 && p2.ttft != null) assert(p2.ttft > p.ttft * 4, "prefill grows faster than linearly: " + p.model.name); } }
  assert(A.recommend(big, dd, { use: "all", ctx: 32768, kvq: "f16" }).results.filter(p => p.pp0 == null).every(p => p.ttft === null));
  // 6f. sort by "ctx" still orders by context that fits; sort by speed at full context works
  const r16 = A.recommend({ kind: "gpu", device: "rtx-5090", count: 1, ram_gb: 64, ram_type: "ddr5-5600" }, dd, { use: "all", ctx: 16384, kvq: "f16" }).results;
  const V = o => ({ ...A.DEFAULT_VIEW, ...o }), byc = A.applyView(r16, V({ sort: "ctx" })); assert(byc.every((p, i) => !i || byc[i - 1].maxCtx >= p.maxCtx) && byc[0].maxCtx > 262144, "ctx sort sees >256k steps");
  const bt = A.applyView(r16, V({ sort: "tpsctx" })); assert(bt.every((p, i) => !i || bt[i - 1].depth.tps >= p.depth.tps)); assert(A.SORTS.tpsctx);
}
{ // analytics: every page has exactly one umami tag (id from layout config, DNT) and analytics.js; same cache-bust everywhere
  const fs2 = require("fs"), path2 = require("path"), L = require("../tools/layout.js"), root = path2.join(__dirname, "..", "site");
  const pages = [...fs2.readdirSync(root).filter(f => f.endsWith(".html")), ...fs2.readdirSync(path2.join(root, "hardware")).filter(f => f.endsWith(".html")).map(f => "hardware/" + f)];
  assert(pages.length >= 28, "pages found: " + pages.length);
  for (const f of pages) {
    const h = fs2.readFileSync(path2.join(root, f), "utf8");
    assert.strictEqual((h.match(/cloud\.umami\.is\/script\.js/g) || []).length, 1, "one umami script in " + f);
    assert(h.includes(`data-website-id="${L.ANALYTICS.websiteId}"`) && h.includes('data-do-not-track="true"'), "umami id + DNT in " + f);
    assert(/analytics\.js\?v=/.test(h) && h.includes("?v=" + L.VER) && !/\?v=20261015d/.test(h), "analytics.js + cache-bust in " + f);
    assert(/anonymous, cookie-free analytics/.test(h), "privacy note in " + f);
    assert(/<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https:\/\/cloud\.umami\.is;/.test(h) && /name="referrer" content="strict-origin-when-cross-origin"/.test(h), "CSP + referrer meta in " + f);
    assert(/rel="icon" href="(\.\.\/)?favicon\.svg"/.test(h) && /favicon\.ico/.test(h), "favicon links in " + f);
    assert(!/<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>/.test(h) && !/\son[a-z]+="/.test(h), "no inline scripts/handlers (CSP) in " + f);
  }
  const src = fs2.readFileSync(path2.join(root, "analytics.js"), "utf8"); assert(!/v-q"\)\.value|\.value\)?\s*\}\);?\s*\/\/ search/.test(src));
  assert(/window\.umami && typeof window\.umami\.track/.test(src), "track is guarded");
}
{ const fs3 = require("fs"), r = require("path").join(__dirname, ".."); assert(fs3.existsSync(r + "/site/favicon.svg") && fs3.existsSync(r + "/site/favicon.ico"), "favicon files");
  assert(/Copyright \(c\) 2026 Matt\s*\n/.test(fs3.readFileSync(r + "/LICENSE", "utf8")) && /CC BY 4\.0/.test(fs3.readFileSync(r + "/DATA-LICENSE", "utf8")), "license files");
  assert(/Data: .*Local LLM Advisor \(localllmadvisor\.com\)/.test(fs3.readFileSync(r + "/site/data-sources.html", "utf8")), "data attribution line"); }
{ const fs4 = require("fs"), rt = require("path").join(__dirname, "..", "site", "hardware"); let n = 0;
  for (const f of fs4.readdirSync(rt).filter(f => f.endsWith(".html") && f !== "index.html")) { const h = fs4.readFileSync(rt + "/" + f, "utf8"), a = h.indexOf('data-placement="v2"'); if (a < 0) continue; n++;
    assert(a < h.indexOf('<section class="card"><h2>Best for') && a > h.indexOf('class="stats"') && (h.match(/data-affiliate="amazon"/g) || []).length === 1, "price box after stats, before results, once: " + f); }
  assert(n >= 20, "boxes on hardware pages: " + n); }
{ // SEO pages: programmatic landing pages, structured data, sitemap lastmod, IndexNow
  const fs5 = require("fs"), p5 = require("path"), root = p5.join(__dirname, "..", "site"), rd = f => fs5.readFileSync(p5.join(root, f), "utf8");
  const tiers = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512], md = JSON.parse(rd("data/models.json")).models;
  const types = h => (h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).map(x => JSON.parse(x.replace(/<[^>]+>/g, "")));
  const sigs = new Set();
  for (const n of tiers) { const h = rd(`vram/${n}gb.html`); assert(h.includes("<h1>Best local LLMs for " + n + "GB VRAM</h1>"), "vram h1 " + n); const t = types(h).map(o => o["@type"]); assert(t.includes("BreadcrumbList") && t.includes("FAQPage"), "ld on vram " + n); assert(h.split(/\s+/).length > 600, "vram content " + n); sigs.add(h.match(/<main[\s\S]*<\/main>/)[0].replace(new RegExp(n + "\\s?(GB|gb)", "g"), "N")); }
  assert(sigs.size === tiers.length, "vram tables are distinct: " + sigs.size);
  const msig = new Set();
  for (const m of md) { const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), h = rd(`models/${slug}.html`); assert(h.includes(m.name) && types(h).some(o => o["@type"] === "FAQPage"), "model page " + slug); msig.add(h.match(/<tbody>[\s\S]*?<\/tbody>/)[0]); }
  assert(msig.size === md.length, "model tables distinct");
  const lbh = rd("leaderboard.html"), csv = rd("data/leaderboard.csv").trim().split("\n"); assert(types(lbh).some(o => o["@type"] === "Dataset" && o.license && o.distribution[0].contentUrl.endsWith("/data/leaderboard.csv")), "Dataset ld"); assert(csv.length > 200 && /^hardware_id,/.test(csv[0]) && (lbh.match(/<tr>/g) || []).length === csv.length, "leaderboard rows match csv " + csv.length);
  const home = rd("index.html"), hwp = rd("hardware/rtx-4090-24gb.html");
  assert(home.includes('href="vram/24gb.html"') && home.includes('href="models/gpt-oss-120b.html"') && home.includes('href="leaderboard.html"') && hwp.includes('href="../vram/24gb.html"') && hwp.includes('href="../models/') && types(hwp).some(o => o["@type"] === "FAQPage") && types(hwp).some(o => o["@type"] === "BreadcrumbList"), "internal links + hardware ld");
  assert(types(home).filter(o => o["@type"] === "WebSite").length === 1 && types(hwp).filter(o => o["@type"] === "WebSite").length === 0, "WebSite only on home");
  for (const f of fs5.readdirSync(root, { recursive: true }).filter(f => f.endsWith(".html"))) for (const a of rd(f).match(/<a [^>]*amazon\.com[^>]*>/g) || []) assert(/rel="sponsored noopener nofollow"/.test(a), "amazon link sponsored in " + f);
  const sm = rd("sitemap.xml"); assert((sm.match(/<loc>/g) || []).length >= 58 && sm.includes("/leaderboard.html") && sm.includes("/vram/24gb.html") && sm.includes("/models/index.html"), "sitemap lists new pages");
  const key = fs5.readFileSync(p5.join(__dirname, "..", "tools", "indexnow-key.txt"), "utf8").trim(); assert(/^[0-9a-f]{32}$/.test(key) && rd(key + ".txt").trim() === key, "indexnow key file");
  const cp = require("child_process"), lmf = p5.join(__dirname, "..", "tools", "lastmod.json"), before = fs5.readFileSync(lmf, "utf8"); // regenerate: nothing changed => lastmod map unchanged
  cp.execFileSync("node", [p5.join(__dirname, "..", "tools", "generate_pages.js")], { stdio: "ignore" }); assert.strictEqual(fs5.readFileSync(lmf, "utf8"), before, "lastmod stable when content is unchanged");
}
console.log("ALL TESTS PASSED");

// ---- affiliate links + disclosure (Amazon Associates rules)
{
  const fs2 = require("fs"), path2 = require("path"), assert2 = require("assert"), Lay = require("../tools/layout.js");
  const root = path2.join(__dirname, "..", "site"), pages = [...fs2.readdirSync(root).filter(f => f.endsWith(".html")).map(f => path2.join(root, f)), ...fs2.readdirSync(path2.join(root, "hardware")).map(f => path2.join(root, "hardware", f))];
  let links = 0;
  for (const f of pages) {
    const h = fs2.readFileSync(f, "utf8");
    assert2(h.includes(Lay.AFFILIATE.disclosure), "disclosure missing in " + f);
    for (const m of h.matchAll(/<a [^>]*data-affiliate="amazon"[^>]*>/g)) {
      links++; assert2(/href="https:\/\/www\.amazon\.com\/s\?k=[^"]+&amp;tag=localllmadvis-20"/.test(m[0]), "bad amazon href " + m[0]);
      assert2(/rel="sponsored noopener nofollow"/.test(m[0]) && /target="_blank"/.test(m[0]), "bad rel/target");
      assert2(!/\/dp\/|\$\d/.test(m[0]), "no ASIN/price allowed");
    }
  }
  assert2(links >= 20, "expected hardware page links, got " + links);
  for (const s of ["mac-studio-m5-ultra-256gb", "mac-studio-m5-ultra-512gb", "mac-mini-m6-32gb"]) assert2(!/amazon\.com/.test(fs2.readFileSync(path2.join(root, "hardware", s + ".html"), "utf8")), "unreleased hardware must not link: " + s);
  console.log("affiliate checks ok:", links, "static links");
  // cloud GPU referral slot (Vast.ai)
  const walk = d => fs2.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path2.join(d, e.name)) : e.name.endsWith(".html") ? [path2.join(d, e.name)] : []);
  const all = walk(root); let cl = 0; const kinds = new Set();
  const live = Lay.cloudPartners();
  assert2(live.length === 2 && live[0].id === "vast" && live[0].url === "https://cloud.vast.ai/?ref_id=749586" && live[1].id === "runpod" && live[1].url === "https://runpod.io?ref=w3uudui6", "vast + runpod enabled");
  for (const f of all) {
    const h = fs2.readFileSync(f, "utf8");
    const nv = (h.match(/data-sponsor="vast"/g) || []).length, nr = (h.match(/data-sponsor="runpod"/g) || []).length; assert2(nv === nr, "vast and runpod always shown together in " + f);
    for (const m of h.matchAll(/<a [^>]*data-sponsor="[^"]*"[^>]*>/g)) {
      cl++; assert2(/href="https:\/\/cloud\.vast\.ai\/\?ref_id=749586"/.test(m[0]) && /data-sponsor="vast"/.test(m[0]) || /href="https:\/\/runpod\.io\?ref=w3uudui6"/.test(m[0]) && /data-sponsor="runpod"/.test(m[0]), "bad cloud href " + m[0]);
      assert2(/rel="sponsored noopener nofollow"/.test(m[0]) && /target="_blank"/.test(m[0]) && /data-slot-id="[a-z-]+"/.test(m[0]) && /data-hardware="[^"]+"/.test(m[0]), "bad cloud attrs " + m[0]);
      assert2(!/\$\d/.test(m[0]), "no price"); kinds.add(/data-slot-id="([a-z-]+)"/.exec(m[0])[1]);
      assert2(h.includes("We may earn a referral credit if you sign up through these links."), "cloud disclosure near link in " + f);
    }
  }
  for (const k of ["hardware-page", "vram-page", "model-page"]) assert2(kinds.has(k), "missing cloud slot kind " + k);
  assert2(cl >= 60, "cloud links " + cl);
  const ds = fs2.readFileSync(path2.join(root, "data-sources.html"), "utf8");
  assert2(/id="affiliate-disclosure"[\s\S]*Vast\.ai[\s\S]*referral credit/.test(ds) && /id="privacy"[\s\S]*cloud GPU rental link/.test(ds), "data-sources documents cloud referral + privacy");
  const aj = fs2.readFileSync(path2.join(root, "affiliate.js"), "utf8"); assert2(/"cloud":\{[^}]*"partners":\[\{"id":"vast"/.test(aj) && /"id":"runpod"/.test(aj), "affiliate.js cloud config");
  console.log("cloud slot checks ok:", cl);
}
// no empty sponsor/ad placeholders rendered; slot() config-driven
{
  const L2 = require("../tools/layout.js"), fs6 = require("fs"), p6 = require("path");
  assert.strictEqual(L2.slot("sponsor-top"), "", "empty slot must render nothing");
  L2.SPONSOR_SLOTS["t"] = { url: "https://example.com/x", text: "Sponsored" }; assert(/data-sponsor="t"/.test(L2.slot("t"))); delete L2.SPONSOR_SLOTS["t"];
  let n = 0;
  for (const f of fs6.readdirSync(S, { recursive: true }).filter(f => f.endsWith(".html"))) {
    const h = fs6.readFileSync(p6.join(S, f), "utf8"); n++;
    assert(!/class="slot"|No sponsor yet|Sponsor slot|Affiliate box|No links yet|\{\{SLOT/i.test(h), "placeholder in " + f);
  }
  console.log("no placeholder slots in", n, "pages");
}

// ---- growth pages: compare, can-run, blog, embed (all numbers from the data files; no prices; CSP; links)
{
  const fs7 = require("fs"), p7 = require("path"), root = S, rd = f => fs7.readFileSync(p7.join(root, f), "utf8");
  const types = h => (h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).map(x => JSON.parse(x.replace(/<[^>]+>/g, "")));
  const sm = rd("sitemap.xml"), inSm = rel => sm.includes("/" + rel + "</loc>");
  const noindex = h => /<meta name="robots" content="noindex/.test(h);
  const text = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ");
  // compare
  const cmp = fs7.readdirSync(p7.join(root, "compare")).filter(f => f !== "index.html"); assert(cmp.length >= 14 && cmp.length <= 20, "compare pages " + cmp.length);
  const sigs7 = new Set(), hubC = rd("compare/index.html"); let amazonBoxes = 0;
  for (const f of cmp) {
    const h = rd("compare/" + f), t = types(h).map(o => o["@type"]); assert(/-vs-/.test(f) && t.includes("BreadcrumbList") && t.includes("FAQPage") && !t.includes("WebSite"), "compare ld " + f);
    assert(h.includes('<section class="card" id="faq">') && h.includes("Price tier note") && h.includes("Verdict from the numbers") && h.includes('href="index.html"') && hubC.includes(f), "compare sections/hub " + f);
    assert(h.includes(Lay_AFF()) && /class="badge (measured|scaled|estimated)"/.test(h), "disclosure + labelled speeds " + f);
    sigs7.add(h.match(/<tbody>[\s\S]*?<\/tbody>/)[0]); amazonBoxes += (h.match(/data-affiliate="amazon"/g) || []).length;
    assert(!/\$\s?\d/.test(text(h)), "no price claims " + f); assert(inSm("compare/" + f) === !noindex(h), "sitemap matches noindex " + f);
    assert((h.match(/data-sponsor="vast"/g) || []).length === (h.match(/data-sponsor="runpod"/g) || []).length);
  }
  assert(sigs7.size === cmp.length, "compare fit tables are distinct"); assert(amazonBoxes >= cmp.length, "amazon boxes on compare pages " + amazonBoxes);
  function Lay_AFF() { return require("../tools/layout.js").AFFILIATE.disclosure; }
  // can-run
  const crAll = fs7.readdirSync(p7.join(root, "can-run")).filter(f => f !== "index.html"), isStub = f => rd("can-run/" + f).includes("<!--canrun-redirect-->");
  { // evicted can-run URLs: every previously published slug still resolves (page or noindex redirect stub to a live page), stubs not in sitemap
    const pub = JSON.parse(fs7.readFileSync(p7.join(root, "..", "data", "canrun_published.json"), "utf8")); assert(pub.length >= 83, "published can-run slug list kept");
    for (const s of pub) { assert(fs7.existsSync(p7.join(root, "can-run", s + ".html")), "published can-run URL still exists " + s); }
    for (const f of crAll.filter(isStub)) { const h = rd("can-run/" + f), u = h.match(/url=\.\.\/([^"]+)"/)[1];
      assert(/noindex/.test(h) && /rel="canonical"/.test(h) && /redirect\.js" data-to=/.test(h) && fs7.existsSync(p7.join(root, u)) && !u.startsWith("can-run/" + f), "redirect stub ok " + f); assert(!inSm("can-run/" + f), "stub not in sitemap " + f); }
    for (const s of ["gemma-4-12b-on-rtx-5070ti-16gb", "qwen3-5-4b-on-rtx-5070ti-16gb", "qwen3-5-9b-on-rtx-5070ti-16gb"]) assert(fs7.existsSync(p7.join(root, "can-run", s + ".html")), "5070 Ti evicted URL resolves " + s); }
  const cr = crAll.filter(f => !isStub(f)); assert(cr.length >= 40 && cr.length <= 80, "can-run 40..80 pages (72 + up to 8 release pairs): " + cr.length);
  const csigs = new Set(); for (const f of cr) { const h = rd("can-run/" + f), t = types(h).map(o => o["@type"]); assert(t.includes("BreadcrumbList") && t.includes("FAQPage"), "can-run ld " + f);
    assert(/<b>[\d.]+<\/b><span>generation tok\/s/.test(h) && /class="badge|Origin/.test(h) || /own measurement|public runs|public/.test(h) || /<!--estimated-pair-->/.test(h), "measured data (or a labelled estimate, checked below) on " + f); assert(inSm("can-run/" + f) === !noindex(h)); assert(!/\$\s?\d/.test(text(h)), "no price " + f); csigs.add(h.match(/<div class="stats">[\s\S]*?<\/div><\/div>/)[0]); }
  assert(csigs.size === cr.length, "can-run pages carry distinct numbers");
  { // every can-run page's headline speed is backed by a measured entry or one of our own rows
    const own = fs7.readdirSync(p7.join(root, "..", "data/benchmarks/own")).filter(f => f.endsWith(".json")).flatMap(f => JSON.parse(fs7.readFileSync(p7.join(root, "..", "data/benchmarks/own", f)))), tgs = new Set(own.map(r => String(Math.round(r.tg_tps * 10) / 10)));
    for (const e of Object.values(data.measured.entries).flat()) tgs.add(String(Math.round(e.tg * 10) / 10));
    for (const f of cr) { if (/<!--estimated-pair-->/.test(rd("can-run/" + f))) continue; const v = rd("can-run/" + f).match(/<div class="stat"><b>([\d.]+)<\/b><span>generation tok\/s/)[1]; assert(tgs.has(v) || tgs.has(String(+v)), "headline speed exists in data: " + f + " " + v); } }
  // blog
  const post = rd("blog/state-of-local-llm-hardware-oct-2026.html"), bt = types(post); const art = bt.find(o => o["@type"] === "Article");
  assert(art && art.datePublished === "2026-10-17" && art.author.name === "Matt" && bt.some(o => o["@type"] === "BreadcrumbList") && inSm("blog/state-of-local-llm-hardware-oct-2026.html") && inSm("blog/index.html"), "article ld + sitemap");
  assert((post.match(/<svg class="chart"/g) || []).length >= 5 && /CC BY 4\.0/.test(post) && /Data: .*Local LLM Advisor \(localllmadvisor\.com\)/.test(post) && /id="methods"/.test(post) && !/\$\s?\d/.test(text(post)), "blog charts/license/methods/no prices");
  assert(post.includes(`<b>${data.measured.counts.rows_used}</b><span>measured rows used`) && post.includes(`<b>${data.measured.counts.points}</b><span>hardware / model / quant points`), "blog headline numbers equal data counts");
  assert(rd("blog/index.html").includes("state-of-local-llm-hardware-oct-2026.html"));
  // embed
  const hw7 = data.hardware.targets, badge = s => rd("embed/badges/" + s + ".svg");
  for (const t of hw7) { const b = badge(t.slug); assert(/^<svg /.test(b) && b.includes("Recommended models for " + t.title.replace(/&/g, "&amp;")) && b.includes("Local LLM Advisor") && !/https?:\/\//.test(b.replace("http://www.w3.org/2000/svg", "")), "badge " + t.slug);
    const c = rd("embed/card/" + t.slug + ".html"); assert(noindex(c) && !/<script/i.test(c) && /default-src 'none'/.test(c) && !/umami|amazon\.com|vast\.ai|runpod/.test(c) && c.includes("https://localllmadvisor.com/hardware/" + t.slug + ".html") && !inSm("embed/card/" + t.slug + ".html"), "card " + t.slug); }
  const emb = rd("embed/index.html"); assert(inSm("embed/index.html") && emb.includes("https://localllmadvisor.com/embed/badges/rtx-4090-24gb.svg") && emb.includes("&lt;iframe src=") && emb.includes("Data: Local LLM Advisor") && (emb.match(/\/embed\/badges\/[a-z0-9-]+\.svg<\/code>/g) || []).length === hw7.length, "embed page snippets");
  assert(!/data-affiliate|data-sponsor|amazon\.com/.test(emb.replace(/Some of the pages[^<]*/, "")), "embed page has no affiliate links");
  // site-wide: CSP present everywhere, scripts only self/umami, nothing third-party loaded, internal links resolve
  const all = fs7.readdirSync(root, { recursive: true }).filter(f => f.endsWith(".html"));
  const csp = require("../tools/layout.js"); let links7 = 0;
  for (const f of all) { const h = rd(f); assert(/Content-Security-Policy/.test(h), "csp " + f);
    for (const m of h.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) assert(!/^https?:/.test(m[1]) || /^https:\/\/cloud\.umami\.is\//.test(m[1]), "script src " + m[1] + " in " + f);
    for (const m of h.matchAll(/<script(?![^>]*(src=|type="application\/(ld\+)?json"))[^>]*>/g)) assert(false, "inline script in " + f);
    for (const m of h.matchAll(/<(?:img|iframe|link)[^>]*\s(?:src|href)="(https?:[^"]+)"/g)) assert(/^https:\/\/localllmadvisor\.com\//.test(m[1]) || /canonical/.test(m[0]) , "external resource " + m[1] + " in " + f);
    if (f.startsWith("embed/card/") || f.startsWith("embed/badges")) continue;
    for (const m of h.matchAll(/<a [^>]*href="([^"#?]+)(?:[#?][^"]*)?"/g)) { if (/^(https?:|mailto:)/.test(m[1])) continue; links7++; const tgt = p7.join(root, p7.dirname(f), m[1]); assert(fs7.existsSync(tgt) || fs7.existsSync(p7.join(tgt, "index.html")), "broken link " + m[1] + " in " + f); } }
  for (const f of all) { const h = rd(f); if (noindex(h)) assert(!inSm(f), "noindex page in sitemap " + f); }
  assert(/compare\/index\.html/.test(rd("index.html")) || /compare\/index\.html/.test(rd("hardware/index.html")), "compare linked from hub pages");
  for (const f of ["index.html", "hardware/rtx-4090-24gb.html", "vram/24gb.html"]) { const h = rd(f); assert(/href="(\.\.\/)?compare\/index\.html"/.test(h) && /href="(\.\.\/)?blog\/index\.html"/.test(h) && /href="(\.\.\/)?embed\/index\.html"/.test(h), "footer links " + f); }
  assert(/compare\/rtx-3090-24gb-vs-rtx-4090-24gb\.html/.test(rd("hardware/rtx-4090-24gb.html")) && /can-run\/gpt-oss-20b-on-rtx-4090-24gb\.html/.test(rd("hardware/rtx-4090-24gb.html")), "hardware page links to compare + can-run");
  { // expanded can-run pages: estimates are labelled and limited to Apple/unified pairs; alternatives + FAQ; model pages link back; sitemap lastmod
    const T7 = Object.fromEntries(data.hardware.targets.map(t => [t.slug, t])), est = cr.filter(f => /<!--estimated-pair-->/.test(rd("can-run/" + f)));
    assert(est.length <= 16, "estimated pairs capped (8 hot + 8 release): " + est.length);
    for (const f of est) { const h = rd("can-run/" + f), slug = f.replace(/\.html$/, "").split("-on-")[1]; const rel = (fs7.existsSync(p7.join(__dirname, "..", "tools", "release_hot.json")) ? JSON.parse(fs7.readFileSync(p7.join(__dirname, "..", "tools", "release_hot.json"), "utf8")).pairs : []).some(x => x.hw === slug); assert(T7[slug] && (rel || ["apple", "unified"].includes(T7[slug].kind)), "estimates only for Apple/unified or day-one release pairs: " + f); assert(/tok\/s estimated/.test((h.match(/<title>[\s\S]*?<\/title>/) || [""])[0]) && /estimated, not measured/.test(h) && /submit\.html/.test(h), "estimate labelled: " + f); }
    const sm = fs7.readFileSync(p7.join(root, "sitemap.xml"), "utf8");
    for (const f of cr) { const h = rd("can-run/" + f); assert(/id="alternatives"/.test(h), "alternatives " + f); assert(/measured or estimated\?/.test(h), "provenance FAQ " + f); assert(/<link rel="canonical" href="https:\/\/localllmadvisor\.com\/can-run\//.test(h), "canonical " + f);
      assert(new RegExp("can-run/" + f.replace(/\./g, "\\.") + "</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>").test(sm), "sitemap lastmod " + f); }
    const keys = new Set(cr.map(f => f.replace(/\.html$/, ""))); assert(keys.size === cr.length);
    assert(/can-run\/qwen3-6-27b-on-rtx-3090-24gb\.html/.test(rd("models/qwen3-6-27b.html")), "model page links to can-run");
    assert(!cr.includes("gpt-oss-120b-on-mac-studio-m5-max-128gb.html") || !cr.includes("gpt-oss-120b-on-macbook-pro-m5-max-128gb.html"), "same chip+memory deduped");
    const d3090 = rd("can-run/qwen3-6-27b-on-rtx-3090-24gb.html"); assert(/with 16k tokens already in context/.test(d3090) && /at 64k/.test(d3090), "depth 16k + long-context summary");
  }
  console.log("growth pages ok: compare", cmp.length, "can-run", cr.length, "badges", hw7.length, "internal links checked", links7);
}
// ---- MLX (Apple Silicon only): repo ids come from the verified cache list; blocks render only for Apple
{
  const fs8 = require("fs"), p8 = require("path"), root = S, rdh = f => fs8.readFileSync(p8.join(root, f), "utf8");
  const cache = JSON.parse(fs8.readFileSync(p8.join(__dirname, "..", "tools", "mlx_verified.json"), "utf8"));
  let withMlx = 0;
  for (const m of data.models.models) {
    assert(m.mlx && Array.isArray(m.mlx.repos) && m.mlx.source && m.mlx.checked, "mlx block with source: " + m.name);
    if (m.mlx.repos.length) withMlx++;
    for (const r of m.mlx.repos) {
      assert(cache.repos[r.repo] && cache.repos[r.repo].exists === true && cache.repos[r.repo].for === m.id, "MLX repo in verified cache list: " + r.repo);
      assert(/^mlx-community\//.test(r.repo) && [4, 8].includes(r.bits) && ["mlx-lm", "mlx-vlm"].includes(r.tool) && r.gb > 0 && r.url === "https://huggingface.co/" + r.repo, "MLX repo fields " + r.repo);
    }
  }
  assert(withMlx >= 10, "most models have an MLX repo: " + withMlx);
  const T8 = data.hardware.targets, inp = t => ({ kind: t.kind, device: t.device, label: t.config ? (data.hardware.apple_configs.find(c => c.id === t.config) || {}).name : undefined, count: t.count, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type });
  let appleCmds = 0;
  for (const t of T8) {
    const r = A.recommend(inp(t), data, { use: "all", ctx: 16384, kvq: "f16" });
    for (const p of r.results) {
      if (t.kind !== "apple") { assert.strictEqual(p.mlx, null, "no MLX for non-Apple: " + t.slug + " " + p.model.name); continue; }
      assert(p.mlx, "Apple result has an MLX decision: " + t.slug);
      if (!p.model.mlx.repos.length) assert.strictEqual(p.mlx.none, "no-conversion");
      else if (p.mlx.repo) { appleCmds++; const mod = p.mlx.tool.replace("-", "_");
        assert(p.mlx.text.startsWith(`pip install -U ${p.mlx.tool}\n${mod}.generate --model ${p.mlx.repo} --prompt `) && p.mlx.text.includes(`\n${mod}.server --model ${p.mlx.repo}`), "MLX command syntax " + p.mlx.repo);
        assert(p.model.mlx.repos.some(x => x.repo === p.mlx.repo) && p.mlx.gb + p.kvGB <= r.hwr.pool, "MLX pick is a listed repo that fits"); }
    }
  }
  assert(appleCmds > 20, "MLX commands on Apple: " + appleCmds);
  const html = A.mlxHtml(A.mlxCommand({ model: { mlx: { repos: [] } }, quantLabel: "Q4_K_M", kvGB: 1 }, {}, { kind: "apple", pool: 50 }), s => s);
  assert(/no MLX conversion yet/.test(html), "missing conversion is stated, not invented");
  for (const t of T8) {
    const h = rdh("hardware/" + t.slug + ".html");
    assert.strictEqual(/data-mlx=/.test(h), t.kind === "apple", "MLX block only on Apple hardware pages: " + t.slug);
    assert.strictEqual(/id="mlx"/.test(h), t.kind === "apple", "MLX explainer only on Apple hardware pages: " + t.slug);
  }
  for (const f of fs8.readdirSync(p8.join(root, "can-run")).filter(f => f !== "index.html")) {
    const h = rdh("can-run/" + f), t = T8.find(x => f.endsWith("-on-" + x.slug + ".html"));
    assert.strictEqual(/data-mlx=/.test(h), t.kind === "apple", "MLX only on Apple can-run pages: " + f);
  }
  for (const m of data.models.models) { const h = rdh("models/" + require("../tools/generate_seo_pages.js").slugify(m.name) + ".html"); assert(/id="mlx-repos"/.test(h) && !/data-mlx=/.test(h)); for (const r of m.mlx.repos) assert(h.includes(r.repo)); if (!m.mlx.repos.length) assert(/No MLX conversion yet/.test(h)); }
  const ds = rdh("data-sources.html"); assert(/id="mlx"/.test(ds) && /arxiv\.org\/abs\/2511\.05502/.test(ds) && /mlx\.core\.quantize/.test(ds), "MLX explainer with sources on data-sources");
  for (const h of [rdh("hardware/macbook-pro-m5-max-128gb.html"), ds]) assert(!/MLX[^.]{0,60}\d+(\.\d+)? tok\/s/.test(h.replace(/<[^>]+>/g, " ").replace(/about 230 tok\/s for MLX|about 150 for llama/g, "")), "no MLX speed numbers of our own");
  console.log("mlx ok:", withMlx, "of", data.models.models.length, "models with repos;", appleCmds, "Apple MLX commands");
}

// model list growth: every model is sourced, memory math is sane, popularity ranking is sourced and dated
{
  const fsP = require("fs"), pP = require("path"), S2 = pP.join(__dirname, "..", "site"), rdP = f => fsP.readFileSync(pP.join(S2, f), "utf8");
  const ms = data.models.models, slugify = require("../tools/generate_seo_pages.js").slugify;
  assert(ms.length >= 25 && ms.length <= 32, "model list is 25-32 models: " + ms.length);
  assert.strictEqual(new Set(ms.map(m => m.id)).size, ms.length, "no duplicate model ids");
  for (const m of ms) {
    for (const k of ["source_url", "gguf_source_url", "license", "gguf_repo"]) assert(m[k], m.name + " has " + k);
    assert(/^https:\/\/huggingface\.co\//.test(m.source_url) && /^https:\/\/huggingface\.co\//.test(m.gguf_source_url), m.name + " sources are HF links");
    assert(m.params_b > 0.5 && m.params_b <= 260, m.name + " params in local range");
    if (m.moe) assert(m.active_params_b > 0 && m.active_params_b < m.params_b, m.name + " MoE active < total");
    const q = Object.entries(m.quants).map(([k, v]) => [k, typeof v === "object" ? v.gb : v]);
    assert(q.length >= 1 && q.some(([k]) => k === "Q4_K_M"), m.name + " has Q4_K_M");
    for (let i = 1; i < q.length; i++) assert(q[i][1] >= q[i - 1][1] - 0.01, m.name + " quant sizes non-decreasing");
    for (const [k, gb] of q) { const bpw = gb * 8 / m.params_b; assert(bpw > 2.5 && bpw < 9.5, `${m.name} ${k} ${gb} GB = ${bpw.toFixed(2)} bpw`); }
    if (A.kvGB) { const k = A.kvGB(m, 32768, "f16"); assert(k > 0 && k < 40, `${m.name} KV at 32k f16 = ${k} GB`); }
    assert(m.kv && m.kv.layers > 0, m.name + " has KV geometry");
    assert(fsP.existsSync(pP.join(S2, "models", slugify(m.name) + ".html")), m.name + " has a model page");
  }
  // KV spot checks against hand math (f16, 32k ctx): Llama 3.3 70B = 80 layers x 8 kv heads x 128 dim x 2 x 2 bytes
  const llama = ms.find(m => m.id === "meta-llama/Llama-3.3-70B-Instruct");
  assert(llama && llama.kv.layers === 80 && llama.kv.full_kv_heads === 8 && llama.kv.full_head_dim === 128, "Llama 3.3 70B KV geometry");
  if (A.kvGB) assert(Math.abs(A.kvGB(llama, 32768, "f16") - 80 * 8 * 128 * 2 * 2 * 32768 / 1e9) < 0.3, "Llama 3.3 70B KV at 32k matches hand math (~10.7 GB)");
  const pop = JSON.parse(rdP("data/popularity.json"));
  assert(/^\d{4}-\d{2}-\d{2}/.test(pop.generated) && pop.method && pop.sources.length >= 2, "popularity has date, method, sources");
  for (const m of ms) { const r = pop.models.find(x => x.id === m.id); assert(r && r.on_site && r.rank > 0, "popularity covers " + m.name);
    assert(/^https:\/\/huggingface\.co\//.test(r.base.url), m.name + " popularity base number links to HF");
    for (const g of r.gguf) assert(/^https:\/\/huggingface\.co\//.test(g.url) && g.downloads_30d >= 0, m.name + " GGUF number links to HF");
    if (r.ollama && r.ollama.shown) assert(/^https:\/\/ollama\.com\/library\//.test(r.ollama.url), m.name + " Ollama number links to ollama.com"); }
  const ranks = pop.models.map(x => x.rank); assert.deepStrictEqual(ranks, ranks.slice().sort((a, b) => a - b), "ranks ascending");
  for (let i = 1; i < pop.models.length; i++) assert(pop.models[i].score_30d <= pop.models[i - 1].score_30d, "ranked by score");
  const ph = rdP("models/popular.html");
  assert(/huggingface\.co\/docs\/hub\/models-download-stats/.test(ph) && /ollama\.com\/library/.test(ph) && ph.includes(pop.generated), "popular page cites method, sources, date");
  assert(rdP("sitemap.xml").includes("/models/popular.html"), "popular page in sitemap");
  const hub = rdP("models/index.html"); assert(/Popularity/.test(hub) && /popular\.html/.test(hub), "hub has popularity column");
  for (const m of ms) assert(hub.includes(">" + m.name.replace(/&/g, "&amp;") + "<"), "hub lists " + m.name);
  console.log("models ok:", ms.length, "models; popularity", pop.models.length, "ranked, fetched", pop.generated);
}
// Strata engine rows: separate list, never in llama.cpp medians; model pages show a Strata section
{
  const st = data.measured.strata || [];
  assert(st.length >= 10 && st.every(r => r.engine === "strata" && ["rtx-3090", "rtx-3060", "rtx-5060ti-16"].includes(r.hw_id) && r.tg_tps > 0 && r.flags && r.engine_version && r.host_ram_gib > 0), "strata rows with engine/version/flags/RAM");
  assert(Object.values(data.measured.entries).every(es => es.every(e => e.engine && !/strata/.test(e.engine))), "every entry has a non-strata engine");
  assert(!Object.values(data.measured.entries).some(es => es.some(e => e.sources.some(s => /strata/.test(s.id)))), "no Strata rows inside llama.cpp medians");
  const q36 = data.measured.entries["rtx-3090"].find(e => e.site_id === "Qwen/Qwen3.6-35B-A3B" && e.qclass === "Q4");
  assert(q36 && q36.engine === "llama.cpp" && q36.tg > 120, "Qwen3.6 3090 Q4 llama.cpp median intact");
  for (const [slug, mtp] of [["qwen3-8-flash-next", true], ["qwen3-6-35b-a3b", false]]) {
    const h = fs.readFileSync(path.join(S, "models", slug + ".html"), "utf8");
    assert(h.includes('id="strata"') && h.includes("Run it with Strata") && h.includes("install.sh") && h.includes("strata launch"), slug + " strata section");
    assert(h.includes("Measured with Strata on an RTX 3090"), slug + " strata lead");
    assert.strictEqual(h.includes("MTP drafts did not engage"), !mtp, slug + " MTP note");
  }
  assert(!fs.readFileSync(path.join(S, "models", "gpt-oss-20b.html"), "utf8").includes('id="strata"'), "no strata section without data");
  assert(st.some(r => r.hw_id === "rtx-3060") && (data.measured.strata_ref || []).some(r => r.hw_id === "rtx-3060" && r.n_cpu_moe > 0), "3060 strata + llama.cpp offload comparison rows");
  { const h = fs.readFileSync(path.join(S, "models", "qwen3-6-35b-a3b.html"), "utf8"); assert(h.includes("RTX 3060 12GB") && h.includes("--n-cpu-moe 22"), "3060 strata comparison on model page"); assert(h.includes("RTX 5060 Ti") && h.includes("llama-server, <code>--n-cpu-moe 14") && h.includes("busy shared host"), "5060 Ti strata + llama-server comparison"); }
  console.log("strata rows:", st.length);
}
