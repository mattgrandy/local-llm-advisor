#!/usr/bin/env python3
"""Normalise a run_sweep.sh result directory (or .tgz) into the data/benchmarks schema.

  python3 tools/sweep/ingest_sweep.py sweep_out.tgz               # writes data/benchmarks/own/own-measurement__<hw>__<date>.{csv,json}
  python3 tools/sweep/ingest_sweep.py sweep_out/ --merge          # ...and idempotently appends to data/benchmarks/benchmarks_all.{csv,json}
  python3 tools/sweep/ingest_sweep.py --flat-csv sweep_out/       # (used on the GPU box; no repo needed) raw llama-bench rows -> results_flat.csv

Rows: one per (model file, ngl, n_cpu_moe, depth): pp_tps (pp512) and tg_tps (tg128) joined. source = 'own-measurement'
(our own runs: our licence, attribute as "Local LLM Advisor own measurement"). hw_id comes from tools/bench_parse.normalize_device
(GPU name + VRAM) unless meta.json has hw_id_override. MoE-offload rows (n_cpu_moe > 0) carry the phrase
"excluded from site medians" so tools/build_measured.py does not treat them as fully-on-GPU data; depth > 0 rows are already
ignored there. NOTE: tools/ingest_benchmarks.py regenerates benchmarks_all.* from scratch, so re-run this with --merge afterwards.
"""
import argparse, csv, glob, io, json, os, re, sys, tarfile, tempfile, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SOURCE = 'own-measurement'
SOURCE_URL = 'https://github.com/mattgrandy/local-llm-advisor'
AUTHOR = 'Local LLM Advisor (own measurement)'


def load_jsonl(path):
    rows = []
    for line in open(path, encoding='utf-8', errors='replace'):
        line = line.strip()
        if line.startswith('{') and line.endswith('}'):
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def resolve_dir(p):
    if os.path.isdir(p):
        return p, None
    tmp = tempfile.mkdtemp(prefix='sweep_ingest_')
    with tarfile.open(p) as t:
        try:
            t.extractall(tmp, filter='data')
        except TypeError:
            t.extractall(tmp)
    sub = [d for d in glob.glob(os.path.join(tmp, '*')) if os.path.isdir(d)]
    return (sub[0] if len(sub) == 1 else tmp), tmp


def flat_csv(d):
    rows = []
    for f in sorted(glob.glob(os.path.join(d, 'raw', '*.jsonl'))):
        for r in load_jsonl(f):
            r = dict(r, config=os.path.basename(f)[:-6])
            r.pop('samples_ns', None)
            r['samples_ts'] = ' '.join(str(x) for x in r.get('samples_ts', []))
            rows.append(r)
    if not rows:
        print('no result rows', file=sys.stderr)
        return 1
    cols = list(dict.fromkeys(k for r in rows for k in r))
    with open(os.path.join(d, 'results_flat.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f'wrote {d}/results_flat.csv ({len(rows)} rows)', file=sys.stderr)
    return 0


def plan_map(d):
    """basename of GGUF file -> plan row (model_id, name, quant, label, mode)."""
    m = {}
    p = os.path.join(d, 'plan.csv')
    if os.path.exists(p):
        for r in csv.DictReader(open(p)):
            m[os.path.basename(r['first_file'])] = r
    return m


def normalise(d):
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from bench_parse import FIELDS, normalize_device, HW_IDS
    models = {x['id']: x for x in json.load(open(os.path.join(ROOT, 'site', 'data', 'models.json')))['models']}
    meta = json.load(open(os.path.join(d, 'meta.json')))
    pm = plan_map(d)
    today = datetime.date.today().isoformat()
    n_used = int(meta.get('gpu_count_used') or 1)
    mem_gb = round(meta['gpu_mib'] / 1024 / n_used)   # per-GPU memory (gpu_mib is the sum when several GPUs are used)
    ovr = meta.get('hw_id_override')
    if ovr and ovr not in HW_IDS:
        raise SystemExit(f'hw_id_override {ovr!r} is not a hardware.json id')
    warnings = []
    groups = {}
    for f in sorted(glob.glob(os.path.join(d, 'raw', '*.jsonl'))):
        for r in load_jsonl(f):
            if not (r.get('avg_ts') and r['avg_ts'] > 0):
                continue
            k = (r['model_filename'], r.get('n_gpu_layers'), r.get('n_cpu_moe', 0), r.get('n_depth', 0), r.get('flash_attn'), r.get('n_ubatch'), r.get('n_batch'))
            groups.setdefault(k, {})['pp' if r['n_gen'] == 0 and r['n_prompt'] > 0 else 'tg' if r['n_prompt'] == 0 and r['n_gen'] > 0 else 'other'] = r
    out = []
    for (mf, ngl, ncmoe, depth, fa, ub, bt), g in groups.items():
        pp, tg = g.get('pp'), g.get('tg')
        ref = tg or pp
        if not ref:
            continue
        pr = pm.get(os.path.basename(mf))
        if pr is None:
            warnings.append(f'{mf}: not in plan.csv, model name taken from llama-bench output')
        site = models.get(pr['model_id']) if pr else None
        gpu_raw = (ref.get('gpu_info') or meta['gpu_name']).split(',')[0].strip()
        device, hw = normalize_device(gpu_raw, mem_gb)
        if ovr:
            device = hw = ovr
        if n_used > 1:   # multi-GPU: never a site hardware id (build_measured only uses device_count == 1)
            device = hw = f'{n_used}x-{hw or device}'
        notes = [f"own run, llama-bench from llama.cpp {meta['llama_build_tag']} (commit {ref.get('build_commit')}), CUDA {meta['llama_cuda']} build, driver {meta['driver']}, "
                 f"{meta.get('provider') or 'unknown provider'}, CPU {meta.get('cpu')}, RAM {meta.get('ram_gib')} GiB; llama-bench model_type '{ref.get('model_type')}'; "
                 f"-r {meta.get('reps')}; " + (f"{n_used} GPUs, llama.cpp layer split (default)" if n_used > 1 else "GPU 0 only")]
        if pr:
            notes.append(f"GGUF {pr['repo']}/{pr['first_file']}")
        for t, nm in ((pp, 'pp'), (tg, 'tg')):
            if t and t.get('stddev_ts') is not None:
                notes.append(f"{nm} stddev {t['stddev_ts']:.2f}")
                if t['avg_ts'] and t['stddev_ts'] / t['avg_ts'] > 0.10:
                    notes.append(f'HIGH VARIANCE in {nm} (>10% of mean)')
        if ncmoe:
            notes.append(f'MoE expert offload: --n-cpu-moe {ncmoe} (expert tensors of the first {ncmoe} layers in system RAM); excluded from site medians')
        row = {k: '' for k in FIELDS}
        row.update(
            device=device, device_raw=gpu_raw, hw_id=hw, device_count=n_used,
            backend=(ref.get('backends') or 'CUDA').split(',')[0], model=site['name'] if site else ref.get('model_type', ''),
            quant=pr['quant'] if pr else '', params_b=site['params_b'] if site else round(ref.get('model_n_params', 0) / 1e9, 2),
            size_gib=round(ref['model_size'] / 2 ** 30, 2) if ref.get('model_size') else '', fa=1 if fa else 0, ngl=ngl, threads=ref.get('n_threads', ''),
            ubatch=ub, depth=depth, pp_n=pp['n_prompt'] if pp else '', pp_tps=round(pp['avg_ts'], 2) if pp else '',
            tg_n=tg['n_gen'] if tg else '', tg_tps=round(tg['avg_ts'], 2) if tg else '',
            build=ref.get('build_commit', ''), build_num=ref.get('build_number', ''), source=SOURCE, source_url=SOURCE_URL, author=AUTHOR,
            date=(ref.get('test_time') or today)[:10], notes='; '.join(notes), n_samples=len(ref.get('samples_ts') or []), retrieved=today)
        out.append(row)
    out.sort(key=lambda r: (r['device'], r['model'], r['quant'], str(r['notes'].count('n-cpu-moe')), int(r['depth'] or 0)))
    return out, meta, warnings


def key(r):
    nc = re.search(r'--n-cpu-moe (\d+)', r['notes'] or '')
    return (r['source'], r['device'], r['model'], r['quant'], str(r['depth']), nc.group(1) if nc else '0', r['date'], r['build'])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path', help='sweep_out directory or .tgz')
    ap.add_argument('--flat-csv', action='store_true')
    ap.add_argument('--merge', action='store_true', help='append to data/benchmarks/benchmarks_all.{csv,json} (idempotent)')
    ap.add_argument('--bench-dir', default=os.path.join(ROOT, 'data', 'benchmarks'), help='data/benchmarks directory (tests use a temp copy)')
    a = ap.parse_args(argv)
    d, tmp = resolve_dir(a.path)
    if a.flat_csv:
        return flat_csv(d)
    rows, meta, warns = normalise(d)
    for w in warns:
        print('WARN', w, file=sys.stderr)
    if not rows:
        print('no usable rows', file=sys.stderr)
        return 1
    from bench_parse import FIELDS
    hw = sorted({r['device'] for r in rows})[0]
    date = max(r['date'] for r in rows)
    sub = 'own-multigpu' if int(meta.get('gpu_count_used') or 1) > 1 else 'own'
    if sub != 'own' and a.merge:
        print('multi-GPU run: --merge ignored (rows stay out of benchmarks_all and site medians)', file=sys.stderr)
        a.merge = False
    os.makedirs(os.path.join(a.bench_dir, sub), exist_ok=True)
    base = os.path.join(a.bench_dir, sub, f'{SOURCE}__{hw}__{date}')
    with open(base + '.csv', 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    json.dump(rows, open(base + '.json', 'w'), indent=1)
    print(f'{len(rows)} rows -> {base}.csv  (hw_id={rows[0]["hw_id"] or "UNMATCHED:" + rows[0]["device"]})', file=sys.stderr)
    if a.merge:
        allp = os.path.join(a.bench_dir, 'benchmarks_all')
        cur = json.load(open(allp + '.json'))
        have = {key(r) for r in cur if r.get('source') == SOURCE}
        new = [r for r in rows if key(r) not in have]
        cur += new
        # keep the same field set/order as the existing csv
        json.dump(cur, open(allp + '.json', 'w'))
        with open(allp + '.csv', 'w', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(cur)
        print(f'merged {len(new)} new rows into benchmarks_all ({len(rows)-len(new)} duplicates skipped). Now run tools/build_measured.py', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
