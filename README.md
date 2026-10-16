# Local LLM Advisor (prototype)

Free static site: pick hardware + use case, get models that fit (weights + KV cache), an **estimated** speed, and copy-paste llama.cpp / ollama commands. No build step; plain HTML/CSS/JS.

## Layout
- `site/index.html, app.js, style.css`: interactive advisor
- `site/advisor.js`: fit/speed/command logic (browser + Node)
- `site/data/models.json`: generated from Hugging Face by `tools/update_models.py`
- `site/data/hardware.json`: hand-maintained hardware specs, assumptions, and the 15 (+1 bonus) SEO target configs
- `site/hardware/*.html`: generated SEO pages (`node tools/generate_pages.js`)
- `tools/model_manifest.json`: which models to track (editorial inputs)
- `site/data/measured.json`: **generated** by `tools/build_measured.py` from `data/benchmarks/` (+ reviewed community submissions): measured medians per hardware/model/quant class, calibration factors, attribution
- `site/submit.html`, `submit.js`, `submit-ui.js`, `submit-config.json`: "Submit your benchmark" (see below); `site/data-sources.html`: generated attribution page
- `tools/ingest_localscore.py`, `tools/ingest_submissions.py`, `tests/test_all.js`, `.github/ISSUE_TEMPLATE/benchmark-submission.yml`
- `research.md`: competitor/demand research

## Run locally
    cd site && python3 -m http.server 8000   # open http://localhost:8000

## Measured vs estimated speeds
Each speed shows its provenance (`Advisor.speedInfo`):
- **measured**: same model, same quant class (Q4/Q5/Q6/Q8...) on that hardware (single device, no -d context depth, no batched-bench, no CPU backend); value = median of N runs; tooltip shows N, range, sources, latest date.
- **scaled from measured**: no direct measurement, so the nearest measurement on that hardware is scaled by bytes read per token (measured_tps x read_measured / read_here). Either the same model at another quant, or a different model of the same kind (dense vs MoE) whose bytes read are within 0.6-1.67x (MoE also needs total params within 0.6-1.67x). Labelled as an estimate-grade number, never plain "measured".
- **estimated**: bandwidth x efficiency / bytes read, with the efficiency calibrated (below).
Measured/scaled values apply only to a model that fully fits on one device (not offload modes, not multi-GPU) and are short-context generation speeds; at 16k context real speed is lower.

## Calibration (documented)
`tools/build_measured.py` computes `efficiency = measured_tg / (bandwidth / read_GB)` on dense models with read >= 3 GB (small models are launch-overhead bound), single device; median per hardware id if >= 3 rows, else per hardware kind (gpu/apple/unified), else the old global 0.55. Clamped to 0.25-0.95. Stored in `measured.json -> calibration` and shown on each page. Results: kind medians gpu 0.64 / apple 0.64 / unified 0.80; per-hardware e.g. RTX 4090 0.68, RTX 3090 0.54 (wide spread), 7900 XTX 0.61, Strix Halo 0.80, DGX Spark 0.81, M3 Ultra 0.40. MoE: a `moe_factor` (0.77) from unified-memory runs only is applied to all MoE estimates; there is no MoE calibration data for discrete GPUs, so those estimates are probably optimistic. Calibration sources are dominated by Llama-2-7B scoreboards and LocalScore 8B/14B, so bias toward those models. CPU offload efficiency (0.60) is NOT calibrated. The 2023-pinned Apple thread (#4167 summary) is excluded.

## Submit your benchmark
`site/submit.html`: static form (hardware, model, quant, backend, pp/tg tok/s, pp/tg token counts, llama.cpp build, OS, flash-attn, notes, optional contact), llama-bench instructions, paste-the-output autofill, client-side validation + plausibility warnings, honeypot field, consent checkbox. Destination is `site/submit-config.json`: `mode` `none` (default: **nothing is sent**; UI says so and shows a copy-paste JSON block), `github_issue` (opens a prefilled new-issue page; set `github_issue.repo`, copy `.github/ISSUE_TEMPLATE/benchmark-submission.yml` into that repo), or `endpoint` (POST JSON to `endpoint_url`, https only; you must run that endpoint). No destination is configured today, so submission is not live.
Moderation: `tools/ingest_submissions.py` (inbox of `.json`/issue-body `.md` files in `data/submissions/inbox/`) re-validates, de-duplicates, flags outliers, queues in `data/submissions/review_queue.json` as pending; a human sets `status` to `approved`; `--publish` writes `community_reviewed.json` (whitelisted fields only, contact stripped, `verified: false`), picked up by `build_measured.py`. Community rows are displayed in a separate "unverified" table and **never** feed estimates or calibration.

## Tests
`node tests/test_all.js` (provenance tiers across all pages, multi-GPU exclusion, submit validation, llama-bench parser). Moderation flow tested manually with sample submissions (removed afterwards).

## Update data (weekly routine)
0. `python3 tools/ingest_benchmarks.py` (llama.cpp/HF/GitHub), then `python3 tools/ingest_localscore.py --refresh`, then `python3 tools/build_measured.py` (the first script rewrites benchmarks_all, so run LocalScore after it).
1. **Add/remove models**: edit `tools/model_manifest.json` (HF model id, unsloth/other GGUF repo, tags, `vision`, and for MoE `active_b` copied from the model card text).
2. `python3 tools/update_models.py`: refetches params, license, context, attention layout (for KV math), and real GGUF file sizes; stamps `last_verified` and appends a changelog entry for changes. A model that fails to fetch is skipped, never guessed.
3. **Hardware**: edit `site/data/hardware.json` by hand. Every entry needs `source_url`, `basis`, `last_verified`. GPUs: TechPowerUp spec page (bandwidth = bus width x data rate). Apple/AMD/NVIDIA unified: vendor spec pages. Add new targets under `targets`.
4. `node tools/generate_pages.js` (SITE_URL defaults to `https://localllmadvisor.com`; also runs `tools/seo.js`: canonical, Open Graph/Twitter, JSON-LD, `sitemap.xml`, `robots.txt`, `CNAME`). Internal links are relative, so the site also works on the old github.io URL.
4b. **Publish**: `tools/sync_publish.sh [/workspace/publish]` copies `site/` to the publish repo's `site/` and `docs/` (GitHub Pages serves `main:/docs`). **`docs/CNAME` must never be deleted** (the script excludes it from `--delete` and rewrites it); deleting it drops the custom domain. Never `rm -rf docs/` or sync without `--exclude CNAME`.
5. Add a human-readable line to `changelog` in models.json if something notable changed (e.g. a new model family).

## Facts vs assumptions
- Verified from the web: params, license, context max, layer/KV config, GGUF sizes, GPU/Apple/AMD/NVIDIA memory and bandwidth.
- **Assumptions** (in `hardware.json -> assumptions`, not facts): 1 GB/GPU overhead, 8 GB OS RAM reserve, 70% (Apple) / 85% (APU) of unified memory usable, experts = 90% of MoE weights, speed efficiency 55% GPU / 60% CPU, "usable" >= 5 tok/s, "comfortable" >= 15 tok/s, RAM bandwidth by RAM type (theoretical). Speed efficiency is now calibrated from measured data (see Calibration); the 55% is only the fallback.
- Ranking is a heuristic (fits and fast enough first, then size; MoE uses sqrt(total x active)). `tags` (coding/chat) are editorial, not benchmark results.
- Gemma 4 / Qwen3.5-3.6 KV math: sliding-window and linear-attention layers are handled; K and V are both counted even where a model shares K=V (conservative).

## Known gaps / not verified
- Commands were not executed on real hardware. `--n-cpu-moe`, `-fa on`, `-hf repo:quant`, `OLLAMA_CONTEXT_LENGTH` should be re-checked against the current llama.cpp/Ollama docs. Ollama cannot set `--n-cpu-moe`.
- Mac memory configs on target pages are examples (96GB M3 Ultra comes from research.md, not re-verified here). No sponsor/affiliate links exist: slots are `data-slot` placeholders only.
- Intel Arc, multi-GPU speed scaling (assumes layer split, single-GPU bandwidth) are not implemented. Measured data covers only part of the hardware x model grid.

## License and data attribution

Code in this repository is MIT licensed (see `LICENSE`). Processed benchmark data in `data/benchmarks/` and `site/data/` is derived from third-party sources (llama.cpp discussions, LocalScore/Mozilla, LMArena CC-BY-4.0, open-licensed GitHub repos and Hugging Face datasets) and remains subject to each source's own terms; see `site/data-sources.html` and `benchmark-sources.md`. Raw caches are not included; rerun the ingest tools to rebuild them.
