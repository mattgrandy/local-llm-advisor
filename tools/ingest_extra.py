"""Non-llama.cpp-discussion sources: HF datasets, permissive GitHub repos, LMArena. Called from ingest_benchmarks.main().
Needs pyarrow+pandas for the LMArena parquet (pip install pyarrow pandas)."""
import os, re, csv, io, json, time, urllib.request, collections
import gh_fetch as g
from bench_parse import *

def _dl(url, name, refresh):
    p = os.path.join(g.RAW, 'hf' if 'huggingface' in url else 'repos'); os.makedirs(p, exist_ok=True); p = os.path.join(p, name)
    if refresh or not os.path.exists(p):
        data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': g.UA}), timeout=120).read()
        open(p, 'wb').write(data)
    return open(p, 'rb').read().decode('utf-8', 'replace')

def R(**kw):
    r = {f: '' for f in FIELDS}; r.update(kw); return r

def fin(r, mem=None, cores=None):
    dev, hid = normalize_device(r['device_raw'], mem, cores); r['device'], r['hw_id'] = dev, hid; return r

def hf_info(repo):
    import urllib.request as u
    d = json.loads(u.urlopen(u.Request(f'https://huggingface.co/api/datasets/{repo}', headers={'User-Agent': g.UA}), timeout=60).read())
    return (d.get('cardData') or {}).get('license'), d.get('lastModified', '')[:10]

def apple_hf(refresh):
    repo = 'RaynarDM/apple-silicon-llm-benchmarks'; lic, lm = hf_info(repo)
    txt = _dl(f'https://huggingface.co/datasets/{repo}/resolve/main/benchmarks.csv', 'apple.csv', refresh)
    url = f'https://huggingface.co/datasets/{repo}'; rows = []; skipped = 0
    for r in csv.DictReader(io.StringIO(txt)):
        m = r['metric'].strip(); v = fnum(r['value'])
        if v is None or r['unit'].strip() != 'tok/s': skipped += 1; continue
        mt = re.match(r'^(pp|tg)(\d+)$', m)
        kind = mt.group(1) if mt else ('pp' if m == 'prefill' else 'tg' if m == 'generation' else None)
        if not kind: skipped += 1; continue
        n = int(mt.group(2)) if mt else ''
        rr = R(device_raw='Apple M2 Max', device_count=1, backend=r['engine'], model=r['model'], quant=r['quant'], size_gib=r['file_gib'],
               source='hf-RaynarDM-apple-silicon-llm-benchmarks', source_url=url, author='RaynarDM', date=lm,
               notes=f"test={r['test']}; config={r['config']}; runs={r['runs']}; 32GB M2 Max; date=HF last-modified; metric={m}" + ('' if n else ' (token count not given)'))
        rr.update({f'{kind}_tps': v, f'{kind}_n': n})
        rows.append(fin(rr))
    return 'hf-apple-silicon-llm-benchmarks', rows, dict(license=lic, url=url, skipped_non_speed_rows=skipped, hf_last_modified=lm)

def rx7800_hf(refresh):
    repo = 'NeoAiLabs/llama-cpp-rx7800xt-benchmarks'; lic, lm = hf_info(repo)
    txt = _dl(f'https://huggingface.co/datasets/{repo}/resolve/main/llama_bench_results.csv', 'rx7800.csv', refresh)
    url = f'https://huggingface.co/datasets/{repo}'; rows = []; groups = collections.OrderedDict()
    for r in csv.DictReader(io.StringIO(txt)):
        t = re.match(r'^(pp|tg)(\d+)$', r['test'].strip()); v = fnum(r['t_per_s'])
        if not t or v is None: continue
        k = (r['source_file'], r['model'], r['backend'], r['ngl'], r['n_batch'])
        d = groups.setdefault(k, dict(r=r, pp=None, tg=None)); d[t.group(1)] = (int(t.group(2)), v)
    for k, d in groups.items():
        r = d['r']; mdl, q = split_model_quant(r['model']); dm = re.search(r'-(\d{8})-\d{6}\.txt$', r['source_file'])
        dt = f'{dm.group(1)[:4]}-{dm.group(1)[4:6]}-{dm.group(1)[6:]}' if dm else lm
        rr = R(device_raw='AMD Radeon RX 7800 XT', device_count=1, backend=norm_backend(r['backend']), model=mdl, quant=q,
               params_b=fnum(r['params']) or '', size_gib=fnum(r['size']) if 'GiB' in r['size'] else '', ngl=r['ngl'], ubatch='',
               pp_n=d['pp'][0] if d['pp'] else '', pp_tps=d['pp'][1] if d['pp'] else '', tg_n=d['tg'][0] if d['tg'] else '', tg_tps=d['tg'][1] if d['tg'] else '',
               source='hf-NeoAiLabs-llama-cpp-rx7800xt-benchmarks', source_url=url, author='NeoAiLabs', date=dt,
               notes=f"n_batch={r['n_batch']}; source_file={r['source_file']}; backend_raw={r['backend']}")
        rows.append(fin(rr))
    return 'hf-llama-cpp-rx7800xt', rows, dict(license=lic, url=url, hf_last_modified=lm)

def strix_hf(refresh):
    repo = 'axjns/strix-halo-inference-bench'; lic, lm = hf_info(repo)
    txt = _dl(f'https://huggingface.co/datasets/{repo}/resolve/main/data/results.jsonl', 'strix_axjns.jsonl', refresh)
    url = f'https://huggingface.co/datasets/{repo}'; rows = []
    for l in txt.splitlines():
        if not l.strip(): continue
        r = json.loads(l); mdl, q = split_model_quant(r.get('lb_model_type') or r['model_label'])
        pre = r['phase'] == 'prefill'
        rr = R(device_raw=r.get('lb_gpu_info') or 'Radeon 8060S', device_count=1, backend=norm_backend(r.get('lb_backends', '')) if 'Vulkan' not in r.get('lb_backends', '') else 'Vulkan',
               model=r['model_label'], quant=r.get('quant') or q, params_b=round(r['lb_model_n_params'] / 1e9, 2) if r.get('lb_model_n_params') else '',
               size_gib=round(r['file_size_bytes'] / 2**30, 2) if r.get('file_size_bytes') else '', ngl=r.get('lb_n_gpu_layers', ''), ubatch=r.get('lb_n_ubatch', ''),
               threads=r.get('lb_n_threads', ''), fa=r.get('lb_flash_attn', ''), depth=r.get('depth') or '',
               pp_n=r['n_prompt'] if pre else '', pp_tps=round(r['tokens_per_sec'], 2) if pre else '', tg_n='' if pre else r['n_gen'], tg_tps='' if pre else round(r['tokens_per_sec'], 2),
               build=r.get('lb_build_commit', ''), build_num=r.get('lb_build_number', ''), source='hf-axjns-strix-halo-inference-bench', source_url=url, author='axjns',
               date=(r.get('measured_at_utc') or lm)[:10],
               notes=f"flags={r.get('llama_bench_flags','')}; gpu_contended={r.get('gpu_contended')}; lb_flash_attn=-1 means llama-bench default; stddev={round(r.get('tokens_per_sec_stddev') or 0,2)}")
        rows.append(fin(rr))
    return 'hf-strix-halo-inference-bench', rows, dict(license=lic, url=url, hf_last_modified=lm)

STRIX_DEVICE = 'AMD Ryzen AI Max+ 395 (Strix Halo)'
def strix_guide(refresh):
    repo = 'hogeheer499-commits/strix-halo-guide'
    info = g.get(f'https://api.github.com/repos/{repo}')['data']
    txt = _dl(f'https://raw.githubusercontent.com/{repo}/main/BENCHMARKS.md', 'strix_guide_BENCHMARKS.md', refresh)
    url = f'https://github.com/{repo}/blob/main/BENCHMARKS.md'; rows = []
    for i, j, h, trs in iter_tables(txt):
        hl = [x.lower() for x in h]
        if hl[:3] == ['model', 'backend / build', 'quant'] and 'pp512' in hl and 'tg128' in hl:
            for r in trs:
                if len(r) < 5: continue
                pp, tg = fnum(r[3]), fnum(r[4].replace('*', ''))
                if pp is None and tg is None: continue
                be = norm_backend(r[1]); bm = re.search(r'(?:llama\.cpp\s+)(b?\w+)\s*$', r[1])
                rows.append(fin(R(device_raw=STRIX_DEVICE, device_count=1, backend=be, model=r[0], quant=r[2], pp_n=512, pp_tps=pp or '', tg_n=128, tg_tps=tg or '',
                                  build=bm.group(1) if bm else '', source='github-strix-halo-guide-BENCHMARKS', source_url=url, author='hogeheer499-commits (guide author)',
                                  date=info['pushed_at'][:10], notes=f"backend/build: {r[1]}; note: {(r[5] if len(r)>5 else '')[:160]}; table has no per-row date column in this view (date=repo last push); single Beelink-class Strix Halo 128GB box per guide")))
        elif hl[:2] == ['model', 'quant'] and 'pp512 t/s' in hl and 'tg128 t/s' in hl:
            for r in trs:
                pp, tg = fnum(r[2]), fnum(r[3])
                if pp is None and tg is None: continue
                rows.append(fin(R(device_raw=STRIX_DEVICE, device_count=1, backend='Vulkan', model=r[0], quant=r[1], pp_n=512, pp_tps=pp or '', tg_n=128, tg_tps=tg or '',
                                  source='github-strix-halo-guide-BENCHMARKS', source_url=url, author='hogeheer499-commits (guide author)', date=info['pushed_at'][:10],
                                  notes='sentinel rows, 2026-09-26 re-check section; backend assumed Vulkan RADV per guide headline profile (not stated in this table); repeats=' + (r[4] if len(r) > 4 else ''))))
    return 'github-strix-halo-guide', rows, dict(license=(info['license'] or {}).get('spdx_id'), url=url, pushed_at=info['pushed_at'])

def rocky_leaderboard(refresh):
    repo = 'john-rocky/apple-silicon-llm-bench'
    info = g.get(f'https://api.github.com/repos/{repo}')['data']
    txt = _dl(f'https://raw.githubusercontent.com/{repo}/main/LEADERBOARD.md', 'rocky_LEADERBOARD.md', refresh)
    url = f'https://github.com/{repo}/blob/main/LEADERBOARD.md'; rows = []; lines = txt.split('\n')
    plat = dev = model = None
    for i, j, h, trs in iter_tables(txt):
        hl = [x.lower() for x in h]
        if 'warm tok/s' not in hl: continue
        plat = dev = model = None
        for l in lines[:i]:
            if l.startswith('## '): plat = l[3:].strip()
            elif l.startswith('### '): dev = l[4:].strip()
            elif l.startswith('**') and l.strip().endswith('**'): model = l.strip().strip('*')
        if plat != 'mac' or not dev: continue
        dm = re.search(r'\((M\d[^)]*)\)', dev)
        dname = 'Apple ' + dm.group(1) if dm else dev
        c = lambda n: hl.index(n) if n in hl else None
        for r in trs:
            warm, cold = fnum(r[c('warm tok/s')]), fnum(r[c('cold tok/s')])
            pf = fnum(r[c('prefill tok/s')]) if c('prefill tok/s') is not None else None
            tg = warm if warm is not None else cold
            if tg is None and pf is None: continue
            mdl_col = c('model'); mdl = r[mdl_col] if mdl_col is not None else model
            cap = r[c('captured')] if c('captured') is not None else ''
            rows.append(fin(R(device_raw=dname, device_count=1, backend=r[c('runtime')], model=(mdl or '').strip('`'), quant=r[c('quant')][:60], build=r[c('engine')],
                              pp_tps=pf if pf is not None else '', tg_tps=tg if tg is not None else '',
                              source='github-apple-silicon-llm-bench-leaderboard', source_url=url, author='john-rocky',
                              date=cap if re.match(r'\d{4}-\d\d-\d\d', cap or '') else '2026-08-26',
                              notes=f"short-chat task (not llama-bench pp512/tg128); tg_tps={'warm' if warm is not None else 'COLD'} decode tok/s; pp_tps=prefill tok/s on the task prompt (length not stated here); artifact={r[c('artifact')][:80] if c('artifact') is not None else ''}; device section '{dev}'")))
    return 'github-apple-silicon-llm-bench', rows, dict(license=(info['license'] or {}).get('spdx_id'), url=url, pushed_at=info['pushed_at'], scope='mac sections only; iPhone/Android sections skipped')

def lmarena(out, refresh):
    import pandas as pd
    p = os.path.join(g.RAW, 'hf'); os.makedirs(p, exist_ok=True); fp = os.path.join(p, 'lmarena_text_latest.parquet')
    if refresh or not os.path.exists(fp):
        open(fp, 'wb').write(urllib.request.urlopen(urllib.request.Request('https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/text/latest-00000-of-00001.parquet', headers={'User-Agent': g.UA}), timeout=120).read())
    d = pd.read_parquet(fp)
    o = d[d.license.str.lower() != 'proprietary'].copy()
    o['source'] = 'LMArena leaderboard-dataset (text/latest), CC-BY-4.0, https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset'
    o = o.sort_values(['category', 'rank'])
    o.to_csv(os.path.join(out, 'lmarena_open_models.csv'), index=False)
    return len(o), int(o.model_name.nunique()), sorted(o.leaderboard_publish_date.astype(str).unique())

def run(out, refresh):
    for fn in (apple_hf, rx7800_hf, strix_hf, strix_guide, rocky_leaderboard):
        try:
            yield fn(refresh)
        except Exception as e:
            print('extra source failed', fn.__name__, repr(e))
            yield fn.__name__ + '-FAILED', [], str(e)
    try:
        n, m, dates = lmarena(out, refresh)
        yield 'lmarena-open-models (quality, separate file)', [], dict(rows_in_lmarena_open_models_csv=n, distinct_models=m, publish_dates=dates, license='CC-BY-4.0')
    except Exception as e:
        print('lmarena failed', repr(e))
