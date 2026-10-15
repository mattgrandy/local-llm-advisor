#!/usr/bin/env python3
"""Generate the benchmark sweep list from site/data/models.json, verified against Hugging Face.

Two steps (so the GPU box needs no repo checkout of models.json or even HF API access beyond downloads):
  1. python3 make_sweep_list.py --refresh          -> writes sweep_catalog.json (queries the HF tree API; one request per GGUF repo)
  2. python3 make_sweep_list.py --vram-gb 12 --ram-gb 32 [--csv out.csv]
        -> reads sweep_catalog.json (no network) and writes a plan CSV for that box:
           rows: model_id,name,repo,quant,label,mode,n_cpu_moe_list,depths,first_file,include,total_bytes,n_files
        mode = gpu (fits in VRAM incl. KV allowance) | moe-offload (MoE, experts to CPU) | skip:<reason> (written only with --show-skipped)

File resolution: GGUF files whose name contains the label (e.g. "Q4_K_M" or "UD-Q4_K_M") as a whole token,
excluding imatrix/mmproj files. Split GGUFs ("-00001-of-00003.gguf") are grouped; first shard is passed to llama-bench.
Quant labels come from models.json (`quants[Q].label`); the file must exist in the repo or the entry is dropped with a warning.
"""
import argparse, csv, json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MODELS = os.path.join(ROOT, 'site', 'data', 'models.json')
CATALOG = os.path.join(HERE, 'sweep_catalog.json')
QUANTS = ('Q4_K_M', 'Q8_0')
DEPTHS = '0,4096,16384'
GB = 1e9
GIB = 2 ** 30
SHARD = re.compile(r'-(\d{5})-of-(\d{5})\.gguf$')


def kv_alloc_gib(ctx):
    """Coarse KV-cache + compute-buffer allowance in GiB, same assumption as tools/sweep_cost.py (~1 GiB/16k + 0.15)."""
    return 0.15 + ctx / 16384.0


def hf_tree(repo, opener=urllib.request.urlopen):
    url = f'https://huggingface.co/api/models/{repo}/tree/main?recursive=1'
    req = urllib.request.Request(url, headers={'User-Agent': 'llm-advisor-sweep/1'})
    out = json.load(opener(req, timeout=60))
    return [{'path': f['path'], 'size': f.get('size', 0)} for f in out if f.get('type') == 'file' and f['path'].endswith('.gguf')]


def match_files(files, label):
    """Return sorted list of {path,size} for one quant label, or [] ."""
    tok = re.compile(r'(?<![A-Za-z0-9])' + re.escape(label) + r'(?![A-Za-z0-9])')
    hit = []
    for f in files:
        base = os.path.basename(f['path'])
        low = base.lower()
        if 'mmproj' in low or 'imatrix' in low or low.startswith('mtp/') or '/mtp-' in low or low.startswith('mtp-'):  # vision projector / imatrix / MTP draft heads
            continue
        # the label must be a whole token: UD-Q4_K_M must not match Q4_K_M and vice versa
        stem = SHARD.sub('', base) if SHARD.search(base) else base[:-5]
        if tok.search(stem):
            if not label.startswith('UD-') and re.search(r'UD-' + re.escape(label), stem):
                continue
            hit.append(f)
    if not hit:
        return []
    shards = [f for f in hit if SHARD.search(f['path'])]
    if shards:
        # group by prefix, keep the group with the most shards (normally exactly one group)
        groups = {}
        for f in shards:
            groups.setdefault(SHARD.sub('', f['path']), []).append(f)
        g = max(groups.values(), key=len)
        return sorted(g, key=lambda f: f['path'])
    return sorted(hit, key=lambda f: len(f['path']))[:1]


def build_catalog(models, fetch=hf_tree):
    cat = {'generated_from': 'site/data/models.json', 'hf_checked': None, 'entries': [], 'warnings': []}
    import datetime
    cat['hf_checked'] = datetime.date.today().isoformat()
    cache = {}
    for m in models:
        repo = m.get('gguf_repo')
        if not repo:
            cat['warnings'].append(f"{m['id']}: no gguf_repo")
            continue
        if repo not in cache:
            try:
                cache[repo] = fetch(repo)
            except Exception as e:  # network/404
                cat['warnings'].append(f'{repo}: HF tree fetch failed: {e}')
                cache[repo] = []
        for q in QUANTS:
            qi = m['quants'].get(q)
            if not qi:
                cat['warnings'].append(f"{m['id']} {q}: not in models.json")
                continue
            fl = match_files(cache[repo], qi['label'])
            if not fl:
                cat['warnings'].append(f"{m['id']} {q}: no file matching '{qi['label']}' in {repo}")
                continue
            total = sum(f['size'] for f in fl)
            site_gb = qi.get('gb')
            if site_gb and abs(total / GB - site_gb) / site_gb > 0.03:
                cat['warnings'].append(f"{m['id']} {q}: HF size {total/GB:.2f} GB differs from models.json {site_gb} GB (>3%)")
            cat['entries'].append({
                'model_id': m['id'], 'name': m['name'], 'repo': repo, 'quant': q, 'label': qi['label'],
                'moe': bool(m.get('moe')), 'params_b': m.get('params_b'), 'active_b': m.get('active_params_b'),
                'first_file': fl[0]['path'], 'files': [f['path'] for f in fl], 'n_files': len(fl), 'total_bytes': total,
            })
    return cat


def plan(cat, vram_gb, ram_gb, ctx=16384, vram_frac=0.95, moe_max_gb=40.0, disk_gb=None, show_skipped=False):
    """Decide per entry: gpu / moe-offload / skip. vram_gb = GiB-equivalent as reported by nvidia-smi (MiB/1024)."""
    rows = []
    for e in cat['entries']:
        gib = e['total_bytes'] / GIB
        mode, why = None, ''
        if gib + kv_alloc_gib(ctx) <= vram_gb * vram_frac:
            mode = 'gpu'
        elif e['quant'] == 'Q4_K_M' and e['moe'] and e['total_bytes'] / GB <= moe_max_gb:
            # experts live in system RAM: need RAM >= weights + ~4 GiB headroom for OS/CUDA pinned buffers
            if ram_gb >= gib + 4:
                mode = 'moe-offload'
            else:
                why = f'MoE offload needs RAM >= {gib+4:.0f} GiB (have {ram_gb:.0f})'
        else:
            why = f'{gib:.1f} GiB does not fit {vram_gb*vram_frac:.1f} GiB usable VRAM' + ('' if e['quant'] == 'Q4_K_M' else ' (offload only run for Q4_K_M MoE)')
        if disk_gb is not None and e['total_bytes'] / GB > disk_gb - 5:
            mode, why = None, f'file larger than free disk ({disk_gb} GB)'
        if mode is None:
            if show_skipped:
                rows.append(dict(e, mode='skip:' + why))
            continue
        rows.append(dict(e, mode=mode))
    # smallest first: the cheap results land early if the budget/timeout ends the run
    rows.sort(key=lambda r: (r['total_bytes'] if not r['mode'].startswith('skip') else 1e18))
    return rows


def n_cpu_moe_list(e, n_layers_hint=None):
    """Values of --n-cpu-moe to sweep. Layer count is unknown without reading GGUF metadata, so run_sweep.sh converts
    these fractions to counts using block_count from the GGUF header (llama-bench prints no layer count). Stored as fractions."""
    return '0.25,0.5,0.75'


CSV_FIELDS = ['model_id', 'name', 'repo', 'quant', 'label', 'mode', 'n_cpu_moe_fracs', 'depths', 'first_file', 'include', 'total_bytes', 'n_files']


def to_csv_rows(rows):
    out = []
    for r in rows:
        inc = os.path.dirname(r['first_file'])
        inc_glob = (inc + '/' if inc else '') + (os.path.basename(r['first_file']) if r['n_files'] == 1 else re.sub(r'-\d{5}-of-(\d{5})\.gguf$', r'-*-of-\1.gguf', os.path.basename(r['first_file'])))
        out.append({'model_id': r['model_id'], 'name': r['name'], 'repo': r['repo'], 'quant': r['quant'], 'label': r['label'], 'mode': r['mode'],
                    'n_cpu_moe_fracs': n_cpu_moe_list(r) if r['mode'] == 'moe-offload' else '', 'depths': DEPTHS,
                    'first_file': r['first_file'], 'include': inc_glob, 'total_bytes': r['total_bytes'], 'n_files': r['n_files']})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--refresh', action='store_true', help='query Hugging Face and rewrite sweep_catalog.json')
    ap.add_argument('--catalog', default=CATALOG)
    ap.add_argument('--vram-gb', type=float, help='GPU VRAM in GiB (nvidia-smi MiB / 1024)')
    ap.add_argument('--ram-gb', type=float, default=0, help='system RAM GiB (needed for MoE offload)')
    ap.add_argument('--disk-gb', type=float, default=None)
    ap.add_argument('--csv', help='write plan CSV here (default stdout)')
    ap.add_argument('--show-skipped', action='store_true')
    ap.add_argument('--summary', action='store_true', help='print human summary to stderr')
    a = ap.parse_args(argv)
    if a.refresh:
        models = json.load(open(MODELS))['models']
        cat = build_catalog(models)
        json.dump(cat, open(a.catalog, 'w'), indent=1)
        for w in cat['warnings']:
            print('WARN', w, file=sys.stderr)
        print(f"wrote {a.catalog}: {len(cat['entries'])} entries, {len(cat['warnings'])} warnings", file=sys.stderr)
        if a.vram_gb is None:
            return 0
    if a.vram_gb is None:
        ap.error('--vram-gb required (or --refresh only)')
    cat = json.load(open(a.catalog))
    rows = plan(cat, a.vram_gb, a.ram_gb, disk_gb=a.disk_gb, show_skipped=a.show_skipped)
    fh = open(a.csv, 'w', newline='') if a.csv else sys.stdout
    w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
    w.writeheader()
    w.writerows(to_csv_rows(rows))
    if a.csv:
        fh.close()
    if a.summary:
        runs = [r for r in rows if not r['mode'].startswith('skip')]
        gb = sum(r['total_bytes'] for r in runs) / GB
        print(f'{len(runs)} configs, {gb:.0f} GB of downloads (vram={a.vram_gb} ram={a.ram_gb})', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
