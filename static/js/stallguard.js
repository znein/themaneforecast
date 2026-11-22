// Stall guard notice: when rain is coming, when to leave for the barn to put Mikey's stall guard up.
// Rain "starts" at the earliest hour ANY source flags it (earliest source wins): NWS at or above
// Mom's chance threshold or with a measurable amount, or a weather model with measurable rain.
// Leave-by = rain start minus her barn trip (drive + prep + spare). Everything is worked out here,
// against the current time in her browser, so countdowns and states stay right as time passes.
(function () {
  "use strict";
  var box = document.getElementById("guard");
  if (!box) return;
  var DATA = null, OFF = 0;  // set by MikeyGuard.render(rainHours) from ui.js
  var KEY = "maneforecast.barn.v1", DONE_KEY = "maneforecast.guard.v1";
  var DEFAULTS = { drive: 15, prep: 30, spare: 15, evening: 21, threshold: 20 };
  var MEASURABLE = 0.01;          // inches
  var SAME_SPELL_GAP_H = 2;       // wet hours this close together are one rain
  var HORIZON_H = 48;             // look this far ahead for the notice
  var $ = function (id) { return document.getElementById(id); };

  // ---------- settings (saved on this device) ----------
  function num(v, lo, hi, d) { v = +v; return isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d; }
  function clean(s) {
    s = s || {};
    return {
      drive: num(s.drive, 0, 180, DEFAULTS.drive), prep: num(s.prep, 0, 180, DEFAULTS.prep),
      spare: num(s.spare, 0, 120, DEFAULTS.spare), evening: num(s.evening, 17, 23, DEFAULTS.evening),
      threshold: num(s.threshold, 5, 90, DEFAULTS.threshold)
    };
  }
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var S = clean(read(KEY));

  // ---------- times, in the barn's own clock ----------
  function barn(ms) { return new Date(ms + OFF); }                 // read with getUTC*
  function clock(ms, withDay) {
    var d = barn(ms), h = d.getUTCHours(), m = d.getUTCMinutes();
    var t = (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " AM" : " PM");
    return withDay ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] + " " + t : t;
  }
  function dayWord(ms, now) {
    var a = barn(ms), b = barn(now), diff = Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
      Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / 864e5);
    return diff === 0 ? (a.getUTCHours() >= 18 ? "tonight" : "today") : diff === 1 ? "tomorrow" : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][a.getUTCDay()];
  }
  function inWords(ms) {
    var m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60);
    return h ? h + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min";
  }

  // ---------- rain spells: earliest source wins ----------
  function wetSources(h) {
    var out = [];
    if ((h.nwsPop != null && h.nwsPop >= S.threshold) || h.nwsBlock >= MEASURABLE) out.push("NWS");
    Object.keys(h.models || {}).forEach(function (m) { if (h.models[m] >= MEASURABLE) out.push(m); });
    return out;
  }
  function spells() {
    var out = [], cur = null;
    DATA.hours.forEach(function (h) {
      var who = wetSources(h);
      if (!who.length) return;
      if (cur && h.ms - cur.lastMs <= (SAME_SPELL_GAP_H + 1) * 36e5) {
        cur.lastMs = h.ms; cur.hours.push(h);
      } else {
        cur = { startMs: h.ms, lastMs: h.ms, hours: [h] }; out.push(cur);
      }
      who.forEach(function (w) { if (!(w in (cur.first = cur.first || {}))) cur.first[w] = h.ms; });
    });
    out.forEach(function (s) {
      s.endMs = s.lastMs + 36e5;
      s.maxPop = Math.max.apply(null, s.hours.map(function (h) { return h.nwsPop || 0; }));
      s.nwsTotal = s.hours.reduce(function (a, h) { return a + (h.nwsRain || 0); }, 0);
      s.sources = Object.keys(s.first).sort(function (a, b) { return s.first[a] - s.first[b]; });
    });
    return out;
  }
  // When she should leave. Overnight rain moves to her evening visit instead of a middle-of-the-night run.
  function plan(sp) {
    var trip = (S.drive + S.prep + S.spare) * 60000, leave = sp.startMs - trip, lh = barn(leave).getUTCHours();
    if (lh >= S.evening || lh < 6) {
      var d = barn(sp.startMs);
      var evening = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), S.evening) - OFF;
      if (evening > sp.startMs - (S.drive + S.prep) * 60000) evening -= 864e5;  // the evening before
      return { leave: evening, overnight: true };
    }
    return { leave: leave, overnight: false };
  }
  function isDone(sp) {
    var d = read(DONE_KEY);
    return !!(d && sp.startMs <= d.endMs + 6 * 36e5 && sp.endMs >= d.startMs);  // the same rain spell
  }

  // ---------- render ----------
  function chips(sp) {
    var c = [];
    if (sp.maxPop) c.push("NWS chance up to <b>" + sp.maxPop + "%</b>");
    if (sp.nwsTotal >= 0.005) c.push("NWS about <b>" + sp.nwsTotal.toFixed(2) + " in</b>");
    var html = c.map(function (x) { return "<li>" + x + "</li>"; }).join("");
    var models = DATA.models;
    var wetModels = models.filter(function (m) { return sp.first[m] != null; });
    var note;
    if (sp.sources.length === 1 && sp.sources[0] === "NWS") note = models.length ? "Only NWS expects rain; the " + models.length + " models say mostly dry" : "From the NWS forecast (the models didn't load)";
    else if (sp.first.NWS == null) note = "NWS says dry; " + wetModels.join(", ") + (wetModels.length > 1 ? " expect" : " expects") + " rain";
    else note = "Earliest: " + sp.sources.slice(0, 3).map(function (s) { return s.replace(/ \(.*\)/, "") + " " + clock(sp.first[s]); }).join(" · ");
    return html + '<li class="split">' + note + "</li>";
  }
  function timeline(sp, p) {
    if (p.overnight) return "";
    var total = S.drive + S.prep + S.spare || 1, w = function (m) { return (100 * m / total).toFixed(1) + "%"; };
    var at = p.leave + S.drive * 60000, ready = at + S.prep * 60000;
    return '<div class="guard-line" role="img" aria-label="Leave ' + clock(p.leave) + ", at the barn " + clock(at) + ", stall ready " + clock(ready) + ", rain likely from " + clock(sp.startMs) + '">' +
      '<div class="guard-times"><span style="left:0"><b>' + clock(p.leave) + "</b>Leave home</span>" +
      '<span class="mid" style="left:' + w(S.drive) + '"><b>' + clock(at) + "</b>At the barn</span>" +
      '<span class="mid" style="left:' + w(S.drive + S.prep) + '"><b>' + clock(ready) + "</b>Stall ready</span>" +
      '<span class="end"><b>' + clock(sp.startMs) + "</b>Rain likely</span></div>" +
      '<div class="guard-bar"><i style="width:' + w(S.drive) + '"></i><i style="width:' + w(S.prep) + '"></i><i style="width:' + w(S.spare) + '"></i></div>' +
      '<div class="guard-legs"><span style="width:' + w(S.drive) + '">' + S.drive + " min drive</span><span style=\"width:" + w(S.prep) + '">' + S.prep + " min stall prep</span><span style=\"width:" + w(S.spare) + '">' + S.spare + " min spare</span></div></div>";
  }
  var GATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V5M21 21V5M3 8h18M3 13h18M3 18h18M7 8v10M12 8v10M17 8v10"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  function render() {
    if (!DATA) return;
    var now = Date.now();
    var all = spells(), sp = all.filter(function (s) { return s.endMs > now; })[0];
    var settingsBtn = '<button type="button" class="btn btn-small" data-open-settings><i class="bi bi-sliders" aria-hidden="true"></i> Barn trip</button>';
    box.hidden = false;
    if (!sp || sp.startMs - now > HORIZON_H * 36e5) {
      var through = DATA.hours.length ? clock(DATA.hours[Math.min(DATA.hours.length, HORIZON_H) - 1].ms, true).split(" ")[0] : "";
      box.className = "guard guard-dry";
      box.innerHTML = '<span class="guard-mini-icon">' + GATE + "</span><span>No rain expected" + (through ? " through " + ({ Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" }[through]) : "") + ". The stall guard can stay down.</span>";
      badges(all, now);
      return;
    }
    var p = plan(sp), when = dayWord(sp.startMs, now);
    if (isDone(sp)) {
      box.className = "guard guard-done";
      box.innerHTML = '<span class="guard-check">' + CHECK + '</span><div class="guard-text"><b>Stall guard is up for ' + (when === "today" || when === "tonight" ? when + "'s" : when + "'s") + ' rain</b>' +
        "<span>A new notice shows up for the next rain.</span></div>" +
        '<button type="button" class="btn" id="guard-undo">Undo</button>';
      $("guard-undo").onclick = function () { write(DONE_KEY, null); render(); };
      badges(all, now);
      return;
    }
    var state, head, sub;
    var rainAt = clock(sp.startMs), leaveAt = clock(p.leave), trip = S.drive + S.prep + S.spare;
    if (now >= sp.startMs) {
      state = "late"; head = "Rain may be starting now";
      sub = (sp.maxPop ? "Up to " + sp.maxPop + "% chance. " : "") + "If the stall guard isn't up, head over now: about " + (S.drive + S.prep) + " minutes all in.";
    } else if (now >= p.leave) {
      state = "late"; head = "Rain may start around " + rainAt;
      sub = "Leave-by was " + leaveAt + ". If the stall guard isn't up, head over now: about " + (S.drive + S.prep) + " minutes all in.";
    } else if (p.leave - now <= 36e5) {
      state = "go"; head = "Leave in " + inWords(p.leave - now);
      sub = p.overnight ? "Evening visit by " + leaveAt + " to put the stall guard up before rain overnight (about " + rainAt + ")."
                        : "By " + leaveAt + " to have the stall guard up before rain at about " + rainAt + ".";
    } else if (p.overnight) {
      state = "night"; head = "Rain likely from about " + rainAt + " " + (when === "today" ? "tonight" : when);
      sub = "Put the stall guard up on your <b>evening visit, before " + leaveAt + "</b>. A middle-of-the-night barn run is no fun.";
    } else {
      state = "plan"; head = "Rain likely from about " + rainAt + " " + when;
      sub = "Put Mikey's stall guard up before it starts. <b>Leave home by " + leaveAt + ".</b>";
    }
    box.className = "guard guard-" + state;
    box.innerHTML = '<div class="guard-icon">' + GATE + '</div><div class="guard-body">' +
      '<div class="guard-top"><p class="eyebrow">Stall guard notice</p>' + settingsBtn + "</div>" +
      '<h2 class="guard-head">' + head + "</h2>" +
      '<p class="guard-sub">' + sub + (state === "plan" || state === "night" ? ' <span class="guard-count">in ' + inWords(p.leave - now) + "</span>" : "") + "</p>" +
      (state === "plan" || state === "go" ? timeline(sp, p) : "") +
      '<ul class="guard-facts">' + chips(sp) + "</ul>" + also(sp, now) +
      '<div class="guard-actions"><button type="button" class="btn btn-primary" id="guard-done">' + CHECK + " Stall guard is up</button></div></div>";
    $("guard-done").onclick = function () { write(DONE_KEY, { startMs: sp.startMs, endMs: sp.endMs, at: Date.now() }); render(); };
    badges(all, now);
  }

  // NWS alerts that overlap this trip or the rain itself, as one "Also:" line.
  function also(sp, now) {
    var list = (DATA.alerts || []).filter(function (a) { return a.startMs < sp.endMs + 6 * 36e5 && (!isFinite(a.endMs) || a.endMs > now); });
    if (!list.length) return "";
    return '<p class="guard-also"><b>Also:</b> ' + list.map(function (a) {
      return a.event.replace(/[&<>"]/g, "") + " (" + a.when.replace(/[&<>"]/g, "") + ")";
    }).join("; ") + ". Worth checking his stall on that visit.</p>";
  }

  // "Guard by 3 PM" on any forecast day whose window holds the start of a rain spell.
  function badges(all, now) {
    document.querySelectorAll(".day[data-start-ms]").forEach(function (day) {
      var el = day.querySelector(".day-guard"); if (!el) return;
      var a = +day.getAttribute("data-start-ms"), b = +day.getAttribute("data-end-ms");
      var sp = all.filter(function (s) { return s.endMs > now && s.startMs >= a && s.startMs < b; })[0];
      if (!sp) { el.hidden = true; return; }
      var p = plan(sp);
      el.className = "day-guard" + (isDone(sp) ? " done" : "");
      el.innerHTML = isDone(sp) ? "Guard up" : "Guard by " + clock(p.leave);
      el.title = "Rain likely from about " + clock(sp.startMs) + (isDone(sp) ? "; stall guard is up" : "; leave by " + clock(p.leave));
      el.hidden = false;
    });
  }

  // ---------- the barn-trip part of Mikey's settings ----------
  var dlg = $("mikey-settings"), draft = null;
  function show() {
    ["drive", "prep", "spare"].forEach(function (k) { var o = $("trip-" + k); if (o) o.textContent = draft[k] + " min"; });
    var t = $("trip-total"), total = draft.drive + draft.prep + draft.spare;
    if (t) t.textContent = "Leave " + (total % 60 ? (total >= 60 ? Math.floor(total / 60) + " h " : "") + (total % 60) + " min" : (total / 60) + (total === 60 ? " hour" : " hours")) + " before the rain.";
    if ($("trip-evening")) $("trip-evening").value = String(draft.evening);
    if ($("trip-threshold")) $("trip-threshold").value = String(draft.threshold);
  }
  if (dlg) {
    // Any settings button (the blanket card's or this notice's) opens the shared popup.
    document.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest("[data-open-settings]")) return;
      draft = clean(S); show(); if (!dlg.open) dlg.showModal();
    });
    dlg.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-step]") : null;
      if (!b || !draft) return;
      var k = b.getAttribute("data-step");
      draft[k] = Math.max(0, Math.min(180, draft[k] + +b.getAttribute("data-by")));
      show();
    });
    ["trip-evening", "trip-threshold"].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener("change", function () { draft[id === "trip-evening" ? "evening" : "threshold"] = +el.value; show(); });
    });
    var reset = $("mikey-settings-reset");
    if (reset) reset.addEventListener("click", function () { draft = clean({}); show(); });
    dlg.addEventListener("close", function () {
      if (dlg.returnValue === "save" && draft) { S = clean(draft); write(KEY, S); render(); }
      draft = null;
    });
  }

  setInterval(render, 60000);  // countdowns and states move on with the clock
  window.MikeyGuard = { render: function (data) { DATA = data; OFF = data.utcOffsetSeconds * 1000; render(); } };
})();
