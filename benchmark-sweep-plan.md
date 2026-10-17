# Benchmark sweep plan & cost estimate (cloud llama-bench)
Prepared 2026-10-15 (MT). Nothing rented, no accounts created. Cost model: `tools/sweep_cost.py`.

## 1. Prices and availability (checked 2026-10-15)
Sources
- RunPod pricing page, "Updated October 8, 2026": https://www.runpod.io/pricing (fetched directly). Lists RTX 3090 $0.50 / 4090 $0.89 / 5090 $1.19 per hr (Secure Cloud; JSON-LD also gives Community Cloud 3090 $0.22, 4090 $0.34, 5090 $0.69). Storage: container disk $0.10/GB/mo, volume $0.10 running / $0.20 idle, network volume $0.07/GB/mo. **RunPod lists no 3060, 4060 Ti, 4070, 5070 or any AMD consumer card.**
- Vast.ai is a live marketplace; its own pricing pages are JS-rendered ("Live GPU Prices", per-GPU pages returned "No current offers" to my fetch, so they were NOT usable). Docs confirm per-second billing, credits needed upfront, storage billed until instance is deleted, bandwidth billed per byte at a host-set rate: https://docs.vast.ai/documentation/instances/pricing . Prices below come from the gpuhour.com aggregator API (https://gpuhour.com/api/v1/offers/, 1,955 offers, provider data last updated 2026-10-15 ~12:25 UTC / 6:25 AM MT, "pulled from provider APIs"). That is a secondary source; confirm live prices in the Vast console before renting.
- Also seen in that snapshot: Shadeform (RTX 5090 $0.65/hr only), Akash (3060 $0.14, 3090 $0.09, 4090 $0.28 – decentralized, unvetted, not planned), Prime Intellect (4090 $0.90), Clore.ai (prices in the feed look like non-USD units, e.g. 3090 at $4–10/hr, so unverified and ignored). TensorDock/Shadeform pages: could not fetch usable prices (redirect/blocked); not verified.

| Card | Rentable now? | Vast.ai 1-GPU offers, $/hr (min / median / p75), n offers | Other providers |
|---|---|---|---|
| RTX 3060 12GB | Yes, Vast only | 0.069 / 0.108 / 0.148 (27) | Akash 0.14 |
| RTX 4060 Ti 16GB | Yes, thin (5 offers; cheapest in Jiangsu CN, others Ohio/KY/MX/VN) | 0.107 / 0.162 / 0.162 (5) | none |
| RTX 4070 12GB | Yes, Vast only | 0.152 / 0.170 / 0.176 (25) | none |
| RTX 5070 12GB | **No reliable listing.** Absent from the 2026-10-15 snapshot except Clore.ai (units unclear). A web-search snippet from gpufind showed a 2-GPU Poland Vast offer ~$0.20/GPU, but it is not in the later snapshot, so treat as sporadic. | n/a | n/a |
| RX 7900 XTX | **No.** No AMD consumer card on any provider checked. Only Instinct MI300/325/350-class appear (different architecture; not a valid proxy). | n/a | n/a |
| RTX 4060 8GB | **No exact card.** Vast has an "RTX 4060 Ti" 8GB SKU (page says from ~$0.11, availability Low; madebyagents lists $0.13) – not in the gpuhour snapshot, unverified. | unverified | – |
| RTX 3090 (compare) | Yes | 0.167 / 0.323 / 0.40 (31) | RunPod Community 0.22, Secure 0.50 |
| RTX 4090 (compare) | Yes | 0.401 / 0.64 / 0.71 (52) | RunPod Community 0.34, Secure 0.89 |
| RTX 5090 (compare) | Yes | 0.436 / 0.974 / 1.74 (102) | RunPod 0.69 / 1.19; Shadeform 0.65 |

Proxy / caveat notes
- Power- or clock-limiting a 4090/3090 to "emulate" a 4070/3060 is NOT valid: VRAM size, memory bandwidth, cache, tensor-core count and driver paths differ. Don't publish it as measured data for another card.
- 5070: could re-check Vast daily and run when a 12GB 5070 appears; or label as "scaled from 5070 Ti/5060 Ti" (5060 Ti 16GB is on Vast at ~$0.14) – that is a scaled estimate, not measured. Different bandwidth (672 GB/s vs 448 for 5060 Ti).
- 7900 XTX: only route is community submissions (submit page) or buying/borrowing one. No cloud route found.
- 4060 8GB: the 4060 Ti 8GB is a close but not identical card (288 vs 272 GB/s, more cores); label as "RTX 4060 Ti 8GB", not 4060.
- Cheapest Vast hosts are often in China/Asia; HF downloads from there can be slow. Filter for US/EU, >=32 GB RAM (MoE offload needs RAM ≥ model size; many 4070 hosts show only 15 GB RAM), >=200 GB disk, and low internet download cost.

## 2. Sweep definition (from site/data/models.json, 15 models)
- Quants: Q4_K_M and Q8_0 (Q5/Q6 skipped). Context depths: 0, 4096, 16384 (`-d`), tests pp512 and tg128, `-r 3`, flash-attn on.
- Included if model + ~1GB KV@16k fits in 95% of VRAM, else, for MoE models ≤40GB at Q4_K_M only, a MoE-offload run (expert tensors on CPU, `--n-cpu-moe` sweep of ~3 values at depth 0, best value at other depths). gpt-oss-120b and GLM-4.5-Air (63–117 GB) excluded: need ≥96 GB RAM.
- Resulting runs: 3060/4070 12GB: 11 configs, ~113 GB of downloads; 4060 Ti 16GB: 13 configs, ~138 GB; 3090/4090: 16 configs, ~187 GB; 5090: 19 configs, ~268 GB.

## 3. Time/cost model (assumptions, not measurements)
- Per config base time on a 4070: 135 s fully on GPU (load + 3 depths × 3 reps incl. depth prefill), 420 s for MoE-offload; scaled by card speed factor (3060 1.6, 4060 Ti 1.3, 4070 1.0, 3090 0.8, 4090 0.5, 5090 0.4). All guesses; first real run should recalibrate.
- Download speed: low 300 MB/s, likely 120 MB/s, high 40 MB/s (assumed, host-dependent). Setup (boot, pull image, verify): 8 / 15 / 30 min. Run time multiplier 0.8 / 1.0 / 1.5. **+30% buffer on total.**
- GPU price: low = min offer, likely = median, high = p75 of current Vast offers.
- Storage: billed per hour with the instance (included in Vast listed hourly price per the aggregator; unverified) – under a few cents for a few hours; delete instances right after.
- Bandwidth/egress: Vast bills inbound/outbound per byte at host-set rates; I could not verify typical rates. 113–190 GB of downloads per card could add real money if a host charges for inbound. **Filter hosts with inet_down_cost = 0 or very low and verify before launching.** Not included below.

| Card | Configs | Download GB | Hours low / likely / high | Cost low | **Likely** | High |
|---|---|---|---|---|---|---|
| RTX 3060 12GB | 11 | 113 | 1.5 / 2.2 / 3.9 | $0.10 | **$0.24** | $0.58 |
| RTX 4060 Ti 16GB | 13 | 138 | 1.3 / 2.0 / 3.7 | $0.14 | **$0.32** | $0.61 |
| RTX 4070 | 11 | 113 | 1.1 / 1.6 / 3.1 | $0.16 | **$0.27** | $0.55 |
| RTX 5070 | – | – | not rentable | – | – | – |
| RX 7900 XTX | – | – | not rentable | – | – | – |
| RTX 4060 8GB / 4060 Ti 8GB | – | – | unverified | – | – | – |
| **Target total (3 rentable cards)** | | | | **$0.40** | **$0.83** | **$1.74** |
| 3090 (compare) | 16 | 187 | 1.0 / 1.6 / 3.4 | $0.16 | $0.52 | $1.37 |
| 4090 (compare) | 16 | 187 | 0.8 / 1.3 / 3.0 | $0.30 | $0.85 | $2.14 |
| 5090 (compare) | 19 | 268 | 0.8 / 1.5 / 3.6 | $0.35 | $1.46 | $6.30 |
| **All six rentable cards** | | | | $1.01 | **$3.14** | $10.18 |

Real-world cost is dominated by things not in the table: Vast minimum credit deposit (not verified; the docs only say credits must be added upfront), failed/slow hosts (budget 2× reruns → ~$2–4 for the whole target set), bandwidth fees, and re-runs after bugs. Suggest a **$10 cap/deposit** covers everything incl. comparisons. This is a very cheap project; the constraint is availability, not money. Needs a Vast.ai account (user's) – not created.

## 4. Runbook outline (SUPERSEDED by section 5: `tools/sweep/` now implements and tests this; kept for reference)
```bash
# on rented instance (Vast template: image ghcr.io/ggml-org/llama.cpp:full-cuda or build from source -DGGML_CUDA=ON; verify tag; Blackwell needs CUDA >=12.8)
set -euo pipefail
GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1 | tr ' ' '_')
OUT=results/$GPU; mkdir -p $OUT models
{ nvidia-smi -q; lscpu; free -g; ./llama-bench --version 2>&1; } > $OUT/env.txt   # record driver, clocks, power limit, build commit
nvidia-smi --query-gpu=power.limit,clocks.max.sm,memory.total --format=csv > $OUT/limits.csv
pip install -q "huggingface_hub[hf_transfer]"; export HF_HUB_ENABLE_HF_TRANSFER=1
# generated from models.json by tools/make_sweep_list.py (to write): rows of repo,file_pattern,quant,mode
while IFS=, read repo pat quant mode; do
  huggingface-cli download "$repo" --include "$pat" --local-dir models/$quant
  f=$(ls models/$quant/*${pat//\*/}* | head -1)       # first shard for split GGUFs
  if [ "$mode" = gpu ]; then
    ./llama-bench -m "$f" -ngl 99 -fa 1 -p 512 -n 128 -d 0,4096,16384 -r 3 -o jsonl >> $OUT/bench.jsonl
  else   # MoE offload: sweep expert layers kept on CPU; confirm flag name with ./llama-bench --help (n-cpu-moe)
    for n in 12 24 36; do
      ./llama-bench -m "$f" -ngl 99 --n-cpu-moe $n -fa 1 -p 512 -n 128 -d 0 -r 3 -o jsonl >> $OUT/bench.jsonl
    done   # then rerun best n at -d 4096,16384
  fi
  rm -rf models/$quant   # keep disk small; one model at a time
done < sweep_list.csv
tar czf $OUT.tgz $OUT   # pull via scp/rsync, then DESTROY the instance
```
Guardrails: set the account spending cap/low balance before launching; hard timeout `timeout 3h` around the script; one card at a time; destroy instance on completion (storage keeps billing otherwise); compare 4090/3090/5090 rows against existing community numbers as a sanity check; ingest with the existing parser (`tools/bench_parse.py`), tagging source "own run, llama.cpp <commit>, <date>, Vast.ai host".
Open items (updated 2026-10-15): script written (section 5); flags/build verified (section 5). Still open: verify Vast bandwidth costs & minimum deposit in the console; recheck 5070 / 4060 8GB availability on run day.


## 5. Sweep tooling (built 2026-10-15, nothing rented, nothing run on a GPU)
Folder `tools/sweep/` (self-contained: copy the whole folder to any Linux box with an NVIDIA driver):
| File | Purpose |
|---|---|
| `make_sweep_list.py` | `--refresh` queries the Hugging Face tree API for each `gguf_repo` in `site/data/models.json`, resolves the exact GGUF file(s) for Q4_K_M and Q8_0 (UD- labels, split shards, skips mmproj/imatrix/MTP), checks sizes against models.json (>3% gap is warned), writes `sweep_catalog.json` (committed; 26 entries, checked 2026-10-15). `--vram-gb N --ram-gb M` turns the catalog into a per-box plan: `gpu` if weights + KV allowance fit 95% of VRAM, `moe-offload` for Q4_K_M MoE <= 40 GB when RAM >= size + 4 GiB, else skipped. Smallest models first. |
| `run_sweep.sh` | Detects GPU/VRAM/RAM/disk, installs the pinned prebuilt llama.cpp (**release b11658, commit 3e4dfa8f3, CUDA 12.8 build, Blackwell-capable, driver >= 570**; `LLAMA_CUDA=13.4` or `source` also supported), downloads each GGUF with `hf download`, runs `llama-bench -ngl 99 -fa 1 -p 512 -n 128 -r 3 -d 0,4096,16384 -o jsonl`; MoE-offload models run `--n-cpu-moe` at 25/50/75% of the layer count (read from the GGUF header) at depth 0, then the best value at depths 4096 and 16384; deletes each model after use; logs `nvidia-smi` (full + `-q`), clocks/power limit/VBIOS, driver, llama.cpp version, CPU/RAM, and a 5-second GPU monitor CSV (clock/power/temp/throttle reasons); writes `raw/*.jsonl`, `logs/`, `meta.json`, `results_flat.csv`, tarball `sweep_out.tgz`. Resumable (`done/` and `failed/` markers). `--dry-run` prints everything with no changes. |
| `ingest_sweep.py` | Turns a result dir/tgz into data/benchmarks rows (pp and tg joined per model/depth/offload setting), `source = own-measurement`, author "Local LLM Advisor (own measurement)", `hw_id` via `tools/bench_parse.normalize_device` (or `--hw-id` override stored in meta.json), notes carry build commit, driver, provider, CPU/RAM, stddevs, a HIGH VARIANCE flag. Offload rows contain "excluded from site medians" so `build_measured.py` ignores them (it already ignores depth > 0 rows). `--merge` idempotently appends to `benchmarks_all.{csv,json}`. Writes `data/benchmarks/own/own-measurement__<hw>__<date>.{csv,json}`. Note: re-running `tools/ingest_benchmarks.py` regenerates benchmarks_all, so run `--merge` after it, then `tools/build_measured.py`. |
| `gguf_blocks.py`, `best_ncmoe.py` | helpers (GGUF layer count; pick best `--n-cpu-moe`). |
| `tests/` | 15 pytest tests incl. end-to-end runs with stub `nvidia-smi`/`hf`/`llama-bench` (resume, failure abort, download failure + retry, deadline -> tarball -> upload -> on-finish order, dry-run changes nothing) and a fixture of genuine b11658 `llama-bench -o jsonl` output. Run: `python3 -m pytest tools/sweep/tests -q`. `shellcheck -x run_sweep.sh` is clean (v0.11.0). |

Typical run on any box: `scp -r tools/sweep box:~/ && ssh box 'cd sweep && ./run_sweep.sh --dry-run'` then `./run_sweep.sh -y --max-hours 3 --provider <name> --on-finish <preset|cmd> --upload-cmd '<cmd with {TARBALL}>'`, then `python3 tools/sweep/ingest_sweep.py sweep_out.tgz --merge`. Sizes per card from the generator: 12 GB card 11 configs / 113 GB; 16 GB 14 / 152 GB; 24 GB 16 / 187 GB; 32 GB 19 / 267 GB; 96 GB 25 / 568 GB (the 96 GB list also includes gpt-oss-120b and GLM-4.5-Air at Q4_K_M/Q8_0).

Verification done: flag names checked in `tools/llama-bench/llama-bench.cpp` @ b11658 and in `llama-bench --help` of the real b11658 binary (CPU/CUDA tarballs downloaded and run on the box without a GPU): `-m -p -n -d -r -ngl -fa` (accepts 1/0/on/off/auto), `--n-cpu-moe`/`-ncmoe`, `--delay`, `-o jsonl`, `--list-devices`. The tarball layout (`llama-b11658/llama-bench` plus `.so` files, `cudart-llama-b11658-bin-ubuntu-cuda-12.8-x64.tar.gz` for CUDA runtime libs) was checked. A real llama-bench jsonl row from a tiny model parses through ingest.
NOT verified (no GPU/vendor access): the CUDA path of the prebuilt binary on real NVIDIA drivers, actual llama-bench timings (section 3 is still an assumption), the `--on-finish` presets other than `poweroff` (`gcp-stop`, `gcp-delete`, `runpod-remove`, `vast-destroy` are best-effort; test them once on the provider, and prefer provider-native limits such as GCP `--max-run-duration` below), and download speeds from HF on each vendor.
Known limits: Q8_0 of 30B-class models is only run when it fits in VRAM (no offload for Q8); 120B/GLM only run on >= 96 GB-class cards; one GPU only (GPU 0).

## 6. GCP (Matt may have free access)
Sources: GCP docs https://docs.cloud.google.com/compute/docs/gpus and `.../gpus/gpu-regions-zones` (fetched 2026-10-15), official price page https://cloud.google.com/products/compute/pricing/accelerator-optimized (fetched), per-machine-type prices from gcloud-compute.com / economize.cloud / devzero.io (secondary, "min" = cheapest region, normally us-central1).
| Machine / GPU | VRAM | Price on-demand, USD/hr (evidence) | Where (docs) | Valid stand-in for |
|---|---|---|---|---|
| `g4-standard-48`: 1x RTX PRO 6000 Blackwell **Server Edition** | 96 GB GDDR7 | **4.4999** us-central1/us-east1/us-east4 (economize.cloud, gcloud-compute.com); spot 1.71-1.89 | 21 regions incl. us-central1, us-east1, us-east4, us-west1, europe-west4 | **`rtx-pro-6000` entry: closest valid, but it is the Server Edition (different power/cooling than the Workstation card in hardware.json), so ingest it as its own device or force `--hw-id rtx-pro-6000` and say so in notes.** Also runs 120B-class models fully on GPU. |
| `g4-standard-6/12/24`: 1/8, 1/4, 1/2 of an RTX PRO 6000 (vGPU) | 12 / 24 / 48 GB | 0.5596 / 1.125 / 2.25 (gcloud-compute.com min; g4-standard-6 also on economize.cloud) | docs list "G4 (Fractional GPU)"; the zone page shows us-central1-b | **NOT a proxy for 12 GB or 24 GB consumer cards.** NVIDIA vGPU time-slice of a 96 GB card (docs: vGPU, needs vGPU driver + service account), not a 3060/4070/3090. Benchmark only as "RTX PRO 6000 1/8 vGPU" if ever. |
| `g2-standard-4`+: 1x L4 | 24 GB GDDR6 | 0.7045 min (gcloud-compute.com); 0.71 us-central1 (compute.fru.dev); L4 vWS GPU add-on 0.56 (official) | 20+ regions, e.g. us-central1, us-east1, us-west1, europe-west1/4 | **No consumer card.** Datacenter Ada-gen part with ~300 GB/s memory; benchmark as "NVIDIA L4" in its own right. Do not use for 4060 Ti / 4070 / 3090. |
| N1 + 1x T4 (`n1-t4-1` = 8 vCPU/30 GB) | 16 GB GDDR6 | GPU alone 0.35 (official); n1-t4-1 total 0.73 us-central1 (devzero.io). **T4 and P4 reach end of support Aug 1, 2027 (GCP docs).** | many zones | **No consumer card** (Turing, 320 GB/s). Not a 4060 Ti 16GB proxy. Own entry only. |
| `a2-highgpu-1g`: 1x A100 40GB | 40 GB | 3.6734 (official) | us-central1, europe-west4, asia | datacenter only; own entry |
| `a2-ultragpu-1g`: 1x A100 80GB | 80 GB | 5.0688 (official) | us-central1, europe-west4, asia-southeast1 | datacenter only; own entry |
| `a3-highgpu-1g`: 1x H100 80GB | 80 GB | 11.06 min (gcloud-compute.com; official 8-GPU a3-highgpu-8g is 88.49, consistent) | us-central1, europe-west1/4 | datacenter only; own entry |
| A3 Ultra (H200), A4 (B200), A4X | - | 8-GPU nodes only for H200/B200 (official: a3-ultragpu-8g 84.81, a4-highgpu-8g DWS 64.44) | - | not worth it for this project |
**Honest verdicts**
- GCP has **no GeForce, no AMD Radeon and no Apple Silicon**. So GCP can cover none of: 3060 12GB, 4060 Ti 16GB, 4070, 5070, 3090, 4090, 5090, RX 7900 XTX, M-series. L4/T4/A100/H100 results would be real measurements of those datacenter cards but are NOT valid proxies for consumer cards (different bandwidth, clocks, power limit, cache, driver path). Clocking or capping them to imitate consumer cards is not valid.
- The one relevant GCP product is **G4 (RTX PRO 6000 Blackwell Server Edition, 96 GB)** for the `rtx-pro-6000` entry (currently with little or no model-specific data) and as a way to measure 120B-class models fully on GPU.
- Cost of a full G4 pass is small: 25 configs / ~568 GB of downloads; at ~4.50/hr even 3 hours is about $13.5 (my arithmetic on the listed price, plus disk and egress which I did not price).
**Quota / account reality (docs)**
- A **Free Trial billing account cannot add GPUs or request quota increases** (https://docs.cloud.google.com/free/docs/free-cloud-features: "While your billing account is a non-billable Free trial account, you can't ... Add GPUs ... Request a quota increase"). You must upgrade to a paid billing account (you keep unused trial credit until it expires 90 days from signup). So "free GCP access" only works if it is an already-paid account or credits applied to a paid account.
- Quotas needed: for G4/G2/A3 you need only the GPU-model quota (e.g. RTX PRO 6000 GPUs, NVIDIA L4 GPUs) in the region, plus the global "GPUs (all regions)" quota; no CPU quota is required for those families (docs: resource-usage page). New projects have a global GPU quota but typically little per-model quota; "if your project has an established billing history, it will receive quota automatically after you submit the request" (docs), otherwise expect manual review. Request in Console, IAM & Admin, Quotas. I did not test turnaround.
- Spend safety on GCP: create the VM with `gcloud compute instances create ... --max-run-duration=3h --instance-termination-action=DELETE` (documented, https://docs.cloud.google.com/compute/docs/instances/limit-vm-runtime; deletes the VM after the duration). That is a provider-side hard stop independent of our script; also set a billing budget alert (alerts only, they do not stop spend). Persistent disk keeps billing if you stop instead of delete.
- Driver: use a GPU-ready image (Deep Learning VM) or install the NVIDIA driver; the b11658 CUDA 12.8 build needs driver >= 570, and the RTX PRO 6000 (Blackwell) needs CUDA >= 12.8. I did not verify which image ships a recent-enough driver.

## 7. Vendor options (checked 2026-10-15; no accounts created, nothing rented)
Evidence key: P = vendor's own page fetched today; M = vendor's public marketplace API read today; A = aggregator snapshot (gpuhour.com, provider data ~6:25 AM MT) or third-party page (secondary, confirm before renting); "-" = not found/verified.
| Vendor | Consumer GeForce? | AMD Radeon? | Apple? | Prices / evidence | Notes |
|---|---|---|---|---|---|
| **Vast.ai** (marketplace) | 3060 (27 offers), 4060 Ti (5), 4070 (25), 3090, 4090, 5090, 5080, 5070 Ti (A) | docs/pricing page list RX 7900 XTX hosts but "no current offers" at fetch (https://vast.ai/pricing/gpu/RX-7900-XTX) | no | 3060 0.069-0.148, 4060 Ti 0.107-0.162, 4070 0.152-0.176 /hr (A, see section 1) | still the best source for 3060/4060 Ti/4070; unvetted hosts, per-second billing, credits upfront (docs.vast.ai) |
| **Clore.ai** (P2P marketplace) | **3060, 4060 Ti, 4070, 5070 (18 single-GPU offers not rented), 5060 Ti, 3090, 4090, 5090, 5080, 5070 Ti** (M: https://api.clore.ai/v1/marketplace, public GET, 2,782 listings) | no | no | Computed from the API: price field is USD per **day** per listing, so 1x 5070 = $0.125 min / $0.229 median per hr; 4070 0.083/0.125; 3060 0.029/0.060; 4060 Ti 0.075/0.093 (my conversion, consistent with third-party pages listing 5070 at ~$0.20-0.25/hr: gpueconomy.com, aipowered.com) | **Only found source for an RTX 5070 12GB** (what section 1 called unavailable). Caveats: hosts are individuals (RU/UA/etc.), RAM per host varies (some 16 GB), payment in CLORE/BTC/stablecoin per the API fields (not verified for card payment), unvetted, check data-handling/sanctions/compliance before using. Benchmarks contain no secrets, but do not put tokens on these hosts. |
| **SaladCloud** (distributed consumer GPUs, container only) | **5090, 4090, 5080, 4080, 5070 Ti, 4070 Ti, 3090, 5070, 4070, 5060 Ti, 4060 Ti 16GB, 5060, 3060 and others** (P: https://salad.com/pricing/) | one third-party site (computeprices.com) lists RX 7900 XTX on Salad from $0.066/hr; not on Salad's own page, unverified | no | P: 5070 0.080 (Lowest) to 0.165 (High); 4070 0.070-0.150; 4060 Ti 16GB 0.080-0.140; 3060 "from $0.015" (Lowest, portal only). vCPU/RAM included | Container-only (no SSH): run `ghcr.io/ggml-org/llama.cpp` image or our script in a container; need a container with enough RAM for MoE offload (not verified how much Salad allows). Lowest priority can be preempted. VRAM/RAM per node uncontrolled; 3060 class does not say 12 GB vs 8 GB. |
| **RunPod** | 3090, 4090, 5090, 5080, 4070 Ti (A); no 3060/4060/4070/5070 | no | no | P: 3090 0.50, 4090 0.89, 5090 1.19 Secure; community 0.22/0.34/0.69 (https://www.runpod.io/pricing, updated Oct 8, 2026) | good for 3090/4090/5090; also RTX PRO 6000 at ~0.50 community in the A snapshot (not on page) |
| **TensorDock** | 4090, 3090, 5090 (typical 3090 ~0.20, 4090 ~0.35) | no | no | **Own pricing page is stale: "Last Updated: July 24, 2024"** (https://marketplace.tensordock.com/cloud-gpus.html); third-party 2026 pages say 3090 0.20-0.23, 4090 0.35-0.50, 5090 ~0.60 (A) | $5 minimum deposit stated on their page; verify live in the dashboard |
| **Shadeform** (aggregator) | 5090 0.65/hr (A) | no | no | A only | useful to compare, no unique consumer cards |
| **Genesis Cloud** | 3090 0.20, 4090 0.55 (A, computeprices.com; their page: https://www.genesiscloud.com/products/nvidia-rtx-gpus not fetched) | no | no | A | unverified from vendor page |
| **Hyperbolic** | marketplace advertised "from $0.20/GPU-hr"; RTX 4090 no longer shows a published rate (A) | no | no | H100 SXM from 3.19 (A) | low value for us |
| **Hetzner GPU servers** (dedicated, monthly) | **no GeForce**; GEX45 = RTX PRO 4000 Blackwell SFF 24 GB (successor of GEX44 per a third party), GEX63/GEX131 = RTX PRO 6000 Blackwell **Max-Q** 96 GB (P: https://www.hetzner.com/dedicated-rootserver/matrix-gpu/) | no | no | monthly + setup fee; third-party (wz-it.com, servermarket.dev) say GEX131 EUR 1,499/mo + EUR 1,499 setup, GEX45 EUR 214/mo + EUR 209 setup (A, not on the fetched page) | monthly commitment, not worth it for a few hours. Max-Q is a 300 W variant: another distinct device, not the Workstation entry |
| **OVHcloud** | no | no | no | P: L4 $1.00/hr, L40S $1.80, A10 $1.00, A100 80GB $3.07, H100 $2.99, V100S $0.88 (excl. VAT, https://www.ovhcloud.com/en/public-cloud/prices/) | datacenter only |
| **Scaleway GPU** | no | no | no | P: L4-1-24G EUR 0.79/hr (https://www.scaleway.com/en/pricing/gpu/); L40S/H100 PAR-2 only | datacenter only |
| **Scaleway Apple silicon** | - | - | **Mac mini M1 8GB, M2 16GB, M2 Pro 16GB, M4 16/32GB, M4 Pro 64GB** (P: https://www.scaleway.com/en/pricing/apple-silicon/) | EUR 0.11 / 0.17 / 0.21 / 0.22-0.29 / **0.49 per hour** (M4 Pro 64GB; M4-XL EUR 335/mo). Apple licence forces a **24-hour minimum** (vendor page text via search; not re-verified on the pricing page), so a minimum of ~EUR 11.8 for M4 Pro | only way to get hourly Apple silicon; Mac mini M4 Pro (20-core GPU) is a different entry than MacBook Pro/Studio Max/Ultra chips |
| **AWS EC2 Mac** (dedicated hosts) | - | - | **mac2-m2pro, mac-m4, mac-m4pro, mac-m4max, mac-m3ultra, mac2-m1ultra** hosts listed (P: https://aws.amazon.com/ec2/dedicated-hosts/pricing/, "minimum host allocation and billing duration of 24 hours") | us-east-1 per-host-hour, third-party (macyou.co, runs-on.com, DevelopersIO) A: mac-m4 $1.23, **mac-m4max $6.25 (24h minimum = $150), mac-m3ultra $12.50 (min $300)**; m4pro not found | closest way to measure **M4 Max** and M3 Ultra (not M5 Ultra). Memory/GPU-core configs fixed by AWS: check they match hardware.json variants (M4 Max 32 vs 40 GPU cores). Needs AWS account + Mac dedicated host quota |
| **MacStadium** | - | - | Mac minis M2/M4/M4 Pro, **Mac Studio M1 Max 64GB $249/mo, M2 Ultra 64GB $369, 128GB $449** (P: https://macstadium.com/pricing, monthly; M5/M6 "talk to sales") | monthly | no M3 Ultra/M4 Max/M5 on the page; month-long commitment |
| **Lambda** | no (A10, A6000, V100, A100, H100, GH200, B200) | no | no | P: https://lambda.ai/pricing e.g. A10 24GB $1.29, A6000 $1.09, H100 SXM $3.99 /GPU-hr | datacenter only |
| **Verda (DataCrunch)**, **Massed Compute**, **Latitude.sh**, **DigitalOcean (Paperspace)**, **CoreWeave**, **Akash**, **io.net**, **Koyeb**, **Prime Intellect** | datacenter parts only in the A snapshot (RTX 6000 Ada, L40/L40S, RTX PRO 6000 Blackwell, A4000/4000 Ada); Akash lists 3060/3090/4090 (decentralized, unvetted) | no | no | A: RTX PRO 6000 Blackwell on Vast 1.14, RunPod 0.50 community, Massed 2.19, Shadeform 2.19, Verda 2.30, Akash 1.44; Latitude.sh, DO, CoreWeave not checked | only relevant for the RTX PRO 6000 entry (and Akash for consumer cards, not recommended) |
| **AMD Radeon RX 7900 XTX** | - | DEGIMA lists RX 7900 XTX ~$0.31/hr with ROCm and SSH (A, web search snippet, https://degima.ai/, not verified), RentGPUPower ~$0.28/hr (A) | - | A only | only lead for the 7900 XTX; unverified small vendors. No big cloud found |
**Recommended order**
1. **Vast.ai**: 3060 12GB, 4060 Ti 16GB, 4070 (cheapest and what section 3 costs); also 3090/4090/5090 for sanity. Run the three small cards first.
2. **Clore.ai or SaladCloud for the RTX 5070 12GB** (and a second opinion on 4070/4060 Ti). Salad's prices are published and containers are simple, but RAM limits for MoE offload must be checked; Clore has a RAM spec per listing (filter >= 32 GB, ideally US/EU).
3. **GCP G4 `g4-standard-48` for the `rtx-pro-6000` entry** (~$4.50/hr, ~3 h) if Matt's account is paid and the RTX PRO 6000 quota is granted; use `--max-run-duration=3h --instance-termination-action=DELETE`. Optionally an L4 (g2-standard-4, ~$0.71/hr) and A100/H100 as separate "datacenter" entries; they must never be shown as consumer-card data.
4. **RunPod** (3090/4090/5090) only if Vast has no suitable host that day.
5. **Apple**: Scaleway Mac mini M4 Pro 64GB (EUR 0.49/hr, 24 h min) and AWS mac-m4max ($6.25/hr, 24 h min = $150) are the realistic hourly options; defer until the site's Apple traffic justifies the cost, otherwise rely on the submit page.
6. **RX 7900 XTX**: try DEGIMA/RentGPUPower only after verifying them; otherwise submit page / borrow a card.
Not worth it: Hetzner (monthly), OVH/Scaleway GPU/Lambda (datacenter only), Hyperbolic, CoreWeave, Akash.
