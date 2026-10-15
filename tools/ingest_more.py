#!/usr/bin/env python3
"""Second ingest pass (2026-10-15): more measured tokens/sec from permitted sources. Run AFTER ingest_benchmarks.py and
ingest_localscore.py (it merges idempotently into data/benchmarks/benchmarks_all.{csv,json}, replacing its own rows).

Usage: python3 tools/fetch_threads.py   # caches extra GitHub threads (unauthenticated REST, polite, resumable)
       python3 tools/ingest_more.py [--refresh]

Sources (all permissive or public-facts, each row keeps source_url + author/date):
  * extra ggml-org/llama.cpp + ikawrakow/ik_llama.cpp threads (tools/threads_list.py): llama-bench tables in comments/bodies
    (MIT repos; user comments carry no explicit data licence -> numbers + device + build only, with permalink + login).
  * HF dataset witcheer/rtx-5090-benchmarks (MIT): RTX 5090 llama.cpp pp/tg per model/quant + decode at depth.
  * HF dataset iBlessi/rtx-5080-llm-throughput (CC-BY-4.0): RTX 5080 16GB, Ollama, decode/prefill per model, 4k/16k ctx.
  * HF dataset steven0226/speculative-decoding-bench-rtx4090 (CC-BY-4.0): RTX 4090 baseline (no speculation) decode tok/s.
Never touched: Reddit, LocalScore /api, anything behind a 403/challenge, unlicensed repos/datasets (link-only).
"""
import os, sys, re, csv, json, io, time, statistics as st, collections
sys.path.insert(0, os.path.dirname(__file__))
import gh_fetch as g
import ingest_extra as X
from bench_parse import *
import ingest_benchmarks as IB
from threads_list import THREADS

ROOT = os.path.join(os.path.dirname(__file__), '..', 'data', 'benchmarks')
REFRESH = '--refresh' in sys.argv
TODAY = time.strftime('%Y-%m-%d')
PREFIXES = ('llamacpp-thread-', 'llamacpp-pr-', 'ik_llama-pr-', 'llamacpp-discussion-15396', 'ik_llama-thread-', 'hf-witcheer-', 'hf-iBlessi-', 'hf-steven0226-', 'hf-studioburnside-', 'hf-pgmharikrishnan-')
R = X.R


def guide_sections(d, src):
    """Discussion #15396 body: one <summary> section per device ("Benchmarks on <device> (<mem>[, N GPU cores]) for `model`")."""
    body = d['body'].replace('\r', ''); parts = re.split(r'(?=<summary>)', body); rows = []
    for sec in parts:
        m = re.match(r'<summary>\s*\S*\s*Benchmarks on (.+?)\s*(?:\(([^)]*)\))?\s*for `([^`]+)`', sec)
        if not m: continue
        dev, meta, model = m.group(1).strip(), m.group(2) or '', m.group(3)
        extra = ''
        if re.match(r'M[1-6]\b', dev):
            dev = 'Apple ' + dev
            mem = re.search(r'(\d+)\s*GB', meta)
            if 'M4 Max' in dev and mem and mem.group(1) == '36' and 'GPU cores' not in meta: extra = '\n32 GPU cores'   # 36 GB is Apple's 32-core-GPU M4 Max configuration
        r, _ = IB.text_rows(sec + extra, src, d['html_url'], d['user']['login'], d['created_at'][:10], default_device=dev, default_count=1,
                            id_note=f'device from section heading "Benchmarks on {m.group(1)}"')
        rows += r
    return rows

def thread_rows():
    out = []; stats = {}
    for repo, kind, n in THREADS:
        base = f'https://api.github.com/repos/{repo}/{kind}/{n}'
        try:
            d = g.get(base)['data']; cm = g.paged(base + '/comments') if d.get('comments') else []
        except Exception as e:
            stats[f'{repo}#{n}'] = f'fetch failed: {e}'; continue
        short = repo.split('/')[1]
        pr = bool(d.get('pull_request')); pre = ('llamacpp' if short == 'llama.cpp' else 'ik_llama') + ('-pr-' if pr else '-thread-')
        src = ('llamacpp-discussion-' + str(n)) if kind == 'discussions' else pre + str(n)
        if n == 15396 and kind == 'discussions': rows = guide_sections(d, src)
        else: rows, _ = IB.text_rows(d.get('body') or '', src, d['html_url'], d['user']['login'], d['created_at'][:10])
        for c in cm:
            r2, _ = IB.text_rows(c.get('body') or '', src, c['html_url'], c['user']['login'], c['created_at'][:10]); rows += r2
        for r in rows:
            r['notes'] = (r['notes'] + f'; thread "{d["title"][:70]}"' + ('; PULL REQUEST thread: may be a PR/dev build, excluded from site medians' if pr else '')).strip('; ')
            if 'device guessed' in r['notes'] or (r['device_count'] not in ('', 1)): r['hw_id'] = ''   # only log/heading-derived single-device rows may map to site hardware
        stats[f'{repo}#{n}'] = dict(title=d['title'], comments=len(cm), rows=len(rows), pr=bool(d.get('pull_request')))
        out += rows
    return out, stats

def witcheer():
    repo = 'witcheer/rtx-5090-benchmarks'; lic, lm = X.hf_info(repo); url = f'https://huggingface.co/datasets/{repo}'
    txt = X._dl(f'{url}/resolve/main/benchmarks.csv', 'witcheer_5090.csv', REFRESH)
    groups = collections.OrderedDict(); rows = []
    for r in csv.DictReader(io.StringIO(txt)):
        if r['engine'].strip().lower() != 'llama.cpp': continue          # vLLM / SGLang rows skipped (different engine)
        k = (r['model'], r['quant'], r['date']); groups.setdefault(k, {})[r['test']] = r
    for (model, quant, date), t in groups.items():
        any_r = next(iter(t.values())); size = float(any_r['size_gib'] or 0)
        off = size > 28.0   # 32 GB card: bigger files were run with MoE experts offloaded to system RAM (see dataset reports)
        base = dict(device_raw='NVIDIA GeForce RTX 5090', device_count=1, backend='CUDA', model=model, quant=quant, params_b=any_r['params_b'], size_gib=size or '',
                    source='hf-witcheer-rtx-5090-benchmarks', source_url=url, author='witcheer', date=date,
                    notes=f"{any_r['architecture']}; llama.cpp CUDA; single RTX 5090 32GB; dataset license {lic}" + ('; CPU/MoE offload (file larger than VRAM): excluded from site medians' if off else ''))
        rr = R(**base)
        if 'pp512' in t: rr.update(pp_n=512, pp_tps=float(t['pp512']['tokens_per_sec']))
        if 'tg128' in t: rr.update(tg_n=128, tg_tps=float(t['tg128']['tokens_per_sec']))
        if rr['pp_tps'] == '' and rr['tg_tps'] == '': continue
        rows.append(X.fin(rr))
        for tn in ('pp2048', 'pp8192', 'pp16384'):   # long-prompt prefill, kept as pp-only rows
            if tn in t:
                r3 = R(**base); r3.update(pp_n=int(tn[2:]), pp_tps=float(t[tn]['tokens_per_sec'])); r3['notes'] += '; prefill-only row'; rows.append(X.fin(r3))
    # decode at depth
    txt = X._dl(f'{url}/resolve/main/dataset/speed_at_depth.csv', 'witcheer_5090_depth.csv', REFRESH)
    for r in csv.DictReader(io.StringIO(txt)):
        if r['engine'].strip().lower() != 'llama.cpp': continue
        for col, depth in (('tg128_d8192', 8192), ('tg128_d32768', 32768)):
            if not r[col]: continue
            rr = R(device_raw='NVIDIA GeForce RTX 5090', device_count=1, backend='CUDA', model=r['model'], quant=r['quant'], depth=depth, tg_n=128, tg_tps=float(r[col]),
                   source='hf-witcheer-rtx-5090-benchmarks', source_url=url, author='witcheer', date=lm,
                   notes=f"decode at context depth {depth} (llama-bench -d); n_cpu_moe={r['n_cpu_moe'] or 0}; date = HF last-modified")
            rows.append(X.fin(rr))
    return rows, dict(license=lic, url=url, hf_last_modified=lm)

def ibl5080():
    repo = 'iBlessi/rtx-5080-llm-throughput'; lic, lm = X.hf_info(repo); url = f'https://huggingface.co/datasets/{repo}'
    txt = X._dl(f'{url}/resolve/main/rtx-5080-llm-throughput.csv', 'iblessi_5080.csv', REFRESH); rows = []
    for r in csv.DictReader(io.StringIO(txt)):
        name = r['model'].replace(':', '-'); off = r['model'] == 'qwen3-coder:30b'
        rr = R(device_raw=r['gpu'], device_count=1, backend='Ollama(CUDA)', model=name, quant=r['quantization'], params_b=fnum(r['parameter_size']) or '',
               pp_n=r['prompt_tokens'], pp_tps=float(r['median_prefill_tok_s']), tg_n=256, tg_tps=float(r['median_decode_tok_s']), n_samples=r['reps'],
               source='hf-iBlessi-rtx-5080-llm-throughput', source_url=url, author='iBlessi', date=r['capture_date_utc'],
               notes=f"Ollama {r['ollama_version']}, driver {r['driver']}, num_ctx={r['num_ctx']}, median of {r['reps']} runs, Windows, 16GB RTX 5080; dataset license {lic}" + ('; partial GPU offload (74% resident): excluded from site medians' if off else ''))
        rows.append(X.fin(rr))
    return rows, dict(license=lic, url=url, hf_last_modified=lm)

def s4090():
    import pandas as pd
    repo = 'steven0226/speculative-decoding-bench-rtx4090'; lic, lm = X.hf_info(repo); url = f'https://huggingface.co/datasets/{repo}'
    p = os.path.join(g.RAW, 'hf', 's4090.parquet'); os.makedirs(os.path.dirname(p), exist_ok=True)
    if REFRESH or not os.path.exists(p):
        import urllib.request
        open(p, 'wb').write(urllib.request.urlopen(urllib.request.Request(f'{url}/resolve/main/data/all_runs.parquet', headers={'User-Agent': g.UA}), timeout=120).read())
    d = pd.read_parquet(p)
    d = d[(d.status == 'ok') & (d.spec_type == 'none') & d.draft_model.isna() & d.config_id.str.endswith('t0') & d.predicted_per_second.notna()]
    NAMES = {'qwen3-8b-q4km': ('Qwen3-8B', 'Q4_K_M', 8.19), 'qwen3-8b-q8': ('Qwen3-8B', 'Q8_0', 8.19), 'qwen3-14b-q4km': ('Qwen3-14B', 'Q4_K_M', 14.77), 'llama31-8b-q4km': ('Llama 3.1 8B', 'Q4_K_M', 8.03)}
    rows = []
    for (eng, mdl), gx in d.groupby(['engine', 'model']):
        if mdl not in NAMES: continue
        nm, q, pb = NAMES[mdl]
        rr = R(device_raw='NVIDIA GeForce RTX 4090', device_count=1, backend='CUDA' if eng == 'llamacpp' else 'LM Studio(CUDA)', model=nm, quant=q, params_b=pb,
               tg_n=int(gx.predicted_n.median()), tg_tps=round(float(gx.predicted_per_second.median()), 2), n_samples=len(gx), build=str(gx.engine_version.iloc[0] or ''),
               source='hf-steven0226-speculative-decoding-bench-rtx4090', source_url=url, author='steven0226', date=str(gx.ts.max())[:10],
               notes=f"baseline (no speculative decoding), temperature 0, median of {len(gx)} short-prompt runs (max_tokens 256) across tasks; engine={eng}; dataset license {lic}")
        rows.append(X.fin(rr))
    return rows, dict(license=lic, url=url, hf_last_modified=lm)

def mlx_apple():
    """Apple Silicon MLX numbers from two open HF datasets. Only the headline / summary figures that state SINGLE-STREAM decode."""
    rows = []
    repo = 'studioburnside/mlx-local-inference-benchmarks'; lic, lm = X.hf_info(repo); url = f'https://huggingface.co/datasets/{repo}'
    txt = X._dl(f'{url}/resolve/main/README.md', 'sb_readme.md', REFRESH)
    m = re.search(r'Raw decode \(single stream / 8 concurrent, tok/s\):\s*oQ4 \*\*([\d.]+) / ([\d.]+)\*\*,\s*oQ8 ([\d.]+) / (\d+(?:\.\d+)?),\s*Tess-Q8 ([\d.]+) / (\d+(?:\.\d+)?),\s*Tess-Q4 ([\d.]+) / (\d+(?:\.\d+)?)', txt)
    if m:
        v = [float(x) for x in m.groups()]
        for name, q, tg, pb, extra in (('Qwen3.6-35B-A3B', 'Q4', v[0], 35.95, 'oQ4 (oMLX 4-bit)'), ('Qwen3.6-35B-A3B', 'Q8', v[2], 35.95, 'oQ8 (oMLX 8-bit)'),
                                       ('Tess-4-27B (Qwen3.6-27B fine-tune)', 'Q8', v[4], 27.0, 'MLX Q8'), ('Tess-4-27B (Qwen3.6-27B fine-tune)', 'Q4', v[6], 27.0, 'MLX Q4')):
            rr = R(device_raw='Apple M5 Max 40GPU', device_count=1, backend='MLX', model=name, quant=q, params_b=pb, tg_tps=tg, tg_n='', source='hf-studioburnside-mlx-local-inference-benchmarks',
                   source_url=url, author='studioburnside', date='2026-07-10',
                   notes=f"README headline 'raw decode, single stream' on a 128 GB M5 Max (GPU core count inferred as 40: the 128 GB option); {extra}; MLX-based servers, not llama.cpp; dataset license {lic}; date = results dir date (README); not llama-bench pp/tg")
            rows.append(X.fin(rr, None, 40))
    repo = 'pgmharikrishnan/mlx-serve-local-llm-benchmarks-2026-10'; lic, lm = X.hf_info(repo); url = f'https://huggingface.co/datasets/{repo}'
    for d, name, q, pb, ex in (('minicpm-v47-35b-a3b-4bit-20261013b', 'minicpm-v47 35B-A3B', 'Q4', 35.0, ''),
                               ('qwen38-27b-4bit-20261013b', 'Qwen3.8-27B', 'Q4', 27.32, '; EXCLUDED from site medians: 0.4x of bandwidth-bound expectation, young engine (mlx-serve), single run set'),
                               ('lfm25-24b-a2b-4bit-20261013b', 'LFM2.5-24B A2B', 'Q4', 24.0, '; EXCLUDED from site medians: very wide min/max (56-208), unstable')):
        t = X._dl(f'{url}/resolve/main/results/{d}/perf-summary.csv', f'pgm_{d}_perf.csv', REFRESH)
        for r in csv.DictReader(io.StringIO(t)):
            if r['cell'] != 'plain': continue
            rr = R(device_raw='Apple M4 Max 40GPU', device_count=1, backend='MLX(mlx-serve)', model=name, quant=q, params_b=pb, tg_tps=float(r['decode_tps']), pp_tps=float(r['prefill_tps']), n_samples=r['n'],
                   source='hf-pgmharikrishnan-mlx-serve-local-llm-benchmarks-2026-10', source_url=url, author='pgmharikrishnan', date=(lambda x: f'{x[:4]}-{x[4:6]}-{x[6:]}')(re.search(r'(\d{8})', d).group(1)),
                   notes=f"'plain' cell (speculative decoding off), median of {r['n']} runs, mlx-serve 26.10.2, 128 GB M4 Max (GPU cores inferred 40 for the 128 GB option); decode min/max {r['decode_min']}-{r['decode_max']}; dataset license {lic}" + ex)
            if 'EXCLUDED' in ex: rr['notes'] = rr['notes'].replace('EXCLUDED', 'excluded') + ' ; excluded from site medians'
            rows.append(X.fin(rr, None, 40))
    return rows, dict(license='apache-2.0 / mit', rows=len(rows))

def main():
    allr, notes = [], {}
    tr, ts = thread_rows(); allr += tr; notes['threads'] = ts
    for name, fn in (('witcheer', witcheer), ('iblessi', ibl5080), ('steven', s4090), ('mlx_apple', mlx_apple)):
        rows, meta = fn(); allr += rows; notes[name] = dict(meta, rows=len(rows))
    # de-dup: identical (device, backend, model, quant, pp, tg, depth) from different comments (e.g. quoted tables)
    seen = set(); keep = []
    for r in allr:
        if 'author-flagged-invalid' in r['notes']: continue
        k = (r['device_raw'], r['backend'], r['model'], r['quant'], r['pp_tps'], r['tg_tps'], r['depth'], r['build'])
        if k in seen: continue
        seen.add(k); keep.append(r)
    allp = os.path.join(ROOT, 'benchmarks_all.json')
    base = [r for r in json.load(open(allp)) if not r['source'].startswith(PREFIXES)]
    # drop new rows that duplicate a row already present from an earlier pass (same device/model/quant/pp/tg)
    have = {(r['device_raw'], r['model'], r['quant'], r['pp_tps'], r['tg_tps'], r['depth']) for r in base}
    new = [r for r in keep if (r['device_raw'], r['model'], r['quant'], r['pp_tps'], r['tg_tps'], r['depth']) not in have]
    allr2 = [{**{f: '' for f in FIELDS}, **r} for r in base] + new
    # fill still-blank hw_id using improved device normalisation (core counts parsed from names like '12P+4E+40GPU');
    # only single-device rows, only blanks, never overwrites an existing match.
    refilled = 0
    for r in allr2:
        if r['hw_id'] or r['device_count'] not in ('', 1, '1') or 'device guessed' in r['notes'] or 'multi-GPU' in r['notes']: continue
        mm = re.search(r'(\d+) GB reported', r['notes'])
        dev, hid = normalize_device(r['device_raw'], float(mm.group(1)) if mm else None)
        if hid and hid != r['hw_id']: r['device'], r['hw_id'] = dev, hid; refilled += 1
    print('refilled hw_id on', refilled, 'rows')
    for r in new: r['retrieved'] = TODAY
    json.dump(allr2, open(allp, 'w'), indent=1)
    with open(os.path.join(ROOT, 'benchmarks_all.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(allr2)
    bs = os.path.join(ROOT, 'by_source'); bysrc = collections.defaultdict(list)
    for r in new: bysrc[r['source']].append(r)
    for fn in os.listdir(bs):
        if fn.startswith(PREFIXES): os.remove(os.path.join(bs, fn))
    for k, v in bysrc.items():
        with open(os.path.join(bs, k + '.csv'), 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(v)
    cov = {}
    for hid in sorted(HW_IDS):
        rr = [r for r in allr2 if r['hw_id'] == hid]
        cov[hid] = dict(rows=len(rr), sources=sorted({r['source'] for r in rr}),
                        models=sorted({r['model'] for r in rr if not r['model'].startswith('llama 7B (Llama 2')})[:30],
                        non_llama2_rows=len([r for r in rr if not r['model'].startswith('llama 7B')]))
    json.dump(cov, open(os.path.join(ROOT, 'coverage.json'), 'w'), indent=1)
    s = json.load(open(os.path.join(ROOT, 'summary_counts.json')))
    s['pass2'] = dict(date=TODAY, new_rows=len(new), by_source=dict(collections.Counter(r['source'] for r in new)), hw_matched=sum(bool(r['hw_id']) for r in new), refilled_hw_id=refilled, notes=notes)
    s['rows_total'] = len(allr2); s['rows_with_hw_id'] = sum(bool(r['hw_id']) for r in allr2)
    json.dump(s, open(os.path.join(ROOT, 'summary_counts.json'), 'w'), indent=1)
    print(json.dumps(s['pass2'], indent=1)[:4000]); print('total rows', len(allr2))
    print(collections.Counter(r['hw_id'] for r in new if r['hw_id']))

if __name__ == '__main__': main()
