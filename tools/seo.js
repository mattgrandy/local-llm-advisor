// Post-process pass: injects canonical, Open Graph/Twitter meta and JSON-LD into every site/**/*.html (idempotent),
// writes robots.txt and sitemap.xml. Run by generate_pages.js (last step). Domain: SITE_URL env, default https://localllmadvisor.com
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const LASTMOD_FILE = path.join(__dirname, "lastmod.json"), KEY_FILE = path.join(__dirname, "indexnow-key.txt");
const SITE_URL = (process.env.SITE_URL || "https://localllmadvisor.com").replace(/\/$/, "");
const NAME = "Local LLM Advisor";
const BEGIN = "<!--seo-->", END = "<!--/seo-->";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
const DATASETS = {
  "leaderboard.html": { name: "Local LLM benchmark leaderboard (measured llama.cpp tokens/sec)", description: "Median measured prompt-processing and generation speed per hardware, model and quantization class, aggregated from public llama.cpp results and our own runs.", distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: SITE_URL + "/data/leaderboard.csv" }], keywords: ["llama.cpp", "benchmark", "local LLM", "tokens per second"] },
  "data-sources.html": { name: "Local LLM Advisor data sources and measurements", description: "Sources, licenses and coverage of the benchmark and hardware data behind Local LLM Advisor.", distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: SITE_URL + "/data/leaderboard.csv" }] }
};
function run(SITE, VER) {
  const files = walk(SITE).filter(f => f.endsWith(".html")).sort();
  const urls = [], lastmod = fs.existsSync(LASTMOD_FILE) ? JSON.parse(fs.readFileSync(LASTMOD_FILE, "utf8")) : {}, next = {}, today0 = new Date().toISOString().slice(0, 10);
  // sitemap lastmod only moves when a page's real content changes: hash with cache-bust params and the build-date line removed
  const pageHash = x => crypto.createHash("sha256").update(x.replace(/\?v=\w+/g, "").replace(/Page generated \d{4}-\d{2}-\d{2}/g, "")).digest("hex").slice(0, 16);
  for (const f of files) {
    const rel = path.relative(SITE, f).split(path.sep).join("/");
    let h = fs.readFileSync(f, "utf8");
    h = h.replace(new RegExp(BEGIN + "[\\s\\S]*?" + END, "g"), "");
    if (/<meta name="robots" content="noindex/.test(h)) { fs.writeFileSync(f, h); continue; } // noindex pages: no canonical/OG block, not in sitemap, not in lastmod/IndexNow
    const title = (h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || NAME;
    const desc = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
    const url = SITE_URL + "/" + (rel === "index.html" ? "" : rel);
    const t = title.replace(/&amp;/g, "&");
    const ld = [rel === "index.html" ? { "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: SITE_URL + "/" } : null,
      rel === "index.html" ? { "@context": "https://schema.org", "@type": "WebApplication", name: NAME, url: SITE_URL + "/", applicationCategory: "UtilitiesApplication", operatingSystem: "Any (web)", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, description: desc.replace(/&amp;/g, "&") }
        : { "@context": "https://schema.org", "@type": "WebPage", name: t, url, description: desc.replace(/&amp;/g, "&"), isPartOf: { "@type": "WebSite", name: NAME, url: SITE_URL + "/" } }];
    const strip = x => x.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&middot;/g, "·").replace(/&rarr;/g, "->").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, " ").trim();
    const crumbDiv = (h.match(/<div class="crumbs">([\s\S]*?)<\/div>/) || [])[1];
    if (crumbDiv && rel !== "index.html") { // BreadcrumbList from the visible breadcrumb links (last item = current page)
      const items = [], re = /<a href="([^"]*)">([\s\S]*?)<\/a>/g; let m;
      while ((m = re.exec(crumbDiv))) items.push({ name: strip(m[2]), url: new URL(m[1], url).href });
      items.push({ name: strip(crumbDiv.replace(/<a [\s\S]*?<\/a>/g, "").replace(/^[\s\/]+|[\s\/]+$/g, "").replace(/\/\s*$/, "")) || t, url });
      ld.push({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: x.url })) });
    }
    const art = (h.match(/<meta name="llma:article" content="(\d{4}-\d{2}-\d{2})"/) || [])[1];
    const wi = ld.findIndex(o => o && o["@type"] === "WebPage");
    if (art && wi >= 0) ld[wi] = { "@context": "https://schema.org", "@type": "Article", headline: t.replace(/ \| Local LLM Advisor$/, ""), description: desc.replace(/&amp;/g, "&"), url, mainEntityOfPage: url, datePublished: art, dateModified: (lastmod[rel] && lastmod[rel].d > art ? lastmod[rel].d : art), author: { "@type": "Person", name: "Matt" }, publisher: { "@type": "Organization", name: NAME, url: SITE_URL + "/" }, image: SITE_URL + "/og-image.png", license: "https://creativecommons.org/licenses/by/4.0/", isPartOf: { "@type": "WebSite", name: NAME, url: SITE_URL + "/" } };
    const faq = []; const fre = /<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g; let fm2;
    while ((fm2 = fre.exec(h))) faq.push({ "@type": "Question", name: strip(fm2[1]), acceptedAnswer: { "@type": "Answer", text: strip(fm2[2]) } });
    if (faq.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq });
    if (DATASETS[rel]) ld.push(Object.assign({ "@context": "https://schema.org", "@type": "Dataset", url, isAccessibleForFree: true, license: "https://creativecommons.org/licenses/by/4.0/", creator: { "@type": "Organization", name: NAME, url: SITE_URL + "/" }, citation: "Data: Local LLM Advisor (localllmadvisor.com)" }, DATASETS[rel]));
    const img = `${SITE_URL}/og-image.png`;
    const block = `${BEGIN}<link rel="canonical" href="${url}"><meta property="og:type" content="${art ? "article" : "website"}"><meta property="og:site_name" content="${NAME}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${img}">${ld.filter(Boolean).map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("")}${END}`;
    const hh = pageHash(h); // content hash before the (idempotent) seo block is injected
    next[rel] = lastmod[rel] && lastmod[rel].h === hh ? lastmod[rel] : { h: hh, d: today0 };
    h = h.replace("</head>", block + "</head>");
    fs.writeFileSync(f, h);
    urls.push({ url, rel });
  }
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(SITE, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${u.url}</loc><lastmod>${next[u.rel].d}</lastmod></url>`).join("")}</urlset>\n`);
  fs.writeFileSync(path.join(SITE, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  fs.writeFileSync(LASTMOD_FILE, JSON.stringify(next, null, 1) + "\n");
  // IndexNow ownership key: tools/indexnow-key.txt is the source of truth; the key file is served from the site root
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(16).toString("hex") + "\n");
  const key = fs.readFileSync(KEY_FILE, "utf8").trim(); fs.writeFileSync(path.join(SITE, key + ".txt"), key + "\n");
  // Custom domain file for GitHub Pages (must never be deleted)
  fs.writeFileSync(path.join(SITE, "CNAME"), new URL(SITE_URL).hostname + "\n");
  return urls.length;
}
module.exports = { run, SITE_URL };
