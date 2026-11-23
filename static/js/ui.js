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
    var alerts = M.activeAlerts(ctx);
    renderAlerts(alerts);
    if (window.MikeyBlanket) window.MikeyBlanket.render(b, ctx);
    if (window.MikeyGuard) window.MikeyGuard.render(Object.assign(M.rainHours(ctx), { alerts: alerts, off: ctx.off }));
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
    $("days").style.setProperty("--days", ctx.days.length);  // 10: NWS's 7 days plus 3 from the models
    $("days").innerHTML = ctx.days.map(function (d, i) {
      var r = M.compareDay(ctx, d).range, spread = "";
      if (r.high) spread = '<span class="day-spread" title="Highest temperature, across every source"><span class="dot ' + (r.high[1] - r.high[0] <= 3 ? "agree" : "split") + '" aria-hidden="true"></span>' +
        (r.high[0] === r.high[1] ? "All say " + r.high[0] + "°" : "Sources " + r.high[0] + "–" + r.high[1] + "°") + "</span>";
      return '<li><button type="button" class="day' + (i ? "" : " is-first") + (d.uncertain ? " is-uncertain" : "") + '" data-day="' + i + '" data-start-ms="' + d.startMs + '" data-end-ms="' + d.endMs + '">' +
        '<span class="day-name">' + esc(d.name) + '</span><span class="day-date">' + esc(d.date) + "</span>" +
        (d.uncertain ? '<span class="day-uncertain" title="Past the NWS 7-day forecast: the four models\' average">Less certain</span>' : "") +
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

  // ---------- NWS alerts: banners, bars over the affected days, and a tag on each day ----------
  var KIND_RANK = { warning: 4, watch: 3, advisory: 2, statement: 1 };
  function overlaps(a, d) { return a.startMs < d.endMs && (!isFinite(a.endMs) || a.endMs > d.startMs); }
  function renderAlerts(alerts) {
    var box = $("alerts"), bars = $("alert-bars");
    box.hidden = !alerts.length;
    box.innerHTML = alerts.map(function (a) {
      return '<details class="alert alert-' + a.kind + '"><summary><span class="alert-icon" aria-hidden="true"><i class="bi bi-exclamation-triangle-fill"></i></span>' +
        '<span class="alert-title"><b>' + esc(a.event) + "</b><span>" + esc(a.when) + '</span></span><span class="alert-more">Details</span></summary>' +
        '<div class="alert-body"><p class="alert-headline">' + esc(a.headline) + "</p>" +
        (a.description ? '<p class="alert-text">' + esc(a.description) + "</p>" : "") +
        (a.instruction ? '<p class="alert-text"><b>What to do:</b> ' + esc(a.instruction) + "</p>" : "") +
        '<p class="alert-fine">From the National Weather Service. Shown while NWS lists it for this spot.</p></div></details>';
    }).join("");
    // a bar per alert, spanning the day cards it touches (same columns as the week)
    bars.style.setProperty("--days", ctx.days.length);
    var rows = alerts.map(function (a) {
      var hit = ctx.days.map(function (d, i) { return overlaps(a, d) ? i : -1; }).filter(function (i) { return i >= 0; });
      return hit.length ? { a: a, from: hit[0], to: hit[hit.length - 1] } : null;
    }).filter(Boolean);
    bars.innerHTML = rows.map(function (r, k) {
      return '<span class="alert-bar alert-' + r.a.kind + '" style="grid-column:' + (r.from + 1) + " / " + (r.to + 2) + ";grid-row:" + (k + 1) + '">' + esc(r.a.event) + "</span>";
    }).join("");
    bars.hidden = !rows.length;
    // the most serious alert touching each day: tinted border and a small tag
    document.querySelectorAll(".day[data-start-ms]").forEach(function (el) {
      var d = { startMs: +el.getAttribute("data-start-ms"), endMs: +el.getAttribute("data-end-ms") };
      var top = alerts.filter(function (a) { return overlaps(a, d); }).sort(function (x, y) { return KIND_RANK[y.kind] - KIND_RANK[x.kind]; })[0];
      var tag = el.querySelector(".day-alert");
      if (tag) tag.remove();
      el.classList.remove("has-warning", "has-watch", "has-advisory", "has-statement");
      if (!top) return;
      el.classList.add("has-" + top.kind);
      var span = document.createElement("span");
      span.className = "day-alert alert-" + top.kind; span.textContent = top.event;
      el.insertBefore(span, el.querySelector(".visually-hidden:last-child"));
    });
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
      "<span>" + (d.uncertain ? "Four weather models · less certain" : "National Weather Service · issued " + esc(ctx.issued)) + "</span></div>" +
      '<div class="dd-nav">' + (x.prev ? '<button type="button" class="btn" data-day="' + x.prev.index + '">‹ ' + esc(x.prev.name) + "</button>" : "") +
      (x.next ? '<button type="button" class="btn" data-day="' + x.next.index + '">' + esc(x.next.name) + " ›</button>" : "") +
      '<button type="button" class="dd-close" data-close aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></header>' +
      (c.verdict.length ? '<div class="verdict"><img src="static/img/horseshoe.svg" alt="" width="28" height="28"><p><b>Mikey\'s take:</b> ' + esc(c.verdict.join(" ")) + "</p></div>" : "") +
      (chips.length ? '<div class="chips">' + chips.join("") + "</div>" : "") +
      '<section class="dd-section"><h3>How the sources compare <span>' + esc(x.window) + '</span></h3><div class="table-box"><table class="compare"><thead><tr><th scope="col">Source</th>' +
      (hasHigh ? '<th scope="col">High</th>' : "") + '<th scope="col">Low</th><th scope="col">Rain</th><th scope="col">Chance</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      (c.sources.some(function (s) { return s.partial; }) ? '<p class="footnote">* Partial: that source\'s forecast doesn\'t cover every hour of this day.</p>' : "") + "</section>" +
      '<div class="nws-text">' + d.parts.map(function (p) { return "<p><b>" + esc(p.name) + ":</b> " + esc(p.text) + "</p>"; }).join("") + "</div>" +
      '<section class="dd-section"><h3>Temperature <span>' + (hasNws(x.chart) ? "National Weather Service" : "average of the four models") + " · °F" + (x.showFeels ? " · feels like (dashed grey)" : "") + '</span></h3><div class="chart-box"><canvas data-chart="temp" role="img" aria-label="Hourly temperature, numbers every 3 hours"></canvas></div>' +
        hourlyHTML(M.hourly(ctx, d.startMs, d.endMs), { title: "Hourly" }) + "</section>" +
      (x.showRain ? '<section class="dd-section"><h3>Rain <span>chance each hour · NWS bars, models lines</span></h3><div class="chart-box"><canvas data-chart="rain" role="img" aria-label="Hourly chance of rain from every source"></canvas></div>' +
        (x.rainBlocks.length ? '<ul class="amounts" aria-label="NWS rain amounts">' + amounts(x.rainBlocks, "", 2) + "</ul>" : "") + "</section>" : "") +
      (x.snow.length || x.ice.length ? '<section class="dd-section"><h3>Snow and ice <span>NWS</span></h3><ul class="amounts">' + amounts(x.snow, " snow", 1) + amounts(x.ice, " ice", 2) + "</ul></section>" : "") +
      (d.uncertain ? "" : '<section class="dd-section"><h3>Wind <span>NWS · mph · wind (blue) · gusts (grey, dashed)</span></h3><div class="chart-box"><canvas data-chart="wind" role="img" aria-label="Hourly wind and gusts"></canvas></div></section>' +
      '<section class="dd-section"><h3>Clouds and humidity <span>NWS · sky cover shaded · humidity line</span></h3><div class="chart-box"><canvas data-chart="sky" role="img" aria-label="Hourly sky cover and humidity"></canvas></div></section>') +
      '<footer class="dd-foot"><span>Hourly data ' + esc(x.window) + ".</span></footer>";
  }
  // ---------- "Hourly" drop-down: one row per hour ----------
  function hourIcon(x) {
    var night = x.hour < 6 || x.hour >= 18;
    if (x.pop >= 50) return "cloud-rain";
    if (x.pop >= 30) return "cloud-drizzle";
    if (x.sky >= 88) return "clouds";
    if (x.sky >= 50) return night ? "cloud-moon" : "cloud-sun";
    return night ? "moon-stars" : "sun";
  }
  function hourlyHTML(rows, opts) {
    opts = opts || {};
    if (!rows.length) return "";
    var models = rows.some(function (x) { return x.src === "models"; });
    return '<details class="hourly"' + (opts.open ? " open" : "") + '><summary><span>' + esc(opts.title || "Hourly") + '</span><i class="bi bi-chevron-down" aria-hidden="true"></i></summary>' +
      '<ol class="hour-list">' + rows.map(function (x, i) {
        var mark = opts.mark === x.ms, newDay = i > 0 && x.hour === 0;
        return '<li class="hour' + (mark ? " is-mark" : "") + (newDay ? " is-new-day" : "") + '">' +
          '<span class="h-time">' + (newDay || i === 0 ? '<small>' + x.day + "</small> " : "") + x.time + "</span>" +
          '<i class="h-icon bi bi-' + hourIcon(x) + '" aria-hidden="true"></i>' +
          '<span class="h-temp">' + x.temp + "°</span>" +
          '<span class="h-feels">' + (x.feels != null ? "feels " + x.feels + "°" : "") + "</span>" +
          '<span class="h-pop">' + (x.pop != null && x.pop >= 10 ? '<i class="bi bi-droplet-fill" aria-hidden="true"></i>' + x.pop + "%" : "") + "</span>" +
          '<span class="h-wind">' + (x.wind != null ? x.wind + " mph" + (x.gust != null && x.gust >= x.wind + 5 ? ' <small>gusts ' + x.gust + "</small>" : "") : "") + "</span>" +
          (mark && opts.markLabel ? '<span class="h-mark">' + esc(opts.markLabel) + "</span>" : "") + "</li>";
      }).join("") + "</ol>" +
      (models ? '<p class="footnote">Hours past the NWS forecast use the four models\' average.</p>' : "") + "</details>";
  }
  window.ManeHourly = { html: hourlyHTML };

  function rgba(hex, a) {
    var h = hex.replace("#", "");
    return "rgba(" + parseInt(h.slice(0, 2), 16) + "," + parseInt(h.slice(2, 4), 16) + "," + parseInt(h.slice(4, 6), 16) + "," + a + ")";
  }
  function clearCharts() { charts.forEach(function (c) { c.destroy(); }); charts = []; }
  // Like weather.gov's hourly graph: a time under every third hour (12 AM, 3 AM, 6 AM...), with
  // the temperature written above the line at those same hours.
  var HOURS = [];
  function third(i) { return HOURS[i] != null && HOURS[i] % 3 === 0; }
  var valueLabels = {
    id: "value_labels",
    afterDatasetsDraw: function (c) {
      var meta = c.getDatasetMeta(0), data = c.data.datasets[0].data, g = c.ctx;
      g.save(); g.font = "600 12px Inter, system-ui, sans-serif"; g.fillStyle = "#e8eaf0"; g.textAlign = "center"; g.textBaseline = "bottom";
      meta.data.forEach(function (pt, i) { if (data[i] != null && third(i)) g.fillText(data[i] + "°", pt.x, pt.y - 7); });
      g.restore();
    }
  };
  function chart(name, labels, datasets, y, labelled) {
    var canvas = content.querySelector('[data-chart="' + name + '"]');
    if (!canvas || !window.Chart) return;
    charts.push(new Chart(canvas, {
      data: { labels: labels, datasets: datasets },
      plugins: labelled ? [valueLabels] : [],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: labelled ? 20 : 0, left: 4, right: 4 } },
        interaction: { mode: "index", intersect: false },
        elements: { point: { radius: 0, hoverRadius: 4, hitRadius: 8 }, line: { tension: 0.35, borderWidth: 2 } },
        plugins: {
          legend: { display: datasets.length > 1, position: "bottom", labels: { color: TEXT, usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 11 } } },
          tooltip: { backgroundColor: "rgba(11, 15, 21, 0.94)", borderColor: "#2a3a52", borderWidth: 1, padding: 10, cornerRadius: 10,
            callbacks: { label: function (i) { return " " + i.dataset.label + ": " + i.formattedValue + (i.dataset.unit || ""); } } }
        },
        scales: {
          x: { grid: { color: function (c) { return third(c.index) ? GRID : "transparent"; } },
            ticks: { color: TEXT, maxRotation: 0, autoSkip: false, font: { size: 11 },
              callback: function (v) { return third(v) ? this.getLabelForValue(v).split(" ").slice(1).join(" ") : null; } } },
          y: Object.assign({ grid: { color: GRID }, ticks: { color: TEXT } }, y)
        }
      }
    }));
  }
  function line(label, data, color, extra) {
    return Object.assign({ type: "line", label: label, data: data, borderColor: color, backgroundColor: color, spanGaps: true }, extra || {});
  }
  function hasNws(d) { return d.nws.temp.some(function (v) { return v != null; }); }
  function drawCharts(d) {
    clearCharts();
    HOURS = d.hours || [];
    var L = d.labels, pct = { min: 0, max: 100, ticks: { color: TEXT, stepSize: 50, callback: function (v) { return v + "%"; } } };
    // One line: the average of every source that has that hour (NWS plus the four models), rounded.
    // The day popup's "How the sources compare" table still shows each source on its own.
    var series = [d.nws.temp].concat(d.models.map(function (m) { return m.temp; })).filter(Boolean);
    var avg = L.map(function (_, i) {
      var v = series.map(function (s) { return s[i]; }).filter(function (x) { return x != null && isFinite(x); });
      return v.length ? Math.round(v.reduce(function (a, x) { return a + x; }, 0) / v.length) : null;
    });
    var main = hasNws(d) ? line("National Weather Service", d.nws.temp, SOURCE_COLORS[0], { borderWidth: 3, unit: "°F", order: 0 })
                         : line("Average of the four models", avg, SOURCE_COLORS[0], { borderWidth: 3, unit: "°F", order: 0 });
    main.pointRadius = function (c) { return third(c.dataIndex) ? 3 : 0; };
    var temp = [main];
    if (d.nws.feels) temp.push(line("Feels like (NWS)", d.nws.feels, "#9aa3b5", { borderDash: [5, 4], unit: "°F" }));
    chart("temp", L, temp, { grace: "12%", ticks: { color: TEXT, callback: function (v) { return v + "°"; } } }, true);
    if (d.nws.pop) {
      var rain = [{ type: "bar", label: "NWS", data: d.nws.pop, backgroundColor: rgba(SOURCE_COLORS[0], 0.45), unit: "%", order: 2 }];
      d.models.forEach(function (m, i) { if (m.pop) rain.push(line(m.name, m.pop, SOURCE_COLORS[i + 1], { borderWidth: 1.6, unit: "%", order: 1 })); });
      chart("rain", L, rain, pct);
    }
    chart("wind", L, [line("Wind", d.nws.wind, SOURCE_COLORS[0], { unit: " mph" }),
      // gusts in grey, so they read apart from the wind
      line("Gusts", d.nws.gust, "#9aa3b5", { borderDash: [5, 4], borderWidth: 1.6, unit: " mph" })], { min: 0, suggestedMax: 20 });
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
