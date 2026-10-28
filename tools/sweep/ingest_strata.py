#!/usr/bin/env python3
"""Ingest a Strata vs llama.cpp run (data/sweeps/<run>/res) into:
  data/benchmarks/own-strata/strata__<hw>__<date>.{csv,json}   engine='strata' rows (NOT in site medians)
  data/benchmarks/own/own-measurement__<hw>__<date>.{csv,json}  engine='llama.cpp' llama-bench rows (merged into benchmarks_all)
Usage: python3 tools/sweep/ingest_strata.py data/sweeps/rtx3090strata [--merge]"""
import csv, json, os, re, statistics, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from bench_parse import FIELDS

STRATA_FIELDS = ['engine', 'variant', 'prompt_kind', 'ram_used_gib', 'engine_version', 'hw_id', 'device_raw', 'model', 'quant', 'gguf', 'mtp', 'prompt_tokens', 'tg_tps', 'pp_tps',
                 'mtp_accept', 'n_samples', 'flags', 'host_ram_gib', 'cpu', 'date', 'source', 'source_url', 'notes']
RUN = {
    'q36': ('Qwen3.6 35B-A3B', 'UD-Q4_K_XL', 'unsloth/Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf', True,
            'strata launch --family qwen36 --model ud-q4_k_xl --context 64k',
            '--max-context 65536 --prefill auto --mtp 2 --batch 3'),
    'fn': ('Qwen3.8 Flash Next', 'Q2_0', 'ISTA-DASLab Qwen3.8-Flash-Next GSQ-RCO-Q2_0 (2 parts) + MTP pack', True,
           'strata launch --family qwen --model q2_0 --context 64k',
           '--expert-profile --expert-cache auto --prefill auto --spec 4 --spec-min-p 0.5 --mtp <pack>/mtp/rt --max-context 65536 --kv int8 --ple-io ram --kv-resident 32768 --vram-reserve-mib 700 --batch 3'),
}
# per-card run configs (keyed by sweep dir name)
CARDS = {
    'rtx3090strata': dict(hw=dict(hw_id='rtx-3090', device_raw='NVIDIA GeForce RTX 3090', host_ram_gib=241.8, cpu='AMD EPYC 7713 (container limit 241.8 GiB RAM)'),
                          llama=(('llama_q36_gpu.jsonl', 0, None), ('llama_q36_ncmoe20.jsonl', 20, None)), driver='595.58.03', run=RUN, reps=3, ver='strata 0.2.7 (build 0.1.53, engine 0.1.52 cuda13)'),
    'rtx3060strata': dict(hw=dict(hw_id='rtx-3060', device_raw='NVIDIA GeForce RTX 3060 12GB', host_ram_gib=1486.9, cpu='Intel Xeon Platinum 8272L'),
                          llama=(('llama_q36_best.jsonl', 22, None), ('llama_q36_d32k_ncmoe26.jsonl', 26, None)), driver='', reps=None, ram_used=True, ver='strata 0.2.7 (build 0.1.53, engine 0.1.52)', run=dict(RUN, fn=(
                              'Qwen3.8 Flash Next', 'IQ3_S', 'Qwen3.8-Flash-Next GSQ-RCO-IQ3_S (2 parts, 84 GB) + MTP pack', True,
                              'strata launch --family qwen --model iq3_s --context 64k',
                              '--expert-profile --expert-cache auto --prefill auto --spec 4 --spec-min-p 0.5 --mtp <pack>/mtp/rt --max-context 65536 --kv int8 --ple-io ram --kv-resident 32768'),
                              q36=('Qwen3.6 35B-A3B', 'UD-Q4_K_XL', 'unsloth/Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf', True,
                                   'strata launch --family qwen36 --model ud-q4_k_xl --context 64k', '--max-context 65536 --prefill auto --mtp 2'))),
}
HW = None
DATE, VER = '2026-10-28', 'strata 0.2.7 (build 0.1.53, engine 0.1.52)'
URL = 'https://github.com/mattgrandy/local-llm-advisor'


def strata_rows(res):
    recs = [json.loads(l) for l in open(os.path.join(res, 'strata.jsonl'))]
    def ram_used(base):  # host RAM in use at end of run, from Strata /v1/status
        f = os.path.join(res, f'v1status_after_{base}.json')
        try: return json.load(open(f))['machine']['ram']['used_gib'] if CFG.get('ram_used') else ''
        except Exception: return ''
    out = []
    for lab in sorted({r['label'] for r in recs}):
        variant = '--parallel 1' if lab.endswith('b1') else ''
        base = lab.replace('_nomtp', '').replace('b1', ''); mtp = not lab.endswith('_nomtp')
        model, quant, gguf, _, cmd, flags = CFG['run'][base]
        for tp in sorted({r['target_prompt'] for r in recs if r['label'] == lab}):
            g = [r for r in recs if r['label'] == lab and r['target_prompt'] == tp]
            tg = statistics.median(r['timings']['predicted_per_second'] for r in g)
            cold = [r['timings']['prompt_per_second'] for r in g if r['timings']['cache_n'] == 0 and r['prompt_tokens'] > 1000]
            dn = sum(r['timings'].get('draft_n', 0) for r in g); da = sum(r['timings'].get('draft_n_accepted', 0) for r in g)
            kind = 'mixed' if tp == 1 else ''
            out.append(dict(engine='strata', ram_used_gib=ram_used(base), variant=variant, prompt_kind=kind, engine_version=CFG['ver'], model=model, quant=quant, gguf=gguf, mtp='on' if mtp else 'off',
                            prompt_tokens=g[0]['prompt_tokens'], tg_tps=round(tg, 1), pp_tps=round(max(cold), 1) if cold else '',
                            mtp_accept=round(da / dn, 3) if dn else '', n_samples=len(g),
                            flags=cmd + (' --mtp off' if not mtp else '') + ' | engine: ' + flags, date=DATE, source='own-measurement-strata', source_url=URL,
                            notes='Strata OpenAI server, ' + ('768-token completions to 3 realistic ~100-token chat prompts' if kind else '256-token completions') + ', temp 0.6, thinking off; tg = median predicted_per_second; pp = best cold-cache (cache_n=0) prompt_per_second'
                            + ('; MTP drafts never engaged (draft_n=0) on this build' if mtp and not dn else '') + ('; --mtp off still leaves Strata n-gram drafting (--spec 4) on' if not mtp and dn else '') + ('; variant ' + variant if variant else ''), **HW))
    return out


def llama_rows(res):
    rows = []
    for f, nc, _ in CFG['llama']:
        recs = [json.loads(l) for l in open(os.path.join(res, f))]
        for d in sorted({r.get('n_depth', 0) for r in recs}):
            pp = next(r for r in recs if r.get('n_depth', 0) == d and r['n_prompt'] > 0)
            tg = next(r for r in recs if r.get('n_depth', 0) == d and r['n_gen'] > 0)
            notes = (f'own run, llama-bench from llama.cpp b11658 (commit 3e4dfa8f3), engine llama.cpp, ' + (f"driver {CFG['driver']}, " if CFG['driver'] else '') + f"vast.ai, CPU {HW['cpu'].split(' (')[0]}, RAM {HW['host_ram_gib']} GiB; "
                     f'GGUF unsloth/Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf; -fa 1 -ngl 99 -r {CFG["reps"] or len(tg.get("samples_ts", [])) or 3}; Strata comparison run')
            if nc: notes += f'; MoE expert offload --n-cpu-moe {nc}' + (' (lowest that fits at this depth)' if 'd32k' in f else '') + '; excluded from site medians'
            rows.append(dict(device=HW['hw_id'], device_raw=HW['device_raw'], hw_id=HW['hw_id'], device_count=1, backend='CUDA', model='Qwen3.6 35B-A3B',
                             quant='UD-Q4_K_XL', params_b=round(tg['model_n_params'] / 1e9, 2), size_gib=round(tg['model_size'] / 2**30, 2), fa=1, ngl=99,
                             threads=tg['n_threads'], ubatch=tg['n_ubatch'], depth=d, pp_n=pp['n_prompt'], pp_tps=round(pp['avg_ts'], 2), tg_n=tg['n_gen'],
                             tg_tps=round(tg['avg_ts'], 2), build='3e4dfa8f3', build_num=11658, source='own-measurement', source_url=URL,
                             author='Local LLM Advisor (own measurement)', date=DATE, notes=notes, ttft_ms='', n_samples=CFG['reps'] or len(tg.get('samples_ts', [])) or 3, perf_score='', rank='', retrieved=DATE))
    return rows


def write(base, rows, fields):
    os.makedirs(os.path.dirname(base), exist_ok=True)
    with open(base + '.csv', 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=fields); w.writeheader(); w.writerows(rows)
    json.dump(rows, open(base + '.json', 'w'), indent=1)


def main(argv):
    global CFG, HW
    CFG = CARDS[os.path.basename(os.path.normpath(argv[0]))]; HW = CFG['hw']; hw = HW['hw_id']
    res = os.path.join(argv[0], 'res'); B = os.path.join(ROOT, 'data', 'benchmarks')
    s = strata_rows(res); l = llama_rows(res)
    write(os.path.join(B, 'own-strata', f'strata__{hw}__{DATE}'), s, STRATA_FIELDS)
    write(os.path.join(B, 'own', f'own-measurement__{hw}__{DATE}'), l, FIELDS)
    print(len(s), 'strata rows,', len(l), 'llama.cpp rows', file=sys.stderr)
    if '--merge' in argv:
        p = os.path.join(B, 'benchmarks_all'); cur = json.load(open(p + '.json'))
        k = lambda r: (r['source'], r['device'], r['model'], r['quant'], str(r['depth']), r['notes'][-40:], r['date'])
        have = {k(r) for r in cur}; new = [r for r in l if k(r) not in have]; cur += new
        json.dump(cur, open(p + '.json', 'w'))
        with open(p + '.csv', 'w', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader(); w.writerows(cur)
        print('merged', len(new), 'rows into benchmarks_all', file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1:])
