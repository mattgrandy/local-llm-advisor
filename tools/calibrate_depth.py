#!/usr/bin/env python3
"""Fit the long-context speed penalty from measured depth rows in data/benchmarks/benchmarks_all.csv.
Model: tg(d) = tg(0) / (1 + kappa * KVread(d) / Wread), where KVread(d) = bytes of KV cache attended per generated token
(full-attention layers: all d tokens; sliding-window layers: min(d, window); linear-attention layers: constant, ignored),
Wread = weight bytes read per token (active params for MoE). kappa is one global constant fitted in log space on rows
whose model maps onto a model in site/data/models.json. Writes site/data/depth_calibration.json."""
import csv, json, math, collections, re, os, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = [x for x in csv.DictReader(open(R + '/data/benchmarks/benchmarks_all.csv'))
        if not (x['source'] == 'own-measurement' and 'MoE expert offload' in (x['notes'] or ''))]  # offload-config rows: different --n-cpu-moe per depth, not comparable
models = {m['id']: m for m in json.load(open(R + '/site/data/models.json'))['models']}
MAP = [(r'gpt-oss 20B', 'openai/gpt-oss-20b'), (r'gpt-oss 120B', 'openai/gpt-oss-120b'), (r'qwen3moe 30B', 'Qwen/Qwen3-Coder-30B-A3B-Instruct'),
       (r'qwen35moe 35B', 'Qwen/Qwen3.6-35B-A3B'), (r'qwen35 27B', 'Qwen/Qwen3.6-27B'), (r'qwen35 9B', 'Qwen/Qwen3.5-9B'),
       (r'gemma4 26B', 'google/gemma-4-26B-A4B-it'), (r'gemma4 31B', 'google/gemma-4-31B-it'),
       (r'Qwen3\.6-27B', 'Qwen/Qwen3.6-27B'), (r'Qwen3\.6-35B-A3B', 'Qwen/Qwen3.6-35B-A3B'),
       # catalog names as written in our own llama-bench rows (see tools/build_measured.py ALIASES)
       (r'^Gemma 4 12B', 'google/gemma-4-12B-it'), (r'^Gemma 4 26B-A4B', 'google/gemma-4-26B-A4B-it'), (r'^Gemma 4 31B', 'google/gemma-4-31B-it'),
       (r'^Qwen3\.6 27B', 'Qwen/Qwen3.6-27B'), (r'^Qwen3\.6 35B-A3B', 'Qwen/Qwen3.6-35B-A3B'), (r'^Qwen3\.5 9B', 'Qwen/Qwen3.5-9B'), (r'^Qwen3\.5 4B', 'Qwen/Qwen3.5-4B'),
       (r'^Qwen3-Coder 30B-A3B', 'Qwen/Qwen3-Coder-30B-A3B-Instruct'), (r'^Qwen3-VL 8B', 'Qwen/Qwen3-VL-8B-Instruct'), (r'^Mistral Small 3\.2 24B', 'mistralai/Mistral-Small-3.2-24B-Instruct-2506')]
BPW = {'Q8': 8.5, 'Q6': 6.56, 'Q5': 5.7, 'Q4': 4.85, 'MXFP4': 4.25, 'BF': 16, 'F16': 16, 'Q3': 3.9}
def kv_read(m, d, bytes_):
    k = m['kv']; full = 2 * k['full_kv_heads'] * k['full_head_dim'] * k['full_layers'] * bytes_ * d
    swa = 0
    if k.get('swa_layers'): swa = 2 * k['swa_kv_heads'] * k['swa_head_dim'] * k['swa_layers'] * bytes_ * min(d, k.get('window', d))
    return (full + swa) / 1e9
def wread(m, quant):
    q = next((v for kq, v in BPW.items() if quant.upper().replace('UD-', '').startswith(kq)), 4.85)
    p = m['params_b'] * (m['active_params_b'] / m['params_b'] if m.get('moe') and m.get('active_params_b') else 1)
    return p * q / 8
g = collections.defaultdict(dict); gp = collections.defaultdict(dict)
for x in rows:
    key = (x['hw_id'] or x['device'], x['backend'], x['model'], x['quant'], x['source'], x['author'], x['build'])
    if x['tg_tps']: g[key][int(float(x['depth'] or 0))] = float(x['tg_tps'])
    if x['pp_tps']: gp[key + (x['pp_n'],)][int(float(x['depth'] or 0))] = float(x['pp_tps'])
pts = []; ppts = []
for k, v in gp.items():
    mid = next((i for pat, i in MAP if re.search(pat, k[2])), None)
    if not mid or 0 not in v: continue
    for d, t in v.items():
        if d >= 4096 and 0.05 < t / v[0] <= 1.05:
            ppts.append((mid, k[0], k[3], d, t / v[0], kv_read(models[mid], d, 2) / wread(models[mid], k[3])))
for k, v in g.items():
    mid = next((i for pat, i in MAP if re.search(pat, k[2])), None)
    if not mid or 0 not in v: continue
    for d, t in v.items():
        if d >= 4096 and 0.05 < t / v[0] <= 1.05:  # drop rows where depth ran faster than d=0 (noise / different config)
            pts.append((mid, k[0], k[3], d, t / v[0], kv_read(models[mid], d, 2) / wread(models[mid], k[3])))
def errp(kap): return sum((math.log(1 / (1 + kap * x)) - math.log(r)) ** 2 for _, _, _, _, r, x in ppts)
kap_pp = min((i / 100 for i in range(1, 3000)), key=errp)
abp = sorted(abs(1 / (1 + kap_pp * x) / r - 1) for _, _, _, _, r, x in ppts)
def err(kap): return sum((math.log(1 / (1 + kap * x)) - math.log(r)) ** 2 for _, _, _, _, r, x in pts)
kap = min((i / 100 for i in range(1, 1500)), key=err)
res = [math.log((1 / (1 + kap * x)) / r) for _, _, _, _, r, x in pts]
absr = sorted(abs(math.exp(e) - 1) for e in res)
by = collections.defaultdict(list)
for mid, hw, q, d, r, x in pts: by[mid].append(round(math.log((1 / (1 + kap * x)) / r), 3))
out = {'generated': os.popen('date +%F').read().strip(), 'kappa': kap, 'kappa_pp': kap_pp, 'n_points_pp': len(ppts), 'pp_median_abs_error_pct': round(100 * abp[len(abp) // 2], 1), 'pp_p90_abs_error_pct': round(100 * abp[int(len(abp) * .9)], 1), 'n_points': len(pts), 'n_groups': len({(p[0], p[1], p[2]) for p in pts}),
       'median_abs_error_pct': round(100 * absr[len(absr) // 2], 1), 'p90_abs_error_pct': round(100 * absr[int(len(absr) * .9)], 1),
       'max_measured_depth': max(p[3] for p in pts), 'depths_with_data': sorted({p[3] for p in pts}),
       'by_model_bias_ln_mean': {m: round(sum(v) / len(v), 3) for m, v in by.items()},
       'method': 'tg(d)=tg(0)/(1+kappa*KVread(d)/Wread). KVread counts f16 KV bytes attended per token (full layers: d tokens, sliding-window layers: window, linear-attention layers: ignored); Wread = weight bytes read per token (active params for MoE). kappa fitted in log space on measured depth rows (llama.cpp discussions/PRs, DGX Spark, Mac M2 Ultra, RTX 4090/5090 data) for models that map onto site models. Prompt processing (prefill) uses the same form with its own constant kappa_pp, applied per chunk and integrated over the prompt. Hardware-independent; real behaviour varies with backend and flash-attention kernels.'}
json.dump(out, open(R + '/site/data/depth_calibration.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != 'method'}, indent=1))
