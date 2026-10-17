# SEO & Visibility Plan — localllmadvisor.com
Written 2026-10-16 (America/Denver). Research + plan only; no repo changes made.

## 0. Current state (audited live)
- 30 URLs in sitemap: home, data-sources, submit, hardware index, 26 hardware pages. 13 models in data. robots.txt OK (Allow all + Sitemap). HTTPS, canonical present, OG/Twitter tags present, og-image present.
- Home: title/meta good, JSON-LD WebSite + WebApplication. Only ~480 words of static text (the advisor is JS-rendered -> little crawlable content on home).
- Hardware page (rtx-4090): title "Best local LLMs for RTX 4090 24GB | Local LLM Advisor", unique meta, one H1, H2s per use case, ~1,060 words, canonical OK. JSON-LD only WebSite+WebPage (duplicate WebSite) — missing BreadcrumbList, FAQPage, Dataset.
- /favicon.ico returned 404 at audit time (favicon fix was in the other executor's queue — recheck).
- Lighthouse not installed on box (npx exists). Run `npx lighthouse` / PageSpeed Insights after the other executor finishes.
- No pages for models, quants, VRAM tiers, or hardware x model — those are where most search demand sits.

## 1. Keyword research
Method: web search of the SERP for the target query families; no paid volume data was available (no Ahrefs/Semrush). Volume is inferred from who ranks and how many near-duplicate sites exist. Treat "expected value" as relative. Validate with Google Search Console once indexed (free).

### What the SERP looks like
- "best local LLM 16GB VRAM": multiple programmatic competitors already rank with exactly this page type — llmrun.dev/gpu/tier/16gb-vram (https://llmrun.dev/gpu/tier/16gb-vram), localanalysis.ai/vram/16gb (https://localanalysis.ai/vram/16gb/), localaistats.com/best-local-llms/16gb (https://localaistats.com/best-local-llms/16gb), atomic.chat blog (https://atomic.chat/blog/guides/best-local-llm-16gb), whatmodel.sh (https://whatmodel.sh/llm/for/search-16gb-vram-local). Proves demand and page format; also means we need a differentiator: measured data on our own sweeps + KV-cache/context math + copy-paste commands + long context up to 1M.
- "can RTX 4090 run Llama 70B": answers from bestllmfor.com (https://bestllmfor.com/how-to/install-llama33-70b-rtx-4090/), r/LocalLLaMA threads (https://www.reddit.com/r/LocalLLaMA/comments/1cils80/rtx4090_and_96gb_6400mhz_ddr5_ram_can_i_get_more/). Typical answer: Q4 ~42GB needs offload (2-4 tok/s), IQ2 fits (15-22 tok/s), 2x4090 needed.
- "M4 Max LLM tokens per second": kunalganglani.com/llm-benchmarks (https://www.kunalganglani.com/llm-benchmarks), craftrigs.com (https://craftrigs.com/comparisons/m4-max-vs-rtx-4090-local-llms/), Reddit (https://www.reddit.com/r/LocalLLaMA/comments/1i7b3r1/i_did_a_quick_test_of_macbook_m4_max_128_gb/). Comparison + tok/s table pages win.

### Query families (patterns, not verified volumes)
| Family | Example queries | Intent | Fit |
|---|---|---|---|
| A. Model x "can I run" | "can I run llama 3.3 70b locally", "gpt-oss 120b requirements", "qwen 3 32b vram" | high, specific | /models/<model>.html |
| B. VRAM/RAM tier | "best local llm 8gb / 12gb / 16gb / 24gb / 32gb / 64gb / 128gb vram", "best llm for 16gb ram mac" | highest volume, competitive | /vram/<N>gb.html |
| C. Hardware x model | "can rtx 4090 run llama 70b", "m4 max 128gb deepseek tokens per second" | long-tail, easy to win with real numbers | /hardware/<hw>/<model>.html |
| D. Hardware tok/s | "m4 max llm tokens per second", "rtx 5090 llm benchmark" | benchmark seekers, buying intent | existing hardware pages (add tok/s table + H2 "tokens per second") |
| E. Comparisons | "m4 max vs rtx 4090 llm", "3090 vs 4090 llm", "rtx 5090 vs mac studio" | commercial, affiliate-friendly | /compare/<a>-vs-<b>.html |
| F. Use-case | "best local llm for coding 24gb", "best local vision model" | medium | /best/<usecase>-<N>gb.html |
| G. Quant/KV | "q4_k_m vs q5_k_m", "kv cache vram calculator", "llm vram calculator" | tool intent; calculators earn links | /guides/ + calculator page |
| H. Buying | "best gpu for local llm 2026", "mac for running llms" | affiliate money | /buying/best-gpu-for-local-llm.html |

### Prioritized programmatic page list
Rule: only publish a page if it has real, differing numbers (fit result, measured/estimated speed, max context, command). Noindex combinations that are "doesn't fit anywhere" or have no unique data.

| Pri | Page type | Count (est.) | Why | Expected value | Thin-content risk / mitigation |
|---|---|---|---|---|---|
| 1 | /vram/<N>gb.html (8,12,16,24,32,48,64,96,128,192,256,512) | ~12 | Family B; biggest head terms; competitors prove format | High traffic potential, Amazon link for the GPU tier | Low: add measured table, KV context-vs-VRAM table, "what doesn't fit", FAQ |
| 2 | /models/<model>.html (13 models now) | 13 | Family A; "<model> requirements/vram"; evergreen, new-model launches spike | High on launch days (freshness) | Low: per-quant size table, hardware that runs it, KV cost per 8k/32k/128k/1M |
| 3 | /compare/<hw>-vs-<hw>.html (curated ~15: 3090/4090/5090, M4 Max vs 4090, Strix Halo vs DGX Spark, Mac Studio vs 2x3090) | 15 | Family E; buying intent -> Amazon clicks | Medium-high revenue/visit | Curate by hand; unique verdict paragraph |
| 4 | /hardware/<hw>/<model>.html for hot combos only (e.g. 4090+Llama 70B, 3090+gpt-oss 20B, M4 Max+70B, 5090+Qwen 32B) | start ~40, cap ~150 | Family C; low competition long-tail | Many small wins; cumulatively big | Medium: only include combos with measured or well-scaled speed; noindex the rest; include "offload" and "2-bit" answers |
| 5 | /buying/best-gpu-for-local-llm.html, /buying/best-mac-for-local-llm.html | 2-3 | Family H; affiliate | Medium | Editorial, hand-written, updated monthly |
| 6 | /calculator (VRAM/KV cache) page | 1 | G; linkable asset (embed) | Backlinks | Low |
| 7 | /guides: quants explained, KV cache, ollama vs llama.cpp, "what is n-cpu-moe" | 4-6 | Topical authority | Low-medium | Original, link to tools |
| 8 | /leaderboard (measured tok/s by hardware x model, sortable, CSV download) | 1 | Linkable data asset | High (backlinks) | None — it's data |

Total target after 30 days: ~100-150 indexable pages (vs 30 now). Do not exceed that until Search Console shows >70% of existing pages indexed (see thin-content note).

### Thin-content / scaled-content risk
- Google treats mass-produced low-value pages as spam ("scaled content abuse"); Bing says large-scale generated content "without oversight, quality control, or editorial review... may be excluded from indexing" (https://www2.bing.com/webmasters/help/webmaster-guidelines-30fba23a). Our defense: real computed + measured numbers, unique verdicts, and gating to combos with distinct data.
- Ship in batches (e.g. 15-25 pages/week), watch "Crawled - currently not indexed" in GSC; if it rises, stop and improve the templates.
- Each page should have >=300 words of non-boilerplate text, a unique data table, and an FAQ with answers derived from that page's numbers.

## 2. On-page / technical audit & fixes (for the repo owner after the current executor finishes)
| # | Finding | Fix | Priority |
|---|---|---|---|
| 1 | Home advisor content is JS-rendered; ~480 words static | Add static crawlable section: "Popular hardware" links grid to all 26 hardware pages + top models + 3-4 FAQs + short method text | High |
| 2 | Hardware pages JSON-LD: WebSite twice, no BreadcrumbList/FAQPage/Dataset | Add BreadcrumbList (Home > Hardware > X), FAQPage (3-5 Q&As using page data), drop the duplicate WebSite from non-home pages. Dataset schema on /data-sources and /leaderboard (name, license CC BY 4.0, distribution CSV). Skip SoftwareApplication on inner pages; WebApplication on home is fine. FAQ rich results are now limited for most sites by Google, so treat FAQ as content for users/LLMs rather than SERP real estate. | High |
| 3 | Titles: pattern good. Make them intent-matching: "RTX 4090 24GB: Best Local LLMs & Tokens/sec (2026) \| Local LLM Advisor" | Update templates; include year or "Updated <Month YYYY>" | Medium |
| 4 | Meta descriptions unique but generic | Include 1 concrete fact ("Runs Llama 70B? Fits Q4: no, ~3 tok/s with offload") | Medium |
| 5 | Internal linking: hardware pages likely link only to index/home | Add "Related hardware" (same VRAM tier + next tier), "Models that fit", breadcrumb nav, footer link blocks to /vram/ and /models/ hubs | High |
| 6 | favicon.ico 404 at audit time | Confirm after the other executor's fix; also add apple-touch-icon | Low |
| 7 | Sitemap: lastmod all identical (build date) | Only change lastmod when the page's data actually changed (Bing relies on it) | Medium |
| 8 | No hub pages for models/VRAM | Create /models/ and /vram/ index pages | High |
| 9 | IndexNow | Host key file at root, POST changed URLs to https://api.indexnow.org/indexnow after each publish (Bing/Yandex etc.; Google doesn't support it) — https://www.indexnow.org/documentation.html. Only submit changed/new URLs. | Medium |
| 10 | Page speed | Static + GitHub CDN should be fast; run Lighthouse; check app JS size, data JSON size (defer-load, preload), image sizes of og-image | Medium |
| 11 | Security headers / CSP in progress by another executor | n/a | — |
| 12 | Freshness | "Last verified" is shown; add visible "Updated <date>" + changelog page (models.json has changelog) | Medium |
| 13 | Affiliate links | Make sure rel="sponsored nofollow" on Amazon links (Google guidance) | High |
| 14 | Pages Cloudflare note | No proxy; fine | — |

## 3. Off-page channels (besides Reddit)
Legend: Auto = assistant can do without Matt; Matt = needs his account/login/identity.

| Channel | Effort | Value | Rules / policy (source) | Who |
|---|---|---|---|---|
| Google Search Console (domain property via Cloudflare DNS TXT) + submit sitemap | 10 min | Essential | — | Matt creates property (or gives login; DNS TXT can be added by Matt in Cloudflare); assistant then monitors via browser login |
| Bing Webmaster Tools (import from GSC) + sitemap | 5 min | Medium (also feeds Copilot/ChatGPT-with-Bing, DuckDuckGo) | https://blogs.bing.com/webmaster/2025/7/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search/ | Matt sign-in once |
| IndexNow | 30 min dev | Medium | https://www.indexnow.org/documentation.html | Auto |
| GitHub awesome lists: rafska/awesome-local-llm (~3k stars, MIT, welcomes PRs, has CONTRIBUTING.md; has a Hardware section) https://github.com/rafska/awesome-local-llm ; Enterprise-AI-Atlas/awesome-local-llms (CC0, PR-based, requires one resource per PR, actively maintained, documented, honest labeling, runs validate-links script) https://github.com/Enterprise-AI-Atlas/awesome-local-llms ; WaterPistolAI/Awesome-Local-LLM (small, PR or issue welcome) https://github.com/WaterPistolAI/Awesome-Local-LLM ; also related: vince-lam/awesome-local-llms, ununununium/awesome-local-ai, av/awesome-llm-services | 20 min each | Medium; durable dofollow-ish links from GitHub, plus discovery | Follow each CONTRIBUTING; one PR per list; honest one-line description; not bulk | Needs Matt's GitHub (PR from mattgrandy account). Assistant drafts PR text; opening PRs is external posting -> needs Matt's OK |
| Hacker News Show HN | 1 hr | High variance (can be 1-20k visits or 0) | Must be something people can try, non-trivial, you're present to discuss; don't solicit upvotes; no AI-generated text; don't use brand username; don't use HN primarily for promotion (https://news.ycombinator.com/showhn.html, https://news.ycombinator.com/newsguidelines.html). New account with only self-posts may be restricted. | Matt must post and write text himself. Best after /leaderboard + measured sweep write-up exist. Title e.g. "Show HN: Local LLM Advisor – what fits on your GPU/Mac, with measured benchmarks" |
| Hugging Face: dataset repo of our measured benchmarks (CC BY 4.0) with dataset card linking to site; optional static Space embedding the advisor (sdk: static) https://huggingface.co/docs/hub/spaces-sdks-static | 1-2 hrs | Medium-high: HF pages rank well and are crawled; developer audience | HF community rules; no spam; dataset must be genuine | Matt creates HF account/token (assistant can then upload) |
| Product Hunt | 2-3 hrs | Medium (one-day spike, dofollow-ish PH page) | Personal account, working product, no requested/paid upvotes (https://help.producthunt.com/en/articles/17350772-launch-guide) | Matt |
| Lobsters | 15 min | Low-medium; invite-only | Self-promo under ~25% of activity (https://lobste.rs/about) | Matt if he has an invite — likely skip |
| dev.to / Hashnode / Medium article: "How much VRAM do you really need? KV cache math + our sweep data" with canonical link to our post | 3 hrs writing | Medium (backlink + discovery) | Cross-post with canonical URL pointing to our site; no link spam | Assistant writes; Matt's account posts (or gives login) |
| X/Twitter | 10 min/day | Low-medium | Post data charts; tag no one spammy | Matt's account; assistant can draft; (X API tool exists on box for reading) |
| LocalLLaMA Discord / llama.cpp Discussions / Ollama & LM Studio Discords | ad hoc | Medium; high-quality niche | Read each server's self-promo channel rules; contribute value first. llama.cpp GitHub discussions: link benchmark data in relevant threads only when genuinely useful (we already ingest from them) | Matt's account |
| Our benchmark results fed back to llama.cpp discussion threads / LocalScore | low | Medium credibility | Don't email LocalScore (Matt's standing instruction); public posts OK | Matt's GitHub |
| AlternativeTo (suggest new application, review backlog) https://alternativeto.net/faq/ | 20 min | Low-medium; backlink | Verified user | Matt's account |
| AI directories (Toolify, Futurepedia, There's An AI For That, SaaSHub, Uneed, Peerlist) | 20 min each | Low; many are nofollow/paywalled; some may require reciprocal links — skip those | Free submission tiers only | Matt's email/account; assistant fills forms if given a login |
| Wikipedia / Stack Overflow style answers | n/a | Low; Wikipedia forbids promotional links; SO discourages self-promo | Only answer where our data is genuinely the citation, disclose affiliation; otherwise skip | Skip Wikipedia; SO optional by Matt |
| YouTube creators outreach (Alex Ziskind, Digital Spaceport, Level1Techs etc. — verify current channels before contacting) | 2 hrs | Medium-high if one links | Personal, short email offering data/embed; no spam | Matt sends (assistant drafts) |
| Embeddable badge/widget + data CSV (see section 5) | dev | High compounding | — | Auto (dev) |

## 4. 30-day action calendar (starts Mon 2026-10-19)
Assumes the other executor finishes fixes + affiliate placement first.

**Week 1 (Oct 19-25) — foundation**
- Matt (10 min): add domain property in Google Search Console (Cloudflare DNS TXT), submit sitemap; sign in to Bing Webmaster Tools (import from GSC); give assistant browser sign-in or share read access.
- Assistant: Lighthouse + PageSpeed run; implement home static content + hub links; BreadcrumbList/FAQ/Dataset schema; internal linking; rel="sponsored"; lastmod logic; IndexNow key + post-publish ping; fix favicon if still 404.
- Assistant: build /vram/<N>gb.html (12 pages) + /models/ (13 pages) + hubs.
- Assistant: draft Reddit post, Show HN text, awesome-list PR text, dev.to article outline (Matt reviews).

**Week 2 (Oct 26-Nov 1) — comparisons & data assets**
- Assistant: /leaderboard page + CSV download + Dataset schema; /compare pages (first 8); HF dataset card draft.
- Matt: create Hugging Face account + token (secure prompt); open awesome-list PRs from his GitHub (or OK for assistant to open them) — 3 lists.
- Assistant: check GSC indexing report; fix any "crawled not indexed".
- Matt: post to r/LocalLLaMA (deferred earlier).

**Week 3 (Nov 2-8) — long tail & launch**
- Assistant: hot hardware x model pages batch 1 (~20-40, noindex the rest); badge/widget v1 with attribution link; "State of local LLM hardware — November 2026" data post.
- Matt: Show HN (Tue-Thu morning US time) after leaderboard is live; stay in thread ~3 hrs. Product Hunt optional.
- Assistant: Monday weekly refresh now includes Umami + GSC summary.

**Week 4 (Nov 9-15 + to Nov 18) — expand & measure**
- Assistant: batch 2 of hardware x model (if GSC indexation healthy), /buying pages, guides (quants, KV cache), calculator.
- Matt: dev.to/Hashnode cross-post of the data article (canonical -> our site); X thread with charts; send 3-5 creator outreach emails (assistant drafts).
- Assistant: 30-day review: impressions, clicks, top queries, affiliate clicks per visitor by `slot`; reprioritize.

### Exact items needed from Matt
1. Google Search Console: verify `localllmadvisor.com` as a domain property (Cloudflare DNS TXT) and let the assistant log in / view it.
2. Bing Webmaster Tools sign-in (import from GSC).
3. Hugging Face account + write token (via secure prompt).
4. OK (and GitHub account use) for 3 awesome-list PRs — assistant drafts exact PR text.
5. Posting under his own accounts: r/LocalLLaMA, Show HN (must be himself, human-written text), optional Product Hunt, dev.to/Hashnode, X.
6. Optional: AlternativeTo / directory sign-ups; YouTuber outreach emails (assistant drafts).
7. Optional later: Vast.ai credit top-up for more NVIDIA sweeps; Apple/AMD data needs someone with the hardware or community submissions (the /submit page is the route).

## 5. Backlink-earning content
1. **Public leaderboard** (/leaderboard): measured tok/s by hardware x model x quant, sortable, with CSV/JSON download under CC BY 4.0 and "cite us" snippet. Our own measured sweeps (llama.cpp b11658 on Vast) are unique vs sites that scale from estimates.
2. **Monthly "State of local LLM hardware" data post**: price per GB VRAM, tok/s per dollar, which model sizes fit which tiers, new-model additions. Pitch to newsletters and communities; refresh each month (freshness + recurring link bait).
3. **Embeddable badge/widget**: "Runs on RTX 4090: 11 models fit" badge or iframe card per hardware page with `<a href>` back to the page; offer to model/tool authors, GPU forum signatures, YouTube descriptions, README badges (shields-style).
4. **VRAM/KV-cache calculator** as standalone page — highly linkable by r/LocalLLaMA guides and model READMEs.
5. **Open dataset on Hugging Face + GitHub** (CC BY 4.0) — citations in papers/blogs; HF page links back.
6. **"Can it run?" per-model pages posted at model-release time** — be first within hours of big releases (Qwen/Gemma/gpt-oss etc.); share in release discussion threads and HF model discussions where data is relevant.
7. **Contribution loop**: /submit page already collects benchmarks; credit contributors on a public page (they link back).

## 6. Top 5 recommended actions
1. Matt verifies Google Search Console + Bing Webmaster; assistant adds IndexNow and sitemap lastmod hygiene.
2. Build /vram/<N>gb and /models/<model> pages (25 pages) with measured data, plus home static content and internal links.
3. Ship /leaderboard + CSV + HF dataset as the linkable asset; then Show HN and awesome-list PRs.
4. Add curated /compare and a capped set of hot hardware x model pages (indexed only when data is unique).
5. Monthly data post + embeddable badge; track via GSC + Umami and iterate weekly.

## Caveats
- Search-volume numbers weren't available without paid tools; priorities are inferred from competitor presence. Validate in GSC after ~2-4 weeks.
- Competitor figures cited above come from their own pages and were not independently verified; some of their model names (e.g. Qwen3.8, Gemma 4) reflect their datasets.
- Channel rules checked: HN, Product Hunt, Lobsters, AlternativeTo, IndexNow, Bing, HF static spaces, awesome-list CONTRIBUTING. Not checked: Discord server rules (read per-server), Toolify/Futurepedia current terms, specific YouTuber contact details.
