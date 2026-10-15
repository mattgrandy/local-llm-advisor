#!/usr/bin/env bash
# run_sweep.sh - vendor-agnostic llama-bench sweep for the Local LLM Advisor. Linux + NVIDIA driver (+ internet).
# Copy the whole tools/sweep/ folder to the GPU box (it is self-contained: sweep_catalog.json is included) and run:
#   ./run_sweep.sh --dry-run                      # show everything it WOULD do, no downloads/installs
#   ./run_sweep.sh --max-hours 3 --on-finish poweroff
# Results land in $OUT (default ./sweep_out) and are tarred to $OUT.tgz; resumable (re-run the same command).
#
# SPEND SAFETY (read this): a hard wall-clock limit (--max-hours, default 3) stops the sweep, writes the tarball,
# runs --upload-cmd, then runs --on-finish. A second watchdog runs --on-finish even if the main script hangs.
# Per-command timeouts and a consecutive-failure abort exist too. --on-finish is NOT a substitute for setting a
# budget/spending cap in the provider console and for destroying the instance yourself afterwards.
#
# Flags used (verified against ggml-org/llama.cpp tools/llama-bench/llama-bench.cpp @ b11658, 2026-10-15):
#   -m -p -n -d -r -ngl -fa (accepts 1/0/on/off/auto) --n-cpu-moe/-ncmoe -o jsonl --list-devices --delay
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLAMA_BUILD="${LLAMA_BUILD:-b11658}"           # pinned llama.cpp release tag (commit 3e4dfa8f39f9, published 2026-10-15)
LLAMA_CUDA="${LLAMA_CUDA:-12.8}"               # 12.8 (driver >= 570, supports Blackwell) | 13.4 (driver >= 580) | source
OUT="${OUT:-$PWD/sweep_out}"
WORK="${WORK:-$PWD/sweep_work}"
MAX_HOURS="${MAX_HOURS:-3}"
REPS="${REPS:-3}"
PROMPT_N=512
GEN_N=128
DEPTHS="0,4096,16384"
MOE_DEPTHS_REST="4096,16384"
RUN_TIMEOUT="${RUN_TIMEOUT:-2700}"            # seconds per llama-bench invocation
DL_TIMEOUT="${DL_TIMEOUT:-5400}"              # seconds per model download
MAX_CONSEC_FAIL="${MAX_CONSEC_FAIL:-4}"
DRY_RUN=0; KEEP_MODELS=0; ONLY=""; HW_ID_OVERRIDE=""; ON_FINISH=""; UPLOAD_CMD=""; PROVIDER="${PROVIDER:-unknown}"
FAKE_GPU="${FAKE_GPU:-}"                      # dry-run testing: "NVIDIA GeForce RTX 4070:12282:32:200" = name:MiB:RAM_GiB:disk_GiB
RETRY_FAILED=1; ASSUME_YES=0

usage() { sed -n '2,16p' "$0"; cat <<'U'

Options:
  --dry-run              print detected hardware, plan, and every command; change nothing
  --max-hours H          hard wall-clock limit (default 3)
  --out DIR / --work DIR results dir / model scratch dir (needs ~ largest model + 5 GB free; models deleted after use)
  --only REGEX           only configs whose "<model_id> <quant>" matches REGEX (e.g. 'gpt-oss|Qwen3.5')
  --hw-id ID             force hardware.json id for ingest (e.g. rtx-4060ti-16); default: auto-mapped from GPU name
  --provider NAME        free text recorded in meta.json (e.g. gcp-g2-l4, vast.ai)
  --on-finish CMD|preset run when finished/timed out. Presets: poweroff | gcp-stop | gcp-delete | runpod-remove | vast-destroy
                         (presets other than poweroff are best-effort and UNVERIFIED; test them on your provider first)
  --upload-cmd CMD       run after the tarball is written; {TARBALL} is replaced by its path (e.g. 'gsutil cp {TARBALL} gs://bkt/')
  --keep-models          do not delete GGUFs after each model
  --no-retry-failed      do not retry configs that failed in an earlier run
  --reps N               llama-bench -r (default 3)
  -y|--yes               do not prompt before installing/downloading (non-interactive boxes should pass this)
Env: LLAMA_BUILD, LLAMA_CUDA, OUT, WORK, MAX_HOURS, HF_TOKEN (optional, higher HF rate limits), FAKE_GPU (dry-run test)
U
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1;;
    --max-hours) MAX_HOURS="$2"; shift;;
    --out) OUT="$2"; shift;;
    --work) WORK="$2"; shift;;
    --only) ONLY="$2"; shift;;
    --hw-id) HW_ID_OVERRIDE="$2"; shift;;
    --provider) PROVIDER="$2"; shift;;
    --on-finish) ON_FINISH="$2"; shift;;
    --upload-cmd) UPLOAD_CMD="$2"; shift;;
    --keep-models) KEEP_MODELS=1;;
    --no-retry-failed) RETRY_FAILED=0;;
    --reps) REPS="$2"; shift;;
    -y|--yes) ASSUME_YES=1;;
    -h|--help) usage; exit 0;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2;;
  esac
  shift
done

START_TS=$(date +%s)
DEADLINE=$(( START_TS + $(awk -v h="$MAX_HOURS" 'BEGIN{printf "%d", h*3600}') ))
mkdir -p "$OUT"/{raw,logs,done,failed}
LOG="$OUT/sweep.log"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG" >&2; }
run() { # run a command, or just print it in dry-run
  if [ "$DRY_RUN" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}
time_left() { echo $(( DEADLINE - $(date +%s) )); }

# ---------------------------------------------------------------- hardware detection
detect_hw() {
  if [ -n "$FAKE_GPU" ]; then
    IFS=: read -r GPU_NAME GPU_MIB RAM_GIB DISK_GIB <<<"$FAKE_GPU"
    DRIVER="fake"; GPU_COUNT=1
  else
    command -v nvidia-smi >/dev/null || { echo "nvidia-smi not found: need an NVIDIA driver" >&2; exit 3; }
    GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l)
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1 | sed 's/^ *//;s/ *$//')
    GPU_MIB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | tr -d ' ')
    DRIVER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 | tr -d ' ')
    RAM_GIB=$(awk '/MemTotal/{printf "%d", $2/1048576}' /proc/meminfo)
    mkdir -p "$WORK"; DISK_GIB=$(df -BG --output=avail "$WORK" | tail -1 | tr -dc '0-9')
  fi
  VRAM_GIB=$(awk -v m="$GPU_MIB" 'BEGIN{printf "%.2f", m/1024}')
  export CUDA_VISIBLE_DEVICES=0         # benchmark ONE card; multi-GPU rows would not be hw-matched anyway
}

# ---------------------------------------------------------------- llama.cpp install (pinned)
LLAMA_DIR="$WORK/llama-$LLAMA_BUILD-cuda$LLAMA_CUDA"
install_llama() {
  if [ -x "$LLAMA_DIR/llama-bench" ]; then log "llama.cpp $LLAMA_BUILD already installed at $LLAMA_DIR"; return; fi
  local base="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_BUILD"
  if [ "$LLAMA_CUDA" = "source" ]; then
    log "building llama.cpp $LLAMA_BUILD from source (needs cmake, git, CUDA toolkit with nvcc)"
    run git clone --depth 1 --branch "$LLAMA_BUILD" https://github.com/ggml-org/llama.cpp "$WORK/llama.cpp-src"
    run cmake -S "$WORK/llama.cpp-src" -B "$WORK/llama.cpp-src/build" -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON
    run cmake --build "$WORK/llama.cpp-src/build" -j"$(nproc)" --target llama-bench
    run mkdir -p "$LLAMA_DIR"; run cp -a "$WORK/llama.cpp-src/build/bin/." "$LLAMA_DIR/"
    return
  fi
  local tar="llama-$LLAMA_BUILD-bin-ubuntu-cuda-$LLAMA_CUDA-x64.tar.gz"
  local rt="cudart-llama-$LLAMA_BUILD-bin-ubuntu-cuda-$LLAMA_CUDA-x64.tar.gz"
  log "installing prebuilt llama.cpp $LLAMA_BUILD (CUDA $LLAMA_CUDA) from $base"
  run mkdir -p "$LLAMA_DIR" "$WORK/dl"
  run curl -fL --retry 3 -o "$WORK/dl/$tar" "$base/$tar"
  run tar xzf "$WORK/dl/$tar" -C "$LLAMA_DIR" --strip-components=1
  # cudart bundle = CUDA runtime/cuBLAS libs, only needed when the box has no CUDA toolkit; harmless otherwise
  if ! ldconfig -p 2>/dev/null | grep -q 'libcudart.so.12' || [ "$LLAMA_CUDA" != "12.8" ]; then
    run curl -fL --retry 3 -o "$WORK/dl/$rt" "$base/$rt"
    run tar xzf "$WORK/dl/$rt" -C "$LLAMA_DIR" --strip-components=1
  fi
  run rm -f "$WORK/dl/$tar" "$WORK/dl/$rt"
}

find_hf() {
  HF_BIN=""
  local c
  for c in "$WORK/venv/bin/hf" "$(command -v hf || true)" "$WORK/venv/bin/huggingface-cli" "$(command -v huggingface-cli || true)" "$HOME/.local/bin/hf"; do
    if [ -n "$c" ] && [ -x "$c" ]; then HF_BIN="$c"; return 0; fi
  done
  return 1
}
setup_python() {
  PY=python3
  HF_BIN="hf"
  [ "$DRY_RUN" = 1 ] && return
  command -v python3 >/dev/null || { echo "python3 required" >&2; exit 3; }
  if ! find_hf; then
    log "installing huggingface_hub into $WORK/venv"
    if python3 -m venv "$WORK/venv" 2>/dev/null; then
      "$WORK/venv/bin/python" -m pip install -q 'huggingface_hub>=0.30'
    else
      python3 -m pip install -q --user --break-system-packages 'huggingface_hub>=0.30' || python3 -m pip install -q --user 'huggingface_hub>=0.30'
    fi
    find_hf || { echo "could not install the hf CLI" >&2; exit 3; }
  fi
  [ -x "$WORK/venv/bin/python" ] && PY="$WORK/venv/bin/python"
  log "hf CLI: $HF_BIN"
}

# ---------------------------------------------------------------- logging of environment
snapshot_env() {
  [ "$DRY_RUN" = 1 ] && return
  {
    echo "== date"; date -u +%FT%TZ
    echo "== nvidia-smi"; nvidia-smi
    echo "== nvidia-smi -q"; nvidia-smi -q
    echo "== lscpu"; lscpu
    echo "== meminfo"; head -3 /proc/meminfo
    echo "== os"; cat /etc/os-release 2>/dev/null | head -4; uname -a
    echo "== llama-bench devices"; "$LLAMA_DIR/llama-bench" --list-devices 2>&1 || true
  } > "$OUT/env.txt" 2>&1 || true
  local build_line
  build_line=$("$LLAMA_DIR/llama-bench" --version 2>&1 | tr '\n' ' ' || true)
  local gpu_extra
  gpu_extra=$(nvidia-smi --query-gpu=power.limit,power.max_limit,clocks.max.sm,clocks.max.mem,pci.bus_id,vbios_version --format=csv,noheader | head -1 || true)
  GPU_NAME="$GPU_NAME" GPU_MIB="$GPU_MIB" DRIVER="$DRIVER" RAM_GIB="$RAM_GIB" GPU_COUNT="$GPU_COUNT" PROVIDER="$PROVIDER" \
  LLAMA_BUILD="$LLAMA_BUILD" LLAMA_CUDA="$LLAMA_CUDA" HW_ID="$HW_ID_OVERRIDE" BUILD_LINE="$build_line" GPU_EXTRA="$gpu_extra" REPS="$REPS" \
  HOST="$(hostname)" CPU="$(lscpu | awk -F: '/Model name/{gsub(/^ +/,"",$2);print $2;exit}')" "$PY" - "$OUT/meta.json" <<'PYEOF'
import json, os, sys, datetime
e = os.environ
json.dump({
  'gpu_name': e['GPU_NAME'], 'gpu_mib': int(float(e['GPU_MIB'])), 'gpu_count_on_box': int(e['GPU_COUNT']), 'driver': e['DRIVER'],
  'ram_gib': int(e['RAM_GIB']), 'cpu': e['CPU'], 'provider': e['PROVIDER'], 'hw_id_override': e['HW_ID'] or None,
  'llama_build_tag': e['LLAMA_BUILD'], 'llama_cuda': e['LLAMA_CUDA'], 'llama_version_output': e['BUILD_LINE'],
  'gpu_extra_power_limit_maxpower_maxclk_sm_mem_bus_vbios': e['GPU_EXTRA'], 'reps': int(e['REPS']),
  'started_utc': datetime.datetime.utcnow().isoformat() + 'Z', 'hostname_hash': __import__('hashlib').sha256(e['HOST'].encode()).hexdigest()[:10],
}, open(sys.argv[1], 'w'), indent=1)
PYEOF
}
MON_PID=""
start_monitor() {
  [ "$DRY_RUN" = 1 ] && return
  nvidia-smi --query-gpu=timestamp,clocks.sm,clocks.mem,power.draw,temperature.gpu,utilization.gpu,memory.used,clocks_throttle_reasons.active --format=csv -l 5 -i 0 >> "$OUT/gpu_monitor.csv" 2>/dev/null &
  MON_PID=$!
}

# ---------------------------------------------------------------- finish / safety
FINISHED=0
finalize() {
  [ "$FINISHED" = 1 ] && return; FINISHED=1
  trap - EXIT TERM INT
  [ -n "$MON_PID" ] && kill "$MON_PID" 2>/dev/null || true
  if [ -n "${WATCHDOG_PID:-}" ]; then pkill -P "$WATCHDOG_PID" 2>/dev/null || true; kill "$WATCHDOG_PID" 2>/dev/null || true; fi
  pkill -P $$ 2>/dev/null || true
  if [ "$DRY_RUN" = 1 ]; then return; fi
  log "finalizing: $(find "$OUT/done" -type f | wc -l) configs done, $(find "$OUT/failed" -type f | wc -l) failed"
  [ -x "$LLAMA_DIR/llama-bench" ] && "$PY" "$SCRIPT_DIR/ingest_sweep.py" --flat-csv "$OUT" >>"$LOG" 2>&1 || true
  tar czf "$OUT.tgz" -C "$(dirname "$OUT")" "$(basename "$OUT")" 2>>"$LOG" || true
  log "results tarball: $OUT.tgz ($(du -h "$OUT.tgz" 2>/dev/null | cut -f1))"
  if [ -n "$UPLOAD_CMD" ]; then log "upload: ${UPLOAD_CMD//\{TARBALL\}/$OUT.tgz}"; bash -c "${UPLOAD_CMD//\{TARBALL\}/$OUT.tgz}" >>"$LOG" 2>&1 || log "UPLOAD FAILED - copy $OUT.tgz manually BEFORE destroying the box"; fi
  on_finish_cmd
}
on_finish_cmd() {
  local c="$ON_FINISH"
  # shellcheck disable=SC2016  # presets are intentionally single-quoted: expanded by the child bash -c
  case "$c" in
    "") log "no --on-finish given: instance keeps running (and billing). Copy $OUT.tgz off the box and destroy it."; return;;
    poweroff) c="sudo poweroff || poweroff";;
    gcp-stop) c='n=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/name); z=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/zone); gcloud compute instances stop "$n" --zone "${z##*/}" --quiet';;
    gcp-delete) c='n=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/name); z=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/zone); gcloud compute instances delete "$n" --zone "${z##*/}" --quiet';;
    runpod-remove) c='runpodctl remove pod "$RUNPOD_POD_ID"';;
    vast-destroy) c='vastai destroy instance "$CONTAINER_ID" --api-key "$CONTAINER_API_KEY"';;
  esac
  log "on-finish: $c"
  bash -c "$c" >>"$LOG" 2>&1 || log "ON-FINISH COMMAND FAILED - destroy/stop the instance manually NOW"
}
FAILS=0
abort_if_late() {
  if [ "$(time_left)" -le 0 ]; then log "DEADLINE reached (--max-hours $MAX_HOURS): stopping"; exit 4; fi
}
start_watchdog() {
  [ "$DRY_RUN" = 1 ] && return
  local mainpid=$$
  (
    sleep $(( DEADLINE - $(date +%s) + 30 ))
    kill -TERM "$mainpid" 2>/dev/null || exit 0
    sleep 900                                  # main script gets 15 min to tar/upload/run on-finish
    if kill -0 "$mainpid" 2>/dev/null; then
      kill -KILL "$mainpid" 2>/dev/null; sleep 2
      echo "$(date -u +%FT%TZ) WATCHDOG: main script hung, running on-finish directly" >>"$LOG"
      on_finish_cmd
    fi
  ) &
  WATCHDOG_PID=$!
}

# ---------------------------------------------------------------- one config
bench() { # bench <outfile> <logfile> <model> <extra llama-bench args...>
  local outf="$1" logf="$2" model="$3"; shift 3
  local t=$RUN_TIMEOUT left; left=$(time_left); [ "$left" -lt "$t" ] && t=$(( left > 60 ? left : 60 ))
  LD_LIBRARY_PATH="$LLAMA_DIR:${LD_LIBRARY_PATH:-}" timeout --signal=TERM --kill-after=30 "$t" \
    "$LLAMA_DIR/llama-bench" -m "$model" -ngl 99 -fa 1 -p "$PROMPT_N" -n "$GEN_N" -r "$REPS" --delay 2 -o jsonl "$@" \
    >>"$outf" 2>>"$logf"
}
cid() { echo "$1" | tr '/ ' '__' | tr -cd 'A-Za-z0-9_.-'; }

run_config() {
  local model_id="$1" repo="$2" quant="$3" mode="$4" fracs="$5" first_file="$6" include="$7" total_bytes="$8"
  local id; id="$(cid "$model_id")__$quant"
  local logf="$OUT/logs/$id.log" mpath="$WORK/models/$repo/$first_file"
  if [ -e "$OUT/done/$id" ]; then log "SKIP (done) $id"; return; fi
  if [ -e "$OUT/failed/$id" ] && [ "$RETRY_FAILED" = 0 ]; then log "SKIP (failed earlier) $id"; return; fi
  rm -f "$OUT/failed/$id"
  log "== $id mode=$mode size=$(awk -v b="$total_bytes" 'BEGIN{printf "%.1f", b/1e9}')GB  (time left $(( $(time_left) / 60 )) min)"
  if [ "$DRY_RUN" = 1 ]; then
    echo "  [dry-run] $HF_BIN download $repo --include '$include' --local-dir $WORK/models/$repo"
    if [ "$mode" = gpu ]; then
      echo "  [dry-run] llama-bench -m $mpath -ngl 99 -fa 1 -p $PROMPT_N -n $GEN_N -d $DEPTHS -r $REPS --delay 2 -o jsonl"
    else
      echo "  [dry-run] n_layers=<read from GGUF header>; for each n in fractions($fracs): llama-bench -m $mpath -ngl 99 --n-cpu-moe n -fa 1 -p $PROMPT_N -n $GEN_N -d 0 -r $REPS -o jsonl"
      echo "  [dry-run] then best n at -d $MOE_DEPTHS_REST"
    fi
    return
  fi
  abort_if_late
  # download (own timeout; HF_TOKEN env is picked up automatically)
  if [ ! -f "$mpath" ]; then
    if ! timeout --signal=TERM --kill-after=30 "$DL_TIMEOUT" "$HF_BIN" download "$repo" --include "$include" --local-dir "$WORK/models/$repo" >>"$logf" 2>&1 || [ ! -f "$mpath" ]; then
      log "FAIL download $id"; echo "download" > "$OUT/failed/$id"; FAILS=$((FAILS+1)); return
    fi
  fi
  : > "$OUT/raw/$id.jsonl"
  local ok=1
  if [ "$mode" = gpu ]; then
    bench "$OUT/raw/$id.jsonl" "$logf" "$mpath" -d "$DEPTHS" || ok=0
  else
    local nl; nl=$("$PY" "$SCRIPT_DIR/gguf_blocks.py" "$mpath" 2>>"$logf") || { log "FAIL cannot read block_count $id"; ok=0; nl=""; }
    if [ -n "$nl" ]; then
      local counts; counts=$("$PY" "$SCRIPT_DIR/gguf_blocks.py" --fracs "$nl" "$fracs")
      log "   n_layers=$nl; --n-cpu-moe sweep: $counts"
      local n
      for n in $counts; do
        abort_if_late
        bench "$OUT/raw/$id.jsonl" "$logf" "$mpath" --n-cpu-moe "$n" -d 0 || log "   (n-cpu-moe=$n failed: likely OOM, continuing)"
      done
      local best; best=$("$PY" "$SCRIPT_DIR/best_ncmoe.py" "$OUT/raw/$id.jsonl") || { ok=0; best=""; }
      if [ -n "$best" ]; then
        log "   best --n-cpu-moe=$best; running depths $MOE_DEPTHS_REST"
        bench "$OUT/raw/$id.jsonl" "$logf" "$mpath" --n-cpu-moe "$best" -d "$MOE_DEPTHS_REST" || ok=0
      fi
    fi
  fi
  if [ "$ok" = 1 ] && [ -s "$OUT/raw/$id.jsonl" ]; then
    : > "$OUT/done/$id"; FAILS=0; log "   ok: $(grep -c '^{' "$OUT/raw/$id.jsonl") result rows"
  else
    echo "bench" > "$OUT/failed/$id"; FAILS=$((FAILS+1)); log "FAIL bench $id (see $logf)"
  fi
  if [ "$KEEP_MODELS" = 0 ]; then rm -rf "$WORK/models/$repo"; fi   # one model at a time keeps disk small
  [ "$FAILS" -ge "$MAX_CONSEC_FAIL" ] && { log "ABORT: $FAILS consecutive failures (spend safety)"; exit 5; }
  return 0
}

# ---------------------------------------------------------------- main
detect_hw
log "sweep start: GPU='$GPU_NAME' x$GPU_COUNT (benchmarking GPU 0) VRAM=${VRAM_GIB}GiB RAM=${RAM_GIB}GiB disk_free=${DISK_GIB}GiB driver=$DRIVER llama.cpp=$LLAMA_BUILD/cuda$LLAMA_CUDA max_hours=$MAX_HOURS dry_run=$DRY_RUN"
[ "$GPU_COUNT" -gt 1 ] && log "NOTE: $GPU_COUNT GPUs; only GPU 0 is used so rows stay single-device."
if [ "$LLAMA_CUDA" = "12.8" ] && [ "$DRY_RUN" = 0 ] && [ -z "$FAKE_GPU" ]; then
  major=${DRIVER%%.*}; [ "${major:-0}" -lt 570 ] && { echo "driver $DRIVER too old for CUDA 12.8 build (need >=570); upgrade driver or use LLAMA_CUDA=source" >&2; exit 3; }
fi
if [ "$DRY_RUN" = 0 ] && [ "$ASSUME_YES" = 0 ] && [ -t 0 ]; then
  read -r -p "Install llama.cpp $LLAMA_BUILD and download up to ~$(( ${DISK_GIB:-0} )) GB of models into $WORK? [y/N] " a; [ "$a" = y ] || exit 1
fi
PY=python3
setup_python
PLAN="$OUT/plan.csv"
"$PY" "$SCRIPT_DIR/make_sweep_list.py" --catalog "$SCRIPT_DIR/sweep_catalog.json" --vram-gb "$VRAM_GIB" --ram-gb "$RAM_GIB" --disk-gb "$DISK_GIB" --csv "$PLAN" --summary 2>&1 | tee -a "$LOG" >&2
[ "$(wc -l <"$PLAN")" -gt 1 ] || { log "nothing fits this card - nothing to do"; exit 0; }
trap 'finalize' EXIT
trap 'log "signal received"; exit 130' INT
trap 'log "TERM received (watchdog/deadline)"; exit 143' TERM
install_llama
snapshot_env
start_monitor
start_watchdog
mapfile -t ROWS < <("$PY" - "$PLAN" "$ONLY" <<'PYEOF'
import csv, re, sys
for r in csv.DictReader(open(sys.argv[1])):
    if sys.argv[2] and not re.search(sys.argv[2], r['model_id'] + ' ' + r['quant']): continue
    print('|'.join([r['model_id'], r['repo'], r['quant'], r['mode'], r['n_cpu_moe_fracs'], r['first_file'], r['include'], r['total_bytes']]))
PYEOF
)
log "plan: ${#ROWS[@]} configs"
for line in "${ROWS[@]}"; do
  IFS='|' read -r model_id repo quant mode fracs first_file include total_bytes <<<"$line"
  run_config "$model_id" "$repo" "$quant" "$mode" "$fracs" "$first_file" "$include" "$total_bytes"
done
log "sweep complete"
