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
    // Umami is always blocked in tests (offline/ad-blocker case); events are captured by a stubbed window.umami instead.
    await ctx.route(/umami\.is/, r => r.abort());
    await ctx.addInitScript(() => { window.__ev = []; window.umami = { track: (n, p) => window.__ev.push([n, p]) }; });
    pg.on("pageerror", e => errors.push(name + ": " + e.message));
    pg.on("console", m => { if (m.type() === "error" && !/404/.test(m.text()) && !/umami/.test(m.location().url + m.text())) errors.push(name + ": " + m.text()); });
    await pg.goto(base, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    const val = id => pg.$eval("#" + id, e => e.value), results = () => pg.$eval("#results", e => e.innerHTML);
    const hit = loc => touch ? loc.tap() : loc.click();
    const pick2 = async (id, v) => { await pg.selectOption("#" + id, v); await sleep(60); };
    const q2 = () => new URLSearchParams(new URL(pg.url()).search);
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
    // ---- long context (up to 1M) ----
    assert.deepStrictEqual(await pg.$$eval("#ctx option", o => o.map(x => +x.value)), [4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1000000], "context presets up to 1M");
    assert.deepStrictEqual(await pg.$$eval("#kvq option", o => o.map(x => x.value)), ["f16", "q8_0", "q4_0"]);
    await pg.goto(base + "index.html?kind=apple&device=m5-ultra&config=studio-m5-ultra-80&mem=512&use=all&ctx=1000000&kvq=f16", { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    assert.strictEqual(await val("ctx"), "1000000", "?ctx=1000000 restored"); assert.strictEqual(await pg.$eval("#ctx + .seg button.on", b => b.dataset.value), "1000000");
    const lc = await pg.$$eval("#results .res", a => a.map(c => ({ n: c.querySelector("h3").textContent, t: c.textContent })));
    assert(lc.length === 6 && lc.every(c => /extended context/.test(c.t) && /estimated/.test(c.t) && /--rope-scale 4/.test(c.t)), "six YaRN-documented models at 1M, all flagged extended + estimated");
    assert(!lc.some(c => /gpt-oss|Mistral|GLM|Gemma/.test(c.n)), "models capped at their max are not offered at 1M");
    const ex = await pg.$eval("#excluded", e => e.textContent); assert(/gpt-oss 120B \(max context 128k\)/.test(ex) && /Gemma 4 31B \(max context 256k\)/.test(ex), "excluded models list real max: " + ex);
    assert(/flash attention/.test(await pg.$eval("#ctxnote", e => e.textContent)), "long-context note");
    assert(/Beyond 128k the slowdown is extrapolated/.test(lc[0].t) && !/measured ~/.test(lc[0].t.split("At 1M depth")[1] || ""), "no measured claim at depth");
    await clickSeg("ctx", "262144"); assert.strictEqual(q2().get("ctx"), "262144", "ctx persisted in URL"); assert(/Gemma 4 31B/.test(await results()), "gemma shows at 256k");
    await pg.selectOption("#v-sort", "ctx"); await sleep(80); assert.strictEqual(q2().get("sort"), "ctx"); await pg.selectOption("#v-sort", "tpsctx"); await sleep(80); assert.strictEqual(q2().get("sort"), "tpsctx");
    const sp = await pg.$$eval("#results .res .depthline b", a => a.map(b => +/\d+/.exec(b.textContent)[0])); assert(sp.length > 2 && sp.every((x, i) => !i || sp[i - 1] >= x), "sorted by tok/s at full context: " + sp);
    await pg.goto(base + "index.html?kind=gpu&device=rtx-4090&ctx=999&kvq=bogus", { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res"); assert.strictEqual(await val("ctx"), "16384", "invalid ?ctx ignored"); assert.strictEqual(await val("kvq"), "f16");
    const ov = await pg.evaluate(() => { const s = document.querySelector("#ctx + .seg"); const r = s.getBoundingClientRect(); return { right: r.right, vw: document.documentElement.clientWidth, docW: document.documentElement.scrollWidth, btns: [...s.children].every(b => { const x = b.getBoundingClientRect(); return x.left >= 0 && x.right <= document.documentElement.clientWidth && x.width > 30; }) }; });
    assert(ov.btns && ov.docW <= ov.vw + 1, "context buttons fit the viewport without horizontal scroll: " + JSON.stringify(ov));
    ok("context up to 1M: presets, URL persistence, extended/excluded flags, honest estimated labels, sorting, layout fits");
    await pg.goto(base, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
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
    // ---- sort & filter ----
    const SF = base + "index.html?kind=gpu&device=rtx-5090&count=1&ram=64&ramt=ddr5-5600&use=all&ctx=16384&kvq=f16";
    await pg.goto(SF, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    const cards = () => pg.$$eval("#results .res", a => a.map(c => ({ name: c.querySelector("h3").textContent, tps: +c.querySelector(".tps b").textContent.replace(/[^0-9.]/g, ""), badges: c.querySelector(".badges").textContent, text: c.textContent })));
    const count = () => pg.$eval("#v-count", e => e.textContent), q = () => new URLSearchParams(new URL(pg.url()).search);
    const pick = async (id, v) => { await pg.selectOption("#" + id, v); await sleep(80); };
    const sorted = (a, k, dir) => a.every((x, i) => i === 0 || (dir === "desc" ? a[i - 1][k] >= x[k] : a[i - 1][k] <= x[k]));
    let c0 = await cards(); const N = +/of (\d+) models/.exec(await count())[1];
    assert(N > 8, "more than 8 models fit on a 5090 with use=all"); assert.strictEqual(c0.length, 8, "default view shows top 8"); assert.strictEqual(await pg.$eval("#v-sort", e => e.value), "rec");
    assert(!(await pg.$eval("#v-all", e => e.hidden))); await hit(pg.locator("#v-all")); await sleep(80); assert.strictEqual((await cards()).length, N); assert.strictEqual(q().get("all"), "1");
    await hit(pg.locator("#v-all")); await sleep(80); assert.strictEqual((await cards()).length, 8); ok("default top 8, 'Show all' toggles to every model (" + N + ")");
    await pick("v-sort", "tps"); c0 = await cards(); assert.strictEqual(c0.length, N, "sorting by speed shows all models"); assert(sorted(c0, "tps", "desc"), "tok/s descending: " + c0.map(x => x.tps));
    assert.strictEqual(q().get("sort"), "tps");
    await hit(pg.locator("#v-dir")); await sleep(80); c0 = await cards(); assert(sorted(c0, "tps", "asc"), "tok/s ascending"); assert.strictEqual(q().get("dir"), "asc");
    await hit(pg.locator("#v-dir")); await sleep(80); assert(sorted(await cards(), "tps", "desc")); ok("sort by tokens/sec shows all models, order toggle reverses");
    await pick("v-sort", "name"); c0 = await cards(); assert.deepStrictEqual(c0.map(x => x.name), c0.map(x => x.name).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)); assert.strictEqual(await pg.$eval("#v-dir", e => e.textContent), "A \u2192 Z");
    await pick("v-sort", "size"); const sizes = (await pg.$$eval("#results .res .badges", a => a.map(b => +/(\d+(\.\d+)?)B/.exec(b.textContent)[1]))); assert(sorted(sizes.map(x => ({ x })), "x", "desc"), "size desc: " + sizes);
    await pick("v-sort", "ctx"); c0 = await cards(); const ctxs = c0.map(x => { const m = /max context that fits here: (\d+)k/.exec(x.text); return m ? +m[1] : 0; }); assert(ctxs.every((x, i) => !i || ctxs[i - 1] >= x), "context desc: " + ctxs);
    assert((await pg.$$eval("#v-sort option", o => o.map(x => x.value))).includes("quality"), "quality option offered when models are rated");
    await pick("v-sort", "quality"); c0 = await cards(); const rat = c0.map(x => { const m = /rating (\d+)/.exec(x.text); return m ? +m[1] : null; });
    assert(rat.some(x => x != null) && rat.indexOf(null) > rat.findIndex(x => x != null) || !rat.includes(null), "rated first"); const rated = rat.filter(x => x != null); assert(rated.every((x, i) => !i || rated[i - 1] >= x), "quality desc: " + rat);
    assert(rat.slice(rated.length).every(x => x == null), "unrated models last"); ok("sort by name, size, context-that-fits, quality (unrated last)");
    await pick("v-sort", "tps");
    await pick("v-src", "measured+scaled"); c0 = await cards(); assert(c0.length > 0 && c0.length < N && c0.every(x => !/estimated/.test(x.badges.replace(/scaled from measured/, ""))), "no purely-estimated rows"); const ms = c0.length;
    await pick("v-src", "measured"); c0 = await cards(); assert(c0.every(x => /measured/.test(x.badges) && !/scaled/.test(x.badges))); assert(c0.length <= ms); await pick("v-src", "all");
    await pick("v-fit", "gpu"); c0 = await cards(); assert(c0.length > 0 && c0.every(x => /Fits fully/.test(x.badges))); await pick("v-fit", "offload"); c0 = await cards(); assert(c0.every(x => !/Fits fully/.test(x.badges))); await pick("v-fit", "all");
    await pick("v-lic", "permissive"); assert((await cards()).length > 0); await pick("v-lic", "all");
    const fams = await pg.$$eval("#v-fam option", o => o.map(x => x.value)); assert(fams.length > 2 && fams[0] === "all"); await pick("v-fam", "Qwen"); c0 = await cards(); assert(c0.length > 0 && c0.every(x => /Qwen/.test(x.name))); await pick("v-fam", "all");
    ok("filters: speed source, fit, license, family");
    await pg.evaluate(() => { const r = document.getElementById("v-min"); r.value = "100"; r.dispatchEvent(new Event("input", { bubbles: true })); }); await sleep(100);
    c0 = await cards(); assert(c0.length > 0 && c0.every(x => x.tps >= 100), "min tok/s 100"); assert.strictEqual(q().get("min"), "100"); assert(/100 tok\/s/.test(await pg.$eval("#v-minout", e => e.textContent)));
    await pg.fill("#v-q", "gpt"); await sleep(100); c0 = await cards(); assert(c0.every(x => /gpt/i.test(x.name))); assert.strictEqual(q().get("q"), "gpt");
    await pg.fill("#v-q", "zzzzzz"); await sleep(100); assert(/No models match/.test(await results())); assert(/Showing 0 of/.test(await count()));
    await pg.fill("#v-q", ""); await sleep(100); ok("min tokens/sec slider, text search, empty state");
    // state persists across hardware changes and the URL reproduces the view
    await pick("v-src", "measured+scaled"); await pick("v-fam", "Qwen");
    await clickSeg("kind", "apple"); await sleep(100);
    assert.strictEqual(await val("v-sort"), "tps"); assert.strictEqual(await val("v-src"), "measured+scaled"); assert.strictEqual(await val("v-fam"), "Qwen"); assert.strictEqual(await val("v-min"), "100");
    assert.strictEqual(q().get("kind"), "apple"); assert.strictEqual(q().get("sort"), "tps"); ok("sort/filter state preserved when hardware changes; URL tracks hardware + view");
    await clickSeg("kind", "gpu"); await pg.selectOption("#device", "rtx-5090"); await sleep(100);
    const shared = pg.url(); await pg.goto(base, { waitUntil: "networkidle" }); await pg.goto(shared, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res, #results .card");
    assert.strictEqual(await val("v-sort"), "tps"); assert.strictEqual(await val("v-src"), "measured+scaled"); assert.strictEqual(await val("v-fam"), "Qwen"); assert.strictEqual(await val("kind"), "gpu"); assert.strictEqual(await val("use"), "all"); assert.strictEqual(await val("v-min"), "100"); ok("shared URL restores hardware and sort/filter view");
    await hit(pg.locator("#v-reset")); await sleep(100);
    assert.strictEqual(await val("v-sort"), "rec"); assert.strictEqual(await val("v-src"), "all"); assert.strictEqual(await val("v-fam"), "all"); assert.strictEqual(await val("v-min"), "0"); assert.strictEqual(await val("v-q"), "");
    assert(!q().has("sort") && !q().has("src") && !q().has("fam") && !q().has("min")); assert.strictEqual(q().get("kind"), "gpu", "reset keeps hardware"); ok("reset clears sort & filters, keeps hardware");
    await pg.goto(base + "index.html?kind=gpu&device=rtx-5090&use=chat&sort=bogus&fit=bogus&min=abc&dir=sideways", { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res"); assert.strictEqual(await val("v-sort"), "rec"); assert.strictEqual(await val("v-fit"), "all"); ok("malformed URL params fall back to defaults");
    await pg.goto(base, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    await pg.goto(base + "hardware/rtx-5090-32gb.html", { waitUntil: "networkidle" });
    {
      const th = pg.locator("#all-models table.sortable th button").first(); assert(await th.count() === 1, "sortable table on hardware page");
      const col = async i => pg.$$eval("#all-models tbody tr", (r, i) => r.map(x => x.cells[i].dataset.v), i);
      let tp = (await col(5)).map(Number); assert(tp.every((x, i) => !i || tp[i - 1] >= x), "hardware table starts fastest-first");
      await hit(pg.locator('#all-models th[data-sort="num"] button').nth(0)); await sleep(60); const sz = (await col(1)).map(Number); assert(sz.every((x, i) => !i || sz[i - 1] <= x) || sz.every((x, i) => !i || sz[i - 1] >= x));
      await hit(pg.locator("#all-models th button", { hasText: "Tok/s" })); await sleep(60); tp = (await col(5)).map(Number); assert(tp.every((x, i) => !i || tp[i - 1] >= x), "tok/s desc on first click");
      await hit(pg.locator("#all-models th button", { hasText: "Tok/s" })); await sleep(60); tp = (await col(5)).map(Number); assert(tp.every((x, i) => !i || tp[i - 1] <= x), "tok/s asc on second click");
      assert.strictEqual(await pg.$eval("#all-models th[aria-sort=ascending]", e => e.textContent), "Tok/s"); ok("hardware page: all-models table sorts by header click");
    }
    await pg.goto(base, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await hit(pg.locator("button.copy").first()); await sleep(200);
    assert.strictEqual(await pg.$eval("button.copy", e => e.textContent), "Copied");
    const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => null); const wantTxt = await pg.$eval("button.copy", b => document.getElementById(b.dataset.c).textContent);
    if (clip !== null) assert.strictEqual(clip, wantTxt, "clipboard contents"); ok("copy button shows Copied" + (clip !== null ? " and clipboard matches" : ""));
    const t0 = await pg.$eval("html", e => e.dataset.theme); await hit(pg.locator("#theme-toggle")); const t1 = await pg.$eval("html", e => e.dataset.theme);
    assert.notStrictEqual(t0, t1); await hit(pg.locator("#theme-toggle")); assert.strictEqual(await pg.$eval("html", e => e.dataset.theme), t0); ok(`theme toggle ${t0} <-> ${t1}`);
    // ---- analytics events fire into the stubbed window.umami ----
    {
      await pg.goto(base, { waitUntil: "networkidle" }); await pg.waitForSelector("#results .res");
      assert(await pg.$eval('script[src*="cloud.umami.is/script.js"]', s => s.dataset.websiteId && s.dataset.doNotTrack === "true"), "umami script tag with website id + do-not-track");
      await pg.evaluate(() => { window.__ev.length = 0; });
      const evs = () => pg.evaluate(() => window.__ev.map(e => e[0] + ":" + JSON.stringify(e[1] || {})));
      await hit(pg.locator("button.copy").first()); await hit(pg.locator("button.copy").nth(1)); await hit(pg.locator("#v-copy")); await hit(pg.locator("#theme-toggle")); await sleep(80);
      await clickSeg("kind", "apple"); await clickSeg("use", "coding"); await clickSeg("ctx", "32768");
      await pg.selectOption("#device", { index: 1 }); await sleep(60);
      await pick2("v-sort", "tps"); await hit(pg.locator("#v-dir")); await pick2("v-src", "measured"); await pick2("v-fit", "gpu");
      await pg.fill("#v-q", "secret-search-text"); await sleep(60);
      await pg.evaluate(() => { const r = document.getElementById("v-min"); r.value = "20"; r.dispatchEvent(new Event("input", { bubbles: true })); });
      const e1 = await evs(), has = n => e1.some(x => x.startsWith(n + ":"));
      for (const n of ["hardware_type_selected", "use_case_selected", "context_selected", "device_selected", "sort_changed", "filter_changed", "command_copied", "link_copied", "theme_toggled"]) assert(has(n), "event fired: " + n + " in " + e1.join(" | "));
      assert(e1.some(x => x === 'hardware_type_selected:{"value":"apple"}') && e1.some(x => x === 'command_copied:{"tool":"llama.cpp"}') && e1.some(x => x === 'command_copied:{"tool":"ollama"}'), "event payloads: " + e1.join(" | "));
      assert(e1.some(x => x.startsWith("filter_changed:") && /"search"/.test(x)), "search filter reported by name"); assert(!e1.join().includes("secret-search-text"), "search text never sent");
      await pg.evaluate(() => { window.__ev.length = 0; document.querySelector("#results").insertAdjacentHTML("beforebegin", '<a id="aff" href="#x" data-affiliate="acme" data-slot-id="s1">a</a><a id="spn" href="#x" data-sponsor="corp" data-slot-id="s2">s</a>'); });
      await hit(pg.locator("#aff")); await hit(pg.locator("#spn")); const e2 = await evs();
      assert.deepStrictEqual(e2, ['affiliate_click:{"partner":"acme","slot":"s1"}', 'sponsor_click:{"sponsor":"corp","slot":"s2"}']);
      await pg.goto(base + "submit.html", { waitUntil: "networkidle" }); await pg.evaluate(() => { window.__ev.length = 0; });
      await pg.evaluate(() => document.getElementById("f").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await sleep(50);
      assert((await evs()).some(x => x.startsWith("benchmark_submit_clicked:")), "benchmark_submit_clicked on submit page");
      await pg.goto(base + "data-sources.html", { waitUntil: "networkidle" }); assert(/anonymous, cookie-free analytics/.test(await pg.$eval("#privacy", e => e.textContent)), "privacy note on data-sources");
      ok("analytics: umami tag present, events fire into stubbed window.umami with no free text, script blocked without errors");
    }
    // without any window.umami at all (script blocked, no stub) nothing throws
    {
      const c2 = await browser.newContext(ctxOpts), p2 = await c2.newPage(); await c2.route(/umami\.is/, r => r.abort());
      p2.on("pageerror", e => errors.push(name + " (no umami): " + e.message));
      await p2.goto(base, { waitUntil: "networkidle" }); await p2.waitForSelector("#results .res");
      await p2.locator("button.copy").first().click(); await p2.locator("#theme-toggle").click(); await p2.selectOption("#v-sort", "tps"); await sleep(80);
      assert(await p2.evaluate(() => typeof window.umami === "undefined"), "umami really absent"); ok("page works with the umami script blocked"); await c2.close();
    }
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
