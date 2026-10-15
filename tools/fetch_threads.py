#!/usr/bin/env python3
"""Pre-fetch (and cache) extra llama.cpp / ik_llama.cpp threads for tools/ingest_more.py. Unauthenticated GitHub REST,
60 req/h limit: sleeps through the window (gh_fetch). Usage: python3 tools/fetch_threads.py"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import gh_fetch as g
from threads_list import THREADS
for repo, kind, n in THREADS:
    base = f'https://api.github.com/repos/{repo}/{kind}/{n}'
    try:
        d = g.get(base)['data']
        c = g.paged(base + '/comments') if d.get('comments') else []
        print(repo, kind, n, d.get('title', '')[:60], len(c), flush=True)
    except SystemExit: raise
    except Exception as e:
        print('FAIL', repo, kind, n, e, flush=True)
