# Launch post drafts (NOT posted; Matt reviews and posts from his own accounts)
Drafted 2026-10-17. Every number below comes from the site/data files at the time of writing; re-check before posting:
26 hardware setups, 13 models, 928 measured benchmark rows (314 hardware/model/quant points on 24 hardware entries), 540 of our own llama-bench rows on 11 NVIDIA GPUs (RTX 3060 12GB, 3090, 4060 8GB, 4060 Ti 16GB, 4070, 4090, 5070, 5070 Ti, 5080, 5090, RTX PRO 6000 96GB), 314-row leaderboard with CSV, context estimates up to 1M tokens where the model supports it, free, no sign-up, no cookies. Data CC BY 4.0, code MIT.
Honest caveats to keep in the posts: Mac/AMD/DGX Spark/Strix Halo numbers are public community medians, not ours; unmeasured combos are bandwidth *estimates* (labelled; e.g. our estimate for Qwen3.6 35B-A3B on a 3090 was 279 tok/s vs 159 measured, so estimates can be optimistic); site has Amazon affiliate links and Vast.ai/RunPod referral links.

Before posting: check r/LocalLLaMA's current self-promotion rules and flair requirements (sidebar/pinned post), post when you can answer comments for a few hours, and don't ask anyone to upvote. Edit the text into your own voice.

---

## (a) r/LocalLLaMA

**Title:** I built a free "what fits on my GPU/Mac" page with measured llama.cpp numbers (and where it's only an estimate)

**Flair:** Resources (or whatever the mod rules currently ask for self-made tools)

**Body:**

I'm the author of this, and it has Amazon affiliate links plus a couple of cloud GPU referral links, so take that into account. It's free, no sign-up, no cookies.

I kept redoing the same fit math for "will model X run on card Y at 16k context", so I turned it into a site: https://localllmadvisor.com

What it does:
- You pick a GPU / Mac / unified-memory box (26 setups listed, or enter your own VRAM/RAM) and it lists which of 13 current models fit, at which quant, with KV cache included. It also shows how much context fits with f16 / q8_0 / q4_0 KV, up to 1M tokens for the models that support it.
- Every speed number carries a label: **measured** (median of real llama.cpp runs), **scaled from measured**, or **estimated** (memory-bandwidth model). The estimates are the weak part. For example it guessed ~279 tok/s for Qwen3.6 35B-A3B on a 3090 and the measured median is ~159, so treat estimated rows as a ceiling.
- Copy-paste llama.cpp and ollama commands for each pick.

Data: 928 measured rows used on the site (public llama.cpp results, credited on the sources page, plus our own GPU runs); 540 llama-bench rows I ran myself on rented GPUs (3060 12GB, 3090, 4060 8GB, 4060 Ti 16GB, 4070, 4090, 5070, 5070 Ti, 5080, 5090, RTX PRO 6000 96GB; depth 0 / 4k / 16k, Q4_K_M and Q8_0). Macs, AMD, DGX Spark and Strix Halo numbers are other people's public results, not mine. Everything is in a sortable leaderboard with a CSV (CC BY 4.0): https://localllmadvisor.com/leaderboard.html and on Hugging Face.

A few things from my own runs, in case they're useful: on the same GPU the MoE models were about 3.5x faster (range 3.2x to 3.9x over 8 comparisons) than the similar-size dense model at Q4_K_M, 16k of context cost a median of ~9% of generation speed for dense models and ~12% for MoE models on full-GPU runs, and Q8_0 ran at ~67% of Q4_K_M speed for dense models (about 94% for MoE). Details and methods are in the write-up: https://localllmadvisor.com/blog/state-of-local-llm-hardware-oct-2026.html

If your hardware isn't measured, there's a form to submit a llama-bench result (https://localllmadvisor.com/submit.html). Corrections welcome, especially where the numbers look off for your setup. Code is MIT: https://github.com/mattgrandy/local-llm-advisor

---

## (b) Show HN

**Title:** Show HN: Local LLM Advisor – what fits on your GPU or Mac, with measured llama.cpp numbers

**URL:** https://localllmadvisor.com

**First comment (post right after submitting):**

Hi, I made this. When choosing a local model I kept redoing the same arithmetic: weights plus KV cache against VRAM, then guessing tokens per second from memory bandwidth. This site does that for 26 hardware setups and 13 models and shows the result as tables you can sort.

How the numbers work: fit is weights (from the GGUF file sizes) plus KV cache at the chosen context plus about 1 GB overhead, against usable memory. Speed is labelled one of three ways: measured (median of llama.cpp results), scaled from a measurement of a similar model or quant, or estimated from memory bandwidth. The estimates can be off by a lot; for example it predicts ~279 tok/s for Qwen3.6 35B-A3B on an RTX 3090 where the measured median is ~159.

The data is 928 measured rows used on the site (public llama.cpp benchmark threads and datasets, credited on the sources page, plus my own GPU runs), including 540 rows from my own llama-bench runs on eleven rented NVIDIA GPUs. Mac, AMD and unified-memory numbers come only from public results. Leaderboard and CSV are CC BY 4.0, code is MIT: https://github.com/mattgrandy/local-llm-advisor

Disclosure: the site has Amazon affiliate links and cloud GPU referral links, labelled as such. They don't affect the recommendations, which come from the fit math and benchmark data only. No sign-up, no cookies, anonymous Umami analytics.

I'd most like to hear where the fit or speed numbers are wrong for your hardware, and what you'd want measured next.

---

## (c) X posts (three, standalone)

1.
Built a free page that tells you which local LLMs fit your GPU or Mac, with KV cache and context included, up to 1M tokens where the model supports it. Speeds are labelled measured / scaled / estimated. localllmadvisor.com

2.
We ran llama-bench on 11 GPUs (3060 12GB to RTX PRO 6000). On the same card, MoE models generated 3.2-3.9x (median 3.5x) faster than similar-size dense ones at Q4_K_M. Data + methods (CC BY 4.0): localllmadvisor.com/blog/state-of-local-llm-hardware-oct-2026.html

3.
Open benchmark table for local LLMs: 928 measured rows, 314 hardware/model/quant points, CSV download, Hugging Face dataset. Missing your GPU or Mac? You can submit a llama-bench result. localllmadvisor.com/leaderboard.html

(Disclose in replies if asked: I'm the author; the site has Amazon affiliate and cloud referral links.)

---
## Update 2026-10-17 (site_id mapping fix)
Own rows with site_id null (Qwen3-VL 8B, Mistral Small 3.2 24B, Qwen3.6 27B) now map to catalog models, so they show as "measured". (superseded below) / 24 hardware entries, MoE 3.6-3.9x vs dense, ~9-11% cost at 16k, Q8 ~66% of Q4 (all computed from own rows by name, not site_id).
Only changed value: the site's depth model is now fit on 283 measured points (was 168), median abs error 2.4% (was 3.2%), kappa 0.74 (was 0.72), because own-row names are now recognised and own MoE-offload rows are excluded from the fit.


## Update 2026-10-17 (own sweeps: 4060 8GB, 5080, 5070 Ti, 5090)
Site numbers now: 928 measured rows used, 314 hardware/model/quant points on 24 hardware entries, 540 own llama-bench rows on 10 NVIDIA GPUs (leaderboard CSV has 276 rows). Re-check the older MoE-vs-dense / 16k-penalty / Q8 figures in the posts against the blog before posting; they were computed on the earlier 253-row set.

## Update 2026-10-17 (RTX PRO 6000 added; figures re-checked against the blog)
Current blog numbers: 928 measured rows used, 314 hardware/model/quant points, 540 own rows on 11 GPUs, leaderboard CSV 314 rows. MoE vs dense at Q4_K_M: median 3.5x (3.2-3.9x, 8 comparisons). 16k context keeps a median 91% of depth-0 speed for dense, 88% for MoE (131 full-GPU runs). Q8_0 is 67% of Q4_K_M speed for dense (43 comparisons), 94% for MoE (12). Posts above were edited to match. Own gpt-oss-120b and GLM-4.5-Air Q4 now measured on the PRO 6000 (GLM Q8 not run: 117 GB).

## Update 2026-10-17 (3090 long-context runs)
Own rows now 540 on 11 GPUs (19 new 3090 rows at 32k/64k/128k depth, Q4_K_M, full-GPU models only; 128k OOMs on 24 GB for 24-30B models). Depth model now fit on 438 points, median abs error 2.2%. MoE/dense (3.5x), 16k retention (91%/88%), Q8 (67%/94%) figures unchanged; other counts (928 rows, 314 points, 314-row leaderboard) unchanged.

## Update 2026-10-17 (4090 long-context runs)
Own rows now 540 on 11 GPUs (19 new 4090 rows at 32k/64k/128k, Q4_K_M, same scope as the 3090). Depth model fit on 457 points, median abs error 2.2%. MoE/dense, 16k retention and Q8 figures and the 928 / 314 / 314-row counts are unchanged.
