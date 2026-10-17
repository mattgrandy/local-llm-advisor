/* Anonymous usage events for Umami. Every call is guarded: if the Umami script is blocked/offline (or the user sends
   Do Not Track) nothing happens and nothing throws. Events carry only enumerated UI choices, never free text, IPs or IDs. */
(function () {
  function track(name, props) { try { if (window.umami && typeof window.umami.track === "function") window.umami.track(name, props); } catch (e) { /* analytics must never break the page */ } }
  window.llmaTrack = track;
  var d = document, SEL = { kind: "hardware_type_selected", device: "device_selected", use: "use_case_selected", ctx: "context_selected" };
  var FILTERS = { "v-src": "speed_source", "v-fit": "fit", "v-lic": "license", "v-fam": "model_family", "v-min": "min_tokens_per_sec", "v-q": "search" };
  var lastSearch = 0;
  function val(el) { return String(el.value).slice(0, 60); }
  d.addEventListener("change", function (e) {
    var el = e.target, id = el && el.id; if (!id) return;
    if (SEL[id]) track(SEL[id], { value: val(el) });
    else if (id === "v-sort") track("sort_changed", { sort: val(el), source: "advisor" });
    else if (id === "v-src" || id === "v-fit" || id === "v-lic" || id === "v-fam") track("filter_changed", { filter: FILTERS[id], value: val(el) });
  }, true);
  d.addEventListener("input", function (e) {
    var el = e.target, id = el && el.id;
    if (id === "v-min") track("filter_changed", { filter: "min_tokens_per_sec" });
    else if (id === "v-q") { var n = Date.now(); if (n - lastSearch > 3000) { lastSearch = n; track("filter_changed", { filter: "search" }); } } // name only: never the text typed
  }, true);
  d.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var b;
    if ((b = t.closest("#v-dir"))) return track("sort_changed", { sort: "direction", source: "advisor" });
    if ((b = t.closest("table.sortable th button"))) return track("sort_changed", { sort: (b.textContent || "").slice(0, 30), source: "hardware_table" });
    if ((b = t.closest("button.copy"))) { var top = b.parentNode && b.parentNode.firstElementChild, lbl = ((top && top.textContent) || "").toLowerCase();
      return track("command_copied", { tool: /ollama/.test(lbl) ? "ollama" : /llama\.cpp/.test(lbl) ? "llama.cpp" : "other" }); }
    if (t.closest("#v-copy")) return track("link_copied");
    if (t.closest("#theme-toggle")) return void setTimeout(function () { track("theme_toggled", { theme: d.documentElement.getAttribute("data-theme") }); }, 0);
    if ((b = t.closest("[data-affiliate]"))) return track("affiliate_click", { partner: String(b.getAttribute("data-affiliate")).slice(0, 60), merchant: String(b.getAttribute("data-affiliate")).slice(0, 60), hardware: String(b.getAttribute("data-hardware") || "").slice(0, 80), slot: String(b.getAttribute("data-slot-id") || "").slice(0, 60), placement: String(b.closest("[data-placement]") ? b.closest("[data-placement]").getAttribute("data-placement") : "v1").slice(0, 10) });
    if ((b = t.closest("[data-sponsor]"))) return track("sponsor_click", { sponsor: String(b.getAttribute("data-sponsor")).slice(0, 60), slot: String(b.getAttribute("data-slot-id") || "").slice(0, 60) });
    if ((b = t.closest('a[href$="submit.html"], a[href*="submit.html?"]'))) return track("benchmark_submit_clicked", { where: "link" });
  }, true);
  d.addEventListener("submit", function (e) { if (e.target && e.target.id === "f" && /submit/.test(location.pathname)) track("benchmark_submit_clicked", { where: "form" }); }, true);
})();
