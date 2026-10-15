#!/usr/bin/env python3
"""Print the transformer block (layer) count from a GGUF header: `<arch>.block_count`. No dependencies.
Usage: gguf_blocks.py model.gguf            -> prints e.g. 48 (exit 1 if not found)
       gguf_blocks.py --fracs 48 0.25,0.5,0.75   -> prints "12 24 36" (n-cpu-moe values, de-duplicated, >=1)"""
import struct, sys

_SCALAR = {0: 'B', 1: 'b', 2: 'H', 3: 'h', 4: 'I', 5: 'i', 6: 'f', 7: '?', 10: 'Q', 11: 'q', 12: 'd'}


def _read(f, fmt):
    n = struct.calcsize(fmt)
    b = f.read(n)
    if len(b) != n:
        raise EOFError('truncated GGUF')
    return struct.unpack('<' + fmt, b)[0]


def _skip_value(f, t):
    if t in _SCALAR:
        f.seek(struct.calcsize(_SCALAR[t]), 1)
    elif t == 8:
        f.seek(_read(f, 'Q'), 1)
    elif t == 9:
        et, n = _read(f, 'I'), _read(f, 'Q')
        if et in _SCALAR:
            f.seek(struct.calcsize(_SCALAR[et]) * n, 1)
        else:
            for _ in range(n):
                _skip_value(f, et)
    else:
        raise ValueError(f'unknown GGUF value type {t}')


def block_count(path):
    with open(path, 'rb') as f:
        if f.read(4) != b'GGUF':
            raise ValueError('not a GGUF file')
        _read(f, 'I')            # version
        _read(f, 'Q')            # tensor count
        nkv = _read(f, 'Q')
        for _ in range(nkv):
            key = f.read(_read(f, 'Q')).decode('utf-8', 'replace')
            t = _read(f, 'I')
            if key.endswith('.block_count') and t in (4, 5, 10, 11):
                return _read(f, _SCALAR[t])
            _skip_value(f, t)
    return None


def fracs_to_counts(n_layers, fracs):
    out = []
    for fr in fracs.split(','):
        v = max(1, min(n_layers, round(n_layers * float(fr))))
        if v not in out:
            out.append(v)
    return out


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--fracs':
        print(' '.join(str(x) for x in fracs_to_counts(int(sys.argv[2]), sys.argv[3])))
        sys.exit(0)
    n = block_count(sys.argv[1])
    if n is None:
        sys.exit(1)
    print(n)
