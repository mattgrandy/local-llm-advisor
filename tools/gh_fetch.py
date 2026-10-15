"""GitHub REST fetch helpers with on-disk cache and rate-limit respect. Uses GITHUB_TOKEN if set (optional)."""
import json, os, sys, time, hashlib, urllib.request, urllib.error
RAW = os.path.join(os.path.dirname(__file__), '..', 'data', 'benchmarks', 'raw')
os.makedirs(RAW, exist_ok=True)
UA = 'llm-advisor-benchmark-ingest/0.1 (polite; cached; contact: site owner)'
def get(url, accept='application/vnd.github+json', refresh=False, binary=False):
    key = hashlib.sha1((url+accept).encode()).hexdigest()[:16]
    p = os.path.join(RAW, 'cache_'+key+'.json')
    if os.path.exists(p) and not refresh:
        return json.load(open(p))
    h = {'User-Agent': UA, 'Accept': accept}
    if os.environ.get('GITHUB_TOKEN'): h['Authorization'] = 'Bearer '+os.environ['GITHUB_TOKEN']
    while True:
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60)
            break
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and e.headers.get('x-ratelimit-remaining') == '0':
                wait = int(e.headers.get('x-ratelimit-reset', time.time()+60)) - time.time() + 2
                print(f'rate limited; sleeping {wait:.0f}s', file=sys.stderr)
                if wait > 3700: raise SystemExit('rate limit window too long; rerun later (cache preserved)')
                time.sleep(max(wait, 1)); continue
            raise
    data = json.loads(r.read().decode())
    out = {'url': url, 'fetched': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'link': r.headers.get('link'), 'data': data}
    json.dump(out, open(p, 'w'))
    rem = r.headers.get('x-ratelimit-remaining')
    if rem is not None and int(rem) < 3:
        wait = int(r.headers['x-ratelimit-reset']) - time.time() + 2
        if wait > 3700: print('near rate limit; stopping', file=sys.stderr); raise SystemExit(2)
        time.sleep(max(wait,1))
    return out
def paged(url):
    page = 1; rows = []
    while True:
        o = get(f'{url}{"&" if "?" in url else "?"}per_page=100&page={page}')
        rows += o['data']
        if not o['data'] or 'rel="next"' not in (o['link'] or ''): break
        page += 1
    return rows
