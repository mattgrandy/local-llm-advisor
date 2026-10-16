// Post-process pass: injects canonical, Open Graph/Twitter meta and JSON-LD into every site/**/*.html (idempotent),
// writes robots.txt and sitemap.xml. Run by generate_pages.js (last step). Domain: SITE_URL env, default https://localllmadvisor.com
const fs = require("fs"), path = require("path");
const SITE_URL = (process.env.SITE_URL || "https://localllmadvisor.com").replace(/\/$/, "");
const NAME = "Local LLM Advisor";
const BEGIN = "<!--seo-->", END = "<!--/seo-->";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
function run(SITE, VER) {
  const files = walk(SITE).filter(f => f.endsWith(".html")).sort();
  const urls = [];
  for (const f of files) {
    const rel = path.relative(SITE, f).split(path.sep).join("/");
    let h = fs.readFileSync(f, "utf8");
    h = h.replace(new RegExp(BEGIN + "[\\s\\S]*?" + END, "g"), "");
    const title = (h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || NAME;
    const desc = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
    const url = SITE_URL + "/" + (rel === "index.html" ? "" : rel);
    const t = title.replace(/&amp;/g, "&");
    const ld = [{ "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: SITE_URL + "/" },
      rel === "index.html" ? { "@context": "https://schema.org", "@type": "WebApplication", name: NAME, url: SITE_URL + "/", applicationCategory: "UtilitiesApplication", operatingSystem: "Any (web)", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, description: desc.replace(/&amp;/g, "&") }
        : { "@context": "https://schema.org", "@type": "WebPage", name: t, url, description: desc.replace(/&amp;/g, "&"), isPartOf: { "@type": "WebSite", name: NAME, url: SITE_URL + "/" } }];
    const img = `${SITE_URL}/og-image.png`;
    const block = `${BEGIN}<link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="${NAME}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${img}">${ld.map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("")}${END}`;
    h = h.replace("</head>", block + "</head>");
    fs.writeFileSync(f, h);
    urls.push(url);
  }
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(SITE, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("")}</urlset>\n`);
  fs.writeFileSync(path.join(SITE, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  // Custom domain file for GitHub Pages (must never be deleted)
  fs.writeFileSync(path.join(SITE, "CNAME"), new URL(SITE_URL).hostname + "\n");
  return urls.length;
}
module.exports = { run, SITE_URL };
