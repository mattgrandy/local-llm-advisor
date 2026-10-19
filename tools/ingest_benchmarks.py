#!/usr/bin/env python3
"""Reproduce the benchmark pull for llm-advisor.

Usage:  python3 tools/ingest_benchmarks.py [--refresh]
Env:    GITHUB_TOKEN (optional) raises the GitHub REST limit from 60/h to 5000/h. Without it the script sleeps
        through rate-limit windows (all responses are cached in data/benchmarks/raw/, so reruns are cheap).
Policy: only public GitHub REST API, raw.githubusercontent.com and Hugging Face downloads. No LocalScore, no Reddit,
        no Cloudflare/403 workarounds.
Outputs (data/benchmarks/): benchmarks_all.csv/.json (all rows), by_source/*.csv, lmarena_open_models.csv,
        coverage.json, summary_counts.json.  README.md is written by hand from summary_counts.json.
"""
import os, sys, re, csv, json, time, urllib.request, collections
sys.path.insert(0, os.path.dirname(__file__))
import gh_fetch as g
from bench_parse import *

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'benchmarks')
REPO = 'ggml-org/llama.cpp'
API = f'https://api.github.com/repos/{REPO}'
DISCUSSIONS = {  # number: (label, scoreboard parser)
    15013: 'CUDA scoreboard', 4167: 'Apple Silicon', 15021: 'ROCm scoreboard', 10879: 'Vulkan scoreboard',
    16578: 'DGX Spark', 23659: 'Strix Halo ROCm',
}
ISSUES = {  # number: repo  (issues with llama-bench tables, bodies + comments)
    13565: REPO, 11931: REPO, 29342: REPO, 19480: REPO, 263: 'ikawrakow/ik_llama.cpp',
}
BENCH_DIR_DEVICE = {'dgx-spark': 'NVIDIA GB10', 'mac-m2-ultra': 'Apple M2 Ultra', 'nemotron': 'NVIDIA GB10'}
args = set(sys.argv[1:])
REFRESH = '--refresh' in args

def mkrow(**kw):
    r = {f: '' for f in FIELDS}; r.update(kw); return r

def finish(r, mem=None, cores=None):
    dev, hid = normalize_device(r['device_raw'], mem, cores)
    if r.get('device_count') not in ('', None, 1): hid = ''
    r['device'], r['hw_id'] = dev, hid
    return r

# ------------------------------------------------------------ scoreboards
def scoreboard_rows(num, d):
    body = d['body'].replace('\r', ''); url = d['html_url']; date = d['updated_at'][:10]; rows = []
    lines = body.split('\n')
    def mk(chip, mem, backend, model, quant, fa, pp, tg, commit, who, extra=''):
        r = mkrow(device_raw=chip, backend=backend, model=model, quant=quant, params_b=6.74, fa=fa, ngl=99, pp_n=512, pp_tps=pp,
                  tg_n=128, tg_tps=tg, build=commit, source=f'llamacpp-discussion-{num}-scoreboard', source_url=url, author=who,
                  date=date, notes=('scoreboard snapshot (table edit date unknown; date=discussion updated_at). ' + extra).strip(), device_count=1)
        return finish(r, mem)
    if num in (15013, 15021):
        be = 'CUDA' if num == 15013 else 'ROCm'
        for i, j, h, trs in iter_tables(body):
            if not h or h[0].lower() != 'chip': continue
            head = next((l for l in reversed(lines[:i]) if l.startswith('###')), '')
            fa = 1 if 'with FA' in head else 0
            for r in trs:
                if len(r) < 5: continue
                pp, tg = fnum(r[2]), fnum(r[3])
                if pp is None or tg is None: continue
                mm = re.match(r'(\d+)\s*GB', r[1])
                rows.append(mk(r[0], mm and float(mm.group(1)), be, 'llama 7B (Llama 2 7B)', 'Q4_0', fa, pp, tg, r[4], r[5] if len(r) > 5 else ''))
    elif num == 10879:
        section = None
        for k, l in enumerate(lines):
            if '<summary>' in l: section = re.sub(r'</?summary>', '', l).strip()
            c = l.split('|')
            if section and len(c) >= 5 and '±' in l:
                chip = c[0].strip(); pp, tg = fnum(c[1]), fnum(c[2])
                if pp is None or tg is None: continue
                fa = 1 if 'FA enabled' in section else 0
                cpu = bool(re.search(r'Ryzen|Core |N150|CD8180|Xeon|EPYC|Snapdragon|Cortex', chip))
                r = mk(chip, None, 'CPU' if cpu else 'Vulkan', 'llama 7B (Llama 2 7B)', 'Q4_0', fa, pp, tg, c[3].strip(), '', c[4].strip() and f'comment: {c[4].strip()}')
                rows.append(r)
    elif num == 4167:
        for i, j, h, trs in iter_tables(body):
            if len(h) >= 9 and 'F16 PP' in h[2] + ' '.join(h):
                for r in trs:
                    if len(r) < 10: continue
                    name = re.sub(r'\[\^\d+\]|[✅🟨🟥]', '', r[0]).strip()
                    vals = [fnum(x) if x.strip() else None for x in r[3:9]]
                    cores = int(fnum(r[2])) if fnum(r[2]) else None
                    if all(v is None for v in vals): continue
                    for q, (pp, tg) in zip(('F16', 'Q8_0', 'Q4_0'), (vals[0:2], vals[2:4], vals[4:6])):
                        if pp is None and tg is None: continue
                        rr = mkrow(device_raw='Apple ' + name, backend='Metal', model='llama 7B (Llama 2 7B)', quant=q, params_b=6.74, ngl=99,
                                   pp_n=512, pp_tps=pp if pp is not None else '', tg_n=128, tg_tps=tg if tg is not None else '',
                                   build=(r[9].strip() if len(r) > 9 else ''), source='llamacpp-discussion-4167-summary', source_url=url,
                                   author='ggerganov+contributors', date=date, device_count=1,
                                   notes=f'bandwidth_gbps={r[1].strip()}; gpu_cores={cores}; summary table pinned to build 8e672ef (2023-11-21) so absolute numbers are low vs current builds')
                        rows.append(finish(rr, None, cores))
                break
        # M2 Ultra over-time table
        date_ = None
        for l in lines:
            if re.fullmatch(r'\d{4} [A-Z][a-z]{2} \d{1,2}', l.strip()):
                date_ = time.strftime('%Y-%m-%d', time.strptime(l.strip(), '%Y %b %d')); continue
            m = re.match(r'^(M\d \w+)\s+([0-9a-f]{7,12})(\s*\+\s*FA)?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|(.+)$', l)
            if m and date_:
                v = [fnum(x) for x in m.group(6).split('|')]
                if len(v) < 6: continue
                for q, (pp, tg) in zip(('F16', 'Q8_0', 'Q4_0'), (v[0:2], v[2:4], v[4:6])):
                    rr = mkrow(device_raw='Apple ' + m.group(1), backend='Metal', model='llama 7B (Llama 2 7B)', quant=q, params_b=6.74, ngl=99,
                               fa=1 if m.group(3) else 0, pp_n=512, pp_tps=pp, tg_n=128, tg_tps=tg, build=m.group(2),
                               source='llamacpp-discussion-4167-m2ultra-history', source_url=url, author='ggerganov', date=date_, device_count=1,
                               notes='same device re-benched across builds')
                    rows.append(finish(rr, None, int(m.group(5))))
    return rows

# ------------------------------------------------------------ generic comment / body / md text
APPLE_FALLBACK = re.compile(r'\b(M[1-6](?: (?:Pro|Max|Ultra))?)\b')
HW_FALLBACK = re.compile(r'\b((?:RTX|GTX|GT|Quadro|Titan|Tesla)\s?[A-Z]?\s?\d{3,4}\w*(?: Ti| SUPER| Super)?|RX\s?\d{3,4}(?: XTX| XT| GRE)?|Radeon (?:VII|Pro [A-Z]*\d+|\d{3}M?)|Instinct MI\d+\w*|Arc [AB]\d{3}|A100|H100|H200|L40S?|A6000|Ryzen AI Max\+? ?\w* ?\d*)', re.I)

def text_rows(text, source, url, author, date, default_device=None, id_note='', default_count=None):
    """Extract llama-bench tables from a free text blob (comment, issue body, md file)."""
    rows = []; stats = collections.Counter()
    t = text.replace('\r', '')
    flagged = bool(re.search(r'<s>|results are invalid|invalid results|\bINVALID\b', t))
    lines = t.split('\n')
    devs = [clean_dev(x) for x in detect_devices(t)]
    devs = [x for x in devs if not GENERIC_DEV.match(x)]
    uniq = list(dict.fromkeys(devs))
    dcount = device_count_from(t)
    cores = gpu_cores_from(t)
    if default_device: uniq, devs = [default_device], [default_device]
    dsrc = 'log' if uniq else ''
    if not uniq:
        head = t[:600]
        m = HW_FALLBACK.search(head) or (re.search(r'Apple (M[1-6](?: (?:Pro|Max|Ultra))?)|\b(?:MacBook|Mac Studio|Mac mini|Mac Pro)\b.{0,40}?\b(M[1-6](?: (?:Pro|Max|Ultra))?)\b', head))
        if m and m.lastindex and m.re is not HW_FALLBACK: 
            class _M:  # unify group access
                def __init__(s, v): s.v = v
                def group(s, i): return s.v
            m = _M(next(x for x in m.groups() if x))
        if m: uniq = [m.group(1)]; dsrc = 'text-guess'
    model_head = ''
    for i, j, h, trs in iter_tables(t):
        res = parse_bench_table(h, trs)
        if not res:
            res = parse_batched_table(h, trs, t, i)
        if not res: continue
        bl, bn = find_build(t, j, lines)
        for d in res:
            note = []
            if dsrc == 'text-guess': note.append('device guessed from comment text')
            if not uniq: note.append('device unknown')
            if len(uniq) > 1: note.append('multiple distinct devices in log: ' + ' + '.join(uniq))
            if flagged: note.append('author-flagged-invalid')
            if id_note: note.append(id_note)
            if d.get('batch'):
                note.append(f"llama-batched-bench B={d['batch']} (tg_tps/pp_tps are aggregate across {d['batch']} parallel sequences)")
                if not d['backend']:
                    rl = (uniq[0] if uniq else '').lower()
                    d['backend'] = 'Metal' if 'apple' in rl else ('CUDA' if re.search(r'nvidia|gb10|rtx', rl) else '')
            cnt = dcount or (len(devs) if devs else 1)
            if default_count: cnt = default_count
            elif not dsrc == 'log': cnt = 1
            raw = uniq[0] if len(uniq) == 1 else (' + '.join(uniq) if uniq else '')
            r = mkrow(device_raw=raw, device_count=cnt, backend=d['backend'], model=d['model'], quant=d['quant'], params_b=d['params_b'] or '',
                      size_gib=d['size_gib'] or '', fa=d['fa'], ngl=d['ngl'], threads=d['threads'], ubatch=d['ubatch'], depth=d['depth'] or '',
                      pp_n=d['pp_n'] or '', pp_tps=d['pp_tps'] if d['pp_tps'] is not None else '', tg_n=d['tg_n'] or '',
                      tg_tps=d['tg_tps'] if d['tg_tps'] is not None else '', build=bl, build_num=bn, source=source, source_url=url,
                      author=author, date=date, notes='; '.join(note))
            r['notes'] = r['notes']
            bk = d['backend']; r['backend'] = norm_backend(bk) if bk else ''
            if bk and bk != r['backend']: r['notes'] = (r['notes'] + f'; backend_raw={bk}').strip('; ')
            finish(r, vram_from(t) if dsrc == 'log' else None, cores)
            if cnt > 1: r['notes'] = (r['notes'] + f'; llama-bench log lists {cnt} devices (multi-GPU run unless -sm none/-mg used)').strip('; ')
            rows.append(r)
    stats['tables'] = len(rows)
    return rows, flagged

# ------------------------------------------------------------ main pull
def main():
    os.makedirs(OUT, exist_ok=True)
    allrows = []; counts = collections.OrderedDict(); notes = collections.OrderedDict()
    def add(src, rows):
        counts[src] = counts.get(src, 0) + len(rows); allrows.extend(rows)

    # 1. discussions: body (scoreboard) + comments
    for num, label in DISCUSSIONS.items():
        d = g.get(f'{API}/discussions/{num}', refresh=REFRESH)['data']
        url = d['html_url']
        if num in (15013, 15021, 10879, 4167):
            add(f'discussion-{num}-scoreboard-tables', scoreboard_rows(num, d))
        else:
            rows, _ = text_rows(d['body'], f'llamacpp-discussion-{num}-body', url, d['user']['login'], d['created_at'][:10])
            add(f'discussion-{num}-body', rows)
        comments = g.paged(f'{API}/discussions/{num}/comments')
        # NOTE: the REST /comments endpoint already returns replies (parent_id != null), so no extra reply fetch is needed.
        nrep = sum(1 for c in comments if c.get('parent_id')); ncom_tab = 0; invalid = 0; allc = list(comments)
        crow = []
        for c in allc:
            rows, flagged = text_rows(c['body'], f'llamacpp-discussion-{num}-comments', c['html_url'], c['user']['login'], c['created_at'][:10])
            if rows:
                ncom_tab += 1
                if flagged: invalid += len(rows)
            crow += rows
        counts[f'discussion-{num}-comments'] = len(crow); allrows += crow
        notes[f'discussion-{num}'] = dict(title=d['title'], comments_total=len(comments), replies_included_in_comment_list=nrep, top_level=len(comments)-nrep,
                                          comments_with_bench_tables=ncom_tab)

    # 2. llama.cpp repo benches/*.md (official, MIT)
    tree = g.get(f'{API}/contents/benches', refresh=REFRESH)['data']
    for x in tree:
        if x['type'] != 'dir': continue
        files = g.get(x['url'], refresh=REFRESH)['data']
        for f in files:
            if not f['name'].endswith('.md'): continue
            txt = urllib.request.urlopen(urllib.request.Request(f['download_url'], headers={'User-Agent': g.UA}), timeout=60).read().decode()
            commits = g.get(f"{API}/commits?path=benches/{x['name']}/{f['name']}&per_page=1", refresh=REFRESH)['data']
            dt = commits[0]['commit']['committer']['date'][:10] if commits else ''
            rows, _ = text_rows(txt, f"llamacpp-benches-{x['name']}", f['html_url'], 'ggml-org (llama.cpp maintainers)', dt,
                                default_device=BENCH_DIR_DEVICE.get(x['name']), id_note='official benches/ file; date = last commit of file')
            add(f"repo-benches-{x['name']}", rows)

    # 3. issues with tables (bodies + comments)
    for num, repo in ISSUES.items():
        base = f'https://api.github.com/repos/{repo}/issues/{num}'
        try:
            iss = g.get(base, refresh=REFRESH)['data']; cm = g.paged(base + '/comments') if iss['comments'] else []
        except Exception as e:
            notes[f'issue-{num}'] = f'fetch failed: {e}'; continue
        dd = ('NVIDIA GeForce RTX 3090', 16) if num == 263 else (None, None)  # per issue title "16x3090"
        rows, _ = text_rows(iss['body'] or '', f'github-issue-{repo.split("/")[1]}-{num}', iss['html_url'], iss['user']['login'], iss['created_at'][:10], default_device=dd[0], default_count=dd[1], id_note='device taken from issue title (16x RTX 3090)' if dd[0] else '')
        for c in cm:
            r2, _ = text_rows(c['body'] or '', f'github-issue-{repo.split("/")[1]}-{num}', c['html_url'], c['user']['login'], c['created_at'][:10], default_device=dd[0], default_count=dd[1], id_note='device taken from issue title (16x RTX 3090)' if dd[0] else '')
            rows += r2
        for r in rows: r['notes'] = (r['notes'] + f'; issue "{iss["title"][:70]}"').strip('; ')
        add(f'issue-{repo.split("/")[1]}-{num}', rows)
        notes[f'issue-{num}'] = iss['title']

    # 4. extra repos / datasets (separate module so failures don't stop the pull)
    try:
        import ingest_extra
        for src, rows, meta in ingest_extra.run(OUT, REFRESH):
            add(src, rows); notes[src] = meta
    except ImportError:
        pass

    # 5. our own llama-bench sweeps (data/benchmarks/own/*.json, written by tools/sweep/ingest_sweep.py). Re-added here so a
    #    rerun of this script never drops them; multi-GPU runs live in own-multigpu/ and stay out on purpose.
    import glob
    own = []
    for f in sorted(glob.glob(os.path.join(OUT, 'own', '*.json'))):
        own += json.load(open(f))
    if own: add('own-measurement', own)

    # de-dup comment rows that restate a scoreboard row (same pp & tg numbers & backend)
    sb = {(r['backend'], r['pp_tps'], r['tg_tps']) for r in allrows if 'scoreboard' in r['source'] or 'summary' in r['source']}
    kept = []; dropped = 0
    for r in allrows:
        if r['source'].endswith('-comments') and (r['backend'], r['pp_tps'], r['tg_tps']) in sb and r['pp_tps'] != '' and r['tg_tps'] != '':
            dropped += 1; continue
        kept.append(r)
    flagged_invalid = [r for r in kept if 'author-flagged-invalid' in r['notes']]
    kept = [r for r in kept if 'author-flagged-invalid' not in r['notes']]
    # unrealistic values guard
    bad = [r for r in kept if any(isinstance(r[k], float) and r[k] <= 0 for k in ('pp_tps', 'tg_tps'))]
    kept = [r for r in kept if r not in bad]

    def w(name, rows):
        with open(os.path.join(OUT, name + '.csv'), 'w', newline='') as f:
            wr = csv.DictWriter(f, fieldnames=FIELDS); wr.writeheader(); wr.writerows(rows)
        json.dump(rows, open(os.path.join(OUT, name + '.json'), 'w'), indent=1)
    w('benchmarks_all', kept)
    os.makedirs(os.path.join(OUT, 'by_source'), exist_ok=True)
    bysrc = collections.defaultdict(list)
    for r in kept: bysrc[r['source']].append(r)
    for k, v in bysrc.items():
        with open(os.path.join(OUT, 'by_source', k + '.csv'), 'w', newline='') as f:
            wr = csv.DictWriter(f, fieldnames=FIELDS); wr.writeheader(); wr.writerows(v)
    # hardware coverage
    hwids = [(k, x['id']) for k in ('gpus', 'apple', 'unified') for x in HW[k]]
    cov = {}
    for _, hid in hwids:
        rr = [r for r in kept if r['hw_id'] == hid]
        cov[hid] = dict(rows=len(rr), sources=sorted({r['source'] for r in rr}),
                        models=sorted({r['model'] for r in rr if not r['model'].startswith('llama 7B (Llama 2')})[:30],
                        non_llama2_rows=len([r for r in rr if not r['model'].startswith('llama 7B')]))
    json.dump(cov, open(os.path.join(OUT, 'coverage.json'), 'w'), indent=1)
    summary = dict(rows_total=len(kept), dropped_dup_of_scoreboard=dropped, dropped_author_flagged_invalid=len(flagged_invalid),
                   dropped_nonpositive=len(bad), counts_by_source_raw=counts,
                   counts_by_source_final=dict(collections.Counter(r['source'] for r in kept)), notes=notes,
                   rows_with_hw_id=len([r for r in kept if r['hw_id']]), rows_device_unknown=len([r for r in kept if not r['device']]),
                   generated=time.strftime('%Y-%m-%d %H:%M %Z'))
    json.dump(summary, open(os.path.join(OUT, 'summary_counts.json'), 'w'), indent=1)
    print(json.dumps(summary, indent=1)[:3500])

if __name__ == '__main__':
    main()
