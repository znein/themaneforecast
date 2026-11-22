// Blanket Mikey tonight? Mom's settings live on this device. The nights are built and the call is
// made by Neighcast's own code (neighcast.js, copied byte for byte), so both sites always agree.
(function () {
  "use strict";
  var N = window.Neighcast;
  var KEY = "maneforecast.mikey.v1";
  var DEFAULTS = { coat: "unclipped", shelter: "runin", warm: false };  // his partly covered stall counts as a run-in, not a box stall
  var COATS = ["unclipped", "partial", "clipped"], SHELTERS = ["none", "runin", "stall"];
  // Our icons for Neighcast's levels (Neighcast uses emoji; the names and weights are Neighcast's).
  var ICONS = ["sun", "umbrella", "thermometer-low", "thermometer-snow", "snow", "snow2"];
  var SHORT = ["No blanket", "Sheet", "Light", "Medium", "Heavy", "Heavy + liner"];
  var $ = function (id) { return document.getElementById(id); };
  var bundle = null;

  // ---------- settings: saved on this device ----------
  function clean(s) {
    s = s || {};
    return {
      coat: COATS.indexOf(s.coat) >= 0 ? s.coat : DEFAULTS.coat,
      shelter: SHELTERS.indexOf(s.shelter) >= 0 ? s.shelter : DEFAULTS.shelter,
      warm: typeof s.warm === "boolean" ? s.warm : DEFAULTS.warm
    };
  }
  function read() { try { return clean(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return clean({}); } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: still works for this visit */ } }
  var S = read();

  // A settings link restores them: ?coat=clipped&shelter=runin&warm=1 (never a location).
  (function fromLink() {
    var q = new URLSearchParams(location.search);
    if (!q.has("coat") && !q.has("shelter") && !q.has("warm")) return;
    S = clean({ coat: q.get("coat") || S.coat, shelter: q.get("shelter") || S.shelter, warm: q.has("warm") ? q.get("warm") === "1" : S.warm });
    save(S);
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.hash);
  })();

  // ---------- Neighcast's render() choices ----------
  function r(v) { return Math.round(v); }
  function ymd(d) { return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
  function hourLabel(iso) { var h = +iso.slice(11, 13); return (h % 12 || 12) + (h < 12 ? " am" : " pm"); }
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
    var n0 = ns[tonightIndex(ns, off)], c0 = N.decide(n0, S), L = N.LEVELS[c0.level];
    $("blanket-card").className = "blanket lvl-" + c0.level;
    $("blanket-icon").className = "bi bi-" + ICONS[c0.level];
    $("blanket-answer").textContent = c0.level === 0 ? "No blanket needed" : "Yes, " + L.name.toLowerCase();
    $("blanket-weight").textContent = L.weight;
    var both = n0.nws ? " <small>(Open-Meteo " + r(n0.om.low) + "° · NWS " + r(n0.nws.low) + "°)</small>" : "";
    var bothF = n0.nws ? " <small>(" + r(n0.om.feelLow) + "° · " + r(n0.nws.feelLow) + "°)</small>" : "";
    $("blanket-facts").innerHTML = [
      "Low <b>" + r(n0.low) + "°F</b> around " + hourLabel(n0.lowAt) + both,
      "Feels like <b>" + r(n0.feelLow) + "°F</b>" + bothF,
      "Wind to <b>" + r(n0.wind) + " mph</b>, gusts " + r(n0.gust),
      n0.snow >= 0.1 ? "Snow <b>" + n0.snow.toFixed(1) + " in</b>" : (n0.precip >= 0.01 ? "Rain <b>" + n0.precip.toFixed(2) + " in</b>" : "Rain/snow chance <b>" + r(n0.precipChance) + "%</b>")
    ].map(function (f) { return "<li>" + f + "</li>"; }).join("");
    $("blanket-why").innerHTML = "<b>Why:</b> " + c0.why.join("; ").replace("this horse", "Mikey") + ".";

    // Do the two forecasts agree? (Neighcast's wording)
    var src = $("blanket-sources"), lo = N.soloLevel(n0, "om", S), ln = N.soloLevel(n0, "nws", S);
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

    // Take it off by...
    var offEl = $("blanket-off"); offEl.hidden = true;
    if (c0.level > 0 && n0.day.length) {
      var limit = N.MAX_OK[S.coat][c0.level];
      var hot = n0.day.filter(function (i) { return h.temperature_2m[i] > limit + 5; })[0];
      if (hot != null) {
        offEl.hidden = false;
        offEl.innerHTML = '<i class="bi bi-brightness-high" aria-hidden="true"></i> <b>Take it off or swap down by about ' + hourLabel(h.time[hot]) + "</b>: it reaches " + r(n0.dayHigh) + "°F tomorrow, too warm for a " + L.name.toLowerCase() + ".";
      }
    }

    var coatName = { unclipped: "Unclipped", partial: "Partly clipped", clipped: "Clipped" }[S.coat];
    var shelterName = { none: "out in the open", runin: "partly sheltered", stall: "closed box stall" }[S.shelter];
    var p = n0.date.split("-"), nd = new Date(Date.UTC(+p[0], p[1] - 1, +p[2]));
    $("blanket-for").textContent = "Tonight · " + nd.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }) +
      " · " + coatName + ", " + shelterName + (S.warm ? ", feels the cold" : "");
    badges(ns);
  }

  // A blanket badge on each forecast day (ui.js puts the night's date on each card).
  function badges(ns) {
    var byDate = {};
    ns.forEach(function (n) { byDate[n.date] = n; });
    document.querySelectorAll(".day-blanket[data-night]").forEach(function (el) {
      var n = byDate[el.getAttribute("data-night")];
      if (!n) { el.hidden = true; return; }
      var c = N.decide(n, S), Lv = N.LEVELS[c.level];
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
    form.querySelectorAll('input[name="coat"]').forEach(function (i) { i.checked = i.value === s.coat; });
    form.querySelectorAll('input[name="shelter"]').forEach(function (i) { i.checked = i.value === s.shelter; });
    form.querySelector('input[name="warm"]').checked = !!s.warm;
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("[data-open-settings]")) return;
    fill(S); if (!dlg.open) dlg.showModal();
  });
  $("mikey-settings-reset").addEventListener("click", function () { fill(clean({})); });
  dlg.addEventListener("close", function () {
    if (dlg.returnValue !== "save") return;
    var coat = form.querySelector('input[name="coat"]:checked'), shelter = form.querySelector('input[name="shelter"]:checked');
    S = clean({ coat: coat && coat.value, shelter: shelter && shelter.value, warm: form.querySelector('input[name="warm"]').checked });
    save(S);
    render();
  });

  window.MikeyBlanket = { render: function (b) { bundle = b; render(); } };
})();
