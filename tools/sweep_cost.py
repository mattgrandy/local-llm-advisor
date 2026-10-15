"""Cost model for cloud llama-bench sweeps. Prices from gpuhour.com API snapshot (Vast.ai, 1-GPU offers, as_of 2026-10-15)."""
import json,statistics as st
M=json.load(open('site/data/models.json'))['models']
O=json.load(open('/workspace/gh_all.json'))
CARDS={ # name: (gpuhour name, vram, ram_needed_ok, speed factor vs 4070 (assumption), provider)
 'RTX 3060 12GB':('RTX 3060',12,1.6),'RTX 4060 Ti 16GB':('RTX 4060 Ti',16,1.3),'RTX 4070':('RTX 4070',12,1.0),
 'RTX 3090 (compare)':('RTX 3090',24,0.8),'RTX 4090 (compare)':('RTX 4090',24,0.5),'RTX 5090 (compare)':('RTX 5090',32,0.4)}
DEPTHS=[0,4096,16384]
def kv_gb(ctx): return 0.15+ctx/16384*1.0   # coarse allowance: ~1GB per 16k ctx + overhead (assumption)
def plan(vram):
    cfg=[];dl=set()
    for m in M:
        for q in ('Q4_K_M','Q8_0'):
            g=m['quants'][q]['gb']
            if m['params_b']>60: continue            # 120B/GLM need >=96GB RAM; not on these cards
            fits=g+kv_gb(16384)<=vram*0.95
            if fits: cfg.append((m['name'],q,g,'gpu'));dl.add((m['id'],q,g))
            elif m['moe'] and g<=40 and q=='Q4_K_M': cfg.append((m['name'],q,g,'moe-offload'));dl.add((m['id'],q,g))
    return cfg,sorted(dl,key=lambda x:x[2])
def prices(gpu):
    v=sorted(x['price_per_gpu_hour_usd'] for x in O if x['gpu']==gpu and x['provider']=='Vast.ai' and x['gpu_count']>=1)
    if not v: return None
    return v[0],st.median(v),v[int(len(v)*.75)] ,len(v)
def run(vram,f,scn):
    cfg,dl=plan(vram)
    base={'gpu':135,'moe-offload':420}
    sec=sum(base[k[3]]*f for k in cfg)
    gb=sum(d[2] for d in dl)
    mbps={'low':300,'likely':120,'high':40}[scn]       # MB/s download assumption
    setup={'low':8,'likely':15,'high':30}[scn]*60
    mult={'low':0.8,'likely':1.0,'high':1.5}[scn]
    tot=(sec*mult+gb*1000/mbps+setup)*1.3
    return tot/3600,len(cfg),gb,sec/60
rows=[];tl=tlk=th=0
for name,(g,vram,f) in CARDS.items():
    p=prices(g)
    out=[name,vram,len(plan(vram)[0]),round(sum(d[2] for d in plan(vram)[1]),1)]
    hrs=[];cost=[]
    for i,s in enumerate(('low','likely','high')):
        h,_,_,_=run(vram,f,s);hrs.append(round(h,1));cost.append(round(h*p[i],2))
    rows.append((out,hrs,[round(x,2) for x in p[:3]],p[3],cost))
    if '(compare)' not in name: tl+=cost[0];tlk+=cost[1];th+=cost[2]
for r in rows:print(r)
print('target-card total (excl compare, excl 4060 8GB proxy)',round(tl,2),round(tlk,2),round(th,2))
json.dump(rows,open('/workspace/sweep_rows.json','w'))
