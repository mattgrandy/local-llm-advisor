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
console.log("ALL TESTS PASSED");
