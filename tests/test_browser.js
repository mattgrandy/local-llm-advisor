// Real-browser test (Playwright). Usage: [TEST_BROWSER=chromium|webkit|all] node tests/test_browser.js [baseUrl]   (default: serves ../site on localhost; BROWSER defaults to all)
// Needs playwright-core (PLAYWRIGHT_DIR, default /workspace/pw) with `npx playwright-core install webkit` for WebKit (Safari's engine) and a Chrome (CHROME_PATH or /usr/bin/google-chrome) for Chromium.
// Clicks are real mouse/touch hit-tested events, so a control that is covered, hidden or unclickable fails here.
const assert = require("assert"), http = require("http"), fs = require("fs"), path = require("path");
let pw; try { pw = require(path.join(process.env.PLAYWRIGHT_DIR || "/workspace/pw", "node_modules/playwright-core")); } catch (e) { pw = require("playwright-core"); }
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
  const want = process.env.TEST_BROWSER || "all", engines = [];
  if (want === "all" || want === "chromium") engines.push(["chromium", () => pw.chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] })]);
  if (want === "all" || want === "webkit") engines.push(["webkit", () => pw.webkit.launch()]);
  const errors = [], ran = []; let n = 0;
  const ok = m => { n++; console.log("  ok", m); };
  async function suite(browser, name, ctxOpts, touch) {
    console.log(name);
    const ctx = await browser.newContext(ctxOpts); const pg = await ctx.newPage();
    pg.on("pageerror", e => errors.push(name + ": " + e.message));
    pg.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(name + ": " + m.text()); });
    await pg.goto(base, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    const val = id => pg.$eval("#" + id, e => e.value), results = () => pg.$eval("#results", e => e.innerHTML);
    const hit = loc => touch ? loc.tap() : loc.click();
    async function clickSeg(id, value) { await hit(pg.locator(`#${id} + .seg button[data-value="${value}"]`)); await sleep(60); }
    for (const id of ["kind", "use", "ctx", "kvq"]) {
      const values = await pg.$$eval(`#${id} option`, o => o.map(x => x.value)); assert(values.length >= 2);
      for (const v of [...values].reverse().concat(values)) {
        await clickSeg(id, v);
        assert.strictEqual(await val(id), v, `${id} select should be ${v}`);
        assert.strictEqual(await pg.$eval(`#${id} + .seg button[data-value="${v}"]`, b => b.getAttribute("aria-checked")), "true", `${id}=${v} marked checked`);
        assert.strictEqual(await pg.$$eval(`#${id} + .seg button.on`, a => a.length), 1);
        const after = await results(); assert(/class="card res|Nothing in the dataset/.test(after), "results rendered");
        if (id === "kind") {
          const vis = await pg.evaluate(() => Object.fromEntries(["device", "count", "mem", "ram", "ramt"].map(k => [k, !document.getElementById("l-" + k).hidden])));
          const exp = { gpu: { device: 1, count: 1, mem: 0, ram: 1, ramt: 1 }, apple: { device: 1, count: 0, mem: 1, ram: 0, ramt: 0 }, unified: { device: 1, count: 0, mem: 1, ram: 0, ramt: 0 }, cpu: { device: 0, count: 0, mem: 0, ram: 1, ramt: 1 } }[v];
          for (const k in exp) assert.strictEqual(vis[k], !!exp[k], `kind=${v}: field ${k} visibility`);
          const dev = await pg.$$eval("#device option", o => o.length); assert(v === "cpu" ? dev === 0 : dev > 0, "device list filled for " + v);
        }
      }
      ok(`${id}: all ${values.length} options switch select, show/hide fields, re-render`);
    }
    await clickSeg("kind", "gpu"); await clickSeg("ctx", "4096"); const a = await results(); await clickSeg("ctx", "131072"); assert.notStrictEqual(await results(), a); ok("context change alters results");
    await clickSeg("kind", "apple"); const ap = await pg.$eval("#hwinfo", e => e.textContent); await clickSeg("kind", "gpu"); assert.notStrictEqual(await pg.$eval("#hwinfo", e => e.textContent), ap); ok("apple vs gpu changes hardware summary");
    // Apple device list: grouped by form factor, full descriptive names, memory options follow the device
    await clickSeg("kind", "apple");
    const groups = await pg.$$eval("#device optgroup", g => g.map(x => [x.label, [...x.querySelectorAll("option")].map(o => o.textContent)]));
    assert.deepStrictEqual(groups.map(g => g[0]), ["Mac Studio", "MacBook Pro", "MacBook Air", "Mac mini", "iMac"]);
    const all = groups.flatMap(g => g[1]); assert(all.includes("Mac Studio — M5 Ultra (80-core GPU)") && all.includes("MacBook Air 13 — M5") && all.includes("Mac mini — M4 Pro".replace("M4 Pro", "M5 Pro (16-core GPU)")), "descriptive names present");
    assert(all.every(x => / — /.test(x)), "every Apple entry names a Mac model and chip");
    await pg.selectOption("#device", "studio-m5-ultra-80"); await sleep(60);
    assert.deepStrictEqual(await pg.$$eval("#mem option", o => o.map(x => +x.value)), [256, 512]); assert(/Apple M5 Ultra|M5 Ultra/.test(await pg.$eval("#hwinfo", e => e.textContent)));
    await pg.selectOption("#device", "air-m5-13"); await sleep(60);
    assert.deepStrictEqual(await pg.$$eval("#mem option", o => o.map(x => +x.value)), [16, 24, 32]); assert(/MacBook Air 13/.test(await pg.$eval("#hwinfo", e => e.textContent)));
    ok("apple device list is grouped, descriptive, and memory options follow the device");
    // generated page deep link selects the same config
    await pg.goto(base + "index.html?kind=apple&device=m5-ultra&config=studio-m5-ultra-80&mem=512", { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    assert.strictEqual(await val("device"), "studio-m5-ultra-80"); assert.strictEqual(await val("mem"), "512"); ok("deep link selects Mac config + memory");
    await pg.goto(base, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await hit(pg.locator("button.copy").first()); await sleep(200);
    assert.strictEqual(await pg.$eval("button.copy", e => e.textContent), "Copied");
    const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => null); const wantTxt = await pg.$eval("button.copy", b => document.getElementById(b.dataset.c).textContent);
    if (clip !== null) assert.strictEqual(clip, wantTxt, "clipboard contents"); ok("copy button shows Copied" + (clip !== null ? " and clipboard matches" : ""));
    const t0 = await pg.$eval("html", e => e.dataset.theme); await hit(pg.locator("#theme-toggle")); const t1 = await pg.$eval("html", e => e.dataset.theme);
    assert.notStrictEqual(t0, t1); await hit(pg.locator("#theme-toggle")); assert.strictEqual(await pg.$eval("html", e => e.dataset.theme), t0); ok(`theme toggle ${t0} <-> ${t1}`);
    await ctx.close();
  }
  let failed = false;
  for (const [ename, launch] of engines) {
    let browser; try { browser = await launch(); } catch (e) { console.error(`SKIP ${ename}: cannot launch (${e.message.split("\n")[0]})`); if (want !== "all") failed = true; continue; }
    console.log(`== ${ename} ${browser.version()}`); ran.push(ename);
    try {
      await suite(browser, `${ename} desktop 1280x900`, { viewport: { width: 1280, height: 900 } }, false);
      await suite(browser, `${ename} mobile 390x844 (touch)`, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, true);
    } catch (e) { console.error(`BROWSER TEST FAILED (${ename}):`, e.message); failed = true; }
    await browser.close();
  }
  if (errors.length) { console.error("console/page errors:", errors); failed = true; }
  if (failed) process.exitCode = 1; else console.log(`BROWSER TESTS PASSED (${n} checks, engines run: ${ran.join("+")}) against ${base}`);
  if (server) server.close();
})();
