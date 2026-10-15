(async function () {
  const $ = id => document.getElementById(id);
  const [hardware, models, measured] = await Promise.all(["data/hardware.json", "data/models.json", "data/measured.json"].map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)));
  const data = { hardware, models, measured };
  const opt = (v, t) => `<option value="${v}">${t}</option>`;
  $("ramt").innerHTML = hardware.ram_types.map(r => opt(r.id, r.name)).join("");
  $("ramt").value = "ddr5-5600";
  function fillDevices() {
    const k = $("kind").value;
    const list = k === "gpu" ? hardware.gpus : k === "apple" ? hardware.apple : k === "unified" ? hardware.unified : [];
    $("device").innerHTML = list.map(d => opt(d.id, d.name + (d.vram_gb ? ` (${d.vram_gb}GB)` : ""))).join("");
    const mems = k === "apple" ? [8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512] : k === "unified" ? [64, 96, 128] : [];
    $("mem").innerHTML = mems.map(m => opt(m, m + " GB")).join("");
    if (k === "apple") $("mem").value = 32;
    if (k === "unified") $("mem").value = 128;
    $("l-device").hidden = k === "cpu"; $("l-count").hidden = k !== "gpu";
    $("l-mem").hidden = !(k === "apple" || k === "unified");
    $("l-ram").hidden = !(k === "gpu" || k === "cpu"); $("l-ramt").hidden = $("l-ram").hidden;
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const MODE = { gpu: "Fits fully in GPU/unified memory", "moe-offload": "MoE: experts partly on CPU (--n-cpu-moe)", "dense-offload": "Partial layer offload to CPU (slow)", cpu: "CPU only" };
  function render() {
    const k = $("kind").value;
    const input = { kind: k, device: $("device").value, count: +$("count").value, memory_gb: +$("mem").value,
                    ram_gb: +$("ram").value, ram_type: $("ramt").value };
    const o = { use: $("use").value, ctx: +$("ctx").value, kvq: $("kvq").value };
    const { hwr, results } = Advisor.recommend(input, data, o);
    $("hwinfo").innerHTML = `Using <b>${esc(hwr.name)}</b>: ${hwr.pool.toFixed(1)} GB usable for model + KV` +
      (hwr.discrete && !hwr.cpuOnly ? `, ${hwr.ramAvail.toFixed(0)} GB RAM available for offload` : "") +
      (hwr.frac ? ` (assumes ${Math.round(hwr.frac * 100)}% of unified memory usable)` : "") + `, ${hwr.gpuBw} GB/s memory bandwidth.` +
      (hwr.eff ? ` Estimated speeds use an efficiency factor of ${hwr.eff.toFixed(2)}, ${esc(hwr.effSource)}.` : "");
    const comm = ((measured && measured.community) || []).filter(c => c.hw_id === input.device);
    $("community").innerHTML = comm.length ? `<section class="card"><h2>Community-submitted benchmarks <span class="badge est">unverified</span></h2>
      <p class="mut">Reviewed for format only; not independently verified and never used in the estimates above.</p><table><tr><th>Model</th><th>Quant</th><th>Backend</th><th>pp tok/s</th><th>tg tok/s</th><th>llama.cpp build</th><th>Date</th></tr>` +
      comm.map(c => `<tr><td>${esc(c.model)}</td><td>${esc(c.quant)}</td><td>${esc(c.backend)}</td><td>${c.pp_tps}</td><td>${c.tg_tps}</td><td>${esc(c.build || "")}</td><td>${esc(c.date || "")}</td></tr>`).join("") + `</table></section>` : "";
    if (!results.length) { $("results").innerHTML = `<div class="card">Nothing in the dataset fits this setup at ${o.ctx} context. Try a shorter context, q8_0 KV, or more memory.</div>`; return; }
    $("results").innerHTML = results.slice(0, 8).map((p, i) => {
      const m = p.model;
      return `<div class="card"><h3>${i + 1}. ${esc(m.name)} <span class="mut">${esc(p.quantLabel)}</span></h3>
      <span class="badge ${p.mode === "gpu" ? "ok" : "est"}">${MODE[p.mode]}</span>
      <span class="badge ${Advisor.speedInfo(p).cls}" title="${esc(Advisor.speedInfo(p).detail)}">${Advisor.speedInfo(p).text}</span>${p.usable ? "" : '<span class="badge est">likely too slow</span>'}
      <span class="badge">${m.moe ? `MoE ${m.params_b}B total / ${m.active_params_b}B active` : m.params_b + "B dense"}</span>
      <span class="badge">${esc(m.license || "license: see source")}</span>
      <p class="mut">${esc(Advisor.speedInfo(p).detail)}${p.speed ? " Source: " + p.speed.sources.map(x => `<a href="${x.url}" rel="noopener">${esc(x.id)}</a>`).join(", ") + ", latest " + esc(p.speed.latest) + "." : ""}</p>
      <p class="mut">Memory: weights ${p.weightsGB.toFixed(1)} GB + KV cache ${p.kvGB.toFixed(2)} GB @ ${o.ctx} ctx. On GPU ${p.gpuGB.toFixed(1)} GB, on CPU/RAM ${p.cpuGB.toFixed(1)} GB.</p>
      <div>llama.cpp <button data-c="l${i}">copy</button><pre id="l${i}">${esc(p.command.llama)}</pre>
      ollama <button data-c="o${i}">copy</button><pre id="o${i}">${esc(p.command.ollama)}</pre>
      ${p.command.ollamaNote ? `<p class="mut">${esc(p.command.ollamaNote)}</p>` : ""}</div>
      <p class="mut">Source: <a href="${m.source_url}" rel="noopener">${esc(m.id)}</a> &middot; GGUF: <a href="${m.gguf_source_url}" rel="noopener">${esc(m.gguf_repo)}</a> &middot; last verified ${m.last_verified}</p></div>`;
    }).join("");
    document.querySelectorAll("button[data-c]").forEach(b => b.onclick = () => navigator.clipboard && navigator.clipboard.writeText($(b.dataset.c).textContent));
  }
  $("kind").onchange = () => { fillDevices(); render(); };
  document.querySelectorAll("#f select,#f input").forEach(e => { if (e.id !== "kind") e.onchange = render; });
  // prefill from query string (used by generated pages): ?kind=&device=&count=&mem=&ram=&ramt=&use=
  const q = new URLSearchParams(location.search);
  if (q.get("kind")) $("kind").value = q.get("kind");
  fillDevices();
  [["device", "device"], ["count", "count"], ["mem", "mem"], ["ram", "ram"], ["ramt", "ramt"], ["use", "use"], ["ctx", "ctx"]].forEach(([p, id]) => { if (q.get(p)) $(id).value = q.get(p); });
  $("changelog").innerHTML = models.changelog.map(c => `<b>${c.date}</b><ul>${c.changes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`).join("");
  render();
})();
