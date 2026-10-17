/* Embed page helper: rebuilds the copy-paste snippets for the selected hardware. Same-origin only; no network, no tracking. */
(function () {
  var sel = document.getElementById("emb-hw"), dj = document.getElementById("emb-data"); if (!sel || !dj) return;
  var D = JSON.parse(dj.textContent), by = {}; D.hw.forEach(function (h) { by[h.slug] = h; });
  function set(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function update() {
    var h = by[sel.value]; if (!h) return; var B = D.base, page = B + "/hardware/" + h.slug + ".html", img = B + "/embed/badges/" + h.slug + ".svg", alt = "Recommended models for " + h.title + " \u2014 Local LLM Advisor";
    set("emb-html", '<a href="' + page + '"><img src="' + img + '" alt="' + alt + '" height="20"></a>');
    set("emb-md", "[![" + alt + "](" + img + ")](" + page + ")");
    set("emb-iframe", '<iframe src="' + B + "/embed/card/" + h.slug + '.html" width="380" height="215" style="border:0" loading="lazy" title="Recommended models for ' + h.title + ' (Local LLM Advisor)"></iframe>');
    set("emb-link", '<p style="max-width:380px;padding:12px 14px;border:1px solid #d5d9e2;border-radius:10px;font:14px/1.45 system-ui,sans-serif"><strong>Best local LLMs for ' + h.title + "</strong><br>See which models fit and how fast they run, with copy-paste commands.<br>" + '<a href="' + page + '">Data: Local LLM Advisor (localllmadvisor.com)</a></p>');
    var p = document.getElementById("emb-badge-prev"); if (p) { var i = p.querySelector("img"); i.src = "../embed/badges/" + h.slug + ".svg"; i.alt = alt; }
    var f = document.getElementById("emb-frame"); if (f) f.src = "../embed/card/" + h.slug + ".html";
  }
  sel.addEventListener("change", update);
})();
