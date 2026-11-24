// Blanket Mikey tonight? Mom's settings live on this device. The nights are built and the call is
// made by Neighcast's own code (neighcast.js, copied byte for byte), but with Mikey's own chart:
// the ranges his family actually blankets him by, instead of Neighcast's three coat charts.
(function () {
  "use strict";
  var N = window.Neighcast;
  // Mikey's chart (°F, what it feels like at his stall overnight): no blanket at 60 and up, sheet
  // 55-60, light (100g) 45-55, medium (200g) 30-45, heavy (300g) below 30. Added next to Neighcast's
  // charts so its decide() and chartLevel() use it unchanged. MAX_OK: warmest he's comfortable in each.
  N.CHART.mikey = [[60, 0], [55, 1], [45, 2], [30, 3], [-999, 4]];
  N.MAX_OK.mikey = { 1: 65, 2: 60, 3: 50, 4: 40 };
  var KEY = "maneforecast.mikey.v1";
  var DEFAULTS = { coat: "mikey", shelter: "runin", warm: false, offset: 0, blanket_hour: 17 };  // his partly covered stall counts as a run-in, not a box stall
  var SHELTERS = ["none", "runin", "stall"];
  // His blankets, as the family names them (Neighcast's generic weights don't match his).
  var WEIGHTS = ["Let his coat do the work tonight.", "Waterproof sheet, no fill.", "Light turnout, 100g fill.", "Medium turnout, 200g fill.", "Heavy turnout, 300g fill."];
  // Our icons for Neighcast's levels (Neighcast uses emoji; the names and weights are Neighcast's).
  var ICONS = ["sun", "umbrella", "thermometer-low", "thermometer-snow", "snow", "snow2"];
  var SHORT = ["No blanket", "Sheet", "Light", "Medium", "Heavy", "Heavy + liner"];
  var $ = function (id) { return document.getElementById(id); };
  var bundle = null, ctx = null;

  // ---------- settings: saved on this device ----------
  function clean(s) {
    s = s || {};
    return {
      coat: "mikey",   // always his own chart; an older saved coat choice is ignored
      shelter: SHELTERS.indexOf(s.shelter) >= 0 ? s.shelter : DEFAULTS.shelter,
      warm: false,     // "feels the cold more" was removed: the fine-tune slider does that job
      // Comfort: blanket him as if the night were this many °F colder (0-20). Applied to the
      // temperatures before Neighcast's rules see them, so the rules themselves stay untouched.
      offset: isFinite(+s.offset) ? Math.max(0, Math.min(20, Math.round(+s.offset))) : DEFAULTS.offset,
      // When the family usually puts his blanket on (barn hour, 3-9 pm). The call is still for the
      // whole night; this only says how warm it is when it goes on.
      blanket_hour: s.blanket_hour != null && isFinite(+s.blanket_hour) ? Math.max(15, Math.min(21, Math.round(+s.blanket_hour))) : DEFAULTS.blanket_hour
    };
  }
  function read() { try { return clean(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return clean({}); } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: still works for this visit */ } }
  var S = read();

  // A settings link restores them: ?shelter=runin&offset=5 (never a location).
  (function fromLink() {
    var q = new URLSearchParams(location.search);
    if (!q.has("shelter") && !q.has("offset")) return;
    S = clean({ shelter: q.get("shelter") || S.shelter, offset: q.has("offset") ? q.get("offset") : S.offset, blanket_hour: S.blanket_hour });
    save(S);
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.hash);
  })();

  // ---------- Neighcast's render() choices ----------
  function r(v) { return Math.round(v); }
  function ymd(d) { return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
  function hourLabel(iso) { var h = +iso.slice(11, 13); return (h % 12 || 12) + (h < 12 ? " am" : " pm"); }
  // The night as Neighcast's rules should see it: every temperature lowered by Mikey's comfort offset.
  function shifted(n) {
    if (!S.offset) return n;
    var d = S.offset, x = Object.assign({}, n, { low: n.low - d, feelLow: n.feelLow - d });
    if (n.om) x.om = Object.assign({}, n.om, { low: n.om.low - d, feelLow: n.om.feelLow - d });
    if (n.nws) x.nws = Object.assign({}, n.nws, { low: n.nws.low - d, feelLow: n.nws.feelLow - d });
    return x;
  }
  // Each blanket's temperature range for these settings, worked out degree by degree the way the rules
  // decide a dry night: Mikey's chart on the temperature lowered by the fine-tune offset.
  var BAND_NAMES = ["No blanket", "Sheet", "Light (100g)", "Medium (200g)", "Heavy (300g)"];
  function bands(s) {
    var out = [];
    for (var t = 100; t >= -20; t--) {
      var eff = t - s.offset, lv = N.chartLevel(s.coat, eff);
      var last = out[out.length - 1];
      if (last && last.level === lv) last.low = t; else out.push({ level: lv, high: t, low: t });
    }
    return out.map(function (b, i) {
      return { level: b.level, name: BAND_NAMES[b.level],
        range: i === 0 ? b.low + "° and warmer" : i === out.length - 1 ? "below " + (b.high + 1) + "°" : b.low + "° to " + (b.high + 1) + "°" };
    });
  }
  function nightsOf(b) { return b && b.om ? N.nights(b.om.hourly, b.nwsHourly) : []; }
  function tonightIndex(ns, off) {
    // The barn's local time. Before 8 am we're still inside last night.
    var local = new Date(Date.now() + off), want = new Date(local);
    if (local.getUTCHours() < 8) want.setUTCDate(want.getUTCDate() - 1);
    var k = ns.findIndex(function (n) { return n.date === ymd(want); });
    if (k < 0) k = ns.findIndex(function (n) { return n.date >= ymd(local); });
    return Math.max(0, k);
  }

  function render() {
    var card = $("blanket-section");
    var ns = nightsOf(bundle);
    if (!ns.length) { card.hidden = true; badges([]); return; }
    card.hidden = false;
    var h = bundle.om.hourly, off = (bundle.om.utc_offset_seconds || 0) * 1000;
    var n0 = ns[tonightIndex(ns, off)], c0 = N.decide(shifted(n0), S), L = N.LEVELS[c0.level];
    $("blanket-card").className = "blanket lvl-" + c0.level;
    $("blanket-icon").className = "bi bi-" + ICONS[c0.level];
    $("blanket-answer").textContent = c0.level === 0 ? "No blanket needed" : "Yes, " + L.name.toLowerCase();
    $("blanket-weight").textContent = WEIGHTS[c0.level] || L.weight;
    var both = n0.nws ? " <small>(Open-Meteo " + r(n0.om.low) + "° · NWS " + r(n0.nws.low) + "°)</small>" : "";
    var bothF = n0.nws ? " <small>(" + r(n0.om.feelLow) + "° · " + r(n0.nws.feelLow) + "°)</small>" : "";
    $("blanket-facts").innerHTML = [
      "Low <b>" + r(n0.low) + "°F</b> around " + hourLabel(n0.lowAt) + both,
      "Feels like <b>" + r(n0.feelLow) + "°F</b>" + bothF,
      "Wind to <b>" + r(n0.wind) + " mph</b>, gusts " + r(n0.gust),
      n0.snow >= 0.1 ? "Snow <b>" + n0.snow.toFixed(1) + " in</b>" : (n0.precip >= 0.01 ? "Rain <b>" + n0.precip.toFixed(2) + " in</b>" : "Rain/snow chance <b>" + r(n0.precipChance) + "%</b>")
    ].map(function (f) { return "<li>" + f + "</li>"; }).join("");
    var why = c0.why.slice();
    if (S.offset) why[0] = why[0].replace(/-?\d+°F/, r(c0.eff + S.offset) + "°F") + ", with each blanket starting " + S.offset + "° warmer";
    $("blanket-why").innerHTML = "<b>Why:</b> " + why.join("; ").replace("this horse", "Mikey") + ".";

    // Do the two forecasts agree? (Neighcast's wording)
    var src = $("blanket-sources"), lo = N.soloLevel(shifted(n0), "om", S), ln = N.soloLevel(shifted(n0), "nws", S);
    if (!n0.nws) {
      src.className = "blanket-sources warn";
      src.textContent = "Only Open-Meteo tonight: the National Weather Service forecast " + (bundle.nwsHourly ? "doesn't reach this night yet." : "didn't load.");
    } else if (lo !== ln) {
      src.className = "blanket-sources warn";
      src.innerHTML = "<b>The forecasts disagree.</b> Open-Meteo says " + N.LEVELS[lo].name.toLowerCase() + ", the NWS says " + N.LEVELS[ln].name.toLowerCase() + ". This goes with the colder one. Worth a look again this evening.";
    } else if (n0.gap > 5) {
      src.className = "blanket-sources warn";
      src.textContent = "The forecasts are " + r(n0.gap) + "° apart on the coldest feels-like, but both point to the same blanket.";
    } else {
      src.className = "blanket-sources ok";
      src.textContent = "Open-Meteo and the National Weather Service agree" + (n0.gap >= 1 ? " (within " + r(n0.gap) + "°)" : "") + ".";
    }

    evening(n0, c0, L);

    // Take it off by...
    var offEl = $("blanket-off"); offEl.hidden = true;
    if (c0.level > 0 && n0.day.length) {
      var limit = N.MAX_OK[S.coat][c0.level] + S.offset;  // he's comfortable in it that much warmer, too
      var hot = n0.day.filter(function (i) { return h.temperature_2m[i] > limit + 5; })[0];
      if (hot != null) {
        offEl.hidden = false;
        offEl.innerHTML = '<i class="bi bi-brightness-high" aria-hidden="true"></i> <b>Take it off or swap down by about ' + hourLabel(h.time[hot]) + "</b>: it reaches " + r(n0.dayHigh) + "°F tomorrow, too warm for a " + L.name.toLowerCase() + ".";
      }
    }

    var shelterName = { none: "out in the open", runin: "partly sheltered", stall: "closed box stall" }[S.shelter];
    var p = n0.date.split("-"), nd = new Date(Date.UTC(+p[0], p[1] - 1, +p[2]));
    $("blanket-for").textContent = "Tonight · " + nd.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }) +
      " · Mikey's chart, " + shelterName + (S.offset ? ", +" + S.offset + "° comfort" : "");
    badges(ns);
  }

  // ---------- blanket time: how warm it is when the blanket goes on ----------
  function clockOf(hr) { return (hr % 12 || 12) + (hr < 12 ? " am" : " pm"); }
  function evening(n0, c0, L) {
    var box = $("blanket-evening"), list = $("blanket-hourly");
    box.hidden = true; list.innerHTML = "";
    if (!ctx || !window.Mane || !window.Mane.hourly) return;
    var from = window.Mane.barnMs(n0.date, S.blanket_hour, ctx.off), to = window.Mane.barnMs(n0.date, 32, ctx.off);  // to 8 am
    var rows = window.Mane.hourly(ctx, from, to).filter(function (x) { return x.ms >= from; });
    if (!rows.length) return;
    list.innerHTML = window.ManeHourly ? window.ManeHourly.html(rows, { title: "Hourly tonight", mark: rows[0].ms, markLabel: "Blanket time", totalLabel: "Rain Total Tonight, " + clockOf(S.blanket_hour) + " to 8 am" }) : "";
    var at = rows[0], low = rows.reduce(function (a, x) { return x.temp < a.temp ? x : a; }, rows[0]);
    var later = rows.filter(function (x) { return x.hour === (S.blanket_hour < 21 ? 21 : 0); })[0];
    var steps = ["<b>" + clockOf(S.blanket_hour) + " " + at.temp + "°F</b>"];
    if (later && later.ms < low.ms) steps.push(later.time.toLowerCase() + " " + later.temp + "°F");
    if (low !== at) steps.push("low " + low.temp + "°F around " + low.time.toLowerCase());
    var text = '<i class="bi bi-clock" aria-hidden="true"></i> ' + (at.src === "nws" ? "NWS hourly: " : "") + steps.join(" → ") + ". ";
    if (c0.level > 0) {
      var limit = N.MAX_OK[S.coat][c0.level] + S.offset, name = L.name.toLowerCase();
      var cool = rows.filter(function (x) { return x.temp <= limit; })[0];
      if (at.temp <= limit)
        text += "<b>Put it on at " + clockOf(S.blanket_hour) + " as usual.</b> The " + name + " is for the low, and " + at.temp + "°F is still comfortable in it (up to " + limit + "°F).";
      else if (at.temp <= limit + 5)
        text += "<b>Fine to put it on at " + clockOf(S.blanket_hour) + ".</b> It's a little warm for a " + name + " at first" + (cool ? ", but it's down to " + limit + "°F by " + cool.time.toLowerCase() : "") + " and keeps cooling toward the low.";
      else
        text += "<b>It's warm at " + clockOf(S.blanket_hour) + " for a " + name + "</b> (comfortable up to " + limit + "°F)." +
          (cool ? " If someone's at the barn later, put it on around " + cool.time.toLowerCase() + ". If " + clockOf(S.blanket_hour) + " is the only visit, it's still the right blanket for the night." : "");
    }
    box.innerHTML = text;
    box.hidden = false;
  }

  // A blanket badge on each forecast day (ui.js puts the night's date on each card).
  function badges(ns) {
    var byDate = {};
    ns.forEach(function (n) { byDate[n.date] = n; });
    document.querySelectorAll(".day-blanket[data-night]").forEach(function (el) {
      var n = byDate[el.getAttribute("data-night")];
      if (!n) { el.hidden = true; return; }
      var c = N.decide(shifted(n), S), Lv = N.LEVELS[c.level];
      el.className = "day-blanket lvl-" + c.level;
      el.title = "Mikey's blanket that night: " + Lv.name;
      el.innerHTML = '<i class="bi bi-' + ICONS[c.level] + '" aria-hidden="true"></i> ' + SHORT[c.level] +
        '<span class="visually-hidden"> for Mikey that night</span>';
      el.hidden = false;
    });
  }

  // ---------- his part of Mikey's settings ----------
  var dlg = $("mikey-settings"), form = $("mikey-settings-form");
  function fill(s) {
    form.querySelectorAll('input[name="shelter"]').forEach(function (i) { i.checked = i.value === s.shelter; });
    $("comfort").value = s.offset;
    $("blanket-hour").value = String(s.blanket_hour);
    preview();
  }
  // Live note while she moves the slider or changes where he spends the night.
  function current() {
    var shelter = form.querySelector('input[name="shelter"]:checked');
    return clean({ shelter: shelter && shelter.value, offset: $("comfort").value, blanket_hour: $("blanket-hour").value });
  }
  function preview() {
    var c = current();
    $("comfort-out").textContent = c.offset + "°";
    $("comfort-bands").innerHTML = bands(c).map(function (b) {
      return '<li class="lvl-' + b.level + '"><span>' + b.name + "</span><span>" + b.range + "</span></li>";
    }).join("");
    $("comfort-note").textContent = (c.shelter === "stall" ? "Air temperature in a closed stall, overnight. " : "The coldest it feels at his shelter, overnight. ") +
      (c.shelter === "none" ? "Gusts of 30 mph or more can move it up one more weight." : "Use the slider if he needs it warmer.");
  }
  form.addEventListener("input", function (e) { if (e.target.name === "offset") preview(); });
  form.addEventListener("change", function (e) { if (e.target.name === "shelter") preview(); });
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("[data-open-settings]")) return;
    fill(S); if (!dlg.open) dlg.showModal();
  });
  $("mikey-settings-reset").addEventListener("click", function () { fill(clean({})); });
  dlg.addEventListener("close", function () {
    if (dlg.returnValue !== "save") return;
    S = current();
    save(S);
    render();
  });

  window.MikeyBlanket = { render: function (b, c) { bundle = b; ctx = c || null; render(); } };
})();
