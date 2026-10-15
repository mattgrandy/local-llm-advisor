(async function () {
  const $ = id => document.getElementById(id), esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const j = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
  const [hw, cfg] = await Promise.all([j("data/hardware.json"), j("submit-config.json")]);
  const list = hw ? ["gpus", "apple", "unified"].flatMap(k => hw[k]) : [];
  const ids = list.map(d => d.id);
  const opts = (a, ph) => `<option value="">${ph}</option>` + a.map(x => `<option value="${esc(x[0])}">${esc(x[1])}</option>`).join("");
  $("hardware_id").innerHTML = opts(list.map(d => [d.id, d.name + (d.vram_gb ? ` (${d.vram_gb}GB)` : "")]).concat([["other", "Other (describe below)"]]), "Choose...");
  $("quant").innerHTML = opts(Submit.QUANTS.map(x => [x, x]), "Choose...");
  $("backend").innerHTML = opts(Submit.BACKENDS.map(x => [x, x]), "Choose...");
  $("os").innerHTML = opts(Submit.OSES.map(x => [x, x]), "Choose...");
  const mode = (cfg && cfg.mode) || "none";
  const live = mode === "github_issue" ? !!Submit.issueUrl(cfg, { hardware_id: "x", model: "x", quant: "x" }) : mode === "endpoint" ? /^https:\/\//.test(cfg.endpoint_url || "") : false;
  $("mode").innerHTML = live ? (mode === "github_issue" ? `Submissions open a prefilled GitHub issue in <code>${esc(cfg.github_issue.repo)}</code>; you press Submit there.` : "Submissions are sent to the configured endpoint.")
    : `<b>Submissions are not live yet</b> (no destination is configured). You can fill the form to validate and get a copy-paste block, but nothing is sent anywhere.`;
  $("send").textContent = live ? (mode === "github_issue" ? "Open prefilled GitHub issue" : "Submit") : "Validate and show copy-paste block";
  $("paste").addEventListener("input", () => {
    const p = Submit.parseLlamaBench($("paste").value);
    if (p.pp) $("pp_tps").value = p.pp; if (p.tg) $("tg_tps").value = p.tg;
    if (p.ppN) $("pp_n").value = p.ppN; if (p.tgN) $("tg_n").value = p.tgN;
    if (p.model && !$("model").value) $("model").value = p.model;
    if (p.backendRaw) { const m = { cuda: "CUDA", metal: "Metal", rocm: "ROCm/HIP", hip: "ROCm/HIP", vulkan: "Vulkan", sycl: "SYCL", cpu: "CPU", blas: "CPU" }[p.backendRaw.toLowerCase().split(/[ ,]/)[0]]; if (m && !$("backend").value) $("backend").value = m; }
    $("parsed").textContent = (p.pp || p.tg) ? `Parsed from your output: pp ${p.pp || "?"}, tg ${p.tg || "?"} tok/s.` : "Could not find pp/tg rows in that text.";
  });
  $("f").addEventListener("submit", async ev => {
    ev.preventDefault();
    const s = {}; new FormData($("f")).forEach((v, k) => s[k] = v); s.consent = $("consent").checked; s.flash_attn = $("flash_attn").checked;
    const r = Submit.validate(s, ids);
    document.querySelectorAll(".err").forEach(n => n.textContent = "");
    for (const [k, m] of Object.entries(r.errors)) { const n = $("e_" + k); if (n) n.textContent = m; }
    $("out").innerHTML = "";
    if (!r.ok) { $("status").textContent = "Please fix the highlighted fields."; return; }
    $("status").innerHTML = r.warnings.map(w => `<div class="mut">&#9888; ${esc(w)}</div>`).join("");
    const block = JSON.stringify(r.clean, null, 2);
    if (live && mode === "github_issue") { const u = Submit.issueUrl(cfg, r.clean); window.open(u, "_blank", "noopener"); $("status").innerHTML += "Opened the prefilled issue in a new tab. It is not submitted until you press Submit on GitHub."; }
    else if (live && mode === "endpoint") {
      try { const res = await fetch(cfg.endpoint_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: block });
        $("status").innerHTML += res.ok ? "Thanks! Submitted for review. It will appear as unverified once reviewed." : `Submission failed (HTTP ${res.status}). Nothing was saved; copy the block below instead.`;
      } catch (e) { $("status").innerHTML += "Network error. Nothing was saved; copy the block below instead."; }
    } else $("status").innerHTML += "Valid. <b>Nothing was sent</b> (no destination is configured yet).";
    $("out").innerHTML = `<p class="mut">Your submission as JSON:</p><pre>${esc(block)}</pre>`;
  });
})();
