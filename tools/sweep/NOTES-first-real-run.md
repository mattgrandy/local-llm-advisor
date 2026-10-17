# First real GPU run (2026-10-15/16, Vast.ai RTX 3060 12GB, instance 56196185)
- No script bugs found; run_sweep.sh worked unmodified (11 configs done, 0 failed; ~25 min wall incl. downloads).
- Launch gotcha: when starting via ssh, use `setsid nohup ... > log 2>&1 < /dev/null &` or the ssh client hangs.
- Use the direct port from instance `ports` (22/tcp HostPort) + public_ipaddr; the SSH proxy port timed out.
- Disk 100GB is enough (models deleted after each). /api/v0/instances/ is deprecated for GET; use /api/v1/instances/.
- n-cpu-moe probe values that OOM are logged as "failed: likely OOM, continuing" - expected.
- 4060 Ti run: Mistral-Small-3.2-24B Q4_K_M (14.3GB on 16GB) OOMed allocating KV at depth 16384, which failed the whole config. Fixed in run_sweep.sh: on a multi-depth failure, retry each depth separately and keep what fits.
- Vast host 54048010 (GB) rejected our SSH key (Permission denied) - destroyed after ~5 min; relisted offers can have this problem, check ssh within a few minutes and switch host.
