#!/usr/bin/env python3
"""Build site/data/measured.json from data/benchmarks/benchmarks_all.json (+ community submissions that are
explicitly marked reviewed, see tools/ingest_submissions.py).

What it produces
  entries[hw_id] -> list of measured points: canonical model, quant class, median tg/pp tok/s, row count, sources.
  calibration    -> speed-efficiency factors derived from measured dense-model runs (see README "Calibration").
Filters (documented, deliberate):
  * single device only (hw_id is set only when device_count == 1), generation speed present, no context depth (-d),
    no llama-batched-bench rows (aggregate throughput), no CPU-backend rows for GPU entries,
    exclude llamacpp-discussion-4167-summary (pinned to a 2023 build -> numbers far below current builds).
  * community submissions are kept in a separate list (`community`) and ALWAYS flagged unverified in the UI.
"""
import os, sys, re, json, csv, statistics as st, time, collections
ROOT = os.path.join(os.path.dirname(__file__), '..')
HW = json.load(open(f'{ROOT}/site/data/hardware.json'))
MODELS = json.load(open(f'{ROOT}/site/data/models.json'))['models']
BW = {x['id']: (x['bandwidth_gbps'], k) for k in ('gpus', 'apple', 'unified') for x in HW[k]}
KIND = {'gpus': 'gpu', 'apple': 'apple', 'unified': 'unified'}
BPW = {'F16': 16, 'Q8': 8.5, 'Q6': 6.56, 'Q5': 5.7, 'Q4': 4.85, 'Q3': 3.9, 'Q2': 3.0}
EXCLUDE_SRC = {'llamacpp-discussion-4167-summary'}
EXCLUDE_PREFIX = ('llamacpp-pr-', 'ik_llama-pr-')   # pull-request threads: dev/PR builds, tuning sweeps -> kept in the dataset, not in site medians
MIN_CAL_READ_GB = 3.0   # below this, per-token launch overhead dominates and bandwidth math is meaningless

def qclass(q):
    q = (q or '').upper().replace(' ', '')
    if 'MXFP4' in q or 'NVFP4' in q: return 'Q4'
    if q in ('F16', 'BF16'): return 'F16'
    m = re.search(r'Q([2-8])', q)
    return f'Q{m.group(1)}' if m else ''

# alias -> site model id (same architecture/size family; speed-equivalent for bandwidth-bound decode)
ALIASES = [
    (r'gpt-oss[ -]?20b', 'openai/gpt-oss-20b'), (r'gpt-oss[ -]?120b', 'openai/gpt-oss-120b'),
    (r'qwen3-?coder.*30b', 'Qwen/Qwen3-Coder-30B-A3B-Instruct'), (r'qwen3moe 30b', 'Qwen/Qwen3-Coder-30B-A3B-Instruct'),
    (r'qwen3-30b-a3b', 'Qwen/Qwen3-Coder-30B-A3B-Instruct'),
    (r'qwen3\.6[ -]?35b|qwen35moe 35b', 'Qwen/Qwen3.6-35B-A3B'), (r'qwen3\.6-27b', 'Qwen/Qwen3.6-27B'),
    (r'gemma[ -]?4[ -]?31b', 'google/gemma-4-31B-it'), (r'gemma[ -]?4[ -]?26b', 'google/gemma-4-26B-A4B-it'), (r'gemma[ -]?4[ -]?12b', 'google/gemma-4-12B-it'),
    (r'glm4moe 106b|glm-4\.5-air', 'zai-org/GLM-4.5-Air'),
    (r'qwen3\.5[ -]?9b', 'Qwen/Qwen3.5-9B'), (r'qwen3\.5[ -]?4b', 'Qwen/Qwen3.5-4B'),
]
SITE = {m['id']: m for m in MODELS}
# fine-tunes / spec-decode / pruned / re-quantised variants must NOT inherit the base model's identity
VARIANT = re.compile(r'mtp|reap|tune|qwopus|qwable|escha|compat|flash-next|heretic|abliter|uncensored|distill|ornith|muse', re.I)

def canon(model, params_b):
    """-> (canonical name, site_id|None, total_b, active_b|None, moe)"""
    s = (model or '').strip(); l = s.lower()
    if not s: return None
    sid = None if VARIANT.search(l) else next((i for pat, i in ALIASES if re.search(pat, l)), None)
    if sid:
        m = SITE[sid]; return (m['name'], sid, m['params_b'], m.get('active_params_b') if m['moe'] else None, bool(m['moe']))
    if 'llama 7b' in l or 'llama 2' in l: return ('Llama 2 7B', None, 6.74, None, False)
    am = re.search(r'(\d+(?:\.\d+)?)b[-. ]a(\d+(?:\.\d+)?)b', l)
    try: tot = float(params_b)
    except (TypeError, ValueError): tot = None
    if am:
        tot = tot or float(am.group(1)); return (s, None, tot, float(am.group(2)), True)
    if tot is None:
        pm = re.search(r'(\d+(?:\.\d+)?)b\b', l); tot = float(pm.group(1)) if pm else None
    if tot is None or '?' in l: return None
    return (s, None, tot, None, False)

def num(x):
    try: return float(x)
    except (TypeError, ValueError): return None

def load_rows():
    rows = json.load(open(f'{ROOT}/data/benchmarks/benchmarks_all.json'))
    out = []
    for r in rows:
        if not r['hw_id'] or r['hw_id'] not in BW or r['source'] in EXCLUDE_SRC or r['source'].startswith(EXCLUDE_PREFIX): continue
        if 'excluded from site medians' in (r['notes'] or ''): continue
        tg = num(r['tg_tps'])
        if not tg or tg <= 0 or num(r['depth']): continue
        if 'batched' in (r['notes'] or '') or r['backend'] == 'CPU': continue
        if num(r['pp_tps']) and not num(r['tg_tps']): continue
        c = canon(r['model'], r['params_b'])
        qc = qclass(r['quant']) or qclass(r['model'])
        if not c or not qc: continue
        out.append(dict(r=r, c=c, qc=qc, tg=tg, pp=num(r['pp_tps'])))
    return out

def main():
    rows = load_rows()
    g = collections.defaultdict(list)
    for x in rows: g[(x['r']['hw_id'], x['c'][0], x['qc'])].append(x)
    entries = collections.defaultdict(list)
    for (hid, name, qc), xs in g.items():
        c = xs[0]['c']
        srcs = {}
        for x in xs: srcs.setdefault(x['r']['source'], x['r']['source_url'])
        pps = [x['pp'] for x in xs if x['pp']]
        entries[hid].append(dict(model=name, site_id=c[1], qclass=qc, params_b=c[2], active_b=c[3], moe=c[4],
            tg=round(st.median(x['tg'] for x in xs), 2), pp=round(st.median(pps), 1) if pps else None, n=len(xs),
            tg_min=round(min(x['tg'] for x in xs), 2), tg_max=round(max(x['tg'] for x in xs), 2),
            sources=[dict(id=k, url=v) for k, v in sorted(srcs.items())],
            size_gb=(round(st.median(sz) * 1.073741824, 2) if (sz := [num(x['r']['size_gib']) for x in xs if num(x['r']['size_gib'])]) else None),
            backends=sorted({x['r']['backend'] for x in xs if x['r']['backend']}),
            latest=max((x['r']['date'] or '') for x in xs)))
    # ---- calibration: efficiency = tg / (bandwidth / read_GB), dense models, read >= MIN_CAL_READ_GB
    per = collections.defaultdict(list)
    for x in rows:
        c = x['c']
        if c[4] or c[3]: continue            # MoE: active-parameter read size is too uncertain for calibration
        read = c[2] * BPW.get(x['qc'], 0) / 8
        if read < MIN_CAL_READ_GB: continue
        bw, k = BW[x['r']['hw_id']]
        per[x['r']['hw_id']].append(x['tg'] / (bw / read))
    by_hw, by_kind = {}, collections.defaultdict(list)
    for hid, es in per.items():
        by_kind[KIND[BW[hid][1]]] += es
        if len(es) >= 3:
            by_hw[hid] = dict(efficiency=round(st.median(es), 3), n=len(es), p25=round(sorted(es)[len(es)//4], 3), p75=round(sorted(es)[(3*len(es))//4], 3))
    # MoE factor: median efficiency of MoE rows (read = ACTIVE params) / median efficiency of dense rows, same hardware kind.
    moe = collections.defaultdict(list)
    for x in rows:
        c = x['c']
        if not (c[4] and c[3]): continue
        read = c[3] * BPW.get(x['qc'], 0) / 8
        if read < 1: continue
        bw, k = BW[x['r']['hw_id']]; moe[KIND[k]].append(x['tg'] / (bw / read))
    moe_factor = None
    if len(moe.get('unified', [])) >= 10 and by_kind.get('unified'):
        moe_factor = dict(value=round(st.median(moe['unified']) / st.median(by_kind['unified']), 3), n=len(moe['unified']),
                          basis='measured on unified-memory hardware only (Strix Halo, DGX Spark); EXTRAPOLATED to other hardware, where there is no calibration data, so MoE estimates there are likely optimistic')
    cal = dict(moe_factor=moe_factor, by_hw=by_hw, by_kind={k: dict(efficiency=round(st.median(v), 3), n=len(v)) for k, v in by_kind.items() if len(v) >= 3},
               method=f'efficiency = measured_tg / (memory_bandwidth_GBps / read_GB); dense models only; read_GB = params*bits_per_weight/8 >= {MIN_CAL_READ_GB} GB; single-device; median; per-hardware factor needs >= 3 rows, else per-kind median, else the global assumption.',
               clamp=[0.25, 0.95], global_assumption=HW['assumptions']['speed_efficiency'])
    # ---- community (reviewed) submissions, always flagged unverified
    comm = []
    cp = f'{ROOT}/data/submissions/community_reviewed.json'
    if os.path.exists(cp): comm = json.load(open(cp))
    out = dict(generated=time.strftime('%Y-%m-%d'), entries=entries, calibration=cal, community=comm,
        attribution=[dict(name='LocalScore (Mozilla Builders / cjpais, Apache-2.0)', url='https://www.localscore.ai'),
                     dict(name='llama.cpp community benchmark threads incl. the gpt-oss guide #15396 (ggml-org/llama.cpp, MIT)', url='https://github.com/ggml-org/llama.cpp/discussions'),
                     dict(name='witcheer/rtx-5090-benchmarks (Hugging Face, MIT)', url='https://huggingface.co/datasets/witcheer/rtx-5090-benchmarks'),
                     dict(name='iBlessi/rtx-5080-llm-throughput (Hugging Face, CC-BY-4.0)', url='https://huggingface.co/datasets/iBlessi/rtx-5080-llm-throughput'),
                     dict(name='steven0226/speculative-decoding-bench-rtx4090 (Hugging Face, CC-BY-4.0)', url='https://huggingface.co/datasets/steven0226/speculative-decoding-bench-rtx4090'),
                     dict(name='Hugging Face / GitHub open-licensed benchmark repos (see data/benchmarks/README.md)', url='')],
        counts=dict(rows_used=len(rows), hardware=len(entries), points=sum(len(v) for v in entries.values()), community=len(comm)))
    json.dump(out, open(f'{ROOT}/site/data/measured.json', 'w'), indent=1)
    print(json.dumps(out['counts'])); print(json.dumps(cal['by_kind'])); print(json.dumps(by_hw, indent=0))
if __name__ == '__main__': main()
