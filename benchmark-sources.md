# Benchmark data sources for llm-advisor
Researched 2026-10-14 (MT). Everything below was fetched live; "not verified" is marked where I could not confirm.
Samples saved in `/workspace/llm-advisor/data-samples/`.

## Ranked summary
| # | Source | Data | Access | Reuse stance | Effort |
|---|---|---|---|---|---|
| 1 | llama.cpp discussion scoreboards (#15013 CUDA, #4167 Apple, #15021 ROCm, #10879 Vulkan) | measured pp512/tg128, Llama-2-7B Q4_0 (Apple also F16/Q8_0) | GitHub REST API (unauthenticated JSON, markdown table in `body`) | Repo MIT; comments are user-contributed, no explicit data license. Facts/numbers OK with attribution+link; don't copy prose | Low |
| 2 | LocalScore (localscore.ai) | measured pp/tg tps, TTFT, score by accelerator × model × quant (llamafile) | SSR page JSON (`__NEXT_DATA__` on /latest, /accelerator/{id}, /model/{id}); JSON API returns 403 | Code Apache-2.0; no ToS/robots.txt/data license found. **Ask contact@localscore.ai first** | Low-Med |
| 3 | LMArena `lmarena-ai/leaderboard-dataset` (HF) | quality Elo by model/category | HF parquet download | CC-BY-4.0 (attribute) | Low |
| 4 | Artificial Analysis free API | quality indexes, price, hosted-API speed | API key (free), 1,000 req/day | Attribution mandatory; cache responses; Terms + Data Platform Terms apply (not read in full) | Low |
| 5 | XiongjieDai/GPU-Benchmarks-on-LLM-Inference | tg tps, Llama-3 8B/70B Q4_K_M/F16 | README tables | No license; last push 2024-05-13 (stale) | Low, low value |
| 6 | Aider polyglot leaderboard YAML | coding pass rates | raw YAML in repo | Apache-2.0; last repo push 2026-05-22 so may be stale | Low |
| 7 | LiveBench | quality | HF datasets / repo | Repo license NOASSERTION; HF dataset `livebench/model_judgment` last modified 2025-04-07 | Med, stale |
| 8 | r/LocalLLaMA posts | anecdotal | — | **Off-limits** | — |
| 9 | Phoronix | articles | — | **Off-limits** (Cloudflare challenge; editorial content) | — |

## Details

### 1. llama.cpp GitHub discussion scoreboards
- URLs (verified): https://github.com/ggml-org/llama.cpp/discussions/15013 (CUDA), /4167 (Apple Silicon), /15021 (ROCm), /10879 (Vulkan).
- Access: `GET https://api.github.com/repos/ggml-org/llama.cpp/discussions/{n}` returned 200 JSON without auth; table is in `body` (16 KB / 14 KB / 7.6 KB / 16.7 KB). Unauthenticated limit is 60 req/hr — plenty. HTML pages are 1.2 MB; avoid, use API.
- Freshness: `updated_at` CUDA 2026-10-01, Apple 2026-10-01, ROCm 2026-10-02, Vulkan 2026-10-10. Weekly polling is enough. (A third-party post, picklog.cc, reports Apple table edited 2026-08-31 and says Apple board is pinned to a Nov-2023 build, so Apple numbers run lower than current builds; ROCm table last edited Dec 2025. I did not verify these independently.)
- Schema, CUDA/ROCm (parsed OK, 155 rows incl. FA/no-FA: `data-samples/llamacpp_cuda_rocm_scoreboards.csv`): `Chip | Memory ("32 GB / GDDR7 / 512 bit") | pp512 t/s ± | tg128 t/s ± | Commit | Thanks to (@user)`. Sample: RTX 5090 32GB pp512 14073.41, tg128 290.02, commit 8cf6b42.
- Apple (#4167): HTML table `chip | BW GB/s | GPU cores | F16 PP | F16 TG | Q8_0 PP | Q8_0 TG | Q4_0 PP | Q4_0 TG | commit`, e.g. M1 Pro 200 GB/s 16 cores Q4_0 TG 36.41. Needs a different parser (HTML-ish table with ✅ and footnotes).
- Vulkan (#10879): `Chip | pp512 | tg128 | Commit | Comments` in collapsible sections; not parsed yet (0 rows matched my "±" filter, so values lack ±; needs custom parser).
- Caveats: single model (Llama 2 7B Q4_0) only. Use it to calibrate the bandwidth→tg model, not as per-model truth. Contributors use different commits/drivers; keep the commit and note it. Dense-7B numbers don't transfer to MoE.
- License/ToS: repo is MIT; comment text has no stated data license. Store numbers + chip + commit + link to discussion, credit the maintainers and contributors. GitHub robots.txt allows normal use; use the API, not crawling.

### 2. LocalScore
- URLs: https://www.localscore.ai (/latest, /accelerator/{id}, /model/{id}, /result/{id}); code https://github.com/cjpais/LocalScore (Apache-2.0, pushed 2026-10-09). Mozilla Builders project; results are crowdsourced from llamafile's `localscore` CLI. Active: results dated 2026-10-14 on /latest.
- Access: `/api/results`, `/api/search` return `{"error":"Access forbidden"}`/403 to my GET (they are submission/search endpoints, not a documented public read API). No "download data" feature found (the /download page is for the client). robots.txt returns the site's 404 page, so no crawl rules; no terms page found.
- Public pages embed full data in `<script id="__NEXT_DATA__">`. /latest gave 10 results. /accelerator/1119 (RTX 5080) gave `officialModelResults` and `results` with rank among N.
- Schema (sampled): `id, created_at, accelerator, accelerator_type (CPU/GPU), accelerator_memory_gb, model{name, quant, params}, avg_prompt_tps, avg_gen_tps, avg_ttft_ms, performance_score, system{cpu_name, cpu_arch, ram_gb, kernel_type}, runtime{name:llamafile, version}`. Models are limited to the 3 official ones (Llama 3.1 8B Q4_K_M, Qwen2.5 14B Q4_K_M, Llama 3.2 1B Q4_K_M seen).
- Caveat: user-submitted, so noisy (one sample row is a Ryzen 5800X CPU at 7.76 tg). Use medians per accelerator and a minimum sample count. Anything with an accelerator name needs normalizing to your hardware IDs.
- Stance: no explicit permission to bulk-scrape. Safest path: email contact@localscore.ai asking for a data export or permission and agree on attribution. Until then, only do light, polite, cached page reads (a few per day), or just link out. I did not bulk crawl.

### 3. LMArena dataset (quality)
- https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset (license cc-by-4.0, lastModified 2026-10-14). Pulled `text/latest-00000-of-00001.parquet` (612 KB, 11,006 rows, publish date 2026-10-13).
- Schema: `model_name, organization, license, rating, rating_lower, rating_upper, variance, vote_count, rank, category, leaderboard_publish_date`. Other configs: text_style_control, text_factuality, agent, search, etc.
- Includes open models (e.g. qwen3.8-27b, gemma-4-31b, gemma-4-26b-a4b). Need a mapping from LMArena model names to your 13 models. `license` column helps filter open-weight. Arena Elo is human preference, not task-specific; use as a general chat-quality signal.
- Site robots.txt for lmarena.ai allows crawling, but use the HF dataset instead.

### 4. Artificial Analysis
- https://artificialanalysis.ai/api-reference. Free API: `GET https://artificialanalysis.ai/api/v2/data/llms/models` with `x-api-key`. Fields: `evaluations` (intelligence/coding/math indexes, mmlu_pro, gpqa, livecodebench…), `pricing`, `median_output_tokens_per_second`, `median_time_to_first_token_seconds`. 1,000 req/day, don't expose key client-side, cache, **attribution required**. Not tested because it needs the user to create an account and key. Speed figures are hosted-API speeds, not local hardware, so they are not useful for tokens/s per GPU. Useful as the quality index for open models. robots.txt: allow all.

### 5. XiongjieDai/GPU-Benchmarks-on-LLM-Inference
- https://github.com/XiongjieDai/GPU-Benchmarks-on-LLM-Inference, 1.9k stars, no license, last push 2024-05-13. README tables of tg tps (Llama 3 8B/70B, Q4_K_M/F16) for 3070…H100 plus M1–M3 Macs. Useful only as a cross-check of older cards (3070/3080/3090/4090). Without a license, treat as "reference, cite, don't republish".

### 6–7. Aider / LiveBench / Open LLM Leaderboard
- Aider: `https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml` (also qwen3_leaderboard.yml, quant.yml). Fields: model, pass_rate_1/2, edit_format, date, total_cost, command. Apache-2.0. Mostly hosted frontier models; few local-size ones. Useful for "coding" use-case ranking of open models.
- LiveBench: repo NOASSERTION (FastChat lineage), data on HF `livebench/*`; model_judgment last modified 2025-04-07 per HF API, and the README says not all of the 2025-04-25 questions are public. Treat as stale/low priority. I did not locate a current scores CSV.
- Open LLM Leaderboard (HF): `open-llm-leaderboard/contents` and `/results` last modified March 2025. Retired/stale; I did not check an official retirement notice. Skip.

### Other findings
- HF datasets search for GPU LLM benchmarks found only `mayank-dubey-ai/l4-gpu-llm-benchmark-leaderboard` (apache-2.0, vLLM on NVIDIA L4, 124 downloads). It's a datacenter card and a niche source; skip.
- GitHub `mozilla-ocho/llamafile` hosts the LocalScore CLI only (no data).

### Off-limits / avoid
- Reddit: robots.txt is `User-agent: * Disallow: /`, and Reddit's Public Content Policy restricts commercial/misuse. Don't scrape. Hand-read posts for leads only, and re-measure or ask the author's permission before using numbers.
- Phoronix: returned a Cloudflare "Just a moment" challenge to curl. Don't bypass it. Content is editorial, so cite and link only.
- LocalScore `/api/*`: 403, don't circumvent.
- Don't present any llama.cpp Llama-2-7B result as measured for other models.

## Recommended ingest order
1. llama.cpp scoreboards via GitHub API, weekly cron: CUDA+ROCm parsed already; add Apple + Vulkan parsers. Use them to replace/calibrate the estimated tg numbers (fit a bandwidth-efficiency factor per backend, label "measured: Llama 2 7B Q4_0" vs "estimated: scaled").
2. Email LocalScore for permission or an export; meanwhile design the schema to accept it. It's the only source with Qwen2.5-14B / Llama-3.1-8B measurements on many GPUs.
3. LMArena HF parquet for the quality ranking (CC-BY-4.0; show attribution on site).
4. Artificial Analysis API (needs user to create a free key) as a second quality signal, with required attribution.
5. Aider YAML for coding ranking.
Weekly refresh fits all of these; GitHub/HF need no auth.


## Update 2026-10-15 (pass 2)
Used: witcheer/rtx-5090-benchmarks (HF, MIT), iBlessi/rtx-5080-llm-throughput (HF, CC-BY-4.0), steven0226/speculative-decoding-bench-rtx4090 (HF, CC-BY-4.0, baseline rows), studioburnside/mlx-local-inference-benchmarks (HF, Apache-2.0, headline decode), pgmharikrishnan/mlx-serve-local-llm-benchmarks-2026-10 (HF, MIT), llama.cpp discussion #15396 (gpt-oss guide), non-PR issues, and PR conversations (dataset only). Rejected / link-only: see "Candidates read but NOT used" in data/benchmarks/README.md. LocalScore: no new model pages exist (models 4-10 are not-found pages). Details and counts: data/benchmarks/README.md, `summary_counts.json`.
