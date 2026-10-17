# Launch post drafts (NOT posted; Matt reviews and posts from his own accounts)
Drafted 2026-10-17. Every number below comes from the site/data files at the time of writing; re-check before posting:
26 hardware setups, 13 models, 858 measured benchmark rows (252 hardware/model/quant points on 24 hardware entries), 253 of our own llama-bench rows on 6 NVIDIA GPUs (RTX 3060 12GB, 3090, 4060 Ti 16GB, 4070, 4090, 5070), 252-row leaderboard with CSV, context estimates up to 1M tokens where the model supports it, free, no sign-up, no cookies. Data CC BY 4.0, code MIT.
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

Data: 858 benchmark rows from public llama.cpp results (credited on the sources page), plus 253 llama-bench rows I ran myself on rented GPUs (3060 12GB, 3090, 4060 Ti 16GB, 4070, 4090, 5070; depth 0 / 4k / 16k, Q4_K_M and Q8_0). Macs, AMD, DGX Spark and Strix Halo numbers are other people's public results, not mine. Everything is in a sortable leaderboard with a CSV (CC BY 4.0): https://localllmadvisor.com/leaderboard.html and on Hugging Face.

A few things from my own runs, in case they're useful: on the same GPU the MoE models were about 3.6x to 3.9x faster than the similar-size dense model at Q4_K_M (4 comparisons), 16k of context cost a median of ~9-11% of generation speed on full-GPU runs, and Q8_0 was ~66% of Q4_K_M speed for dense models. Details and methods are in the write-up: https://localllmadvisor.com/blog/state-of-local-llm-hardware-oct-2026.html

If your hardware isn't measured, there's a form to submit a llama-bench result (https://localllmadvisor.com/submit.html). Corrections welcome, especially where the numbers look off for your setup. Code is MIT: https://github.com/mattgrandy/local-llm-advisor

---

## (b) Show HN

**Title:** Show HN: Local LLM Advisor – what fits on your GPU or Mac, with measured llama.cpp numbers

**URL:** https://localllmadvisor.com

**First comment (post right after submitting):**

Hi, I made this. When choosing a local model I kept redoing the same arithmetic: weights plus KV cache against VRAM, then guessing tokens per second from memory bandwidth. This site does that for 26 hardware setups and 13 models and shows the result as tables you can sort.

How the numbers work: fit is weights (from the GGUF file sizes) plus KV cache at the chosen context plus about 1 GB overhead, against usable memory. Speed is labelled one of three ways: measured (median of llama.cpp results), scaled from a measurement of a similar model or quant, or estimated from memory bandwidth. The estimates can be off by a lot; for example it predicts ~279 tok/s for Qwen3.6 35B-A3B on an RTX 3090 where the measured median is ~159.

The data is 858 rows from public llama.cpp benchmark threads and datasets (credited on the sources page) plus 253 rows from my own llama-bench runs on six rented NVIDIA GPUs. Mac, AMD and unified-memory numbers come only from public results. Leaderboard and CSV are CC BY 4.0, code is MIT: https://github.com/mattgrandy/local-llm-advisor

Disclosure: the site has Amazon affiliate links and cloud GPU referral links, labelled as such. They don't affect the recommendations, which come from the fit math and benchmark data only. No sign-up, no cookies, anonymous Umami analytics.

I'd most like to hear where the fit or speed numbers are wrong for your hardware, and what you'd want measured next.

---

## (c) X posts (three, standalone)

1.
Built a free page that tells you which local LLMs fit your GPU or Mac, with KV cache and context included, up to 1M tokens where the model supports it. Speeds are labelled measured / scaled / estimated. localllmadvisor.com

2.
We ran llama-bench on 6 GPUs (3060 12GB to 4090). On the same card, MoE models generated 3.6-3.9x faster than similar-size dense ones at Q4_K_M. Data + methods (CC BY 4.0): localllmadvisor.com/blog/state-of-local-llm-hardware-oct-2026.html

3.
Open benchmark table for local LLMs: 858 llama.cpp rows, 252 hardware/model/quant points, CSV download, Hugging Face dataset. Missing your GPU or Mac? You can submit a llama-bench result. localllmadvisor.com/leaderboard.html

(Disclose in replies if asked: I'm the author; the site has Amazon affiliate and cloud referral links.)

---
## Update 2026-10-17 (site_id mapping fix)
Own rows with site_id null (Qwen3-VL 8B, Mistral Small 3.2 24B, Qwen3.6 27B) now map to catalog models, so they show as "measured". Launch-post numbers are UNCHANGED: 858 rows, 253 own rows, 252 points / 24 hardware entries, MoE 3.6-3.9x vs dense, ~9-11% cost at 16k, Q8 ~66% of Q4 (all computed from own rows by name, not site_id).
Only changed value: the site's depth model is now fit on 283 measured points (was 168), median abs error 2.4% (was 3.2%), kappa 0.74 (was 0.72), because own-row names are now recognised and own MoE-offload rows are excluded from the fit.
