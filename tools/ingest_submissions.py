#!/usr/bin/env python3
"""Moderation + ingest for community benchmark submissions. Nothing is auto-published.

Flow
  1. Put raw submissions in data/submissions/inbox/ : *.json (the JSON block from the form; one object or a list) or
     *.md (a GitHub issue body created by the form / issue template, "### Label\\n\\nvalue" sections).
  2. python3 tools/ingest_submissions.py            -> re-validates each (same rules as site/submit.js), drops
     duplicates, flags outliers vs measured data, appends NEW ones to data/submissions/review_queue.json with
     status "pending" (existing decisions are never overwritten).
  3. A human edits review_queue.json: set "status" to "approved" or "rejected" (and optional "review_note").
  4. python3 tools/ingest_submissions.py --publish  -> writes data/submissions/community_reviewed.json containing ONLY
     approved entries and ONLY whitelisted fields (contact/email/notes-free of contact are stripped), each flagged
     "verified": false. tools/build_measured.py then adds them to site/data/measured.json as `community`; the site
     always labels them unverified and never uses them for estimates/calibration.
Flags raised: outlier_vs_measured (tg differs >3x from the median measured for same hardware+model class or >3x from
  same-hardware Llama-class median), duplicate, pp_lt_tg, implausible_tg_for_bandwidth (> 2x memory-bandwidth ceiling
  for a 0.5 GB model, i.e. impossible), unknown_hardware.
"""
import os, sys, re, json, glob, hashlib, subprocess, time
ROOT = os.path.join(os.path.dirname(__file__), '..')
SUB = f'{ROOT}/data/submissions'
HW = json.load(open(f'{ROOT}/site/data/hardware.json'))
BW = {x['id']: x['bandwidth_gbps'] for k in ('gpus', 'apple', 'unified') for x in HW[k]}
BACKENDS = ["CUDA", "Metal", "ROCm/HIP", "Vulkan", "SYCL", "CPU", "Other"]
OSES = ["Linux", "Windows", "macOS", "Other"]
QUANTS = ["Q2_K", "Q3_K_M", "Q4_0", "Q4_K_S", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "MXFP4", "F16", "BF16"]
NUM = re.compile(r'^\d+(\.\d+)?$')
PUBLIC = ['id', 'hw_id', 'hardware_other', 'memory_gb', 'model', 'quant', 'backend', 'pp_tps', 'pp_n', 'tg_tps', 'tg_n', 'build', 'os', 'flash_attn', 'date']
LABELS = {'Hardware id': 'hardware_id', 'Hardware (if other)': 'hardware_other', 'Memory (GB)': 'memory_gb', 'Model': 'model', 'Quantization': 'quant',
          'Backend': 'backend', 'Prompt processing (tokens/s)': 'pp_tps', 'Prompt tokens (pp)': 'pp_n', 'Generation (tokens/s)': 'tg_tps',
          'Generated tokens (tg)': 'tg_n', 'llama.cpp build': 'build', 'Operating system': 'os', 'OS detail': 'os_detail', 'Flash attention': 'flash_attn',
          'Notes': 'notes', 'Contact (optional, never published)': 'contact'}

def parse_issue_body(t):
    d = {}
    for m in re.finditer(r'###\s*(.+?)\s*\n+(.*?)(?=\n###\s|\Z)', t, re.S):
        k = LABELS.get(m.group(1).strip())
        v = m.group(2).strip()
        if k: d[k] = '' if v == '_No response_' else v
    if 'flash_attn' in d: d['flash_attn'] = d['flash_attn'].lower() in ('yes', 'true', '1')
    d['consent'] = 'Consent' in t and 'agree it may be published' in t
    return d

def num(x):
    x = str(x if x is not None else '').strip()
    return float(x) if NUM.match(x) else None

def validate(s):
    e = []
    hw = str(s.get('hardware_id', '')).strip()
    if hw != 'other' and hw not in BW: e.append('unknown_hardware')
    if hw == 'other' and len(str(s.get('hardware_other', '')).strip()) < 3: e.append('hardware_other_missing')
    if not 3 <= len(str(s.get('model', '')).strip()) <= 160: e.append('model')
    q = str(s.get('quant', '')).strip()
    if not (q in QUANTS or re.match(r'^[A-Za-z0-9_.\-]{2,24}$', q)): e.append('quant')
    if str(s.get('backend', '')).strip() not in BACKENDS: e.append('backend')
    for k in ('pp_tps', 'tg_tps'):
        v = num(s.get(k))
        if not v or v <= 0 or v > 200000: e.append(k)
    if not re.match(r'^(b?\d{3,6}|[0-9a-f]{7,40})$', str(s.get('build', '')).strip(), re.I): e.append('build')
    if str(s.get('os', '')).strip() not in OSES: e.append('os')
    if len(str(s.get('notes', ''))) > 500: e.append('notes')
    if not s.get('consent'): e.append('consent')
    return e

def load_inbox():
    out = []
    for f in sorted(glob.glob(f'{SUB}/inbox/*')):
        try:
            if f.endswith('.json'):
                d = json.load(open(f)); out += [(os.path.basename(f), x) for x in (d if isinstance(d, list) else [d])]
            elif f.endswith('.md'):
                out.append((os.path.basename(f), parse_issue_body(open(f).read())))
        except Exception as ex:
            print('skip unreadable', f, ex)
    return out

def measured_median(hw, model):
    p = f'{ROOT}/site/data/measured.json'
    if not os.path.exists(p) or hw not in BW: return None
    es = json.load(open(p))['entries'].get(hw, [])
    key = re.sub(r'[^a-z0-9]', '', model.lower())
    same = [e['tg'] for e in es if re.sub(r'[^a-z0-9]', '', e['model'].lower()) in key or key in re.sub(r'[^a-z0-9]', '', e['model'].lower())]
    return sorted(same)[len(same)//2] if same else None

def ingest():
    qp = f'{SUB}/review_queue.json'
    queue = json.load(open(qp)) if os.path.exists(qp) else []
    seen = {q['id'] for q in queue}; content_seen = {q['fingerprint'] for q in queue}
    new = 0
    for fname, s in load_inbox():
        errs = validate(s)
        fp = hashlib.sha1('|'.join(str(s.get(k, '')).strip().lower() for k in ('hardware_id', 'hardware_other', 'model', 'quant', 'backend', 'pp_tps', 'tg_tps', 'build')).encode()).hexdigest()[:12]
        sid = 'sub-' + fp
        if sid in seen: continue
        flags = list(errs)
        if fp in content_seen: flags.append('duplicate')
        tg, pp = num(s.get('tg_tps')), num(s.get('pp_tps'))
        if tg and pp and pp < tg: flags.append('pp_lt_tg')
        hw = str(s.get('hardware_id', '')).strip()
        if tg and hw in BW and tg > 2 * BW[hw] / 0.5: flags.append('implausible_tg_for_bandwidth')
        med = measured_median(hw, str(s.get('model', ''))) if tg else None
        if med and (tg > 3 * med or tg < med / 3): flags.append(f'outlier_vs_measured(median {med})')
        queue.append(dict(id=sid, fingerprint=fp, source_file=fname, status='rejected' if errs else 'pending',
                          review_note='auto-rejected: ' + ','.join(errs) if errs else '', flags=flags, submission={k: v for k, v in s.items()},
                          queued=time.strftime('%Y-%m-%d')))
        seen.add(sid); content_seen.add(fp); new += 1
    json.dump(queue, open(qp, 'w'), indent=1)
    from collections import Counter
    print(f'queued {new} new; queue now {len(queue)}:', dict(Counter(q['status'] for q in queue)))

def publish():
    qp = f'{SUB}/review_queue.json'
    queue = json.load(open(qp)) if os.path.exists(qp) else []
    out = []
    for q in queue:
        if q['status'] != 'approved': continue
        s = q['submission']
        if validate(s):  # approved but invalid: refuse
            print('refusing approved-but-invalid', q['id'], validate(s)); continue
        row = dict(id=q['id'], hw_id=s['hardware_id'], hardware_other=s.get('hardware_other', '') if s['hardware_id'] == 'other' else '',
                   memory_gb=num(s.get('memory_gb')), model=s['model'].strip(), quant=s['quant'].strip(), backend=s['backend'],
                   pp_tps=num(s['pp_tps']), pp_n=int(num(s.get('pp_n')) or 512), tg_tps=num(s['tg_tps']), tg_n=int(num(s.get('tg_n')) or 128),
                   build=s['build'].strip(), os=s['os'], flash_attn=bool(s.get('flash_attn')), date=q['queued'], verified=False)
        out.append({k: row[k] for k in PUBLIC + ['verified']})
    json.dump(out, open(f'{SUB}/community_reviewed.json', 'w'), indent=1)
    print(f'published {len(out)} approved submissions (all flagged verified=false) -> data/submissions/community_reviewed.json')
    subprocess.run([sys.executable, f'{ROOT}/tools/build_measured.py'], check=False, stdout=subprocess.DEVNULL)

if __name__ == '__main__':
    publish() if '--publish' in sys.argv else ingest()
