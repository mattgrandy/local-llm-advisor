# Draft PRs for awesome lists (NOT opened)
Prepared 2026-10-16. Open each from the `mattgrandy` GitHub account only after Matt approves. One PR per list, one entry each. Check each list's current README before opening (they change often), and make sure the site and repo are live and linked.

Common facts (verified): site https://localllmadvisor.com (free, no sign-up); repo https://github.com/mattgrandy/local-llm-advisor (MIT code, CC BY 4.0 own data); dataset https://huggingface.co/datasets/LocalLLMAdvisor/local-llm-advisor-benchmarks; leaderboard https://localllmadvisor.com/leaderboard.html. Disclose in each PR body that the maintainer (Matt) is the author and that the site has Amazon affiliate links on hardware pages, labelled and rel="sponsored".

---
## 1. rafska/awesome-local-llm
Repo: https://github.com/rafska/awesome-local-llm - CONTRIBUTING: fork, edit README.md, clear commit message, PR describing the addition. List entries look like `- [Name](url) - description` (a star badge is added for GitHub repos).
Section: **Large Language Models > Explorers, Benchmarks, Leaderboards** (alternative: Tools > Models, next to llmfit).

**Branch / commit:** `add-local-llm-advisor` / "Add Local LLM Advisor to Explorers, Benchmarks, Leaderboards"

**README line to add (GitHub repo, so with the star badge like its neighbours):**
```
- <img src="https://img.shields.io/github/stars/mattgrandy/local-llm-advisor?style=social" height="17" align="texttop"/> [Local LLM Advisor](https://localllmadvisor.com) - pick your GPU, Mac or RAM and see which local LLMs and quantizations fit (weights + KV cache, up to 1M context), with measured llama.cpp tokens/sec and copy-paste commands
```

**PR title:** Add Local LLM Advisor (hardware -> model/quant recommendations with measured benchmarks)

**PR body:**
Adds Local LLM Advisor to *Explorers, Benchmarks, Leaderboards*.

- What it is: a free website (no sign-up, no cookies) where you choose your GPU, Mac or system RAM and get the models and quants that fit, including KV-cache math and long-context limits, a speed figure labelled measured / scaled / estimated, and llama.cpp / ollama commands.
- Open data: leaderboard with CSV download (https://localllmadvisor.com/leaderboard.html), own llama-bench measurements as a CC BY 4.0 dataset on Hugging Face, code MIT (https://github.com/mattgrandy/local-llm-advisor).
- Disclosure: I'm the author. The site has labelled Amazon affiliate links on hardware pages; they never affect the recommendations.

---
## 2. Enterprise-AI-Atlas/awesome-local-llms
Repo: https://github.com/Enterprise-AI-Atlas/awesome-local-llms - CC0. Requirements (CONTRIBUTING.md): publicly accessible, actively maintained (commit in last 12 months), documented (README with setup), correctly categorized, honestly labelled with `Official` or `Community` badge; entry format below; run `./scripts/validate-links.sh`; one resource per PR. New categories need >= 5 entries, so use an existing one.
Section: **Model Management** (closest: helps choose models/quants for local hardware). Alternative: Hardware / Acceleration. Check that the maintainers consider a web tool in scope ("resources directly useful for running... or optimizing LLMs on local hardware"); if unsure open an issue first.

**Branch / commit:** `add-local-llm-advisor` / "Add Local LLM Advisor (Community)"

**README line to add:**
```
- **[Local LLM Advisor](https://github.com/mattgrandy/local-llm-advisor)** `Community` — Free web tool that recommends local LLMs and quantizations for your GPU, Mac or RAM using memory-fit and KV-cache math plus measured llama.cpp benchmarks (live at localllmadvisor.com).
```
(No install line: it is a hosted static site; the repo can be served locally with any static server.)

**PR title:** Add Local LLM Advisor to Model Management

**PR body:**
Resource: Local LLM Advisor - https://localllmadvisor.com (source: https://github.com/mattgrandy/local-llm-advisor, MIT; own benchmark data CC BY 4.0).

Why it fits: it helps people size models and quantizations to their local hardware (VRAM/unified memory, KV cache up to 1M context, MoE offload flags) and gives paste-ready llama.cpp/ollama commands.
Checklist: public and open source; actively maintained (weekly data refresh); README documents the data pipeline; category: Model Management; badge: Community; `./scripts/validate-links.sh` run and passing (to be confirmed at PR time).
Disclosure: I'm the author; hardware pages carry labelled Amazon affiliate links that do not affect recommendations.

---
## 3. WaterPistolAI/Awesome-Local-LLM
Repo: https://github.com/WaterPistolAI/Awesome-Local-LLM (default branch `master`; the README raw URL on `main` 404s, so read it from `master` before editing; it is a small list; the plan notes PRs or issues are welcome). No CONTRIBUTING.md was found.
Open an **issue first** (lower friction for a small list), then a PR if they prefer.

**Issue title:** Suggestion: add Local LLM Advisor (hardware -> model/quant recommendations)

**Issue / PR body:**
Hi! I'd like to suggest https://localllmadvisor.com for the list. It is a free web tool where you select your GPU, Mac or RAM and it shows which local LLMs and quantizations fit (weights + KV cache, long context up to 1M), with measured llama.cpp speeds and copy-paste commands. Open data (CSV leaderboard, CC BY 4.0 dataset on Hugging Face) and MIT code: https://github.com/mattgrandy/local-llm-advisor. I'm the author, and the site has labelled Amazon affiliate links. Happy to adjust the wording or section.

Suggested line (adapt to the list's format and section, e.g. tools/hardware):
```
- [Local LLM Advisor](https://localllmadvisor.com) - free tool: pick your GPU/Mac/RAM, get models and quants that fit with measured tokens/sec and ready-to-run commands
```

---
## Other lists from the plan (not drafted; lower fit)
vince-lam/awesome-local-llms, ununununium/awesome-local-ai, av/awesome-llm-services. Only pursue after the first three, one at a time, and only if their scope matches a web advisor tool.
