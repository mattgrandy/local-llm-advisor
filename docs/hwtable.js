/* Click-to-sort for tables.sortable on hardware pages. Plain buttons in headers, explicit click handlers (Safari-safe), no dependencies. */
(function () {
  document.querySelectorAll("table.sortable").forEach(function (t) {
    var ths = Array.prototype.slice.call(t.tHead.rows[0].cells), body = t.tBodies[0];
    var orig = Array.prototype.slice.call(body.rows);
    ths.forEach(function (th, ci) {
      if (th.dataset.sort === undefined) return;
      var label = th.textContent, b = document.createElement("button"); b.type = "button"; b.className = "sortbtn"; b.textContent = label;
      b.setAttribute("aria-label", "Sort by " + label); th.textContent = ""; th.appendChild(b); th.setAttribute("aria-sort", "none");
      b.addEventListener("click", function (ev) {
        ev.preventDefault();
        var dir = th.getAttribute("aria-sort") === "descending" ? "ascending" : (th.getAttribute("aria-sort") === "ascending" ? "descending" : (th.dataset.sort === "text" ? "ascending" : "descending"));
        ths.forEach(function (o) { if (o.dataset.sort !== undefined) o.setAttribute("aria-sort", "none"); });
        th.setAttribute("aria-sort", dir);
        var rows = orig.slice(), m = dir === "ascending" ? 1 : -1;
        rows.sort(function (a, c) {
          var x = a.cells[ci].dataset.v, y = c.cells[ci].dataset.v;
          if (th.dataset.sort === "num") { x = x === "" ? NaN : +x; y = y === "" ? NaN : +y; if (isNaN(x) || isNaN(y)) return isNaN(x) === isNaN(y) ? 0 : isNaN(x) ? 1 : -1; return (x - y) * m; }
          return x.localeCompare(y) * m;
        });
        rows.forEach(function (r) { body.appendChild(r); });
        var st = document.getElementById(t.dataset.status); if (st) st.textContent = "Sorted by " + label + ", " + dir + ".";
      });
    });
  });
})();
