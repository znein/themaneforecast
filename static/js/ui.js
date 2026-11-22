// The Mane Forecast page: where's Mikey (zip, saved on this device), the week, and each day's popup.
(function () {
  "use strict";
  var M = window.Mane, $ = function (id) { return document.getElementById(id); };
  var ctx = null;
  // one colour per source, matching --src-0..4 in style.css (NWS first, then the models)
  var SOURCE_COLORS = ["#5cb8ff", "#ffaa3c", "#c39bff", "#4fd1a5", "#ff7a90"];
  var TEXT = "#9aa3b5", GRID = "rgba(154, 163, 181, 0.14)";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fix2(v) { return (Math.round(v * 100) / 100).toFixed(2); }

  // ---------- where's Mikey? ----------
  function askForPlace(message) {
    $("setup").hidden = false; $("week").hidden = true; $("status").hidden = true;
    $("setup-msg").textContent = message || "";
  }
  function found(p) { return "Found " + p.label + " · NWS square " + p.grid + " (from " + p.source + ")."; }
  function lookup(promise, msgId, onFound, suffix) {
    var msg = $(msgId); msg.textContent = "Looking it up…";
    promise.then(function (p) { msg.textContent = found(p) + (suffix || ""); onFound(p); }, function (err) { msg.textContent = err.message; });
  }

  // ---------- loading ----------
  function start(force) {
    var place = M.getPlace();
    if (!place) { askForPlace(); return; }
    $("setup").hidden = true;
    $("status").hidden = false;
    $("status").textContent = "Fetching the latest forecast…";
    M.load(place, force).then(function (res) {
      ctx = M.context(res.bundle);
      renderAll(res);
    }).catch(function (err) {
      $("status").hidden = false;
      $("status").textContent = (err && err.message ? err.message : "Something went wrong.") + " Try again in a minute.";
    });
  }

  function renderAll(res) {
    var b = ctx.bundle;
    $("issued").innerHTML = '<i class="bi bi-clock-history" aria-hidden="true"></i> NWS forecast issued ' + esc(ctx.issued);
    $("issued").hidden = false;
    var n = Object.keys(ctx.M).length;
    $("lead-sources").textContent = n ? n + " weather models" : "the weather models";
    var notes = [];
    if (res.stale) notes.push("Showing the forecast from " + M.clock(b.at, ctx.off) + " because the latest didn't load.");
    if (b.errors.length) notes.push(b.errors.join(" and ") + " didn't answer, so " + (b.errors.length === 1 ? "it's" : "they're") + " left out for now. It'll try again in a few minutes.");
    $("status").innerHTML = notes.map(esc).join(" ") + (notes.length ? ' <button type="button" class="btn btn-small" id="try-now">Try now</button>' : "");
    $("status").hidden = !notes.length;
    if (notes.length) $("try-now").addEventListener("click", function () { start(true); });
    renderWeek();
    if (window.MikeyBlanket) window.MikeyBlanket.render(b);
    if (window.MikeyGuard) window.MikeyGuard.render(M.rainHours(ctx));
  }

  // ---------- the week ----------
  function nightOf(day) {
    // Which blanket night (Neighcast's 6 pm -> 8 am) belongs to this card: a night-only card that
    // starts before 8 am is the rest of last night.
    var d = M.barnDate(day.startMs, ctx.off);
    if (day.high == null && d.getUTCHours() < 8) d.setUTCDate(d.getUTCDate() - 1);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function renderWeek() {
    $("week").hidden = false;
    $("days").innerHTML = ctx.days.map(function (d, i) {
      var r = M.compareDay(ctx, d).range, spread = "";
      if (r.high) spread = '<span class="day-spread" title="Highest temperature, across every source"><span class="dot ' + (r.high[1] - r.high[0] <= 3 ? "agree" : "split") + '" aria-hidden="true"></span>' +
        (r.high[0] === r.high[1] ? "All say " + r.high[0] + "°" : "Sources " + r.high[0] + "–" + r.high[1] + "°") + "</span>";
      return '<li><button type="button" class="day' + (i ? "" : " is-first") + '" data-day="' + i + '" data-start-ms="' + d.startMs + '" data-end-ms="' + d.endMs + '">' +
        '<span class="day-name">' + esc(d.name) + '</span><span class="day-date">' + esc(d.date) + "</span>" +
        '<i class="day-icon bi bi-' + d.icon + " is-" + d.icon + '" aria-hidden="true"></i>' +
        '<span class="day-temps"><span class="hi">' + (d.high != null ? d.high + "°" : "") + '</span><span class="lo">' + (d.low != null ? d.low + "°" : "") + "</span></span>" +
        '<span class="day-text">' + esc(d.short) + "</span>" +
        '<span class="day-chance">' + (d.showChance ? '<i class="bi bi-droplet-fill" aria-hidden="true"></i>' + d.chance + '%<span class="visually-hidden"> chance of rain</span>' : "") + "</span>" +
        spread +
        '<span class="day-blanket" data-night="' + nightOf(d) + '" hidden></span><span class="day-guard" hidden></span>' +
        (r.anyRain ? '<span class="day-spread rain" title="Rain total, across every source">Rain ' + fix2(r.rain[0]) + "–" + fix2(r.rain[1]) + " in</span>" : "") +
        '<span class="visually-hidden">Open the hourly forecast for ' + esc(d.title) + "</span></button></li>";
    }).join("");
  }

  // ---------- a day's popup ----------
  var dialog = $("day-dialog"), content = $("day-content"), charts = [];
  function popupHTML(x) {
    var d = x.day, c = x.compared, hasHigh = d.high != null;
    var chips = [];
    if (x.gustMax) chips.push('<span class="chip">Gusts up to <b>' + x.gustMax + " mph</b></span>");
    if (x.thunder) chips.push('<span class="chip">Thunder up to <b>' + x.thunder + "%</b></span>");
    if (x.snowTotal >= 0.05) chips.push('<span class="chip wet"><b>Snow ' + x.snowTotal.toFixed(1) + " in</b></span>");
    if (x.iceTotal >= 0.005) chips.push('<span class="chip wet"><b>Ice ' + fix2(x.iceTotal) + " in</b></span>");
    x.types.forEach(function (t) { chips.push('<span class="chip wet">' + esc(t) + " possible</span>"); });
    var rows = c.sources.map(function (s, i) {
      return '<tr><th scope="row"><span class="swatch src-' + i + '" aria-hidden="true"></span>' + esc(s.name) + (s.partial ? '<sup title="Partial: this source doesn\'t cover every hour of this window">*</sup>' : "") + "</th>" +
        (hasHigh ? "<td>" + (s.high != null ? s.high + "°" : "–") + "</td>" : "") +
        "<td>" + (s.low != null ? s.low + "°" : "–") + '</td><td class="' + (s.rain >= 0.01 ? "wet" : "") + '">' + fix2(s.rain) + " in</td><td>" + (s.chance != null ? s.chance + "%" : "–") + "</td></tr>";
    }).join("");
    var amounts = function (list, unit, digits) {
      return list.map(function (b) { return "<li><b>" + b.amount.toFixed(digits) + " in" + unit + "</b> " + esc(b.when) + "</li>"; }).join("");
    };
    return '<header class="dd-head"><div class="dd-titles"><h2 id="day-title" tabindex="-1">' + esc(d.title) + "</h2>" +
      "<span>National Weather Service · issued " + esc(ctx.issued) + "</span></div>" +
      '<div class="dd-nav">' + (x.prev ? '<button type="button" class="btn" data-day="' + x.prev.index + '">‹ ' + esc(x.prev.name) + "</button>" : "") +
      (x.next ? '<button type="button" class="btn" data-day="' + x.next.index + '">' + esc(x.next.name) + " ›</button>" : "") +
      '<button type="button" class="dd-close" data-close aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></header>' +
      (c.verdict.length ? '<div class="verdict"><img src="static/img/horseshoe.svg" alt="" width="28" height="28"><p><b>Mikey\'s take:</b> ' + esc(c.verdict.join(" ")) + "</p></div>" : "") +
      (chips.length ? '<div class="chips">' + chips.join("") + "</div>" : "") +
      '<section class="dd-section"><h3>How the sources compare <span>' + esc(x.window) + '</span></h3><div class="table-box"><table class="compare"><thead><tr><th scope="col">Source</th>' +
      (hasHigh ? '<th scope="col">High</th>' : "") + '<th scope="col">Low</th><th scope="col">Rain</th><th scope="col">Chance</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      (c.sources.some(function (s) { return s.partial; }) ? '<p class="footnote">* Partial: that source\'s forecast doesn\'t cover every hour of this day.</p>' : "") + "</section>" +
      '<p class="nws-text">' + d.parts.map(function (p) { return "<b>" + esc(p.name) + ":</b> " + esc(p.text); }).join(" ") + "</p>" +
      '<section class="dd-section"><h3>Temperature <span>every source · °F' + (x.showFeels ? " · feels like (dashed grey)" : "") + '</span></h3><div class="chart-box"><canvas data-chart="temp" role="img" aria-label="Hourly temperature from every source"></canvas></div></section>' +
      (x.showRain ? '<section class="dd-section"><h3>Rain <span>chance each hour · NWS bars, models lines</span></h3><div class="chart-box"><canvas data-chart="rain" role="img" aria-label="Hourly chance of rain from every source"></canvas></div>' +
        (x.rainBlocks.length ? '<ul class="amounts" aria-label="NWS rain amounts">' + amounts(x.rainBlocks, "", 2) + "</ul>" : "") + "</section>" : "") +
      (x.snow.length || x.ice.length ? '<section class="dd-section"><h3>Snow and ice <span>NWS</span></h3><ul class="amounts">' + amounts(x.snow, " snow", 1) + amounts(x.ice, " ice", 2) + "</ul></section>" : "") +
      '<section class="dd-section"><h3>Wind <span>NWS · mph · gusts dashed</span></h3><div class="chart-box"><canvas data-chart="wind" role="img" aria-label="Hourly wind and gusts"></canvas></div></section>' +
      '<section class="dd-section"><h3>Clouds and humidity <span>NWS · sky cover shaded · humidity line</span></h3><div class="chart-box"><canvas data-chart="sky" role="img" aria-label="Hourly sky cover and humidity"></canvas></div></section>' +
      '<footer class="dd-foot"><span>Hourly data ' + esc(x.window) + ".</span></footer>";
  }
  function rgba(hex, a) {
    var h = hex.replace("#", "");
    return "rgba(" + parseInt(h.slice(0, 2), 16) + "," + parseInt(h.slice(2, 4), 16) + "," + parseInt(h.slice(4, 6), 16) + "," + a + ")";
  }
  function clearCharts() { charts.forEach(function (c) { c.destroy(); }); charts = []; }
  function chart(name, labels, datasets, y) {
    var canvas = content.querySelector('[data-chart="' + name + '"]');
    if (!canvas || !window.Chart) return;
    charts.push(new Chart(canvas, {
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 8 }, line: { tension: 0.35, borderWidth: 2 } },
        plugins: {
          legend: { display: datasets.length > 1, position: "bottom", labels: { color: TEXT, usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 11 } } },
          tooltip: { backgroundColor: "rgba(11, 15, 21, 0.94)", borderColor: "#2a3a52", borderWidth: 1, padding: 10, cornerRadius: 10,
            callbacks: { label: function (i) { return " " + i.dataset.label + ": " + i.formattedValue + (i.dataset.unit || ""); } } }
        },
        scales: {
          x: { grid: { color: GRID }, ticks: { color: TEXT, maxRotation: 0, autoSkip: true, maxTicksLimit: 9,
            callback: function (v) { return this.getLabelForValue(v).split(" ").slice(1).join(" "); } } },
          y: Object.assign({ grid: { color: GRID }, ticks: { color: TEXT } }, y)
        }
      }
    }));
  }
  function line(label, data, color, extra) {
    return Object.assign({ type: "line", label: label, data: data, borderColor: color, backgroundColor: color, spanGaps: true }, extra || {});
  }
  function drawCharts(d) {
    clearCharts();
    var L = d.labels, pct = { min: 0, max: 100, ticks: { color: TEXT, stepSize: 50, callback: function (v) { return v + "%"; } } };
    var temp = [line("NWS", d.nws.temp, SOURCE_COLORS[0], { borderWidth: 3.5, unit: "°F", order: 0 })];
    d.models.forEach(function (m, i) { temp.push(line(m.name, m.temp, SOURCE_COLORS[i + 1], { borderWidth: 1.6, unit: "°F" })); });
    if (d.nws.feels) temp.push(line("Feels like (NWS)", d.nws.feels, "#9aa3b5", { borderDash: [5, 4], unit: "°F" }));
    chart("temp", L, temp, { ticks: { color: TEXT, callback: function (v) { return v + "°"; } } });
    if (d.nws.pop) {
      var rain = [{ type: "bar", label: "NWS", data: d.nws.pop, backgroundColor: rgba(SOURCE_COLORS[0], 0.45), unit: "%", order: 2 }];
      d.models.forEach(function (m, i) { if (m.pop) rain.push(line(m.name, m.pop, SOURCE_COLORS[i + 1], { borderWidth: 1.6, unit: "%", order: 1 })); });
      chart("rain", L, rain, pct);
    }
    chart("wind", L, [line("Wind", d.nws.wind, SOURCE_COLORS[0], { unit: " mph" }),
      line("Gusts", d.nws.gust, SOURCE_COLORS[0], { borderDash: [5, 4], borderWidth: 1.6, unit: " mph" })], { min: 0, suggestedMax: 20 });
    chart("sky", L, [line("Sky cover", d.nws.sky, "rgba(205, 214, 228, 0.55)", { backgroundColor: "rgba(205, 214, 228, 0.16)", fill: "origin", unit: "%" }),
      line("Humidity", d.nws.rh, "#8fd0ff", { unit: "%" })], pct);
  }
  function openDay(i) {
    if (!ctx) return;
    clearCharts();
    if (!ctx.G) {
      content.innerHTML = '<header class="dd-head"><h2 id="day-title">Forecast</h2><button type="button" class="dd-close" data-close aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>' +
        '<p class="notice">The hourly forecast isn\'t available right now. Try again in a minute.</p>';
    } else {
      var x = M.dayDetail(ctx, i);
      content.innerHTML = popupHTML(x);
      if (!dialog.open) dialog.showModal();
      drawCharts(x.chart);
      $("day-title").focus();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }
  document.addEventListener("click", function (e) {
    var dayBtn = e.target.closest ? e.target.closest("[data-day]") : null;
    if (dayBtn) { e.preventDefault(); openDay(+dayBtn.getAttribute("data-day")); return; }
    if (e.target.closest && e.target.closest("[data-close]")) dialog.close();
  });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", clearCharts);

  // ---------- the place part of Mikey's settings ----------
  var settings = $("mikey-settings"), pending = null;
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("[data-open-settings]")) return;
    var p = M.getPlace(); pending = null;
    $("place-zip").value = "";
    $("place-msg").textContent = p ? "Now: " + (p.label || "saved spot") + (p.grid ? " · NWS square " + p.grid : "") + (p.source ? " (from " + p.source + ")" : "") + "." : "";
  });
  // Inside the settings form, so buttons (not a nested form) do the lookup; Enter works too.
  function keep(p) { pending = p; }
  function findPlace() { lookup(M.findPlace($("place-zip").value), "place-msg", keep, " Save to use it."); }
  $("place-find").addEventListener("click", findPlace);
  $("place-here").addEventListener("click", function () { lookup(M.findHere(), "place-msg", keep, " Save to use it."); });
  $("place-zip").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); findPlace(); } });
  settings.addEventListener("click", function (e) { if (e.target === settings) settings.close(); });
  settings.addEventListener("close", function () {
    if (settings.returnValue === "save" && pending) { M.setPlace(pending); pending = null; start(true); }
  });
  function useNow(p) { M.setPlace(p); start(true); }
  $("setup-form").addEventListener("submit", function (e) { e.preventDefault(); lookup(M.findPlace($("setup-zip").value), "setup-msg", useNow); });
  $("setup-here").addEventListener("click", function () { lookup(M.findHere(), "setup-msg", useNow); });

  start(false);
  // Keep it current while the page stays open (the cache makes this cheap).
  setInterval(function () { if (M.getPlace() && document.visibilityState === "visible") start(false); }, 15 * 60e3);
})();
