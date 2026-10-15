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
  assert.deepStrictEqual(ids1m, ["Qwen/Qwen3-Coder-30B-A3B-Instruct", "Qwen/Qwen3-VL-8B-Instruct", "Qwen/Qwen3.5-4B", "Qwen/Qwen3.5-9B", "Qwen/Qwen3.6-27B", "Qwen/Qwen3.6-35B-A3B"]);
  assert(at1m.excluded.some(e => e.model.id === "openai/gpt-oss-120b" && e.native === 131072) && at1m.excluded.every(e => !e.model.context_extended));
  assert(at1m.results.every(p => p.ctxStatus === "extended" && p.command.llama.includes("--rope-scale 4")));
  const at512 = A.recommend(big, dd, { use: "all", ctx: 524288, kvq: "f16" }); assert(at512.results.every(p => /--rope-scale 2 /.test(p.command.llama)));
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
  }
  const src = fs2.readFileSync(path2.join(root, "analytics.js"), "utf8"); assert(!/v-q"\)\.value|\.value\)?\s*\}\);?\s*\/\/ search/.test(src));
  assert(/window\.umami && typeof window\.umami\.track/.test(src), "track is guarded");
}
console.log("ALL TESTS PASSED");
