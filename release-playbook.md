# New-release fast path (model or hardware live within a day)

Goal: when a model or GPU/Mac launches, publish its hardware or model page plus the top "Can X run Y" pages within 24 hours, while people are searching.

**Next test: Apple event, Oct 27–28 2026** (expected M6-generation Macs). Run this playbook on the day of the announcement once Apple's tech-specs page is up.

## 0. Ground rules
- Use only published facts: bandwidth and memory options from the vendor spec page (apple.com tech specs, NVIDIA/AMD product page, TechPowerUp only when the vendor page lacks bandwidth). `--source` is required. The tests reject Apple entries whose source isn't apple.com.
- Model facts (params, layers, KV layout, GGUF sizes, license) are fetched from Hugging Face by `tools/update_models.py`. Only `active_b` (MoE) and YaRN context blocks are copied by hand from the model card into `tools/model_manifest.json`.
- Until someone measures, the speed on day-one pages is an **estimate** and is labelled that way in the title, hero, short answer and FAQ. Pages switch to measured automatically when rows arrive (our sweep, LocalScore, llama.cpp threads, submissions).
- No prices anywhere.

## 1. One command

```sh
cd /workspace/llm-advisor
# New Apple machine (one target per popular memory size; repeat with another --target-mem and --slug for a second size)
node tools/add_release.js apple --chip m6-max-40 --chip-name "Apple M6 Max (40-core GPU)" --bw <GB/s from spec page> \
  --source https://www.apple.com/macbook-pro/specs/ --config mbp-m6-max-40 --form "MacBook Pro" \
  --config-name "MacBook Pro 14/16 — M6 Max (40-core GPU)" --mem 36,64,128 --target-mem 128 \
  --pairs openai/gpt-oss-120b,Qwen/Qwen3.6-35B-A3B,zai-org/GLM-4.5-Air
# New discrete GPU
node tools/add_release.js gpu --id rtx-6090 --name "GeForce RTX 6090" --vendor NVIDIA --vram 32 --bw <GB/s> \
  --source <vendor or TechPowerUp URL> --basis "memory bus x data rate from <source>" \
  --pairs openai/gpt-oss-20b,Qwen/Qwen3.6-27B,Qwen/Qwen3.6-35B-A3B,google/gemma-4-31B-it
# New model (GGUF repo must already exist; unsloth/bartowski usually publish same day)
node tools/add_release.js model --id org/Model-30B-A3B --name "Model 30B-A3B" --gguf unsloth/Model-30B-A3B-GGUF \
  --moe --active 3.3 --tags chat,coding [--vision] --pairs rtx-4090-24gb,rtx-3090-24gb,rtx-5090-32gb,macbook-pro-m5-max-128gb
# Only add day-one pairs for entries that already exist
node tools/add_release.js pairs --hw rtx-5090-32gb --models org/New-Model
```
Add `--dry` to preview, or `--no-build` to stage several entries before one regenerate (`node tools/generate_pages.js`).

What it does: updates `site/data/hardware.json` or `tools/model_manifest.json` (and refetches `models.json`), adds the target page, writes the day-one pairs to `tools/release_hot.json`, regenerates everything (hardware, model, VRAM tier, compare, can-run, embed badge and card, sitemap with lastmod, JSON-LD) and runs `tests/test_all.js`. The Amazon box comes from the GPU name or Apple config automatically. If no listing exists yet, add a skip in `affiliateQueries` (`tools/layout.js`) the way `studio-m5-ultra` and `mini-m6` are.

Day-one pair rules (in `tools/generate_extra_pages.js`):
- Pairs go first, up to `CAP_REL` = 8 on top of the 72 regular pages, so choose 3–4 per device.
- A pair is published only if the model fits fully. Estimates are allowed for any hardware kind here.
- Pairs expire after 45 days unless measured data arrives. A measured pair keeps its page through the normal path.

## 2. Check and publish (about 15 minutes)
1. Read the new hardware page and one pair page. Bandwidth, usable memory and "estimated" labels should all be right.
2. Run `node tests/test_browser.js && node tests/test_browser_growth.js`.
3. Run `tools/sync_publish.sh` (keeps `docs/CNAME`). Copy the changed `tools/`, `tests/` and data files into `/workspace/publish`.
4. Commit as `Matt <mattgrandy@users.noreply.github.com>` and push with `GITHUB_TOKEN_LLM_ADVISOR`.
5. Once Pages is live, run `node tools/indexnow.js --submit` from `/workspace/llm-advisor`.
6. Optional: run Google Search Console URL inspection on the hardware page, and add a line to the blog changelog.

## 3. Within the week
- Measure if it can be rented. NVIDIA cards usually show up on Vast.ai within weeks; follow `next-benchmarks-plan.md` (one instance, destroy after, keep the reserve). Macs can't be rented, so watch LocalScore and llama.cpp discussions and ingest them during the Monday refresh.
- Add a compare pair to `PAIR_SLUGS` (new vs predecessor, e.g. M6 Max vs M5 Max) and to the `HOT` list if the pair stays popular.
- Update `launch-posts.md` numbers if the headline stats change.

## Apple Oct 27–28 checklist
- [ ] Spec pages are live: bandwidth per chip, memory options.
- [ ] One `apple` command per new chip, with the target at the most-searched memory size (Max at 128 GB, Pro at 48 or 64 GB, base at 32 GB).
- [ ] Pairs: gpt-oss 120B and GLM-4.5-Air for Max and Ultra; Qwen3.6 35B-A3B and 27B for Pro; gpt-oss 20B and Qwen3.5 9B for base chips.
- [ ] Mark machines that aren't shipping yet in the title, e.g. "(ships <date>)", the way the M5 Ultra 512GB target does.
- [ ] Publish, run IndexNow, and note it in growth-progress.md.
