#!/usr/bin/env python3
"""Find and verify MLX conversions (mlx-community, plain 4-bit and 8-bit) for every model in site/data/models.json.
Public Hugging Face API, no token. Writes a `mlx` block into each model record and a cached check list
tools/mlx_verified.json (every repo id the site shows must be in it). Only repos that exist, whose model card or
base_model points at the site model's original repo, and that ship .safetensors weights are kept. Nothing is guessed:
no match -> mlx.repos = [] and the site says "no MLX conversion yet".
On network failure the previous verified entry for that model is kept (and marked stale_check)."""
import json, re, sys, datetime, urllib.request, urllib.parse, pathlib
HERE = pathlib.Path(__file__).parent
MODELS = HERE.parent / "site" / "data" / "models.json"
CACHE = HERE / "mlx_verified.json"
TODAY = datetime.date.today().isoformat()
ORG = "mlx-community"
# preferred names per bit class, best first (plain mlx-lm / mlx-vlm quantization; gpt-oss ships MXFP4 experts)
SUFFIXES = {4: ["-4bit", "-MLX-4bit", "-MXFP4-Q4"], 8: ["-8bit", "-MLX-8bit", "-MXFP4-Q8"]}

def get(url, raw=False):
    req = urllib.request.Request(url, headers={"User-Agent": "llm-advisor-mlx-check"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
    return b.decode("utf-8", "replace") if raw else json.loads(b)

def info(repo):
    return get(f"https://huggingface.co/api/models/{repo}?blobs=true")

def readme(repo):
    try: return get(f"https://huggingface.co/{repo}/raw/main/README.md", raw=True)
    except Exception: return ""

def bases(api):
    b = (api.get("cardData") or {}).get("base_model") or []
    return [b] if isinstance(b, str) else list(b)

def derived_from(repo, api, model_id, depth=0):
    """True if repo's base_model or model card names model_id (one hop through an mlx-community bf16 intermediate)."""
    txt = readme(repo)
    if model_id.lower() in [x.lower() for x in bases(api)] or model_id.lower() in txt.lower():
        return True, txt
    if depth == 0:
        for b in bases(api):
            if b.startswith(ORG + "/"):
                try:
                    ok, _ = derived_from(b, info(b), model_id, 1)
                    if ok: return True, txt
                except Exception: pass
    return False, txt

def check_model(m):
    base = m["id"].split("/", 1)[1]
    found = get(f"https://huggingface.co/api/models?author={ORG}&search={urllib.parse.quote(base)}&limit=100")
    names = {x["id"].split("/", 1)[1].lower(): x["id"] for x in found}
    repos = []
    for bits, sufs in SUFFIXES.items():
        for s in sufs:
            rid = names.get((base + s).lower())
            if not rid: continue
            api = info(rid)
            st = [f for f in api.get("siblings", []) if f["rfilename"].endswith(".safetensors")]
            if not st: continue
            ok, txt = derived_from(rid, api, m["id"])
            if not ok: continue
            tool = "mlx-vlm" if re.search(r"mlx-vlm|mlx_vlm", txt) else "mlx-lm"
            repos.append({"repo": rid, "bits": bits, "label": s.lstrip("-"), "gb": round(sum(f.get("size", 0) for f in st) / 1e9, 1),
                          "tool": tool, "sha": api.get("sha"), "last_modified": api.get("lastModified"),
                          "url": f"https://huggingface.co/{rid}"})
            break
    return repos

def main():
    data = json.load(open(MODELS))
    cache = json.load(open(CACHE)) if CACHE.exists() else {"repos": {}, "models": {}}
    prev_models = cache.get("models", {})
    for m in data["models"]:
        try:
            repos = check_model(m); stale = False
        except Exception as e:
            print(f"  {m['name']}: HF check failed ({e}); keeping previous result", file=sys.stderr)
            repos = (prev_models.get(m["id"]) or {}).get("repos", []); stale = True
        m["mlx"] = {"repos": repos, "checked": TODAY if not stale else (prev_models.get(m["id"]) or {}).get("checked"),
                    "source": f"Hugging Face API search of the {ORG} organisation; each repo verified to exist, ship .safetensors weights and name {m['id']} as its base model",
                    **({"stale_check": True} if stale else {})}
        prev_models[m["id"]] = m["mlx"]
        for r in repos:
            cache["repos"][r["repo"]] = {"exists": True, "sha": r["sha"], "checked": m["mlx"]["checked"], "for": m["id"], "tool": r["tool"]}
        print(f"  {m['name']}: " + (", ".join(f"{r['repo']} ({r['tool']}, {r['gb']} GB)" for r in repos) or "no MLX conversion yet"))
    cache["models"] = prev_models; cache["generated"] = TODAY
    cache["_note"] = "Written by tools/mlx_repos.py. repos = every MLX repo id the site may show, with the HF API result; tests require each shown id to be here."
    json.dump(cache, open(CACHE, "w"), indent=1)
    json.dump(data, open(MODELS, "w"), indent=1)
    n = sum(1 for m in data["models"] if m["mlx"]["repos"])
    print(f"mlx: {n} of {len(data['models'])} models have an {ORG} conversion")

if __name__ == "__main__":
    main()
