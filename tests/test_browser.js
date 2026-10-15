// Real-browser test. Usage: node tests/test_browser.js [baseUrl]   (default: serves ../site on localhost)
// Needs puppeteer-core + a Chrome (CHROME_PATH or /usr/bin/google-chrome). NODE_PATH may point at its node_modules.
const assert = require("assert"), http = require("http"), fs = require("fs"), path = require("path");
let puppeteer; try { puppeteer = require("puppeteer-core"); } catch (e) { puppeteer = require(path.join(process.env.PUPPETEER_DIR || "/workspace/bt", "node_modules/puppeteer-core")); }
const SITE = path.join(__dirname, "..", "site");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let base = process.argv[2], server;
  if (!base) {
    server = http.createServer((q, s) => { let f = path.join(SITE, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html";
      fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(d); } }); });
    await new Promise(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${server.address().port}/`;
  }
  if (!base.endsWith("/")) base += "/";
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const errors = []; let n = 0;
  const ok = m => { n++; console.log("  ok", m); };
  async function open(viewport) {
    const pg = await browser.newPage(); if (viewport) await pg.setViewport(viewport);
    pg.on("pageerror", e => errors.push(e.message));
    pg.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
    await pg.goto(base, { waitUntil: "networkidle0" });
    await pg.waitForSelector("#results .res");
    return pg;
  }
  const val = (pg, id) => pg.$eval("#" + id, e => e.value);
  const results = pg => pg.$eval("#results", e => e.innerHTML);
  async function clickSeg(pg, id, value) {
    const h = await pg.evaluateHandle((id, value) => [...document.querySelectorAll(`#${id} + .seg input`)].find(i => i.value === value).closest("label"), id, value);
    await h.asElement().click(); await sleep(60);
  }
  async function suite(name, viewport) {
    console.log(name);
    const pg = await open(viewport);
    // every segmented option: select value changes, radio checked, results re-render
    for (const id of ["kind", "use", "ctx", "kvq"]) {
      const values = await pg.$$eval(`#${id} option`, o => o.map(x => x.value));
      assert(values.length >= 2);
      for (const v of [...values].reverse().concat(values)) {
        const before = await results(pg);
        await clickSeg(pg, id, v);
        assert.strictEqual(await val(pg, id), v, `${id} select should be ${v}`);
        assert(await pg.$eval(`#${id} + .seg input[value="${v}"]`, i => i.checked), `${id}=${v} radio checked`);
        assert.strictEqual(await pg.$$eval(`#${id} + .seg input:checked`, a => a.length), 1);
        const after = await results(pg);
        assert(after.length > 0 && (/class="card res|Nothing in the dataset/.test(after)), "results rendered");
        if (id === "kind") {
          const vis = await pg.evaluate(() => Object.fromEntries(["device", "count", "mem", "ram", "ramt"].map(k => [k, !document.getElementById("l-" + k).hidden])));
          const exp = { gpu: { device: 1, count: 1, mem: 0, ram: 1, ramt: 1 }, apple: { device: 1, count: 0, mem: 1, ram: 0, ramt: 0 }, unified: { device: 1, count: 0, mem: 1, ram: 0, ramt: 0 }, cpu: { device: 0, count: 0, mem: 0, ram: 1, ramt: 1 } }[v];
          for (const k in exp) assert.strictEqual(vis[k], !!exp[k], `kind=${v}: field ${k} visibility`);
          const dev = await pg.$$eval("#device option", o => o.length);
          assert(v === "cpu" ? dev === 0 : dev > 0, "device list filled for " + v);
          if (v !== "cpu") assert((await pg.$eval("#hwinfo", e => e.textContent)).length > 20);
        }
      }
      ok(`${id}: all ${values.length} options switch select, show/hide fields, re-render`);
    }
    // changes actually alter output
    await clickSeg(pg, "kind", "gpu"); await clickSeg(pg, "ctx", "4096"); const a = await results(pg); await clickSeg(pg, "ctx", "131072"); assert.notStrictEqual(await results(pg), a); ok("context change alters results");
    await clickSeg(pg, "kind", "apple"); const ap = await pg.$eval("#hwinfo", e => e.textContent); await clickSeg(pg, "kind", "gpu"); assert.notStrictEqual(await pg.$eval("#hwinfo", e => e.textContent), ap); ok("apple vs gpu changes hardware summary");
    // copy buttons (clipboard needs permission; fall back to checking UI state)
    await pg.browserContext().overridePermissions(new URL(base).origin, ["clipboard-read", "clipboard-write"]).catch(() => {});
    await pg.bringToFront();
    const btn = await pg.$("button.copy"); await btn.click(); await sleep(150);
    assert.strictEqual(await pg.$eval("button.copy", e => e.textContent), "Copied"); 
    const want = await pg.$eval("button.copy", b => document.getElementById(b.dataset.c).textContent);
    const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (clip !== null) assert.strictEqual(clip, want, "clipboard contents"); ok("copy button shows Copied" + (clip !== null ? " and clipboard matches" : ""));
    // theme toggle
    const t0 = await pg.$eval("html", e => e.dataset.theme); await pg.click("#theme-toggle"); const t1 = await pg.$eval("html", e => e.dataset.theme);
    assert.notStrictEqual(t0, t1); assert.strictEqual(await pg.evaluate(() => localStorage.getItem("llma-theme")), t1);
    await pg.click("#theme-toggle"); assert.strictEqual(await pg.$eval("html", e => e.dataset.theme), t0); ok(`theme toggle ${t0} <-> ${t1}`);
    await pg.close();
  }
  try {
    await suite("desktop 1280x900", { width: 1280, height: 900 });
    await suite("mobile 390x844", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    assert.deepStrictEqual(errors, [], "console/page errors: " + errors.join(" | "));
    console.log(`BROWSER TESTS PASSED (${n} checks) against ${base}`);
  } catch (e) { console.error("BROWSER TEST FAILED:", e.message, errors); process.exitCode = 1; }
  await browser.close(); if (server) server.close();
})();
