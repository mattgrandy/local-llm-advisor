#!/usr/bin/env python3
"""Rebuild site/data/models.json from Hugging Face (public API, no token).
Only facts that were actually fetched are written. Missing -> omitted/null."""
import json, re, sys, datetime, urllib.request, pathlib
HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "site" / "data" / "models.json"
TODAY = datetime.date.today().isoformat()
QUANTS = ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0"]

def get(url, raw=False):
    req = urllib.request.Request(url, headers={"User-Agent": "llm-advisor-updater"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
    return b.decode() if raw else json.loads(b)

def kv_from_config(c):
    t = c.get("text_config", c)
    L = t["num_hidden_layers"]
    lt = t.get("layer_types")
    kvh = t.get("num_key_value_heads"); hd = t.get("head_dim") or t["hidden_size"] // t["num_attention_heads"]
    if lt:
        full = sum(1 for x in lt if x == "full_attention")
        swa = sum(1 for x in lt if x == "sliding_attention")
    else:
        full, swa = L, 0
    out = {"layers": L, "full_layers": full,
           "full_kv_heads": t.get("num_global_key_value_heads") or kvh,
           "full_head_dim": t.get("global_head_dim") or hd}
    if swa:
        out.update({"swa_layers": swa, "swa_kv_heads": kvh, "swa_head_dim": hd, "window": t.get("sliding_window")})
    if t.get("sliding_window") and not lt and t.get("use_sliding_window"):
        pass  # Qwen-style flag; not used by listed models
    return out

def gguf_sizes(repo):
    tree = get(f"https://huggingface.co/api/models/{repo}/tree/main?recursive=1")
    res = {}
    for q in QUANTS:
        for prefix in ("", "UD-"):  # prefer plain quant, fall back to Unsloth dynamic
            tot, files = 0, []
            for f in tree:
                p = f["path"]; base = p.split("/")[-1]
                if not base.endswith(".gguf") or "mmproj" in base.lower(): continue
                if re.search(r"(^|[-_.])" + prefix + q + r"(-\d{5}-of-\d{5})?\.gguf$", base) and (prefix or "UD-" not in base):
                    tot += f.get("size", 0); files.append(p)
            if tot:
                res[q] = {"label": prefix + q, "gb": round(tot / 1e9, 2)}; break
    return res

def main():
    man = json.load(open(HERE / "model_manifest.json"))["models"]
    prev = {}
    if OUT.exists():
        prev = {m["id"]: m for m in json.load(open(OUT))["models"]}
    models, log = [], []
    for m in man:
        try:
            api = get(f"https://huggingface.co/api/models/{m['id']}")
            cfg = get(f"https://huggingface.co/{m['id']}/resolve/main/config.json")
            q = gguf_sizes(m["gguf"])
        except Exception as e:
            print("FAILED", m["id"], e, file=sys.stderr); continue
        total = api.get("safetensors", {}).get("total")
        lic = (api.get("cardData") or {}).get("license")
        rec = {"id": m["id"], "name": m["name"],
               "params_b": round(total / 1e9, 2) if total else None,
               "moe": m["moe"], "tags": m["tags"], "vision": m["vision"],
               "license": lic, "context_max": (cfg.get("text_config", cfg)).get("max_position_embeddings"),
               "kv": kv_from_config(cfg), "gguf_repo": m["gguf"], "quants": q,
               "source_url": f"https://huggingface.co/{m['id']}",
               "gguf_source_url": f"https://huggingface.co/{m['gguf']}",
               "last_verified": TODAY}
        if m.get("active_b"):
            rec["active_params_b"] = m["active_b"]
            rec["active_source"] = "model card text on source_url"
        old = prev.get(m["id"])
        if old is None: log.append(f"added {m['name']}")
        else:
            for k in ("params_b", "license", "quants", "kv"):
                if old.get(k) != rec.get(k): log.append(f"{m['name']}: {k} changed")
        models.append(rec)
    existing = json.load(open(OUT)) if OUT.exists() else {"changelog": []}
    changelog = existing.get("changelog", [])
    if log or not changelog:
        changelog.insert(0, {"date": TODAY, "changes": log or ["initial data"]})
    json.dump({"generated": TODAY, "models": models, "changelog": changelog}, open(OUT, "w"), indent=1)
    print("wrote", OUT, len(models), "models")
main()
