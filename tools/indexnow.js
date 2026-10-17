#!/usr/bin/env node
// IndexNow: tell Bing/Yandex/etc. which URLs changed. Google does not support IndexNow (it uses the sitemap).
//   node tools/indexnow.js            -> record URLs whose sitemap lastmod changed since the last submission (tools/indexnow-pending.json); no network
//   node tools/indexnow.js --submit   -> after the site is pushed AND live: verify the key file is reachable, POST pending URLs, mark them submitted
//   node tools/indexnow.js --dry-run  -> print what would be sent
// Only changed/new URLs are sent (never the whole sitemap on every run).
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), HOST = (process.env.SITE_URL || "https://localllmadvisor.com").replace(/\/$/, "");
const read = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d;
const LM = path.join(__dirname, "lastmod.json"), SUB = path.join(__dirname, "indexnow-submitted.json"), PEND = path.join(__dirname, "indexnow-pending.json");
const key = fs.readFileSync(path.join(__dirname, "indexnow-key.txt"), "utf8").trim();
const urlOf = rel => HOST + "/" + (rel === "index.html" ? "" : rel);
const lm = read(LM, {}), sub = read(SUB, {});
const pending = Object.keys(lm).filter(rel => sub[rel] !== lm[rel].h).map(urlOf);
fs.writeFileSync(PEND, JSON.stringify(pending, null, 1) + "\n");
const arg = process.argv[2];
if (!arg) { console.log(`indexnow: ${pending.length} URL(s) pending (run with --submit after the push is live)`); process.exit(0); }
if (arg === "--dry-run") { console.log(pending.join("\n")); process.exit(0); }
(async () => {
  if (!pending.length) return console.log("indexnow: nothing to submit");
  const keyUrl = `${HOST}/${key}.txt`, kr = await fetch(keyUrl).then(r => r.text()).catch(() => "");
  if (kr.trim() !== key) { console.error("indexnow: key file not live yet at " + keyUrl + "; push/deploy first"); process.exit(2); }
  for (let i = 0; i < pending.length; i += 9000) {
    const r = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host: new URL(HOST).hostname, key, keyLocation: keyUrl, urlList: pending.slice(i, i + 9000) }) });
    console.log("indexnow: HTTP", r.status, "for", Math.min(9000, pending.length - i), "URLs");
    if (r.status !== 200 && r.status !== 202) process.exit(3);
  }
  for (const rel of Object.keys(lm)) sub[rel] = lm[rel].h; fs.writeFileSync(SUB, JSON.stringify(sub, null, 1) + "\n"); fs.writeFileSync(PEND, "[]\n");
})();
