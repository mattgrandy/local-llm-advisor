# Next live-benchmark plan (planning only; nothing rented, no repo edits)
Prepared 2026-10-17 (MT). Vast offers queried read-only via API at ~15:00 MT (verified, on-demand, 1 GPU, >=30 GB RAM, >=150 GB disk, inbound <= ~$10/TB). Prices move hourly; re-check before renting.

## 0. Budget reality check (important)
- Vast credit now **$4.10** (no card, hard cap). Started at $10.00 (vast-launch-plan.md). Six sweeps (3060, 4060 Ti, 4070, 5070, 3090, 4090) plus two aborted hosts used **~$5.90, i.e. ~$1.0 per card**, about 3x the $0.24-0.85 per-card estimate in benchmark-sweep-plan.md. Cause: hourly price is only part of it. Inbound bandwidth is billed per GB (hosts charge ~$2.7-13/TB; a 140 GB sweep = $0.4-1.9), plus boot/download/storage time and dead hosts.
- So plan on **~$0.7-1.0 per 12-16 GB card, ~$1.5-2 for a 5090 (268 GB), ~$3-4 for a 96 GB card (~400 GB)**, and always pick hosts with the lowest inbound $/TB and >=500 Mbps.
- Past wall times (sweep.log): 3060 23 min, 4060 Ti 27, 4070 31, 5070 28, 3090 20, 4090 33 min of sweep, plus ~10-15 min boot/setup. Budget ~45-60 min per rental.

## 1. Current coverage (site/data/measured.json, data/benchmarks/own)
Own measured (llama-bench, b11658, Q4_K_M+Q8_0, depth 0/4k/16k): 3060 12GB (11 configs), 4060 Ti 16GB (14), 4070 (11), 5070 (11), 3090 (16), 4090 (16). That is 253 rows.

| Hardware page | Own rows | Other measured on site | Site-model coverage | Main reliance on estimates |
|---|---|---|---|---|
| RTX 5090 | none | 38 third-party (6 site models, odd quants) | 6/13 | 7 models (gemma-26B, Qwen3.5 4B/9B, Coder-30B, Mistral, VL-8B, GLM-Air), all of the 16k+ penalty |
| RTX 5080 | none | 11 third-party, only gpt-oss-20B maps | 1/13 | almost everything |
| RTX 5070 Ti | none | 5, 1 model | 1/13 | almost everything |
| RTX 4060 8GB | none | 2 rows, 0 site models | 0/13 | everything (likely the highest-traffic 8GB page) |
| RTX 4070, 5070, 3060, 4060 Ti | yes | - | see bug below | 120B/GLM-Air, 32k+ context, Q5/Q6 |
| RTX 3090, 4090 | yes | - | see bug below | gpt-oss-120b / GLM-Air (need big RAM), long context, 2x3090 page |
| RTX PRO 6000 96GB | none | 6 rows, 2 models | 2/13 | 11 models, incl. gpt-oss-120b |
| RX 7900 XTX | none | 8 third-party (Llama2-class), 2 map | 2/13 | all; no rental route |
| Apple (M4/M5 families, M3 Ultra) | none | few rows, mostly Llama-2 7B from an old pinned build | 0-1/13 | all |
| Strix Halo, DGX Spark | none | 26 / 19 community rows | 6 / 4 | large models |
| Dual RTX 3090 page | none | - | - | multi-GPU scaling is a fixed assumption |

**Possible data bug worth a free check first:** many *own* rows have `site_id: null` in measured.json (e.g. 4090: Mistral Small 3.2 24B, Qwen3-VL 8B, Qwen3.6 27B; 3060: only 3 of 11 configs mapped; 3090 8/16). If the site ties "measured" to site_id, ~half of the sweeps we paid for may not show as measured for those models. Not edited; worth verifying and fixing in the ingest name map before spending more.

Gaps present on almost every page: no depth > 16k (the site sells 1M-context filters), no Q5/Q6 own data, no gpt-oss-120b / GLM-4.5-Air anywhere, no multi-GPU, no AMD/Apple own data.

## 2. Likely-traffic ranking (judgment; no per-page Umami data pulled yet, so check Umami top pages once)
Popular consumer cards people ask "will it run" about: 4060/4060 Ti (8/16GB), 3060 12GB, 4070 / 4070 Super / 4070 Ti (Super), 3090, 4090, 5070 Ti, 5080, 5090, 3080/3070/2080 Ti (older, lots of used-GPU shoppers). Site currently has pages for only some; **no pages for 4070 Ti / Ti Super, 4080/4080 Super, 3080, 3070, 2080 Ti, A100/H100/L40S**. Adding them is a separate (repo) task; the measurements only help if the pages/hardware.json rows exist.

## 3. What can be rented right now (Vast, 1 GPU, qualifying hosts)
| Card | Qualifying offers ($/hr, cheapest first, region) | Notes |
|---|---|---|
| RTX 4060 **8GB** | 0.080 (BC, CA; 31 GB RAM; inbound $2.7/TB), 0.083 (NV, US; 16 GB RAM) | Only 2 offers. Exact card the site models. |
| RTX 4060 Ti 16 / 8GB | 0.143 PA US, 0.149, 0.162 | already own-measured (16GB) |
| RTX 5060 Ti 16GB | 0.142 KR, 0.149 KR (8GB variant listed too) | no page |
| RTX 5070 | 0.171-0.203 CA/US/UZ | already measured |
| **RTX 5070 Ti** | **0.282 Quebec (63 GB RAM, 790 GB disk, 934 Mbps)**, 0.403 NL, 0.438 CA-US | page has 1/13 |
| **RTX 5080** | **0.361 Spain (31 GB RAM, 462 Mbps)**, 0.467 Denmark, 0.539 CA-US | page has 1/13 |
| RTX 5090 | 0.601-0.616 (19 offers; GB, KR, SK, TW, US) cheapest unfiltered 0.463 | page 6/13, no own |
| RTX 4070S Ti 16GB | 0.296 Arizona (63 GB RAM, 2.2 Gbps) | no page (not the 4070 Ti) |
| RTX 4070 Ti 12GB | only 2 offers (0.242, 1.07), neither passes RAM/disk filter | marginal |
| RTX 4080 / 4080S 16GB | 4080: 0.242/0.30 (fail filter); 4080S: 0.29-0.51 (one US host with 126 GB RAM at 0.51; its listing says 32 GB VRAM, so verify it is truly a 4080S) | thin |
| RTX 3080 10/12GB, 3080 Ti 12GB | 3080 0.16 (none pass RAM filter; fine if GPU-only configs); 3080 Ti 0.178 TH, 0.242 MA-US, 0.324 ES | no page |
| RTX 3070 8GB | 1 qualifying offer at $3.99 (no); cheaper ones 0.083-0.095 fail RAM filter | GPU-only configs would be OK on low-RAM hosts |
| RTX 2080 Ti 11GB | 0.123 VN (150 Mbps, slow downloads) | no page |
| RTX 3090 / 4090 | 0.161 / 0.402 | already have |
| 2x RTX 3090 | 0.36-0.40 (CN/ES/US/EE; 47-72 GB RAM) | validates dual-3090 page |
| 2x RTX 4090 | 0.86-0.94 | |
| A100 SXM4 40GB | 0.47 CA-US (31 GB RAM) | |
| **A100 SXM4 80GB** | **0.80 Poland (126 GB RAM)**, 1.07 TW/CZ, 1.47 US | fits gpt-oss-120b |
| L40S 48GB | 0.436 / 0.80 / 0.84 (KR/SG/TW/US) | |
| H100 SXM / NVL | 2.14-2.35 / 2.31-3.0 | too expensive for now |
| **RTX PRO 6000 96GB** | WS 1.30 US, Max-Q 1.00 AU/1.12 CA, S 1.34 ES | the page exists with 2/13 |
| RTX PRO 5000 48GB / PRO 4000 | 0.47 US / 0.23 US | |
| **RX 7900 XTX** | **Vast: none.** Salad Cloud lists it at $0.066-0.168/hr per web aggregators, but Salad runs containers on idle consumer PCs (no SSH/root, queued, unclear if a ROCm llama.cpp image is usable). Needs a Salad account; I have not verified it works for benchmarking. | only credible hourly route; otherwise community submissions |
| Apple Silicon | AWS EC2 Mac is the only hourly-ish route and has a **24 h minimum** per host: M4 $1.23/h ($29.52), M4 Pro $1.97/h ($47.28), **M4 Max 128GB $6.25/h ($150)**, M3 Ultra 256GB $12.50/h ($300). Other Mac clouds (MacStadium etc.) are daily/monthly. Not viable at our budget. | rely on community data (llama.cpp #4167, GitHub/HF leaderboards) |
No MI300-class AMD or Apple on Vast. RunPod lists no AMD consumer cards or Macs.

## 4. Ranked test batches
Cost = my estimate: hours x price + inbound GB x host $/TB, with ~25% slack. "Sweep" = tools/sweep/run_sweep.sh with the existing 13-model catalog (Q4_K_M + Q8_0, depths 0/4k/16k, MoE offload where it fits).

| # | Batch | Est. cost (expected / bad case) | Gaps closed | Why it ranks here |
|---|---|---|---|---|
| 1 | **RTX 4060 8GB** sweep (only 8GB-fitting configs ~8 + MoE offload; needs 16 GB+ RAM, prefer the 31 GB BC host) | $0.25 / $0.5 | 4060 page goes 0/13 -> ~8/13 own | Cheapest, probably the most-searched 8GB GPU, and the page is currently pure estimate |
| 2 | **RTX 5080 16GB** sweep (same list as 4060 Ti: 13 configs) | $0.7 / $1.2 | 1/13 -> ~12/13 | 5080 is a top "will it run" query; today's single row is third-party |
| 3 | **RTX 5070 Ti 16GB** sweep | $0.6 / $1.0 | 1/13 -> ~12/13 | same reasoning; Quebec host is cheap with 63 GB RAM |
| 4 | **RTX 5090 32GB** sweep, trimmed to skip configs where third-party rows already exist (about 12-14 configs) | $1.2 / $2.0 (full 19-config list: $1.7 / $2.6) | 6/13 third-party -> own 13/13 incl. 32GB-only fits (Gemma 31B Q8, Qwen3.6 27B Q8, 35B-A3B) | high-traffic flagship; current data is odd quants from forum posts |
| 5 | **RTX PRO 6000 96GB** (US WS $1.30 or AU Max-Q $1.00; ~1.5 h, ~400 GB) | $3.5 / $5 | the only way to own-measure **gpt-oss-120b and GLM-4.5-Air** at full GPU, plus 11 missing models on that page | headline models, but costly; 96GB-class cards are rare in searches |
| 6 | **A100 80GB** (PL $0.80, 126 GB RAM) | $2.0 / $3.0 | gpt-oss-120b, GLM-Air Q4, cloud-GPU "Rent" tie-in; can substitute for #5 on the 120B models (80GB fits 120B Q4 only) | cloud/rental pages support the Vast referral slot |
| 7 | **2x RTX 3090** (layer split) on the existing dual-3090 page | $1.0 / $1.6 | replaces the multi-GPU assumption with data; fits 70B-class and 120B Q4 w/ 48GB | unique content competitors lack |
| 8 | **Long-context extension on 4090 + 3090** (-d 32768, 65536, 131072 for ~8 key models, Q4 only) | $0.9 + $0.8 | first real >16k data; validates the context-penalty model that the 1M-context filter depends on | cheap per insight; needs a small run_sweep depth option (repo edit later) |
| 9 | **New-card pages**: 4070 Ti Super 16GB ($0.30 AZ), 3080 Ti 12GB ($0.24 US), (4070 Ti, 4080/4080S, 3080, 3070, 2080 Ti when a good host appears) | ~$0.7 each | enables pages for popular used/mid cards | needs hardware.json/page work; label exact card names (a 4070 Ti Super is not a 4070 Ti) |
| 10 | L40S 48GB / RTX PRO 5000 48GB | $1.5 each | 48GB tier, cloud pages | lower traffic |
| 11 | Re-run 1-2 cards for variance (second host, same card) | $0.8 | confidence intervals / outlier check (e.g. LocalScore 5070 55.9 vs our 111.9) | quality, not coverage |
| - | RX 7900 XTX via Salad | unknown, ~$0.1-0.2/hr + image work | only AMD consumer own data | speculative; try only after verifying Salad gives a ROCm-capable container |
| - | Apple via AWS | $30-300 minimum | M4/M4 Pro/M4 Max/M3 Ultra | not worth it; use community data |

## 5. Recommendation within ~$4.10
Spend about $3.2 expected, keep about $0.9 as reserve for a dead host or a rerun:
1. 4060 8GB ($0.25) 2. 5080 ($0.7) 3. 5070 Ti ($0.6) 4. trimmed 5090 ($1.2-1.5). Order by traffic value, stop and reassess after each (check live credit via API before each launch; destroy immediately after copying the tarball; verify SSH within 3 minutes and switch hosts if rejected, per NOTES-first-real-run.md).
If the 5090 would leave under $0.6, skip it and do #9 (4070 Ti Super or 3080 Ti) instead. Do not attempt #5-#7 on this credit.
Free work to do first (no rentals): fix the null `site_id` mapping so existing own rows show as measured; add hardware entries for popular missing cards so batch #9 has somewhere to land; pull Umami top pages to confirm the traffic ranking.

## 6. What an extra ~$16 (about $20 total) would buy
In order: full-list 5090 (+$0.5), RTX PRO 6000 (gpt-oss-120b/GLM-Air, $3.5), 2x3090 ($1.0), A100 80GB ($2.0), long-context 4090+3090 ($1.7), 4070 Ti Super + 3080 Ti + 4080S/4070 Ti when hosts exist ($2.5), L40S ($1.5), variance reruns ($1.6). Roughly $14-15, leaving margin for failures. Needs the user to add credit (Vast has no card on file, so top-ups are manual; a card with auto-top-up is not recommended).

## 7. Free/open sources of real measurements not yet ingested (all need license check before publishing numbers)
Already ingested: llama.cpp discussions #15013/#15021/#10879/#4167 and comments, several llama.cpp PR threads, LocalScore pages, HF datasets (iBlessi 5080, witcheer 5090, NeoAiLabs rx7800xt, axjns/strix-halo, steven0226 4090, Mac MLX sets), Strix Halo guide, DGX Spark benches. Candidates still open:
1. **LocalScore bulk**: only /latest and some model pages ingested. Email contact@localscore.ai for an export (Apache-2.0 code, no stated data license); biggest GPU x model matrix of real runs. Needs the owner's OK.
2. **llama.cpp discussion #15013 etc. re-poll** weekly (updated 2026-10-01..10): cheap new rows, MIT repo, numbers + attribution.
3. **ik_llama.cpp discussions/issues** with llama-bench tables (one issue already ingested); same approach.
4. **Hugging Face datasets**: search periodically for tags like `llama-bench`, `gpu-benchmark`, `tokens-per-second` with a permissive license (CC-BY/Apache/MIT/CC0). Only ingest if the license is explicit.
5. **MLPerf Inference / MLCommons results** (Apache-2.0-ish, public GitHub) for A100/H100/L40S/B200 datacenter numbers; different workloads (Llama-2-70B, etc.), so use only for cloud pages, clearly labelled.
6. **Phoronix / Reddit / YouTube**: not allowed (ToS, off-limits per benchmark-sources.md). Instead invite the posters to submit via the site's form.
7. **Our own `submit.html` submissions** (GitHub issues): promote in the launch posts; best long-term source for AMD/Apple.
8. **vLLM / SGLang / TensorRT-LLM public benchmark repos and CI dashboards** (Apache-2.0): H100/A100/L40S/RTX numbers in other engines; label engine separately.
9. **LMSYS/SGLang "gpu benchmark" blog data, Hugging Face `optimum-benchmark`/`open-llm-perf-leaderboard`**: check license/freshness; the HF Open LLM leaderboard is stale (Mar 2025) so skip.
10. **Apple**: llama.cpp #4167 is pinned to a Nov-2023 build (numbers low); newer MLX benchmark repos on GitHub/HF (some ingested) are the best open source; re-poll monthly.

Reproducibility rule I'd keep: store commit/build, quant, depth, driver and a source URL for each row, and never mix forum-post Llama-2-7B Q4_0 numbers into per-model "measured" claims.
