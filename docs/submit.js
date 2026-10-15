/* Benchmark submission: validation + llama-bench parsing + issue-body formatting. Browser + Node (tests). No deps. */
(function (root) {
  const BACKENDS = ["CUDA", "Metal", "ROCm/HIP", "Vulkan", "SYCL", "CPU", "Other"];
  const OSES = ["Linux", "Windows", "macOS", "Other"];
  const QUANTS = ["Q2_K", "Q3_K_M", "Q4_0", "Q4_K_S", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "MXFP4", "F16", "BF16", "Other"];
  const NUM = /^\d+(\.\d+)?$/;

  // Parse the markdown table printed by `llama-bench`. Returns { pp, tg, ppN, tgN, model, backend, ngl } (fields may be undefined).
  function parseLlamaBench(text) {
    const out = {};
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.includes("|")) continue;
      const c = line.split("|").map(s => s.trim());
      const m = c.find(x => /^(pp|tg)\d+$/.test(x));
      if (!m) continue;
      const idx = c.indexOf(m), val = parseFloat((c[idx + 1] || "").replace(/,/g, ""));
      if (!(val > 0)) continue;
      const n = parseInt(m.slice(2), 10);
      if (m.startsWith("pp")) { out.pp = val; out.ppN = n; } else { out.tg = val; out.tgN = n; }
      if (c[1] && !/^model$/i.test(c[1]) && !/^-+$/.test(c[1])) { out.model = c[1]; if (c[2] && !/^size$/i.test(c[2])) out.size = c[2]; }
      const be = c.find(x => /^(CUDA|Metal|ROCm|HIP|Vulkan|SYCL|BLAS|CPU)/i.test(x));
      if (be) out.backendRaw = be;
    }
    return out;
  }

  // Returns { ok, errors: {field: msg}, warnings: [msg], clean }. `hwIds` = known hardware ids (optional).
  function validate(s, hwIds) {
    const e = {}, w = [], str = k => (s[k] == null ? "" : String(s[k]).trim());
    if (str("website")) e.website = "spam";                      // honeypot field must stay empty
    const hw = str("hardware_id");
    if (!hw) e.hardware_id = "Choose your hardware (or Other).";
    else if (hw !== "other" && hwIds && !hwIds.includes(hw)) e.hardware_id = "Unknown hardware.";
    if (hw === "other" && str("hardware_other").length < 3) e.hardware_other = "Describe your hardware (e.g. 'RTX 3080 10GB').";
    if (str("hardware_other").length > 120) e.hardware_other = "Too long (120 max).";
    const ram = str("memory_gb");
    if (ram && !(NUM.test(ram) && +ram >= 1 && +ram <= 2048)) e.memory_gb = "Memory in GB, 1-2048.";
    if (str("model").length < 3 || str("model").length > 160) e.model = "Model name/file, 3-160 chars (e.g. gpt-oss-20b).";
    if (!QUANTS.includes(str("quant"))) e.quant = "Choose a quantization.";
    if (str("quant") === "Other" && !/^[A-Za-z0-9_.\-]{2,24}$/.test(str("quant_other"))) e.quant_other = "Give the quant name (letters, digits, _ . -).";
    if (!BACKENDS.includes(str("backend"))) e.backend = "Choose a backend.";
    for (const k of ["pp_tps", "tg_tps"]) {
      const v = str(k);
      if (!NUM.test(v) || !(+v > 0)) e[k] = "Positive number (tokens/second).";
      else if (+v > 200000) e[k] = "Implausibly high.";
    }
    if (!e.tg_tps && +str("tg_tps") > 3000) w.push("tg over 3000 tok/s is unusual for a single device; double-check the units (tokens/s, not t/s x batch).");
    if (!e.pp_tps && !e.tg_tps && +str("pp_tps") < +str("tg_tps")) w.push("pp is lower than tg; prompt processing is normally much faster than generation. Did you swap them?");
    for (const k of ["pp_n", "tg_n"]) if (str(k) && !(/^\d+$/.test(str(k)) && +str(k) >= 1 && +str(k) <= 1000000)) e[k] = "Whole number of tokens.";
    if (!/^(b?\d{3,6}|[0-9a-f]{7,40})$/i.test(str("build"))) e.build = "llama.cpp build: number like b6123 or commit hash (from `llama-bench --version`).";
    if (!OSES.includes(str("os"))) e.os = "Choose an OS.";
    if (str("os_detail").length > 80) e.os_detail = "Too long (80 max).";
    if (str("notes").length > 500) e.notes = "500 characters max.";
    if (str("contact") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str("contact")) && !/^@?[\w.\-]{2,40}$/.test(str("contact"))) e.contact = "Email or handle, or leave blank.";
    if (!s.consent) e.consent = "Please confirm.";
    const ok = Object.keys(e).length === 0;
    const clean = ok ? {
      hardware_id: hw, hardware_other: str("hardware_other"), memory_gb: ram ? +ram : null, model: str("model"),
      quant: str("quant") === "Other" ? str("quant_other") : str("quant"), backend: str("backend"),
      pp_tps: +str("pp_tps"), pp_n: str("pp_n") ? +str("pp_n") : 512, tg_tps: +str("tg_tps"), tg_n: str("tg_n") ? +str("tg_n") : 128,
      build: str("build"), os: str("os"), os_detail: str("os_detail"), flash_attn: !!s.flash_attn, notes: str("notes"),
      contact: str("contact"), consent: true, submitted_client_time: new Date().toISOString(), schema: 1
    } : null;
    return { ok, errors: e, warnings: w, clean };
  }

  // Markdown body for a GitHub issue; headings match .github/ISSUE_TEMPLATE/benchmark-submission.yml labels
  function toIssueBody(c) {
    const h = (k, v) => `### ${k}\n\n${v === "" || v == null ? "_No response_" : v}\n\n`;
    return h("Hardware id", c.hardware_id) + h("Hardware (if other)", c.hardware_other) + h("Memory (GB)", c.memory_gb) + h("Model", c.model) +
      h("Quantization", c.quant) + h("Backend", c.backend) + h("Prompt processing (tokens/s)", c.pp_tps) + h("Prompt tokens (pp)", c.pp_n) +
      h("Generation (tokens/s)", c.tg_tps) + h("Generated tokens (tg)", c.tg_n) + h("llama.cpp build", c.build) + h("Operating system", c.os) +
      h("OS detail", c.os_detail) + h("Flash attention", c.flash_attn ? "yes" : "no") + h("Notes", c.notes) + h("Contact (optional, never published)", c.contact) +
      h("Consent", "I ran this myself and agree it may be published (CC0) as unverified community data.");
  }
  function issueUrl(cfg, c) {
    const g = cfg && cfg.github_issue;
    if (!g || !g.repo || !/^[\w.\-]+\/[\w.\-]+$/.test(g.repo)) return null;
    const q = new URLSearchParams({ template: g.template || "benchmark-submission.yml", title: `Benchmark: ${c.hardware_id === "other" ? c.hardware_other : c.hardware_id} / ${c.model} ${c.quant}`, labels: "benchmark-submission" });
    return `https://github.com/${g.repo}/issues/new?${q}&body=${encodeURIComponent(toIssueBody(c))}`;
  }
  const api = { validate, parseLlamaBench, toIssueBody, issueUrl, BACKENDS, OSES, QUANTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Submit = api;
})(typeof window !== "undefined" ? window : globalThis);
