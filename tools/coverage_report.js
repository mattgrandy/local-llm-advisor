#!/usr/bin/env node
// Counts measured / scaled / estimated speeds across the target hardware pages (all models that fit, 16k ctx).
// Usage: node tools/coverage_report.js [--json]
const fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "site");
const A = require(path.join(SITE, "advisor.js"));
const read = f => JSON.parse(fs.readFileSync(path.join(SITE, "data", f)));
const data = { hardware: read("hardware.json"), models: read("models.json"), measured: read("measured.json") };
const tot = { measured: 0, scaled: 0, estimated: 0 }, rows = [];
for (const t of data.hardware.targets) {
  const input = { kind: t.kind, device: t.device, label: t.config ? (data.hardware.apple_configs.find(c => c.id === t.config) || {}).name : undefined, count: t.count, memory_gb: t.memory_gb, ram_gb: t.ram_gb, ram_type: t.ram_type };
  const r = A.recommend(input, data, { use: "all", ctx: 16384, kvq: "f16" });
  const c = { measured: 0, scaled: 0, estimated: 0 };
  for (const p of r.results) { const s = A.speedInfo(p).short; c[s === "measured" ? "measured" : s === "estimated" ? "estimated" : "scaled"]++; }
  for (const k in c) tot[k] += c[k];
  rows.push({ slug: t.slug, device: t.device, points: (data.measured.entries[t.device] || []).length, ...c });
}
if (process.argv.includes("--json")) console.log(JSON.stringify({ tot, rows }));
else { console.log("slug\tdevice\tmeasured_points\tmeasured\tscaled\testimated"); rows.forEach(r => console.log([r.slug, r.device, r.points, r.measured, r.scaled, r.estimated].join("\t"))); console.log("TOTAL", JSON.stringify(tot), "pages", rows.length); }
