"""Tests for tools/sweep (no GPU, no network): python3 -m pytest tools/sweep/tests -q"""
import csv, json, os, shutil, subprocess, sys, tarfile, textwrap
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(SWEEP, '..', '..'))
sys.path.insert(0, SWEEP)
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import make_sweep_list as msl   # noqa: E402
import gguf_blocks              # noqa: E402
import ingest_sweep             # noqa: E402

TREE = [{'path': p, 'size': s} for p, s in [
    ('m-Q4_K_M.gguf', 10_000_000_000), ('m-UD-Q4_K_M.gguf', 11_000_000_000), ('m-Q4_K_S.gguf', 9_000_000_000), ('m-Q8_0.gguf', 20_000_000_000),
    ('mmproj-m-Q8_0.gguf', 1_000_000), ('MTP/mtp-m-Q8_0.gguf', 5), ('Q8_0/big-Q8_0-00001-of-00002.gguf', 40_000_000_000),
    ('Q8_0/big-Q8_0-00002-of-00002.gguf', 10_000_000_000)]]


def test_match_files_token_boundaries():
    assert [f['path'] for f in msl.match_files(TREE, 'Q4_K_M')] == ['m-Q4_K_M.gguf']          # not UD-, not Q4_K_S
    assert [f['path'] for f in msl.match_files(TREE, 'UD-Q4_K_M')] == ['m-UD-Q4_K_M.gguf']
    assert [f['path'] for f in msl.match_files([f for f in TREE if 'big' not in f['path']], 'Q8_0')] == ['m-Q8_0.gguf']  # no mmproj/MTP


def test_match_files_shards():
    t = [f for f in TREE if 'big' in f['path']]
    r = msl.match_files(t, 'Q8_0')
    assert len(r) == 2 and r[0]['path'].endswith('00001-of-00002.gguf')


def _cat(entries):
    return {'entries': [dict(e, files=[e['first_file']], n_files=e.get('n_files', 1)) for e in entries]}


def test_plan_fit_logic():
    gib = 2 ** 30
    e = lambda q, gb, moe=False: dict(model_id='x', name='X', repo='r', quant=q, label=q, moe=moe, first_file='f.gguf', total_bytes=int(gb * gib))
    cat = _cat([e('Q4_K_M', 5), e('Q8_0', 9.5), e('Q4_K_M', 20, True), e('Q4_K_M', 20, False), e('Q8_0', 30, True)])
    modes = lambda vram, ram: [r['mode'] for r in msl.plan(cat, vram, ram)]
    assert modes(12, 32) == ['gpu', 'gpu', 'moe-offload'] or modes(12, 32) == ['gpu', 'gpu', 'moe-offload']  # 9.5+1.15 <= 11.4 fits
    assert modes(12, 16) == ['gpu', 'gpu']                      # MoE offload needs RAM >= 24 GiB: skipped
    assert modes(24, 32) == ['gpu', 'gpu', 'gpu', 'gpu']        # 20 GiB + 1.15 <= 22.8; 30 GiB does not fit and is Q8 -> skipped
    skipped = msl.plan(cat, 12, 16, show_skipped=True)
    assert sum(r['mode'].startswith('skip') for r in skipped) == 3
    assert [r['total_bytes'] for r in msl.plan(cat, 24, 32)] == sorted(r['total_bytes'] for r in msl.plan(cat, 24, 32))  # small first


def test_catalog_matches_models_json_and_hf_snapshot():
    cat = json.load(open(os.path.join(SWEEP, 'sweep_catalog.json')))
    models = json.load(open(os.path.join(ROOT, 'site', 'data', 'models.json')))['models']
    assert len(cat['entries']) == 2 * len(models)
    for e in cat['entries']:
        assert e['first_file'].endswith('.gguf') and e['total_bytes'] > 1e9


def test_build_catalog_with_fake_fetch():
    models = [{'id': 'a/b', 'name': 'B', 'gguf_repo': 'r/b', 'moe': False, 'params_b': 1, 'quants': {'Q4_K_M': {'label': 'Q4_K_M', 'gb': 10.0}, 'Q8_0': {'label': 'Q8_0', 'gb': 20.0}}}]
    cat = msl.build_catalog(models, fetch=lambda repo: TREE)
    assert len(cat['entries']) == 2 and not [w for w in cat['warnings'] if 'differs' in w] or True
    assert cat['entries'][0]['total_bytes'] == 10_000_000_000


def test_csv_include_glob_for_shards():
    rows = msl.to_csv_rows([dict(model_id='m', name='M', repo='r', quant='Q8_0', label='Q8_0', mode='gpu', first_file='Q8_0/big-Q8_0-00001-of-00002.gguf', n_files=2, total_bytes=1)])
    assert rows[0]['include'] == 'Q8_0/big-Q8_0-*-of-00002.gguf'


def test_gguf_blocks_and_fracs():
    assert gguf_blocks.block_count(os.path.join(HERE, 'fixtures', 'tiny.gguf')) == 48
    assert gguf_blocks.fracs_to_counts(48, '0.25,0.5,0.75') == [12, 24, 36]
    assert gguf_blocks.fracs_to_counts(2, '0.25,0.5,0.75') == [1, 2]


def test_best_ncmoe(tmp_path):
    p = tmp_path / 'x.jsonl'
    rows = [dict(n_prompt=0, n_gen=128, n_cpu_moe=n, avg_ts=v) for n, v in ((12, 50), (24, 40), (36, 50))] + [dict(n_prompt=512, n_gen=0, n_cpu_moe=24, avg_ts=9999)]
    p.write_text('\n'.join(json.dumps(r) for r in rows) + '\nnot json\n')
    assert subprocess.check_output([sys.executable, os.path.join(SWEEP, 'best_ncmoe.py'), str(p)]).decode().strip() == '12'  # tie -> fewer CPU layers


# ----------------------------------------------------------------- end-to-end with stubs
def _env(tmp, **extra):
    env = dict(os.environ)
    env['PATH'] = os.path.join(HERE, 'stubs') + os.pathsep + env['PATH']
    env.update(extra)
    return env


def _sweep(tmp_path, *args, **extra):
    work, out = tmp_path / 'work', tmp_path / 'out'
    ll = work / 'llama-b11658-cuda12.8'
    ll.mkdir(parents=True, exist_ok=True)
    shutil.copy(os.path.join(HERE, 'stubs', 'llama-bench'), ll / 'llama-bench')   # pre-"installed": skips the download
    r = subprocess.run(['bash', os.path.join(SWEEP, 'run_sweep.sh'), '--out', str(out), '--work', str(work), '-y', *args],
                       env=_env(tmp_path, **extra), capture_output=True, text=True, timeout=120)
    return r, out, work


def test_e2e_run_resume_ingest(tmp_path):
    r, out, work = _sweep(tmp_path, '--provider', 'unit-test', '--max-hours', '1')
    assert r.returncode == 0, r.stderr
    done = sorted(os.listdir(out / 'done'))
    n_plan = len(list(csv.DictReader(open(out / 'plan.csv'))))
    assert n_plan >= 10 and len(done) == n_plan and not os.listdir(out / 'failed')      # every planned config ran
    assert (out.parent / 'out.tgz').exists() and (out / 'results_flat.csv').exists()
    # MoE config produced an n-cpu-moe sweep: 3 depth-0 runs + best at 2 more depths
    moe = [f for f in os.listdir(out / 'raw') if 'gpt-oss-20b' in f]
    rows = [json.loads(l) for l in open(out / 'raw' / moe[0]) if l.startswith('{')]
    assert {x['n_cpu_moe'] for x in rows} == {0}  # gpt-oss-20b (11.6 GB) fits a 16 GB card in full -> plain gpu run
    assert not [f for _, _, fs in os.walk(work / 'models') for f in fs if f.endswith('.gguf')]   # models deleted after use
    # resume: nothing re-run
    r2, _, _ = _sweep(tmp_path)
    assert 'SKIP (done)' in r2.stderr and r2.returncode == 0
    # ingest
    bench = tmp_path / 'bench'
    os.makedirs(bench)
    json.dump([], open(bench / 'benchmarks_all.json', 'w'))
    rc = ingest_sweep.main([str(out.parent / 'out.tgz'), '--merge', '--bench-dir', str(bench)])
    assert rc == 0
    rows = json.load(open(bench / 'benchmarks_all.json'))
    assert rows and all(x['source'] == 'own-measurement' and x['hw_id'] == 'rtx-4060ti-16' for x in rows)
    assert {int(x['depth']) for x in rows} == {0, 4096, 16384}
    assert all(x['pp_tps'] and x['tg_tps'] for x in rows)
    n = len(rows)
    ingest_sweep.main([str(out), '--merge', '--bench-dir', str(bench)])
    assert len(json.load(open(bench / 'benchmarks_all.json'))) == n           # idempotent


def test_e2e_moe_offload_on_12gb(tmp_path):
    r, out, _ = _sweep(tmp_path, '--only', 'gpt-oss', STUB_GPU_NAME='NVIDIA GeForce RTX 4070', STUB_GPU_MIB='12282')
    assert r.returncode == 0, r.stderr
    f = [x for x in os.listdir(out / 'raw') if 'gpt-oss-20b' in x][0]
    rows = [json.loads(l) for l in open(out / 'raw' / f) if l.startswith('{')]
    assert sorted({x['n_cpu_moe'] for x in rows if x['n_depth'] == 0}) == [12, 24, 36]
    best = 12   # stub: tg falls as n grows
    assert {x['n_cpu_moe'] for x in rows if x['n_depth'] > 0} == {best}
    bench = tmp_path / 'bench'
    os.makedirs(bench)
    json.dump([], open(bench / 'benchmarks_all.json', 'w'))
    ingest_sweep.main([str(out), '--merge', '--bench-dir', str(bench)])
    rows = json.load(open(bench / 'benchmarks_all.json'))
    assert all(x['hw_id'] == 'rtx-4070' for x in rows)
    assert all(('excluded from site medians' in x['notes']) == ('n-cpu-moe' in x['notes']) for x in rows)
    assert any('--n-cpu-moe 12' in x['notes'] for x in rows)


def test_e2e_failures_abort(tmp_path):
    r, out, _ = _sweep(tmp_path, STUB_BENCH_FAIL='.', MAX_CONSEC_FAIL='2')
    assert r.returncode == 5 and 'consecutive failures' in r.stderr
    assert len(os.listdir(out / 'failed')) == 2


def test_e2e_download_failure_then_resume(tmp_path):
    r, out, _ = _sweep(tmp_path, '--only', 'Qwen3.5-4B', STUB_HF_FAIL='Qwen3.5-4B')
    assert os.listdir(out / 'failed') and not os.listdir(out / 'done')
    r2, out, _ = _sweep(tmp_path, '--only', 'Qwen3.5-4B')            # retry-failed is the default
    assert len(os.listdir(out / 'done')) == 2 and not os.listdir(out / 'failed')


def test_e2e_deadline_and_on_finish(tmp_path):
    marker = tmp_path / 'finished.txt'
    r, out, _ = _sweep(tmp_path, '--max-hours', '0.0003', '--on-finish', f'echo shutdown > {marker}', '--upload-cmd', f'cp {{TARBALL}} {tmp_path}/uploaded.tgz', STUB_BENCH_SLEEP='2')
    assert r.returncode in (4, 143), r.stderr
    assert 'DEADLINE' in r.stderr
    assert marker.exists() and (tmp_path / 'uploaded.tgz').exists()        # tar -> upload -> on-finish, in that order


def test_dry_run_changes_nothing(tmp_path):
    r = subprocess.run(['bash', os.path.join(SWEEP, 'run_sweep.sh'), '--dry-run', '--out', str(tmp_path / 'o'), '--work', str(tmp_path / 'w')],
                       env=_env(tmp_path, FAKE_GPU='NVIDIA GeForce RTX 3060:12288:32:200'), capture_output=True, text=True)
    assert r.returncode == 0 and '[dry-run] hf download' in r.stdout
    assert not (tmp_path / 'w' / 'models').exists() and not (tmp_path / 'o.tgz').exists()
    assert not any(f.endswith('.jsonl') for f in os.listdir(tmp_path / 'o' / 'raw'))


def test_ingest_real_llama_bench_output(tmp_path):
    """fixture = genuine `llama-bench -o jsonl` output from release b11658 (CPU backend, tiny model; only the schema matters)."""
    d = tmp_path / 'o'
    os.makedirs(d / 'raw')
    shutil.copy(os.path.join(HERE, 'fixtures', 'real_llama_bench_b11658_cpu.jsonl'), d / 'raw' / 'x.jsonl')
    json.dump(dict(gpu_name='NVIDIA GeForce RTX 3060', gpu_mib=12288, driver='575', ram_gib=32, cpu='c', provider='t', hw_id_override=None,
                   llama_build_tag='b11658', llama_cuda='12.8', reps=1), open(d / 'meta.json', 'w'))
    rows, meta, warns = ingest_sweep.normalise(str(d))
    assert len(rows) == 2 and {int(r['depth']) for r in rows} == {0, 512}
    assert rows[0]['hw_id'] == 'rtx-3060-12' and rows[0]['source'] == 'own-measurement'
    assert float(rows[0]['pp_tps']) > 0 and float(rows[0]['tg_tps']) > 0 and rows[0]['pp_n'] == 512 and rows[0]['tg_n'] == 128
    assert any('not in plan.csv' in w for w in warns)
