// Browser smoke for compare / can-run / blog / embed pages (Chromium). Usage: node tests/test_browser_growth.js
const assert = require("assert"), http = require("http"), fs = require("fs"), path = require("path");
let pw; try { pw = require(path.join(process.env.PLAYWRIGHT_DIR || "/workspace/pw", "node_modules/playwright-core")); } catch (e) { pw = require("playwright-core"); }
const SITE = path.join(__dirname, "..", "site"), MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };
(async () => {
  const server = http.createServer((q, s) => { let f = path.join(SITE, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(d); } }); });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${server.address().port}`;
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] }), ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }), pg = await ctx.newPage(), errs = [];
  await ctx.route(/umami\.is/, r => r.abort());
  pg.on("pageerror", e => errs.push(e.message)); pg.on("console", m => { if (m.type() === "error" && !/umami|Failed to load resource/.test(m.text() + m.location().url)) errs.push(m.text()); });
  for (const u of ["/compare/index.html", "/compare/rtx-3090-24gb-vs-rtx-4090-24gb.html", "/can-run/gpt-oss-20b-on-rtx-4090-24gb.html", "/can-run/index.html", "/can-run/qwen3-6-27b-on-rtx-3090-24gb.html", "/can-run/gpt-oss-120b-on-macbook-pro-m5-max-128gb.html", "/blog/index.html", "/blog/state-of-local-llm-hardware-oct-2026.html"]) {
    await pg.goto(base + u, { waitUntil: "networkidle" }); assert((await pg.locator("h1").count()) === 1, "h1 " + u);
    const sorts = pg.locator("table.sortable th button.sortbtn"); if (await sorts.count()) { await sorts.nth(1).click(); assert((await pg.locator("th[aria-sort=descending],th[aria-sort=ascending]").count()) >= 1, "sort " + u); }
    console.log("  ok", u);
  }
  await pg.goto(base + "/blog/state-of-local-llm-hardware-oct-2026.html", { waitUntil: "networkidle" });
  for (const bx of await pg.locator("svg.chart").all()) { const r = await bx.boundingBox(); assert(r && r.width > 300 && r.height > 40, "chart visible"); }
  console.log("  ok charts render:", await pg.locator("svg.chart").count());
  await pg.goto(base + "/compare/rtx-3090-24gb-vs-rtx-4090-24gb.html", { waitUntil: "networkidle" });
  assert((await pg.locator('a[data-affiliate="amazon"]').count()) === 2 && (await pg.locator("a[data-sponsor]").count()) === 2); console.log("  ok compare has 2 amazon + 2 cloud links");
  await pg.goto(base + "/can-run/qwen3-6-27b-on-rtx-3090-24gb.html", { waitUntil: "networkidle" });
  assert(await pg.locator("#alternatives a").count() >= 3, "alternatives links"); assert((await pg.locator('a[data-affiliate="amazon"]').count()) >= 1, "amazon slot on can-run");
  await pg.locator("#faq summary").nth(2).click(); assert(await pg.locator("#faq details").nth(2).evaluate(d => d.open), "faq opens");
  const href = await pg.locator("#alternatives a").first().getAttribute("href"); await pg.locator("#alternatives a").first().click(); await pg.waitForLoadState("networkidle"); assert((await pg.locator("h1").count()) === 1 && pg.url().includes(href.replace(/^\.\.\//, "")), "alternative link resolves " + href);
  await pg.goto(base + "/can-run/gpt-oss-120b-on-macbook-pro-m5-max-128gb.html", { waitUntil: "networkidle" });
  assert(/estimated/.test(await pg.locator("#alternatives").evaluate(() => document.querySelector(".page-hero").textContent + document.title)), "estimate labelled in hero/title");
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.goto(base + "/can-run/qwen3-6-27b-on-rtx-3090-24gb.html", { waitUntil: "networkidle" });
  assert(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal overflow on mobile"); await pg.setViewportSize({ width: 1100, height: 900 });
  console.log("  ok can-run alternatives, faq, estimate label, mobile");
  await pg.goto(base + "/embed/index.html", { waitUntil: "networkidle" });
  assert((await pg.locator("#emb-html").textContent()).includes("rtx-4090-24gb.svg"));
  await pg.selectOption("#emb-hw", "mac-m4-16gb"); assert((await pg.locator("#emb-html").textContent()).includes("mac-m4-16gb.svg") && (await pg.locator("#emb-iframe").textContent()).includes("/embed/card/mac-m4-16gb.html") && (await pg.locator("#emb-badge-prev img").getAttribute("src")).includes("mac-m4-16gb.svg"));
  await pg.waitForTimeout(500); const fr = pg.frameLocator("#emb-frame"); assert((await fr.locator("h1").textContent()).includes("Mac"), "iframe card loads under CSP");
  const img = await pg.locator("#emb-badge-prev img").evaluate(i => i.complete && i.naturalWidth > 100); assert(img, "badge image loads under CSP");
  console.log("  ok embed builder, badge image, iframe card");
  assert.deepStrictEqual(errs, [], "console errors: " + errs.join("; ")); await b.close(); server.close(); console.log("GROWTH BROWSER TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
