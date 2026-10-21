#!/usr/bin/env python3
"""Demand ranking for local open-weight models. Real, fetched numbers only:
- Hugging Face API `downloads` (shown on model pages as "Downloads last month") and `likes` for the original repo and its main GGUF
  conversions (unsloth, bartowski, ggml-org, lmstudio-community; plain conversions only, found by HF search).
- Ollama library page "Downloads" (all-time, per library family, so shared by every size in that family).
Score = HF 30-day downloads of base + GGUF repos (one comparable signal); likes and Ollama are shown, not mixed in.
Writes site/data/popularity.json. Candidates: tools/demand_candidates.json + every site model."""
import json, re, sys, datetime, urllib.request, urllib.parse, pathlib
HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "site" / "data" / "popularity.json"
TODAY = datetime.date.today().isoformat()
GGUF_ORGS = ["unsloth", "bartowski", "ggml-org", "lmstudio-community"]
SKIP = re.compile(r"abliterat|uncensor|heretic|reap|mtp|nvfp4|awq|gptq|fp8|-i1-|imatrix|distill(?!-)|optiq|apex", re.I)

def get(url, raw=False):
    req = urllib.request.Request(url, headers={"User-Agent": "llm-advisor-demand"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
    return b.decode("utf-8", "replace") if raw else json.loads(b)

def hf(repo):
    d = get(f"https://huggingface.co/api/models/{repo}?expand[]=downloads&expand[]=likes&expand[]=safetensors&expand[]=pipeline_tag&expand[]=gguf")
    st = (d.get("safetensors") or {}).get("total")
    return {"repo": repo, "downloads_30d": d.get("downloads", 0) or 0, "likes": d.get("likes", 0) or 0, "params": st, "pipeline": d.get("pipeline_tag"), "url": f"https://huggingface.co/{repo}"}

def ggufs(base_id):
    org0, name = base_id.split("/", 1)
    name = re.sub(r"-BF16$", "", name)  # NVIDIA repos carry a -BF16 suffix their GGUFs drop
    out = []
    for org in GGUF_ORGS + [org0]:  # plus the model maker's own GGUF repo, if any
        try:
            res = get(f"https://huggingface.co/api/models?author={org}&search={urllib.parse.quote(name)}&limit=50")
        except Exception:
            continue
        for x in res:
            rn = x["id"].split("/", 1)[1]
            core = re.sub(r"^(" + re.escape(org0) + r"|nvidia|google|qwen|meta-llama|deepseek-ai|mistralai|zai-org)_", "", rn, flags=re.I)
            if core.lower() == name.lower() + "-gguf" and not SKIP.search(rn) and x["id"] not in out:
                out.append(x["id"])
    return out

def ollama(slug):
    t = get(f"https://ollama.com/library/{slug}", raw=True)
    t = re.sub(r"<script[\s\S]*?</script>", " ", t); t = re.sub(r"<[^>]+>", " ", t).replace("&nbsp;", " ")
    m = re.search(r"([\d.,]+)\s*([KMB]?)\s+Downloads", t)
    if not m: return None
    n = float(m.group(1).replace(",", "")) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2)]
    return {"slug": slug, "downloads_all_time": int(n), "shown": m.group(1) + m.group(2), "url": f"https://ollama.com/library/{slug}"}

def main():
    cand = json.load(open(HERE / "demand_candidates.json"))
    site = json.load(open(HERE.parent / "site" / "data" / "models.json"))["models"]
    site_ids = {m["id"]: m["name"] for m in site}
    oll = {**cand["site_ollama"], **{c["id"]: c.get("ollama") for c in cand["candidates"]}}
    todo = [(m["id"], oll.get(m["id"]), True) for m in site] + [(c["id"], c.get("ollama"), c["id"] in site_ids) for c in cand["candidates"] if c["id"] not in site_ids]
    rows, ocache = [], {}
    for mid, slug, on_site in todo:
        try:
            b = hf(mid)
        except Exception as e:
            print(f"  skip {mid}: {e}", file=sys.stderr); continue
        g = []
        for rid in ggufs(mid):
            try: g.append(hf(rid))
            except Exception: pass
        o = None
        if slug:
            if slug not in ocache:
                try: ocache[slug] = ollama(slug)
                except Exception: ocache[slug] = None
            o = ocache[slug]
        score = b["downloads_30d"] + sum(x["downloads_30d"] for x in g)
        rows.append({"id": mid, "name": site_ids.get(mid), "on_site": on_site, "score_30d": score, "base": b, "gguf": g, "ollama": o,
                     "params_b": round(b["params"] / 1e9, 1) if b["params"] else None})
        print(f"  {mid}: {score:,} (base {b['downloads_30d']:,} + {len(g)} GGUF) likes {b['likes']}{' ollama ' + o['shown'] if o else ''}")
    rows.sort(key=lambda r: -r["score_30d"])
    for i, r in enumerate(rows): r["rank"] = i + 1
    json.dump({"generated": TODAY, "method": "Score = Hugging Face downloads over the last 30 days for the original repo plus its plain GGUF conversions from " + ", ".join(GGUF_ORGS) + " and the model maker's own GGUF repo. Likes and Ollama library downloads (all-time, per model family) are shown for context and are not part of the score.",
               "sources": ["https://huggingface.co/docs/hub/api", "https://huggingface.co/docs/hub/models-download-stats", "https://ollama.com/library"], "models": rows}, open(OUT, "w"), indent=1)
    print("wrote", OUT, len(rows), "models")

if __name__ == "__main__":
    main()
