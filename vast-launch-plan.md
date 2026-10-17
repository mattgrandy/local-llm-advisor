# Vast.ai launch plan (NOT executed; nothing rented) - prepared 2026-10-15 ~10 PM MT

## 0. Account state (GET /api/v0/users/current/, read-only)
- Key works. credit = $10.00, balance = 0, total_spend = $0.00, email verified.
- No card on file (has_billing=false), autobill_amount/threshold = null => **no auto top-up**. Spend is hard-capped by the $10 credit.
- Per docs: when credit hits 0 instances are stopped; with no saved payment method instances AND data are scheduled for deletion. Storage bills until the instance is DESTROYED.
- No SSH key registered on the account yet (ssh_key = null). Must add one before renting (docs: register keys before create).
- Key is stored only in env VAST_API_KEY; never print it.

## 1. Pricing model (from live search results + docs.vast.ai)
- Offer `dph_base` = GPU $/hr. `dph_total` in search = dph_base + storage for the default 8 GB disk.
- Storage $/hr for our disk = storage_cost ($/GB/month) * DISK_GB / 720 (my conversion; 30-day month assumed). We allocate 300 GB (`disk` is fixed at creation).
- Bandwidth billed per byte at host rate: `internet_down_cost_per_tb` (field in search). Downloads (HF) count as inbound.
- Offer IDs change often (re-listed when machines are rented/relisted): ALWAYS re-run the search just before renting.

## 2. Search that was run (read-only POST https://console.vast.ai/api/v0/bundles/)
```bash
curl -s -X POST https://console.vast.ai/api/v0/bundles/ \
  -H "Authorization: Bearer $VAST_API_KEY" -H "Content-Type: application/json" -d '{
  "limit":500,"type":"ondemand","verified":{"eq":true},"rentable":{"eq":true},"rented":{"eq":false},
  "num_gpus":{"eq":1},"gpu_name":{"eq":"RTX 3060"},            
  "geolocation":{"in":["US","CA","DE","FR","NL","GB","IT","ES","PL","SE","FI","NO","DK","CH","AT","BE","IE","CZ","RO","HU","PT"]},
  "cpu_ram":{"gte":32000},"disk_space":{"gte":300},"reliability":{"gte":0.97},"cuda_max_good":{"gte":12.8},
  "order":[["dph_total","asc"]]}'
```
- gpu_name uses a SPACE form ("RTX 3060", "RTX 4060 Ti", "RTX 4070", "RTX 5070"); "RTX_3060" returns nothing. VRAM split: 4060 Ti = 16380 MB (16GB) vs 8188 MB (8GB) variant. "RTX 4070S" (Super) is a different card and was excluded.
- `cuda_max_good >= 12.8` added because our prebuilt llama.cpp is CUDA 12.8 (driver >= 570; Blackwell needs it). Offers with 12.4 / 12.7 were dropped.
- Docs: inet_down/inet_up units are described as MB/s in the API doc, but values (e.g. 900-2000) look like Mbit/s; I treat them as Mbit/s and unverified. Download time column below assumes Mbit/s.

## 3. Shortlist (strict filters; costs computed with 300 GB disk)
Run cost = (GPU+storage $/hr) x (plan hours + 0.25 h setup) + bandwidth for the plan's download GB. Plan hours/GB are the *assumed* "likely" values in benchmark-sweep-plan.md (3060 2.2h/113GB, 4060 Ti 2.0h/138GB, 4070 1.6h/113GB; 5070 uses the 4070 numbers as a stand-in, 1.6h/113GB - my assumption). Excludes host-quirks I could not verify. "BW/200GB" = bandwidth cost for 200 GB inbound.
See table in the chat report; raw data: <workdir>/vast/offers.json (re-create with <workdir>/vast/q.py).

| GPU | Offer ID | CPU | RAM GB | Disk GB | Down/Up Mbps* | Country | GPU $/hr | Storage $/hr (300GB) | Total $/hr | BW $/TB down | BW per 200GB | Reliab. | Est. run cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RTX 3060 12GB | 56128590 | AMD Ryzen Threadripper 192 | 31 | 772 | 2188/2081 | US | 0.093 | 0.111 | 0.204 | 2.67 | $0.53 | 0.983 | $0.80 |
| RTX 3060 12GB | 53839880 | Xeon® Platinum 8272L | 1487 | 3282 | 1330/1623 | CA | 0.667 | 0.056 | 0.722 | 4.00 | $0.80 | 0.994 | $2.22 |
| RTX 3060 12GB | 54436371 | Xeon® E5-2680 v4 | 63 | 354 | 840/445 | NO | 0.093 | 0.083 | 0.177 | 20.00 | $4.00 | 0.998 | $2.69 |
| RTX 4060 Ti 16GB | 47588722 | AMD EPYC 7J13 64-Core Proc | 126 | 570 | 919/852 | NO | 0.200 | 0.072 | 0.272 | 9.33 | $1.87 | 0.992 | $1.90 |
| RTX 4060 Ti 16GB | 54048010 | AMD EPYC 7K62 48-Core Proc | 126 | 618 | 1300/70 | GB | 0.147 | 0.083 | 0.230 | 13.33 | $2.67 | 0.997 | $2.36 |
| RTX 4060 Ti 16GB | 54228378 | AMD Ryzen 7 5800XT 8-Core  | 31 | 1596 | 1558/1010 | US | 0.200 | 0.139 | 0.339 | 13.33 | $2.67 | 0.996 | $2.60 |
| RTX 4070 12GB | 54968174 | AMD Ryzen 9 3950X 16-Core  | 63 | 809 | 742/285 | US | 0.400 | 0.083 | 0.483 | 13.33 | $2.67 | 0.999 | $2.40 |
| RTX 5070 12GB | 54313979 | AMD Ryzen 7 5800XT 8-Core  | 63 | 759 | 965/657 | US | 0.267 | 0.083 | 0.350 | 2.00 | $0.40 | 0.997 | $0.87 |
| RTX 4060 Ti 8GB | 55783771 | 12th Gen Core™ i9-12900 | 63 | 739 | 884/874 | US | 0.187 | 0.139 | 0.326 | 10.67 | $2.13 | 0.998 | $1.64 |

*units uncertain (see section 2). Est. run cost uses ASSUMED hours/GB from the sweep plan; real cost will vary. Ports: all shortlisted have direct_port_count >= 12 (SSH direct). RTX 4060 8GB (non-Ti): 0 offers meeting filters (1 offer exists but only 16GB RAM/29GB disk). Only 1 strict offer each for 4070, 5070, 4060 Ti 8GB.

## 4. Image / launch mode (docs.vast.ai)
- Recommended: `vastai/base-image:cuda-12.8.1-auto` (tag exists on Docker Hub, updated 2026-09-07; also devel variants e.g. `cuda-12.8.1-cudnn-devel-ubuntu24.04-py312-2026-09-07`). It has curl, python3, ssh, Instance Portal, and the /etc/environment export of env vars. Our run_sweep.sh downloads the PRE-BUILT llama.cpp b11658 CUDA 12.8 tarball (URL checked: HTTP 200) so no nvcc/compile is needed. Alternative: `nvidia/cuda:12.8.1-runtime-ubuntu22.04` (tag exists) but it lacks python3/curl/ssh; use only with runtype args and apt install first.
- Launch mode: `runtype: ssh_direct` (Vast replaces image entrypoint, onstart runs after init). `args` runtype has no SSH, avoid.
- Host must have >=12.8 CUDA support (filter above) - Blackwell (5070) requires it.
- Env vars set in `env` are NOT visible in SSH sessions unless `env >> /etc/environment` (vastai images do this automatically).
- Predefined in container: CONTAINER_ID, CONTAINER_API_KEY (per-instance key; can run `vastai destroy instance $CONTAINER_ID --api-key $CONTAINER_API_KEY` from inside). Needs the vastai CLI: `curl -fsSL https://vast.ai/install.sh | bash` (or `pip install vastai`).
- onstart is limited to 4048 chars: onstart only fetches/starts the sweep; the tools/sweep folder is delivered via a tarball over scp, or from the public repo.

## 5. Safety design
1. Hard wall-clock: run_sweep.sh --max-hours 3 (default) + built-in watchdog + on-finish.
2. `--on-finish vast-destroy` (expands to `vastai destroy instance "$CONTAINER_ID" --api-key "$CONTAINER_API_KEY"`; marked UNVERIFIED in run_sweep.sh - test it).  **Destroy deletes the disk and the results**, so results must be copied off first: use --upload-cmd (scp to a reachable host is not possible from the instance to the box unless the box accepts SSH; practical option: the sweep writes sweep_out.tgz and we pull it by scp, then destroy ourselves). Default plan therefore: use `--on-finish ""` (none) + our own poll-and-destroy loop (section 7); add a *backstop*: `--on-finish "vastai stop instance $CONTAINER_ID --api-key $CONTAINER_API_KEY"` (stop keeps data but storage still bills, tiny) - or a second timer `sleep 4h && vastai destroy ...` started in onstart as last-resort.
2. Budget: credit is only $10, no card => cannot overspend.
3. No tokens on the host except CONTAINER_API_KEY (auto) and optionally HF_TOKEN (read-only).

## 6. Exact commands (to be run ONLY after Matt approves renting)
```bash
# 6.0 prerequisites (Matt/you): register SSH public key in Vast account (cloud.vast.ai > Account > SSH Keys)
#   or: curl -X POST https://console.vast.ai/api/v0/ssh/ -H "Authorization: Bearer $VAST_API_KEY" -H 'Content-Type: application/json' -d '{"ssh_key":"<pubkey>"}'   # (account change; needs OK)
# 6.1 re-search (section 2) and pick OFFER_ID. Example for target 3060:
OFFER_ID=<fresh id>; GPU_LABEL=rtx3060
# 6.2 create (this spends money)
curl -s -X PUT "https://console.vast.ai/api/v0/asks/$OFFER_ID/" \
  -H "Authorization: Bearer $VAST_API_KEY" -H "Content-Type: application/json" -d '{
  "image":"vastai/base-image:cuda-12.8.1-auto","label":"llm-advisor-sweep-'"$GPU_LABEL"'",
  "disk":300,"runtype":"ssh_direct","cancel_unavail":true,
  "env":{"HF_HUB_ENABLE_HF_TRANSFER":"0"},
  "onstart":"env >> /etc/environment; mkdir -p /workspace; touch <workdir>/READY"}'
# -> {"new_contract": <INSTANCE_ID>}  (note: new_contract, not id)
# 6.3 poll until actual_status == running (if exited/unknown/offline: destroy + retry another offer)
curl -s -H "Authorization: Bearer $VAST_API_KEY" https://console.vast.ai/api/v0/instances/$INSTANCE_ID/ | python3 -c 'import json,sys;i=json.load(sys.stdin)["instances"];print(i["actual_status"],i.get("ssh_host"),i.get("ssh_port"))'
# 6.4 copy tools and start the sweep detached
tar czf /tmp/sweep.tgz -C <workdir>/llm-advisor/tools sweep
scp -P $SSH_PORT /tmp/sweep.tgz root@$SSH_HOST:<workdir>/
ssh -p $SSH_PORT root@$SSH_HOST 'cd /workspace && tar xzf sweep.tgz && cd sweep && ./run_sweep.sh --dry-run'   # sanity
ssh -p $SSH_PORT root@$SSH_HOST 'cd <workdir>/sweep && nohup ./run_sweep.sh -y --max-hours 3 --provider vast.ai --out <workdir>/sweep_out --work <workdir>/sweep_work > <workdir>/sweep.log 2>&1 &'
# 6.5 monitor
ssh -p $SSH_PORT root@$SSH_HOST 'tail -n 20 <workdir>/sweep.log'
# 6.6 fetch results, then DESTROY (stops all billing)
scp -P $SSH_PORT root@$SSH_HOST:<workdir>/sweep_out.tgz <workdir>/llm-advisor/data/sweep/$GPU_LABEL.tgz
curl -s -X DELETE -H "Authorization: Bearer $VAST_API_KEY" https://console.vast.ai/api/v0/instances/$INSTANCE_ID/
# 6.7 ingest: python3 tools/sweep/ingest_sweep.py <tgz>   (see tools/sweep README/section 5 of the sweep plan)
```
Backstop inside the box (optional, add to onstart; needs vastai CLI): `nohup bash -c 'sleep 14400; pip install -q vastai; vastai destroy instance $CONTAINER_ID --api-key $CONTAINER_API_KEY' &`
