#!/usr/bin/env python3
"""Given llama-bench jsonl file(s) of a --n-cpu-moe sweep, print the n_cpu_moe with the best tg t/s (ties -> smaller n,
i.e. more experts on GPU). Prints nothing and exits 1 if no usable rows. Usage: best_ncmoe.py f1.jsonl [f2.jsonl ...]"""
import json, sys

best = None
for p in sys.argv[1:]:
    for line in open(p):
        line = line.strip()
        if not line.startswith('{'):
            continue
        r = json.loads(line)
        if r.get('n_gen', 0) > 0 and r.get('n_prompt', 0) == 0 and r.get('avg_ts', 0) > 0:
            key = (r['avg_ts'], -r.get('n_cpu_moe', 0))
            if best is None or key > best[0]:
                best = (key, r.get('n_cpu_moe', 0))
if best is None:
    sys.exit(1)
print(best[1])
