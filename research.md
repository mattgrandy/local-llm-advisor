# Local LLM Advisor — Research (2026-10-14)
Method: web search + page fetch. All competitor URLs fetched OK on 2026-10-14. Claims below are from those pages unless marked (unverified).
Caveat: no tool gave Reddit post-frequency counts; "demand" is inferred from sampled r/LocalLLaMA threads + guides, not measured.

## 1. Competitors
| Tool | URL | What it does | Gaps | Monetization |
|---|---|---|---|---|
| CanItRun | https://canitrun.dev/ | GPU picker -> fits/offload/won't-run for ~99 models, quant, est tok/s, 100+ GPUs, guides, app catalog | Estimates not measured; mixed-quality "best quant" (e.g. BF16 for small models); no "what to buy" budget flow seen | RunPod affiliate link (disclosed on page) |
| LocalLLMChecker | https://localllmchecker.com/ | 86 architectures x 131 devices, KV-cache aware, MoE offload, validated on one RTX 3050 (2.1% mem / 2.5% speed error), buy-side pages | Validation is one machine/one model; speeds are estimates | Ads + Amazon affiliate (stated on page) |
| ModelFit | https://modelfit.io/calculator/ | RAM/VRAM slider -> single top pick + ollama command, 116 models, CLI (`npx @wecko-ai/modelfit`), CC BY 4.0 dataset | Simple 0.6GB/B rule; tok/s estimated; no real benchmarks | None visible (email capture "get told when better model fits") |
| FitLLM | https://fitllm.run/ | Model+quant+KV quant+context fit for NVIDIA/AMD/Mac; handles sliding-window/MLA; MIT engine | Fit only, thin recommendations | None visible |
| VRAMCalculator | https://vramcalculator.com/ | Precise weights+KV+engine overhead; GGUF header read in browser; accuracy record on real cards (27/27 fits ran) | Calculator, not a recommender | Paid newsletter "Local LLM Sizing Guide" from $9/mo; domain voxllm.com for sale |
| LocalAnalysis | https://localanalysis.ai/vram/24gb/ | Per-VRAM-tier ranked pages with independent ECI score, max context, speed (on RTX 3090 Ti) | Only models with scores ranked; tiers not use-case specific | None visible |
| llmfit (CLI) | https://github.com/AlexsJones/llmfit | Rust TUI/CLI detects hardware, scores hundreds of HF models (fit/speed/quality/context), `bench --share` community leaderboard | Local install needed; not SEO/web | Open source (search snippet says ~30K stars — unverified; fetch showed 0) |
| LocalScore (Mozilla) | https://www.localscore.ai/about | Open benchmark + public DB of prompt/gen tok/s, TTFT across CPUs/GPUs/Apple | Single-GPU only; no "which model should I run" layer; public query API planned | Non-profit (Mozilla Builders) |
| LLMHardware.io | https://llmhardware.io/hardware | 26 GPUs/Macs/mini PCs specs + fit notes + buy links | Hardware catalog, thin on model rec | Amazon affiliate "Check current price" |

Other seen (not fetched): popularai.org, openclawdc.com, digitalapplied.com, vettedconsumer.com buyer guides (blog-style, affiliate-style content).

## 2. Demand signals (sampled)
Reddit threads (search snippets):
- 24GB: https://www.reddit.com/r/LocalLLaMA/comments/1qlwibf/what_is_the_best_generalpurpose_model_to_run/ (CanItRun cites 98 upvotes / 61 answers for a similar thread)
- 8GB: https://www.reddit.com/r/LocalLLaMA/comments/1vx4k9g/whats_the_best_local_model_youve_found_for_8_gb/
- RTX 3060 12GB: https://www.reddit.com/r/LocalLLaMA/comments/1sentxd/best_model_for_rtx_3060_12gb/ ; .../1tne39v/best_coding_model_on_rtx_3060/ ; r/LocalLLM .../1v1ajuq/3060_12gb_32_gb_ddr5_what_can_i_run/
- 16GB: https://www.reddit.com/r/LocalLLaMA/comments/1tpi8cs/vram_16gig_poor_what_models_do_i_test/
- 5090 vs M3 Ultra: .../1motsy3/seeking_numbers_on_rtx_5090_vs_m3_ultra/ ; Dual DGX Spark vs M3 Ultra 512GB: .../1s4lmep/dual_dgx_sparks_vs_mac_studio_m3_ultra_512gb/
Recurring themes: tier = VRAM size; MoE with CPU/RAM offload (--n-cpu-moe) is the hot technique for 8-16GB cards; coding/agentic use is a dominant use case; dense vs MoE speed; context/KV cache surprises; Mac vs NVIDIA vs Strix Halo/DGX Spark purchasing debates.

Models currently dominant in sources (Oct 2026): Qwen 3.5/3.6/3.8 (27B dense, 35B-A3B MoE, 9B), Gemma 4 (26B-A4B, 31B, 12B), gpt-oss 20B/120B, Qwen3-Coder-30B-A3B, Mistral Small 3.2 24B, GLM-4.7-Flash/4.5-Air, Nemotron 3 Nano, Llama 3.x (legacy), DeepSeek R1 distills. Sources: localanalysis.ai, openclawdc.com/blog/best-models-popular-rtx-gpus/, popularai.org, canitrun.dev/guides/24gb-vram-llms/. Sources disagree on #1 (Qwen3.8 27B vs Gemma 4 26B-A4B vs Qwen3.6 27B) — need own benchmark/ranking method.
Market facts: Apple pulled 512GB (Mar 2026) and 256GB (May 2026) Mac Studio M3 Ultra options (digitalapplied.com, DRAM shortage) — older guides/Reddit posts are stale. Many GPUs show "no buy box"/unavailable on Amazon (llmhardware.io 2026-10-13) — affiliate links need availability handling; cloud rental (RunPod) is an alternative CTA.

## 3. Top 15 hardware configs to target (derived from sampled threads + guides; ranking is judgment, not measured counts)
1. RTX 3090 24GB (used) — "value king" (canitrun guide)
2. RTX 4090 24GB
3. RTX 5090 32GB
4. RTX 3060 12GB (+32GB RAM) — many threads
5. 8GB VRAM class (RTX 4060 / 3070 / 4070 mobile) with RAM offload
6. 16GB class (RTX 4060 Ti 16GB / 4070 Ti Super / 5070 Ti / 5080)
7. RTX 5070 / 4070 12GB
8. AMD RX 7900 XTX 24GB
9. AMD Ryzen AI Max+ 395 "Strix Halo" 128GB (GMKtec EVO-X2, Beelink GTR9 Pro)
10. NVIDIA DGX Spark 128GB
11. Mac Studio M3 Ultra (96GB now max new) / used 256–512GB
12. MacBook Pro M-series Max, 64–128GB (M4/M5 Max)
13. Mac mini / MacBook 16–24GB (M4/M5)
14. Mac Studio M5 Max 36GB+ / M4 Pro 24–64GB
15. Dual-GPU rigs (2x3090 / 2x4090 / 3090+other) and RTX PRO 6000 96GB
Also: Intel Arc B580 12GB / Arc Pro B60 24GB (long tail).

## 4. Top 5 gaps / opportunities
1. Use-case-first answers: competitors rank by fit/score; few answer "best for coding agent / chat / vision on MY hardware" with a ready `ollama`/`llama-server` command incl. MoE offload flags (--n-cpu-moe), which Reddit threads show is the key trick for 8–16GB.
2. Measured, not estimated, speeds: most tools show formula tok/s (ModelFit says so explicitly). Aggregate LocalScore / llama.cpp community benchmarks and label "measured vs estimated".
3. Freshness + trust: model landscape changes monthly; stale Mac/GPU facts exist. Automated weekly update loop with visible "last verified" dates and change log.
4. Buy/upgrade + cloud CTA: "what's the cheapest card/Mac that runs X" plus availability-aware affiliate links (Amazon buy boxes often missing) and RunPod/Vast fallback; only CanItRun/LocalLLMChecker/LLMHardware touch this.
5. Under-served configs: Strix Halo, DGX Spark, multi-GPU and Apple Silicon unified-memory/MoE planning, with context-length (KV cache) honesty.

## 5. Monetization notes (from competitors)
Amazon affiliate (LocalLLMChecker, LLMHardware), RunPod affiliate (CanItRun), display ads (LocalLLMChecker), paid newsletter (VRAMCalculator $9/mo), email capture (ModelFit). Landscape is crowded and mostly free; differentiation must be data quality + UX. Unverified: actual traffic/revenue of any competitor.
