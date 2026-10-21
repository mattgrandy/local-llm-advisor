#!/usr/bin/env node
// New-release fast path: add a model, GPU or Apple/unified machine (plus its top "Can X run Y" pairs) and regenerate, in one command.
// See release-playbook.md. Every fact passed here must come from a cited source (--source); nothing is guessed.
//   node tools/add_release.js model --id org/Repo --name "Name 30B-A3B" --gguf unsloth/Repo-GGUF [--moe --active 3.3] [--tags chat,coding] [--vision] [--pairs rtx-4090-24gb,rtx-3090-24gb]
//   node tools/add_release.js gpu --id rtx-6090 --name "GeForce RTX 6090" --vendor NVIDIA --vram 32 --bw 2048 --source URL --basis "..." [--title "RTX 6090 32GB"] [--pairs openai/gpt-oss-20b,Qwen/Qwen3.6-27B]
//   node tools/add_release.js apple --chip m6-max-40 --chip-name "Apple M6 Max (40-core GPU)" --bw 700 --source URL --config mbp-m6-max-40 --form "MacBook Pro"
//        --config-name "MacBook Pro 14/16 — M6 Max (40-core GPU)" --mem 36,64,128 --target-mem 128 [--title "MacBook Pro 14/16 M6 Max 128GB"] [--pairs ...]
//   node tools/add_release.js pairs --hw <target-slug> --models id,id     (just add day-one pairs for existing entries)
// model: update_models.py also runs mlx_repos.py, so verified mlx-community 4/8-bit repos are picked up (or 'no MLX conversion yet').
// Common flags: --dry (print the change, write nothing), --no-build (skip regenerate + tests).
const fs = require("fs"), path = require("path"), cp = require("child_process");
const ROOT = path.join(__dirname, ".."), HWF = path.join(ROOT, "site/data/hardware.json"), MAN = path.join(__dirname, "model_manifest.json"), REL = path.join(__dirname, "release_hot.json");
const [kind, ...rest] = process.argv.slice(2), o = {};
for (let i = 0; i < rest.length; i++) { const k = rest[i].replace(/^--/, ""); if (rest[i + 1] === undefined || rest[i + 1].startsWith("--")) o[k] = true; else o[k] = rest[++i]; }
const die = m => { console.error("add_release: " + m); process.exit(1); }, need = (...ks) => ks.forEach(k => { if (o[k] === undefined || o[k] === true) die(`--${k} is required for '${kind}'`); });
const today = new Date().toISOString().slice(0, 10), slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const rj = f => JSON.parse(fs.readFileSync(f, "utf8")), wj = (f, x) => o.dry ? console.log(`[dry] would write ${path.relative(ROOT, f)}`) : fs.writeFileSync(f, JSON.stringify(x, null, 2) + "\n");
const list = s => (s && s !== true ? String(s).split(",").map(x => x.trim()).filter(Boolean) : []);
const hw = rj(HWF), rel = fs.existsSync(REL) ? rj(REL) : { _note: "Day-one pairs for tools/generate_extra_pages.js; expire after 45 days. Written by tools/add_release.js.", pairs: [] };
const DEFAULT_MODELS = ["openai/gpt-oss-20b", "Qwen/Qwen3.6-35B-A3B", "Qwen/Qwen3.6-27B", "google/gemma-4-31B-it", "openai/gpt-oss-120b"];
const DEFAULT_HW = ["rtx-4090-24gb", "rtx-3090-24gb", "rtx-5090-32gb", "rtx-4060ti-16gb", "macbook-pro-m5-max-128gb"];
const addPairs = (hws, models) => { for (const h of hws) for (const m of models) if (!rel.pairs.some(x => x.hw === h && x.model === m)) { rel.pairs.push({ hw: h, model: m, added: today }); console.log(`pair: ${m} on ${h}`); } };
const addTarget = (t) => { if (hw.targets.some(x => x.slug === t.slug)) die(`target ${t.slug} exists`); hw.targets.push(t); console.log("target:", t.slug); return t.slug; };
let changed = [];
if (kind === "model") {
  need("id", "name", "gguf"); const man = rj(MAN);
  if (man.models.some(m => m.id === o.id)) die(`${o.id} already in model_manifest.json`);
  const e = { id: o.id, name: o.name, gguf: o.gguf, ...(o.active ? { active_b: +o.active } : {}), moe: !!o.moe, tags: list(o.tags || "chat"), vision: !!o.vision };
  if (o.moe && !o.active) die("--moe needs --active <B> copied from the model card");
  man.models.push(e); console.log("manifest +", JSON.stringify(e)); wj(MAN, man); changed.push("tools/model_manifest.json");
  if (!o.dry) { console.log("fetching facts from Hugging Face (update_models.py)..."); cp.execFileSync("python3", [path.join(__dirname, "update_models.py")], { stdio: "inherit" }); }
  const ms = rj(path.join(ROOT, "site/data/models.json")).models; if (!o.dry && !ms.some(m => m.id === o.id)) die(`update_models.py did not produce ${o.id} (no GGUF sizes or config?). Check the GGUF repo name.`);
  addPairs(list(o.pairs).length ? list(o.pairs) : DEFAULT_HW, [o.id]);
} else if (kind === "gpu") {
  need("id", "name", "vendor", "vram", "bw", "source", "basis");
  if (hw.gpus.some(g => g.id === o.id)) die(`gpu ${o.id} exists`);
  hw.gpus.push({ id: o.id, name: o.name, vendor: o.vendor, vram_gb: +o.vram, bandwidth_gbps: +o.bw, source_url: o.source, basis: o.basis, last_verified: today });
  const title = o.title && o.title !== true ? o.title : `${o.name.replace(/^GeForce |^Radeon /, "")} ${o.vram}GB`;
  const slug = addTarget({ slug: o.slug && o.slug !== true ? o.slug : slugify(title), title, kind: "gpu", device: o.id, count: 1, memory_gb: null, ram_gb: 32, ram_type: "ddr5-5600", note: "" });
  addPairs([slug], list(o.pairs).length ? list(o.pairs) : DEFAULT_MODELS);
} else if (kind === "apple" || kind === "unified") {
  need("chip", "chip-name", "bw", "source", "target-mem");
  const pool = kind === "apple" ? hw.apple : hw.unified;
  if (!pool.some(a => a.id === o.chip)) pool.push({ id: o.chip, name: o["chip-name"], bandwidth_gbps: +o.bw, source_url: o.source, basis: o.basis && o.basis !== true ? o.basis : `${o["chip-name"]} spec page: ${o.bw}GB/s`, last_verified: today, ...(kind === "unified" ? { memory_gb: +o["target-mem"] } : {}) });
  let config;
  if (kind === "apple") { need("config", "form", "config-name", "mem"); config = o.config; if (!hw.apple_configs.some(c => c.id === config)) hw.apple_configs.push({ id: config, hw: o.chip, form_factor: o.form, name: o["config-name"], memory_options_gb: list(o.mem).map(Number), source_url: o.source, last_verified: today }); }
  const title = o.title && o.title !== true ? o.title : `${(o["config-name"] || o["chip-name"]).replace(/ — /, " ").replace(/\s*\(\d+-core GPU\)/, "")} ${o["target-mem"]}GB`;
  const slug = addTarget({ slug: o.slug && o.slug !== true ? o.slug : slugify(title.replace(/\b14\/16 /, "")), title, kind, device: o.chip, ...(config ? { config } : {}), count: 1, memory_gb: +o["target-mem"], ram_gb: +o["target-mem"], ram_type: "ddr5-5600", note: "" });
  addPairs([slug], list(o.pairs).length ? list(o.pairs) : DEFAULT_MODELS);
} else if (kind === "pairs") {
  need("hw", "models"); if (!hw.targets.some(t => t.slug === o.hw)) die(`no target ${o.hw}`); addPairs([o.hw], list(o.models));
} else die("usage: add_release.js model|gpu|apple|unified|pairs ... (see header)");
if (kind !== "model" && kind !== "pairs") { hw.generated = today; wj(HWF, hw); changed.push("site/data/hardware.json"); }
wj(REL, rel); changed.push("tools/release_hot.json");
if (o.dry || o["no-build"]) process.exit(0);
console.log("regenerating..."); cp.execFileSync("node", [path.join(__dirname, "generate_pages.js")], { stdio: "inherit", env: { ...process.env, SITE_URL: "https://localllmadvisor.com" } });
console.log("testing..."); cp.execFileSync("node", [path.join(ROOT, "tests/test_all.js")], { stdio: ["ignore", "ignore", "inherit"] }); cp.execFileSync("node", [path.join(ROOT, "tests/test_all.js")], { stdio: ["ignore", "ignore", "inherit"] }); // twice: the first run may move lastmod
const made = rel.pairs.map(x => { const m = (rj(path.join(ROOT, "site/data/models.json")).models.find(y => y.id === x.model) || {}).name; return m && `can-run/${slugify(m)}-on-${x.hw}.html`; }).filter(f => f && fs.existsSync(path.join(ROOT, "site", f)));
console.log(`\nOK. Changed: ${changed.join(", ")}. Day-one pair pages live in site/: ${made.length}\n  ${made.join("\n  ")}\nNext: node tests/test_browser.js && node tests/test_browser_growth.js; tools/sync_publish.sh; copy tools/ + data changes into /workspace/publish; commit as Matt; push; node tools/indexnow.js --submit`);
