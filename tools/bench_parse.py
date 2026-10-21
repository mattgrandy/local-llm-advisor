"""Parsers + device normalisation for llama.cpp-style benchmark text. No network."""
import re, json, os
HW = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'site', 'data', 'hardware.json')))
HW_IDS = {x['id'] for k in ('gpus', 'apple', 'unified') for x in HW[k]}

FIELDS = ['device','device_raw','hw_id','device_count','backend','model','quant','params_b','size_gib','fa','ngl','threads','ubatch',
          'depth','pp_n','pp_tps','tg_n','tg_tps','build','build_num','source','source_url','author','date','notes',
          'ttft_ms','n_samples','perf_score','rank','retrieved']

# ---------------- device normalisation ----------------
def _slug(s):
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'(?i)laptop gpu', 'laptop', s)
    s = re.sub(r'(?i)\b(nvidia|geforce|amd|radeon|graphics|intel|apple|series)\b', ' ', s)
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def normalize_device(raw, mem_gb=None, gpu_cores=None):
    """Return (device, hw_id_or_''). device = hardware.json id when matched, else a canonical slug."""
    if not raw: return ('', '')
    s = raw.strip(); l = s.lower()
    mob = bool(re.search(r'laptop|mobile|max-q|notebook|\bmax q\b', l))
    # Apple
    m = re.search(r'\bm([1-6])\b(?:\s*(pro|max|ultra))?', l) if ('apple' in l or re.match(r'^m[1-6]\b', l)) else None
    if m:
        gen, var = m.group(1), (m.group(2) or '')
        base = f'm{gen}' + (f'-{var}' if var else '')
        if not gpu_cores:
            mc = re.search(r'(\d{2})\s*(?:GPU|[- ]core GPU)', s)
            if mc: gpu_cores = int(mc.group(1))   # e.g. LocalScore '12P+4E+40GPU'
        if var == 'max' and gen in ('4', '5'):
            c = int(gpu_cores) if gpu_cores else None
            if c in (32, 40): hid = f'{base}-{c}'
            else: return (base, '')
        else: hid = base
        return (hid, hid if hid in HW_IDS else '')
    if re.search(r'gb10|dgx spark', l): return ('dgx-spark', 'dgx-spark')
    if re.search(r'8060s|ai max\+? ?(pro )?395|strix halo', l): return ('strix-halo', 'strix-halo')
    if not mob:
        mem = float(mem_gb) if mem_gb else None
        if re.search(r'rtx 3060(?! ti)', l) and (mem is None or mem == 12) and not re.search(r'8 ?gb', l):
            if mem == 12 or '12' in l: return ('rtx-3060-12', 'rtx-3060-12')
            return ('rtx-3060', '')   # memory variant unknown (12GB vs 8GB)
        if re.search(r'rtx 3090(?! ti)', l): return ('rtx-3090', 'rtx-3090')
        if re.search(r'rtx 4090(?! d)', l): return ('rtx-4090', 'rtx-4090')
        if re.search(r'rtx 5090', l) and 'd ' not in l: return ('rtx-5090', 'rtx-5090')
        if re.search(r'rtx 4060 ti', l):
            if mem == 16 or '16' in l: return ('rtx-4060ti-16', 'rtx-4060ti-16')
            return ('rtx-4060-ti', '')
        if re.search(r'rtx 4060(?! ti)', l): return ('rtx-4060', 'rtx-4060')
        if re.search(r'rtx 4070(?! ti| super)', l): return ('rtx-4070', 'rtx-4070')
        if re.search(r'rtx 5080', l): return ('rtx-5080', 'rtx-5080')
        if re.search(r'rtx 5070 ti', l): return ('rtx-5070ti', 'rtx-5070ti')
        if re.search(r'rtx 5060 ti', l):
            if mem == 16 or '16' in l: return ('rtx-5060ti-16', 'rtx-5060ti-16')
            return ('rtx-5060-ti', '')
        if re.search(r'rtx 5070(?! ti)', l): return ('rtx-5070', 'rtx-5070')
        if re.search(r'rx 7900 xtx', l): return ('rx-7900xtx', 'rx-7900xtx')
        if re.search(r'rtx pro 6000', l) and not re.search(r'server', l): return ('rtx-pro-6000', 'rtx-pro-6000')
    d = _slug(s)
    if d in ('device', 'gpu', 'unknown', 'custom-gpu-0932'): return ('', '')
    return (d, '')

# ---------------- tables ----------------
def _cells(line):
    line = line.strip().rstrip('\r')
    if '|' not in line: return None
    if line.startswith('|'): line = line[1:]
    if line.endswith('|'): line = line[:-1]
    return [c.strip() for c in line.split('|')]

def iter_tables(text):
    """yield (start_line_idx, end_line_idx, header_cells, rows) for pipe tables (leading pipe optional)."""
    lines = text.split('\n'); i = 0
    while i < len(lines) - 1:
        h = _cells(lines[i]); sep = lines[i+1].strip().replace(' ', '')
        if h and len(h) >= 2 and re.fullmatch(r'\|?:?-{1,}:?(\|:?-{1,}:?)*\|*', sep):
            j = i + 2; rows = []
            while j < len(lines):
                c = _cells(lines[j])
                if c is None or not lines[j].strip(): break
                rows.append(c); j += 1
            yield i, j, h, rows; i = j
        else: i += 1

NUM = re.compile(r'(-?\d+(?:[.,]\d+)?)')
def fnum(s):
    m = NUM.search((s or '').replace('\u2714', '').replace('✅', ''))
    if not m: return None
    try: return float(m.group(1).replace(',', ''))
    except ValueError: return None

QUANT_RE = re.compile(r'\b((?:mostly\s+)?(?:F32|F16|BF16|MXFP4|NVFP4|(?:UD-)?I?Q\d(?:_[A-Z0-9]+)*(?:\s*-\s*(?:Small|Medium|Large|Mixed|S|M|L))?))\s*(?:MoE)?\s*$', re.I)
def split_model_quant(m):
    m = re.sub(r'\s+', ' ', m.strip())
    q = QUANT_RE.search(m)
    if q:
        quant = re.sub(r'^mostly\s+', '', q.group(1), flags=re.I)
        return m[:q.start()].strip(' ,') or m, quant
    q2 = re.search(r'\b(MXFP4|F16|BF16|Q\d_[A-Z0-9_]+|Q\d_\d)\b', m)
    return (m, q2.group(1)) if q2 else (m, '')

TEST_RE = re.compile(r'^(pp|tg)\s*(\d+)(?:\s*@\s*d(\d+))?$')
def parse_bench_table(h, rows):
    """llama-bench markdown table -> list of dict with pp/tg paired. Returns [] when not a llama-bench table."""
    hl = [x.lower() for x in h]
    if 'model' not in hl or not any('t/s' in x for x in hl): return []
    ti = next((k for k, x in enumerate(hl) if x == 'test'), None)
    si = next(k for k, x in enumerate(hl) if 't/s' in x)
    if ti is None: return []
    col = lambda name: hl.index(name) if name in hl else None
    out = {}
    order = []
    for r in rows:
        if len(r) < len(h) - 0: 
            if len(r) <= max(ti, si): continue
        t = TEST_RE.match(r[ti].replace('  ', ' ').strip())
        v = fnum(r[si])
        if not t or v is None: continue
        kind, n, depth = t.group(1), int(t.group(2)), int(t.group(3) or 0)
        def g(name, cast=str):
            c = col(name)
            if c is None or c >= len(r): return ''
            return r[c]
        key = (r[hl.index('model')], g('backend'), g('fa'), g('ngl'), g('threads'), g('n_ubatch'), g('n_batch'), depth, g('type_k'), g('n_gpu_layers'))
        if key not in out:
            out[key] = dict(model_raw=r[hl.index('model')], size=g('size'), params=g('params'), backend=g('backend'), fa=g('fa'), ngl=g('ngl'),
                            threads=g('threads'), ubatch=g('n_ubatch'), depth=depth, pp_n=None, pp_tps=None, tg_n=None, tg_tps=None)
            order.append(key)
        d = out[key]
        if kind == 'pp':
            if d['pp_tps'] is not None:   # second pp size for same config -> separate row
                k2 = key + (('pp', n),); out[k2] = dict(d, pp_n=n, pp_tps=v, tg_n=None, tg_tps=None); order.append(k2)
            else: d['pp_n'], d['pp_tps'] = n, v
        else:
            if d['tg_tps'] is not None:
                k2 = key + (('tg', n),); out[k2] = dict(d, pp_n=None, pp_tps=None, tg_n=n, tg_tps=v); order.append(k2)
            else: d['tg_n'], d['tg_tps'] = n, v
    res = []
    for k in order:
        d = out[k]
        mdl, quant = split_model_quant(d['model_raw'])
        d['model'], d['quant'] = mdl, quant
        d['params_b'] = fnum(d['params']) if d['params'].strip().upper().endswith('B') else None
        sz = d['size']; d['size_gib'] = fnum(sz) if 'GiB' in sz else (fnum(sz) / 1024 if 'MiB' in sz else None)
        res.append(d)
    return res

BUILD_RE = re.compile(r'build\s*[:=]\s*([0-9a-f]{6,12}|b?\d+)?\s*\(?\s*(b?\d{3,6}|[0-9a-f]{6,12})?\s*\)?', re.I)
def find_build(text, line_idx_end, lines):
    """nearest 'build: hash (num)' at or after table end (within 12 lines), else the nearest in whole text."""
    pat = re.compile(r'build\s*:\s*(?:b?(\d{3,6}))?\s*\(?([0-9a-f]{6,12})?\)?\s*(?:\((\d{3,6})\))?', re.I)
    def parse(l):
        m = re.match(r'^\W*build\s*:\s*(.+)$', l.strip(), re.I)
        if not m: return None
        s = m.group(1)
        h = re.search(r'\b([0-9a-f]{7,12})\b', s); n = re.search(r'\((\d{3,6})\)|\bb(\d{3,6})\b', s)
        hh = h.group(1) if h and re.search(r'[0-9]', h.group(1)) else ''
        nn = (n.group(1) or n.group(2)) if n else ''
        return (hh, nn) if (hh or nn) else None
    for k in range(line_idx_end, min(len(lines), line_idx_end + 12)):
        b = parse(lines[k])
        if b: return b
    for k in range(len(lines)):
        b = parse(lines[k])
        if b: return b
    return ('', '')

# ---------------- device from logs / text ----------------
def detect_devices(text):
    """Return list of device name strings found in ggml init logs (one per physical device line)."""
    devs = []
    for m in re.finditer(r'^\s*Device\s+\d+:\s*(.+?)(?:,\s*compute capability|,\s*gfx|\s*\(0x|,\s*VMM|$)', text, re.M):
        devs.append(m.group(1).strip())
    if not devs:
        for m in re.finditer(r'ggml_vulkan:\s*\d+\s*=\s*(.+?)\s*(?:\((?:radv|amdvlk|NVIDIA|proprietary|AMD proprietary|Intel|MESA|llvmpipe)[^)]*\)|\||$)', text, re.M | re.I):
            devs.append(m.group(1).strip())
    if not devs:
        for m in re.finditer(r'ggml_metal\w*:\s*GPU name:\s*(.+)$', text, re.M):
            devs.append(m.group(1).strip())
    return devs

def gpu_cores_from(text):
    m = re.search(r'(\d{2})[- ]?core GPU|(\d{2})\s*GPU(?: cores)?|GPU cores?\s*[:=]?\s*(\d{2})', text, re.I)
    return int(next(g for g in m.groups() if g)) if m else None

def vram_from(text):
    m = re.search(r'VRAM:\s*(\d+)\s*MiB', text)
    return round(float(m.group(1)) / 1024) if m else None


def parse_batched_table(h, rows, text, start_line):
    """llama-batched-bench table (PP, TG, B, N_KV, S_PP t/s, S_TG t/s). Model name from the nearest preceding '## org/model' heading."""
    hl = [x.strip().lower() for x in h]
    if not ('pp' in hl and 'tg' in hl and 'b' in hl and any(x.startswith('s_pp') for x in hl)): return []
    lines = text.split('\n')
    model = ''
    for k in range(start_line, -1, -1):
        m = re.match(r'^#{2,}\s+(\S+/\S+)\s*$', lines[k].strip())
        if m: model = m.group(1); break
    ipp = next(k for k, x in enumerate(hl) if x.startswith('s_pp')); itg = next(k for k, x in enumerate(hl) if x.startswith('s_tg'))
    out = []
    for r in rows:
        if len(r) <= max(ipp, itg): continue
        pp, tg = fnum(r[ipp]), fnum(r[itg])
        n_pp, n_tg, b = fnum(r[hl.index('pp')]), fnum(r[hl.index('tg')]), fnum(r[hl.index('b')])
        if pp is None or tg is None: continue
        mdl, q = split_model_quant(re.sub(r'(?i)-?GGUF$', '', model.split('/')[-1])); mdl = mdl.rstrip('-')
        out.append(dict(model_raw=model, model=mdl, quant=q, size='', params='', size_gib=None, params_b=None, backend='', fa='', ngl='', threads='',
                        ubatch='', depth=0, pp_n=int(n_pp), pp_tps=pp, tg_n=int(n_tg), tg_tps=tg, batch=int(b)))
    return out


GENERIC_DEV = re.compile(r'^(amd\s+)?radeon\s+graphics$|^(nvidia\s+)?(unknown|gpu)$|^$', re.I)
def clean_dev(n):
    n = re.sub(r'\s*\((?:AMD open-source driver|AMD proprietary driver|radv|amdvlk|[^)]*driver[^)]*)\)', '', n, flags=re.I).strip()
    return n

def device_count_from(text):
    """Count physical devices in the FIRST init log block (distinct device indices)."""
    idx = [int(m.group(1)) for m in re.finditer(r'^\s*Device\s+(\d+):', text, re.M)]
    if idx:
        first = []
        for i in idx:
            if first and i <= first[-1]: break
            first.append(i)
        return len(first)
    vk = [(int(m.group(1)), m.group(2).strip()) for m in re.finditer(r'ggml_vulkan:\s*(\d+)\s*=\s*(.+?)\s*(?:\(|\|)', text)]
    if vk:
        first = []
        for i, n in vk:
            if first and i <= first[-1][0]: break
            first.append((i, n))
        return len({n for _, n in first}) if len(first) > 1 and len({n for _, n in first}) < len(first) and re.search(r'amdvlk|radv', text) and len(first) == 2 else len(first)
    return None

def norm_backend(b):
    raw = b
    b = re.sub(r'\*|\(git [0-9a-f]+\)', '', b).strip()
    u = b.upper()
    for key, name in (('CUDA', 'CUDA'), ('ROCM', 'ROCm'), ('HIP', 'ROCm'), ('VULKAN', 'Vulkan'), ('METAL', 'Metal'), ('MTL', 'Metal'),
                      ('SYCL', 'SYCL'), ('OPENCL', 'OpenCL'), ('OPENVINO', 'OpenVINO'), ('CPU', 'CPU'), ('BLAS', 'CPU(BLAS)')):
        if key in u: return name
    return b
