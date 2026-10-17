# llm-advisor benchmark data

Generated 2026-10-14 (MT) by `tools/ingest_benchmarks.py` (+ `tools/ingest_extra.py`, `tools/bench_parse.py`, `tools/gh_fetch.py`).
Rerun: `python3 tools/ingest_benchmarks.py` (add `--refresh` to bypass the cache in `raw/`).
Needs `pandas` + `pyarrow` for the LMArena parquet. Set `GITHUB_TOKEN` (optional) to lift GitHub's 60 req/h unauthenticated limit; the script sleeps through limits and caches every response.

## Files
| File | What |
|---|---|
| `benchmarks_all.csv` / `.json` | **6,550 normalized rows** (4,829 + 1,721 LocalScore), fields: `device, device_raw, hw_id, device_count, backend, model, quant, params_b, size_gib, fa, ngl, threads, ubatch, depth, pp_n, pp_tps, tg_n, tg_tps, build, build_num, source, source_url, author, date, notes, ttft_ms, n_samples, perf_score, rank, retrieved` |
| `by_source/*.csv` | same rows split by `source` |
| `lmarena_open_models.csv` | LMArena quality ratings for non-proprietary models (5,758 rows, 225 models, all categories, published 2026-10-13) |
| `coverage.json` | per hardware.json id: row count, sources, models |
| `summary_counts.json` | raw/final counts per source, drops, per-thread comment stats |
| `raw/` | cached API responses and downloaded files (reproducibility; not for publishing) |

Field notes: `device` = hardware.json id when matched (e.g. `rtx-3090`), otherwise a canonical slug (`rx-9070-xt`); `device_raw` = text as found; `hw_id` is set **only** when the match is unambiguous AND `device_count==1`. `pp_n/tg_n` = prompt/gen token counts (512/128 for scoreboards); `depth` = context depth (`-d`) for llama-bench "@ dN" tests. `date` for scoreboard rows is the discussion's `updated_at` (the table-edit date isn't exposed); for comments it is the comment date. Rows with only `pp_tps` or only `tg_tps` exist when the contributor posted only that test.

## Row counts per source (after de-dup)
| source id | rows | license / terms | notes |
|---|---:|---|---|
| llamacpp-discussion-15013-scoreboard (CUDA) | 112 | llama.cpp MIT; user-contributed numbers, no data license | Llama 2 7B Q4_0, pp512/tg128, FA and no-FA |
| llamacpp-discussion-15013-comments | 1,283 | same | llama-bench tables in comments+replies; many multi-GPU / long-context / other models |
| llamacpp-discussion-15021-scoreboard (ROCm) | 46 | same | |
| llamacpp-discussion-15021-comments | 408 | same | |
| llamacpp-discussion-10879-scoreboard (Vulkan) | 234 | same | includes CPU rows the thread lists (backend `CPU`) |
| llamacpp-discussion-10879-comments | 1,248 | same | |
| llamacpp-discussion-4167-summary (Apple) | 96 | same | F16/Q8_0/Q4_0, **pinned to build 8e672ef (2023-11-21)**, so absolute numbers are low |
| llamacpp-discussion-4167-m2ultra-history | 12 | same | same device across builds (2023-2026) |
| llamacpp-discussion-4167-comments | 169 | same | |
| llamacpp-discussion-16578-comments (DGX Spark thread) | 318 | same | many devices, not only Spark; mostly modern MoE models |
| llamacpp-discussion-23659-body | 28 | same | Strix Halo ROCm 7.2.3, Qwen3.5 122B / Gemma 4 31B |
| llamacpp-benches-dgx-spark | 138 | MIT (llama.cpp repo `benches/`) | official; 6 models; incl. llama-batched-bench rows (B>1 = aggregate throughput, flagged in `notes`) |
| llamacpp-benches-mac-m2-ultra | 138 | MIT | official; M2 Ultra |
| llamacpp-benches-nemotron | 46 | MIT | Nemotron 3 on DGX Spark |
| github-issue-llama.cpp-13565 / 11931 / 19480 | 4 / 4 / 8 | MIT repo; issue text | Strix Halo HIP, ROCm quants, Qwen3-Coder-Next CPU |
| github-issue-ik_llama.cpp-263 | 347 | MIT repo | 16x RTX 3090, DeepSeek R1 671B (`device_count=16`, never hw-matched) |
| hf-RaynarDM-apple-silicon-llm-benchmarks | 34 | Apache-2.0 | one M2 Max 32GB; llama.cpp/MLX/ollama; many are spec-decoding experiments (see `notes`) |
| hf-NeoAiLabs-llama-cpp-rx7800xt-benchmarks | 16 | MIT | RX 7800 XT llama-bench summary CSV |
| hf-axjns-strix-halo-inference-bench | 44 | Apache-2.0 | Strix Halo Vulkan, 11 models, pp512/pp4096/tg128/tg@d4096 |
| github-strix-halo-guide-BENCHMARKS | 41 | MIT (hogeheer499-commits/strix-halo-guide) | headline tables only; one Beelink-class box; date = repo last push, not per-run |
| github-apple-silicon-llm-bench-leaderboard | 55 | MIT (john-rocky/apple-silicon-llm-bench) | Mac sections only; **short-chat task, warm decode tok/s**, not pp512/tg128 |
| **Total** | **4,829** | | 2,946 rows have both pp and tg; 289 distinct device names; 134 distinct model strings; 983 rows matched to a hardware.json id |

Dropped during ingest: 425 comment rows that duplicate a scoreboard row (same backend+pp+tg), 2 rows whose author struck them out as invalid. The 4 llama.cpp discussion `comments` counts already include replies (the REST list returns replies with `parent_id`).

## Attribution
- llama.cpp scoreboards/comments: data from GitHub discussions in `ggml-org/llama.cpp` (#15013, #15021, #10879, #4167, #16578, #23659) and issues #13565, #11931, #19480 and `ikawrakow/ik_llama.cpp` #263. Each row carries `source_url` (comment permalink) and `author` (GitHub login). Only numbers + device + build were extracted; no prose copied. Credit "llama.cpp community benchmark threads (ggml-org/llama.cpp, MIT)" and link the threads on the site.
- llama.cpp `benches/*.md`: © ggml-org contributors, MIT.
- Hugging Face datasets: RaynarDM/apple-silicon-llm-benchmarks (Apache-2.0), NeoAiLabs/llama-cpp-rx7800xt-benchmarks (MIT), axjns/strix-halo-inference-bench (Apache-2.0). Keep author credit and link.
- GitHub repos: hogeheer499-commits/strix-halo-guide (MIT), john-rocky/apple-silicon-llm-bench (MIT).
- **LMArena** (`lmarena-ai/leaderboard-dataset`, CC-BY-4.0, text/latest, published 2026-10-13): required attribution, e.g. "Model quality ratings: LMArena (lmarena.ai), CC-BY-4.0". `lmarena_open_models.csv` keeps `license`, `rank`, `rating`, CIs and the `source` column. The file has non-proprietary models only (includes some non-commercial licenses, see `license` column). Arena rating = human preference, not task accuracy; model names still need mapping to models.json.

## Pass 2 (2026-10-15): `tools/ingest_more.py` (+ `tools/fetch_threads.py`, `tools/threads_list.py`)
Rerun order: `ingest_benchmarks.py` -> `ingest_localscore.py` (cached, no requests) -> `fetch_threads.py` -> `ingest_more.py` -> `build_measured.py` -> `node tools/coverage_report.js`.
Adds ~2,430 rows (see `summary_counts.json` -> `pass2`). `source` ids: `hf-witcheer-rtx-5090-benchmarks` (MIT), `hf-iBlessi-rtx-5080-llm-throughput` (CC-BY-4.0), `hf-steven0226-speculative-decoding-bench-rtx4090` (CC-BY-4.0), `hf-studioburnside-mlx-local-inference-benchmarks` (Apache-2.0, README headline decode figures, M5 Max 128 GB), `hf-pgmharikrishnan-mlx-serve-local-llm-benchmarks-2026-10` (MIT, M4 Max 128 GB, MLX), `llamacpp-discussion-15396` (gpt-oss guide: per-device `<summary>` sections parsed with the device taken from the section heading), `llamacpp-thread-N` (non-PR issues), `llamacpp-pr-N` / `ik_llama-pr-N` (pull-request conversations: kept in the CSV, **excluded from site medians** because they are dev builds / tuning sweeps), `ik_llama-thread-N`.
Rules: a thread row only maps to site hardware if the device came from a ggml init log or section heading AND the log shows exactly one device (rows with "device guessed from comment text" or multi-device logs never get an `hw_id`); rows with `excluded from site medians` in `notes` (CPU/MoE-offloaded runs where the file is larger than VRAM, unstable summaries) stay in the data but are skipped by `build_measured.py`. `hw_id` is also back-filled from names like `Apple M4 Max 12P+4E+40GPU` (core count parsed). Added `rtx-5080` to `site/data/hardware.json` (NVIDIA: 16 GB GDDR7, 960 GB/s).
Attribution added: llama.cpp guide discussion #15396 (ggml-org/llama.cpp, MIT, numbers + device + build only, permalink + author per row); witcheer/rtx-5090-benchmarks (MIT, © witcheer); iBlessi/rtx-5080-llm-throughput (CC-BY-4.0, © iBlessi); steven0226/speculative-decoding-bench-rtx4090 (CC-BY-4.0, © steven0226; baseline rows only); studioburnside/mlx-local-inference-benchmarks (Apache-2.0); pgmharikrishnan/mlx-serve-local-llm-benchmarks-2026-10 (MIT).
LocalScore re-check: models 4..10 return the site's not-found page (only the 3 official models exist); no new model pages. robots.txt is a 404 page (no rules); no /api calls were made.
Candidates read but NOT used: JacobPEvans/mlx-benchmarks (Apache-2.0; server load probes at concurrency>=2 with ~12k context, not single-stream), nanimani/local-llm-benchmark (CC-BY, quality-focused), Nitish-Goud/local-llm-8gb-vram-benchmark (CC-BY, 8 GB laptop GPU, not a site hardware entry), witcheer/windows-rtx-4060ti-8gb-* (CC-BY/MIT, 8 GB card; not a site entry), JacksonES/rtx-5080-llm-benchmark (no licence, image-generation, link only), cn0303/local-llm-speed-benchmarks (licence "other"), gist slewsys 3090 benchmarks (gists carry no licence: link only), hardware-corner.net / Phoronix-style articles (editorial: link only).

## Deliberately NOT ingested
- Reddit (robots disallow), Phoronix (Cloudflare), Artificial Analysis (needs user API key; hosted-API speeds), Open LLM Leaderboard/LiveBench (stale).
- GitHub repos with **no license**: XiongjieDai/GPU-Benchmarks-on-LLM-Inference, kyuz0/amd-strix-halo-toolboxes, slb350/strix-benchmarks, botAGI/strix-halo-llm-benchmarks and others. No license = no stated permission; link out only. przbadu.github.io/strix-halo-benchmarks (no license stated) likewise.
- Not parsed (permissive but low value / different shape): kreier/llama.cpp_jetson_benchmark (Jetson, MIT), mayank-dubey-ai/l4-gpu-llm-benchmark-leaderboard (L4 datacenter), igurss/mlx-chronos, famstack-dev/local-llm-bench, druide67/asiai, andyast/m4-local-llm-benchmark (MLX/app-level scenario results, not llama-bench shape; candidates for a later pass), strix-halo-guide COMMUNITY_RESULTS.md (free-text results).
- Free-text comments without a llama-bench table (e.g. "pp512 5069 / tg128 161" lines) were not parsed; so were Apple per-chip sections in #4167 (duplicates of the summary) and A-series (#4508, phones).
- Vendor/official docs (NVIDIA/AMD/Apple): used only for spec data already in hardware.json; none of them publish llama.cpp tokens/s per device, so no rows were added.

## Caveats (read before using numbers on the site)
1. **Most rows are Llama 2 7B Q4_0** (scoreboards). Dense-7B speeds do not transfer to MoE models; label them "measured on Llama 2 7B". 1,584 rows are other models.
2. **Device matching is heuristic.** Devices come from the contributor's ggml init log (`Device 0:` / `ggml_vulkan:` / `GPU name:`); when absent, a regex over the first 600 chars guesses (`notes` says "device guessed"); 738 rows have no device. 3060/4060 Ti memory variants are matched only when VRAM is known (log `Total VRAM` or scoreboard memory column), so many 3060 rows stay `rtx-3060` (unknown 8 vs 12 GB). Apple Max chips need the GPU core count (32 vs 40) so `m4-max` rows without cores are unmatched.
3. **Multi-GPU / mixed logs**: `device_count>1` rows are not hw-matched (llama-bench uses all GPUs unless `-sm none -mg`); the `rtx-3090` x4/x16 rows (~500) are clusters.
4. Contributor runs differ in build (see `build`/`build_num`), driver, power limits, FA, ubatch; scoreboards pick the best entry. No outlier filtering beyond dropping struck-through results.
5. Unauthenticated GitHub only: nothing private. Comments edited after 2026-10-14 are not reflected until rerun.
6. The strix-halo-guide and Apple leaderboard rows are curated third-party summaries (not raw logs); the guide's `Backend / Build` strings are in `notes`. Sentinel table backend is assumed Vulkan RADV (stated in `notes`).
7. `date` semantics differ by source (see above); do not treat scoreboard dates as measurement dates.
8. Speed values are as published; nothing was re-measured or interpolated.

## Coverage vs `site/data/hardware.json` (rows with `hw_id`; "non-Llama2" = other models)
| hardware id | rows | non-Llama2 rows | status |
|---|---:|---:|---|
| rtx-3060-12 | 4 | 0 | Llama 2 7B only |
| rtx-3090 | 39 | 0 | Llama 2 7B only |
| rtx-4060 | 0 | 0 | GAP: no measured data |
| rtx-4060ti-16 | 0 | 0 | GAP: no measured data |
| rtx-4070 | 2 | 0 | Llama 2 7B only (very thin) |
| rtx-4090 | 71 | 0 | Llama 2 7B only |
| rtx-5070 | 2 | 0 | Llama 2 7B only (very thin) |
| rtx-5070ti | 28 | 0 | Llama 2 7B only |
| rtx-5090 | 42 | 0 | Llama 2 7B only |
| rx-7900xtx | 177 | 9 | has other models |
| rtx-pro-6000 | 24 | 0 | Llama 2 7B only |
| m4 | 9 | 5 | has other models |
| m4-pro | 6 | 0 | Llama 2 7B only |
| m4-max-32 | 9 | 0 | Llama 2 7B only |
| m4-max-40 | 3 | 0 | Llama 2 7B only (very thin) |
| m3-ultra | 9 | 0 | Llama 2 7B only |
| m5 | 2 | 0 | Llama 2 7B only (very thin) |
| m5-pro | 6 | 0 | Llama 2 7B only |
| m5-max-32 | 0 | 0 | GAP: no measured data |
| m5-max-40 | 6 | 0 | Llama 2 7B only |
| strix-halo | 181 | 114 | has other models |
| dgx-spark | 363 | 338 | has other models |

Extra gap notes: `rtx-4060` (desktop 8GB) has 0 matched rows (17 rows are the *laptop* 4060; 3060/4060 Ti ambiguous variants listed under their slugs); `rtx-4060ti-16` 0 (2 rows of unknown 8/16GB); `m5-max-32` 0; `m4-max-40`, `m5`, `rtx-4070`, `rtx-5070` have only 2-3 rows. **No consumer NVIDIA GeForce card (3060/3090/4060/4070/4090/5070/5090) has single-GPU measured data for any model other than Llama 2 7B** (the multi-model rows are 4x/16x 3090 clusters). Apple (M-series) has measured non-Llama-2 data only for M4 (M2 Max/M4 Max rows exist but unmatched to ids), and strix-halo/dgx-spark have good multi-model coverage.


## LocalScore (added 2026-10-14)
`tools/ingest_localscore.py` (rerun: `python3 tools/ingest_localscore.py [--refresh]`; zero network calls when cached in `raw/localscore/`).
- **Source**: [LocalScore](https://www.localscore.ai), a Mozilla Builders project (open source, Apache-2.0: github.com/cjpais/LocalScore and Mozilla-Ocho/llamafile `localscore/`). Approved by the site owner after finding no ToS or robots.txt restriction (robots.txt returns 404).
- **How**: only the public HTML pages `/` (to list model ids), `/model/<id>` (3 models) and `/latest`. Next.js embeds each page's data as JSON in `<script id="__NEXT_DATA__">`; that is parsed. **No `/api/*` call is ever made**, no header spoofing or bypass. 5 requests total, >= 1.5 s apart, User-Agent `llm-advisor-research/0.1 (polite low-rate ...)`, script aborts on any 403/429/5xx.
- **Rows**: 1,711 per-accelerator averages (`source=localscore-model-pages`: Llama 3.1 8B, Qwen2.5 14B, Llama 3.2 1B, all Q4_K_M) + 10 single recent runs (`localscore-latest-runs`, with runtime/OS). 128 rows are matched to a hardware.json id (`hw_id`); the rest keep a canonical device slug.
- **New columns**: `ttft_ms` (time to first token), `perf_score` (LocalScore's composite), `rank` (`rank/number_ranked`), `n_samples`, `retrieved` (fetch date).
- **Limits**: the public pages show only *averages* per accelerator id; **sample counts and medians are not exposed** (`n_samples` blank except 1 for single runs). Backend is not shown on model pages. Two accelerator ids can share a name (e.g. RTX 4090 reported as 23 and 24 GB); both are kept as separate rows. Numbers come from LocalScore's fixed test suite (not pp512/tg128), through llamafile.
- **Attribution (required on the site)**: "Benchmark data from LocalScore (localscore.ai), a Mozilla Builders project, Apache-2.0." Shown on `site/data-sources.html`. Not affiliated with LocalScore/Mozilla.

## Own measurements (llm-advisor, llama.cpp b11658)
Source id `own-measurement`: our own `llama-bench` runs (llama.cpp b11658, CUDA 12.8, FA on, `-p 512 -n 128`, depths 0/4096/16384, 3 reps) on rented Vast.ai single-GPU hosts, 2026-10-16 (3090 and 4090 added the same day). Attribute as "own measurements (llm-advisor, llama.cpp b11658)". Files: `own/own-measurement__<hw>__2026-10-16.{csv,json}`; raw sweeps in `data/sweeps/<card>/`. Tooling: `tools/sweep/` (run_sweep.sh, ingest_sweep.py).
| hardware | rows | host notes |
|---|---:|---|
| RTX 3060 12GB | 37 | Threadripper 1920X, 62 GB RAM |
| RTX 4060 Ti 16GB | 46 | 62 GB RAM |
| RTX 4070 12GB | 37 | 125 GB RAM |
| RTX 5070 12GB | 37 | 125 GB RAM; compute capability 12.0 works with the CUDA 12.8 build |
| RTX 3090 24GB | 48 | 125 GB RAM (NL host); 16 configs, all fully on GPU, depths 0/4k/16k |
| RTX 4090 24GB | 48 | 31 GB RAM (GB host); same 16 configs |
Caveats: MoE-offload rows (`--n-cpu-moe` > 0) depend on the host CPU/RAM and are excluded from site medians. Mistral Small 3.2 24B on the 4060 Ti has no 16k-depth row (KV OOM). LocalScore's 5070 Llama 3.1 8B row (55.9 tg) looks low compared with our 5070 results (about 112 tg on an 8B Q4) and may be a mislabelled device.
