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

def text_cfg(c):
    # language-model part of the config: text_config (Gemma/Qwen VLMs), llm_config (Nemotron VL), else the top level
    return c.get("text_config") or c.get("llm_config") or c

def kv_from_config(c):
    t = text_cfg(c)
    bt = t.get("layers_block_type")  # Nemotron-H hybrid: one entry per block (mamba / attention / moe / mlp)
    lt = t.get("layer_types")
    kvh = t.get("num_key_value_heads"); hd = t.get("head_dim") or t["hidden_size"] // t["num_attention_heads"]
    L = len(bt) if bt else t["num_hidden_layers"]
    lin_layers, lin_bytes, lin_note = 0, 0, None
    if bt:
        full, swa = bt.count("attention"), 0
        mamba = bt.count("mamba")
        if mamba:  # Mamba-2: f32 SSM state (heads x head_dim x state) + conv state (conv_dim x (kernel-1)), fixed size
            nh, hdm, ds = t["mamba_num_heads"], t["mamba_head_dim"], t["ssm_state_size"]
            conv_dim = nh * hdm + 2 * t["n_groups"] * ds
            per = nh * hdm * ds * 4 + conv_dim * (t["conv_kernel"] - 1) * 4
            lin_layers, lin_bytes = mamba, mamba * per
            lin_note = "Mamba-2 layers keep a fixed-size f32 SSM + conv state (does not grow with context); computed from config.json mamba_* dims."
    elif lt:
        full = sum(1 for x in lt if x == "full_attention")
        swa = sum(1 for x in lt if x == "sliding_attention")
        nlin = sum(1 for x in lt if x == "linear_attention")
        nconv = sum(1 for x in lt if x == "conv")
        if nlin:  # Gated DeltaNet: f32 state (value heads x key dim x value dim) + conv state
            nk, nv = t["linear_num_key_heads"], t["linear_num_value_heads"]
            dk, dv = t["linear_key_head_dim"], t["linear_value_head_dim"]
            per = nv * dk * dv * 4 + (2 * nk * dk + nv * dv) * (t["linear_conv_kernel_dim"] - 1) * 4
            lin_layers, lin_bytes = nlin, nlin * per
            lin_note = "Gated DeltaNet layers keep a fixed-size f32 state (does not grow with context); computed from config.json linear_* dims."
        elif nconv and t.get("conv_L_cache"):  # LFM2 short-convolution layers: hidden_size x L_cache state (counted as f32)
            per = t["hidden_size"] * t["conv_L_cache"] * 4
            lin_layers, lin_bytes = nconv, nconv * per
            lin_note = "Short-convolution (LFM2) layers keep a tiny fixed-size state (does not grow with context); computed from config.json hidden_size and conv_L_cache."
    else:
        full, swa = L, 0
    out = {"layers": L, "full_layers": full,
           "full_kv_heads": t.get("num_global_key_value_heads") or kvh,
           "full_head_dim": t.get("global_head_dim") or hd}
    if swa:
        out.update({"swa_layers": swa, "swa_kv_heads": kvh, "swa_head_dim": hd, "window": t.get("sliding_window")})
    if lin_layers:
        out.update({"linear_layers": lin_layers, "linear_state_gb": round(lin_bytes / 1e9, 4), "linear_note": lin_note})
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
        card = api.get("cardData") or {}
        lic = card.get("license")
        if lic == "other" and card.get("license_name"): lic = card["license_name"]  # e.g. openmdw-1.1, lfm1.0
        rec = {"id": m["id"], "name": m["name"],
               "params_b": round(total / 1e9, 2) if total else None,
               "moe": m["moe"], "tags": m["tags"], "vision": m["vision"],
               "license": lic, "context_max": text_cfg(cfg).get("max_position_embeddings"),
               "kv": kv_from_config(cfg), "gguf_repo": m["gguf"], "quants": q,
               "source_url": f"https://huggingface.co/{m['id']}",
               "gguf_source_url": f"https://huggingface.co/{m['gguf']}",
               "last_verified": TODAY}
        if m.get("context_extended"):  # editorial: copied from the model card (YaRN), see manifest
            rec["context_native"] = rec["context_max"]
            rec["context_extended"] = m["context_extended"]
        if m.get("active_b"):
            rec["active_params_b"] = m["active_b"]
            rec["active_source"] = "model card text on source_url"
        old = prev.get(m["id"])
        if old and old.get("mlx"): rec["mlx"] = old["mlx"]  # refreshed below by mlx_repos.py
        if old is None: log.append(f"added {m['name']}")
        else:
            for k in ("params_b", "license", "quants", "kv", "context_max", "context_extended"):
                if old.get(k) != rec.get(k): log.append(f"{m['name']}: {k} changed")
        models.append(rec)
    existing = json.load(open(OUT)) if OUT.exists() else {"changelog": []}
    changelog = existing.get("changelog", [])
    if log or not changelog:
        changelog.insert(0, {"date": TODAY, "changes": log or ["initial data"]})
    json.dump({"generated": TODAY, "models": models, "changelog": changelog}, open(OUT, "w"), indent=1)
    print("wrote", OUT, len(models), "models")
    if "--no-mlx" not in sys.argv:  # find/verify mlx-community conversions for every model (new models included)
        import subprocess; subprocess.run([sys.executable, str(HERE / "mlx_repos.py")], check=False)
main()
