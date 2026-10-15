#!/usr/bin/env python3
"""Ingest public LocalScore (localscore.ai, Mozilla Builders / cjpais, Apache-2.0) results.

Usage: python3 tools/ingest_localscore.py [--refresh]

Policy (approved by the site owner; see data/benchmarks/README.md):
  * Only the PUBLIC HTML pages are fetched (/model/<id>, /latest). Each Next.js page embeds its data as JSON in
    <script id="__NEXT_DATA__">; that embedded JSON is what we parse. Nothing under /api/* is ever called, and there is
    no header spoofing / Cloudflare bypass.
  * Polite: descriptive User-Agent, >= 1.5 s between requests, every response cached in data/benchmarks/raw/localscore/
    (a rerun without --refresh makes zero requests), ~4 requests total. Stops immediately on 403/429/5xx.
  * Output: data/benchmarks/by_source/localscore-*.csv and merged into benchmarks_all.csv/.json (idempotent: old
    localscore rows are replaced), coverage.json refreshed for localscore rows.
What LocalScore exposes on public pages: per accelerator x model *averages* (pp tok/s, tg tok/s, TTFT ms), a composite
performance score and rank. It does NOT expose sample counts or medians publicly (n_samples left blank), so a row is
"an average of that accelerator id's submitted runs". /latest gives 10 individual recent runs with system+runtime.
"""
import os, sys, re, csv, json, time, hashlib, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
from bench_parse import FIELDS, normalize_device, HW_IDS

ROOT = os.path.join(os.path.dirname(__file__), '..', 'data', 'benchmarks')
RAW = os.path.join(ROOT, 'raw', 'localscore'); os.makedirs(RAW, exist_ok=True)
BASE = 'https://www.localscore.ai'
UA = 'llm-advisor-research/0.1 (polite low-rate fetch of public pages; non-commercial research prototype; respects 403/429)'
DELAY = 1.5
REFRESH = '--refresh' in sys.argv
TODAY = time.strftime('%Y-%m-%d')
_last = [0.0]

def get(path):
    f = os.path.join(RAW, hashlib.sha1(path.encode()).hexdigest()[:12] + '_' + re.sub(r'\W+', '_', path).strip('_') + '.html')
    if os.path.exists(f) and not REFRESH:
        return open(f, encoding='utf-8').read()
    wait = DELAY - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(BASE + path, headers={'User-Agent': UA, 'Accept': 'text/html'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: html = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        sys.exit(f'STOP: {path} -> HTTP {e.code}; not retrying or working around it.')
    _last[0] = time.time()
    open(f, 'w', encoding='utf-8').write(html)
    return html

def next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(m.group(1))['props']['pageProps'] if m else {}

def quant(q):  # "Q4_K - Medium" -> Q4_K_M
    m = re.match(r'(Q\d)_K\s*-\s*(Small|Medium|Large)', q or '')
    return f'{m.group(1)}_K_{m.group(2)[0]}' if m else (q or '').replace(' ', '')

def row(**kw):
    r = {f: '' for f in FIELDS}; r.update(kw); return r

def main():
    home = next_data(get('/'))
    model_ids = sorted({m['model']['id'] for m in home.get('results', [])})
    rows = []
    for mid in model_ids:
        res = next_data(get(f'/model/{mid}')).get('result')
        if not res: continue
        m = res['model']; url = f'{BASE}/model/{mid}'
        for x in res['results']:
            a = x['accelerator']
            dev, hid = normalize_device(a['name'], a.get('memory_gb'))
            rows.append(row(device=dev, device_raw=a['name'], hw_id=hid, device_count=1, backend='',
                model=m['name'], quant=quant(m['quant']), params_b=round(m['params'] / 1e9, 2), pp_tps=round(x['avg_prompt_tps'], 2),
                tg_tps=round(x['avg_gen_tps'], 2), ttft_ms=round(x['avg_ttft'], 1), perf_score=round(x['performance_score'], 1),
                rank=f"{x['performance_rank']}/{x['number_ranked']}", source='localscore-model-pages', source_url=url,
                author='LocalScore contributors', date=TODAY, retrieved=TODAY,
                notes=f"LocalScore accelerator id {a['id']} ({a['type']}, {a.get('memory_gb')} GB reported); average over submitted runs of LocalScore's fixed test suite; sample count/median not public; backend not shown on this page."))
    lat = next_data(get('/latest')).get('results', [])
    for x in lat:
        dev, hid = normalize_device(x['accelerator'], x.get('accelerator_memory_gb'))
        m, s, rt = x['model'], x.get('system', {}), x.get('runtime', {})
        rows.append(row(device=dev, device_raw=x['accelerator'], hw_id=hid, device_count=1, backend=rt.get('name', ''),
            model=m['name'], quant=quant(m['quant']), params_b=round(m['params'] / 1e9, 2), pp_tps=round(x['avg_prompt_tps'], 2),
            tg_tps=round(x['avg_gen_tps'], 2), ttft_ms=round(x['avg_ttft_ms'], 1), perf_score=round(x['performance_score'], 1),
            n_samples=1, build=(rt.get('commit_hash') or ''), source='localscore-latest-runs', source_url=f"{BASE}/latest",
            author='LocalScore contributors', date=x['created_at'][:10], retrieved=TODAY,
            notes=f"single run #{x['id']}; {rt.get('name','')} {rt.get('version','')}; {s.get('kernel_type','')}; CPU {s.get('cpu_name','')}; RAM {s.get('ram_gb','')} GB; {x['accelerator_type']}"))
    # write by_source
    bs = os.path.join(ROOT, 'by_source'); os.makedirs(bs, exist_ok=True)
    for src in ('localscore-model-pages', 'localscore-latest-runs'):
        rr = [r for r in rows if r['source'] == src]
        with open(os.path.join(bs, src + '.csv'), 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(rr)
    # merge into benchmarks_all (idempotent)
    allp = os.path.join(ROOT, 'benchmarks_all.json')
    allr = [r for r in json.load(open(allp)) if not r['source'].startswith('localscore')]
    allr = [{**{f: '' for f in FIELDS}, **r} for r in allr] + rows
    json.dump(allr, open(allp, 'w'), indent=1)
    with open(os.path.join(ROOT, 'benchmarks_all.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(allr)
    cov = {}
    for hid in sorted(HW_IDS):
        rr = [r for r in allr if r['hw_id'] == hid]
        cov[hid] = dict(rows=len(rr), sources=sorted({r['source'] for r in rr}),
                        models=sorted({r['model'] for r in rr if not r['model'].startswith('llama 7B (Llama 2')})[:30],
                        non_llama2_rows=len([r for r in rr if not r['model'].startswith('llama 7B')]))
    json.dump(cov, open(os.path.join(ROOT, 'coverage.json'), 'w'), indent=1)
    s = json.load(open(os.path.join(ROOT, 'summary_counts.json')))
    s['localscore'] = dict(rows=len(rows), model_page_rows=sum(r['source'] == 'localscore-model-pages' for r in rows),
                           latest_rows=len(lat), hw_matched=sum(bool(r['hw_id']) for r in rows), retrieved=TODAY)
    s['rows_total'] = len(allr); s['rows_with_hw_id'] = sum(bool(r['hw_id']) for r in allr)
    json.dump(s, open(os.path.join(ROOT, 'summary_counts.json'), 'w'), indent=1)
    print(json.dumps(s['localscore']))
    from collections import Counter
    print(Counter(r['hw_id'] for r in rows if r['hw_id']))

if __name__ == '__main__':
    main()
