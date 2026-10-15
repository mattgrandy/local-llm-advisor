#!/usr/bin/env python3
"""Builds site/data/quality.json: LMArena (CC-BY-4.0) overall + coding rating/rank for site models.
Only EXACT, explicitly mapped arena model names are used; models without a confident match get no entry (UI shows 'not rated')."""
import csv, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = {  # site model id -> LMArena model_name (same model/version)
 "google/gemma-4-26B-A4B-it": "gemma-4-26b-a4b", "google/gemma-4-31B-it": "gemma-4-31b",
 "openai/gpt-oss-20b": "gpt-oss-20b", "openai/gpt-oss-120b": "gpt-oss-120b",
 "zai-org/GLM-4.5-Air": "glm-4.5-air", "mistralai/Mistral-Small-3.2-24B-Instruct-2506": "mistral-small-2506"}
rows = list(csv.DictReader(open(os.path.join(ROOT, "data/benchmarks/lmarena_open_models.csv"))))
out = {"source": "LMArena leaderboard-dataset (text/latest), CC-BY-4.0", "url": "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset",
       "note": "rank as published in the LMArena text leaderboard (it includes closed models); higher rating is better", "models": {}}
for sid, an in MAP.items():
    e = {}
    for r in rows:
        if r["model_name"] == an and r["category"] in ("overall", "coding"):
            e[r["category"]] = {"rating": round(float(r["rating"])), "rank": int(float(r["rank"])), "votes": int(float(r["vote_count"])), "date": r["leaderboard_publish_date"]}
    if "overall" in e: e["arena_name"] = an; out["models"][sid] = e
json.dump(out, open(os.path.join(ROOT, "site/data/quality.json"), "w"), indent=1)
print(len(out["models"]), "models rated")
