// The Mane Forecast's data, fetched by the visitor's own browser.
// The barn's location lives only on this device (zip, town or the phone's location); the site holds none.
// Sources: NWS (forecast, hourly grid) and Open-Meteo (4 weather models, plus Neighcast's request
// for the blanket call). Results are kept on the device for 30 minutes.
(function () {
  "use strict";
  var PLACE_KEY = "maneforecast.place.v1", CACHE_KEY = "maneforecast.cache.v1";
  var FRESH_MS = 30 * 60e3, PARTIAL_FRESH_MS = 3 * 60e3, STALE_OK_MS = 12 * 36e5;
  var NWS = "https://api.weather.gov";
  var MODELS = { gfs_seamless: "GFS (US)", ecmwf_ifs025: "ECMWF (Europe)", icon_seamless: "ICON (Germany)", gem_seamless: "GEM (Canada)" };
  var MIN_CHANCE = 10, RAIN_MIN = 0.01;

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or private: carry on */ } }
  // Each request gets 12 seconds; a slow source is left out instead of holding up the whole page.
  var TIMEOUT_MS = 12000;
  function getJSON(url) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    var host = url.split("?")[0].replace("https://", "").split("/")[0];
    return fetch(url, { headers: { Accept: "application/geo+json, application/json" }, signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error(host + " answered " + r.status);
      return r.json();
    }, function (e) {
      throw new Error(e && e.name === "AbortError" ? host + " took too long" : host + " couldn't be reached");
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  // ---------- the place: zip, town or GPS -> rounded coordinates, saved on this device ----------
  function getPlace() { var p = read(PLACE_KEY); return p && isFinite(p.lat) && isFinite(p.lon) ? p : null; }
  function setPlace(p) { write(PLACE_KEY, p); write(CACHE_KEY, null); }
  // A zip code or a town name, through Open-Meteo's place search (it only goes to a weather service).
  // A zip lands on the middle of the zip's area, which can be miles from the barn; a town name or the
  // phone's location is usually closer. Rounded to ~1 km, like Neighcast.
  function findPlace(query) {
    var q = String(query || "").trim();
    if (!q) return Promise.reject(new Error("Enter a zip code or a town name."));
    // Coordinates, or a pasted weather.gov link (…MapClick.php?lat=..&lon=..): the exact spot weather.gov uses.
    var link = /lat=(-?\d+(?:\.\d+)?).*?lon=(-?\d+(?:\.\d+)?)/i.exec(q), pair = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(q);
    var ll = link || pair;
    if (ll) {
      var lat = +ll[1], lon = +ll[2];
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return Promise.reject(new Error("Those don't look like coordinates."));
      return describe({ lat: +lat.toFixed(2), lon: +lon.toFixed(2), source: link ? "a weather.gov link" : "coordinates" });
    }
    var isZip = /^\d{5}$/.test(q);
    return getJSON("https://geocoding-api.open-meteo.com/v1/search?count=10&countryCode=US&format=json&name=" + encodeURIComponent(q)).then(function (d) {
      var all = d.results || [];
      var hit = isZip ? (all.filter(function (r) { return (r.postcodes || []).indexOf(q) >= 0; })[0] || all[0]) : all[0];
      if (!hit) throw new Error("Couldn't find " + (isZip ? "zip " : "") + q + ".");
      return describe({ lat: +hit.latitude.toFixed(2), lon: +hit.longitude.toFixed(2), source: isZip ? "zip " + q : hit.name + (hit.admin1 ? ", " + hit.admin1 : "") });
    });
  }
  // The phone's own location (most accurate: tap it while at the barn).
  function findHere() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error("This browser can't share its location."));
      navigator.geolocation.getCurrentPosition(function (pos) {
        resolve(describe({ lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2), source: "this phone's location" }));
      }, function (err) {
        reject(new Error(err.code === 1 ? "Location permission was declined. Allow it for this site, or type a zip or town." : "Couldn't get a location right now. Try again, or type a zip or town."));
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    });
  }
  // Which NWS forecast square the point falls in, and its nearest town, so it can be checked against weather.gov.
  function describe(p) {
    return getJSON(NWS + "/points/" + p.lat + "," + p.lon).then(function (pt) {
      var pr = pt.properties, rel = ((pr.relativeLocation || {}).properties) || {};
      p.grid = pr.gridId + " " + pr.gridX + "," + pr.gridY;
      p.label = rel.city ? "near " + rel.city + ", " + rel.state : p.source;
      return p;
    }, function () { throw new Error("The National Weather Service doesn't cover that spot (US only)."); });
  }

  // ---------- fetching (with a 30-minute cache on the device) ----------
  var GRID_KEYS = ["temperature", "dewpoint", "windChill", "heatIndex", "relativeHumidity", "skyCover", "windSpeed", "windGust",
    "probabilityOfPrecipitation", "probabilityOfThunder", "quantitativePrecipitation", "snowfallAmount", "iceAccumulation", "weather"];
  function modelsURL(lat, lon) {
    return "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
      "&hourly=temperature_2m,precipitation,precipitation_probability,wind_gusts_10m&models=" + Object.keys(MODELS).join(",") +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=8";
  }
  function settle(p) { return p.then(function (v) { return { ok: v }; }, function (e) { return { err: String(e.message || e) }; }); }

  function fetchAll(place) {
    var lat = place.lat, lon = place.lon, N = window.Neighcast;
    var point = getJSON(NWS + "/points/" + lat + "," + lon).then(function (p) { return p.properties; });
    var forecast = point.then(function (p) { return getJSON(p.forecast); }).then(function (f) { return { periods: f.properties.periods, updated: f.properties.updateTime }; });
    var grid = point.then(function (p) { return getJSON(p.forecastGridData); }).then(function (g) {
      var out = {}; GRID_KEYS.forEach(function (k) { if (g.properties[k]) out[k] = g.properties[k]; }); return out;
    });
    return Promise.all([settle(forecast), settle(grid), settle(getJSON(modelsURL(lat, lon))),
      settle(getJSON(N.forecastURL(lat, lon))), N.nwsHourly(lat, lon)]).then(function (r) {
      if (!r[0].ok) throw new Error("The National Weather Service didn't answer (" + r[0].err + ").");
      var errors = [];  // plain names for the page's "didn't answer" note
      if (!r[1].ok) errors.push("The NWS hourly forecast");
      if (!r[2].ok || !r[3].ok) errors.push(!r[2].ok && !r[3].ok ? "Open-Meteo (the weather models and the blanket data)"
        : !r[2].ok ? "Open-Meteo's weather models" : "Open-Meteo's blanket data");
      return { at: Date.now(), lat: lat, lon: lon, forecast: r[0].ok, grid: r[1].ok || null, models: r[2].ok || null,
        om: r[3].ok || null, nwsHourly: r[4], errors: errors };
    });
  }
  // Calls back with (bundle, stale) once from the cache if it's fresh, otherwise after fetching.
  function load(place, force) {
    var c = read(CACHE_KEY), now = Date.now();
    var mine = c && c.lat === place.lat && c.lon === place.lon;
    // A forecast with a source missing is only kept for 3 minutes, so the next visit tries again.
    var fresh = c && c.errors && c.errors.length ? PARTIAL_FRESH_MS : FRESH_MS;
    if (!force && mine && now - c.at < fresh) return Promise.resolve({ bundle: c, stale: false });
    return fetchAll(place).then(function (b) { write(CACHE_KEY, b); return { bundle: b, stale: false }; }, function (e) {
      if (mine && now - c.at < STALE_OK_MS) return { bundle: c, stale: true, error: e.message };
      throw e;
    });
  }

  // ---------- time at the barn ----------
  // Open-Meteo reports the barn's UTC offset; every label uses it, whatever the phone's own timezone.
  function offsetOf(b) { return ((b.om && b.om.utc_offset_seconds) || (b.models && b.models.utc_offset_seconds) || 0) * 1000; }
  function barnDate(ms, off) { return new Date(ms + off); }
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function hourOf(ms, off) { return barnDate(ms, off).getUTCHours(); }
  function clock(ms, off) { var h = hourOf(ms, off); return (h % 12 || 12) + (h < 12 ? " AM" : " PM"); }
  function clockMin(ms, off) {
    var d = barnDate(ms, off), h = d.getUTCHours(), m = d.getUTCMinutes();
    return (h % 12 || 12) + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM");
  }
  function localToMs(s, off) {  // "2026-11-22T18:00" at the barn -> epoch ms
    var p = s.split(/[-T:]/).map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0) - off;
  }
  function sameBarnDay(a, b, off) { var x = barnDate(a, off), y = barnDate(b, off); return x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth() && x.getUTCDate() === y.getUTCDate(); }
  function issuedLabel(iso, off) {
    var ms = Date.parse(iso);
    return (sameBarnDay(ms, Date.now(), off) ? "" : DOW[barnDate(ms, off).getUTCDay()] + " ") + clockMin(ms, off);
  }

  // ---------- NWS: day cards ----------
  function iconFor(text, daytime) {
    var t = text.toLowerCase();
    if (t.indexOf("thunder") >= 0) return "cloud-lightning-rain";
    if (/snow|sleet|flurr|ice|freezing/.test(t)) return "cloud-snow";
    if (/rain|shower|drizzle/.test(t)) return "cloud-rain";
    if (/fog|haze|smoke/.test(t)) return "cloud-fog2";
    if (/partly|mostly sunny|mostly clear/.test(t)) return daytime ? "cloud-sun" : "cloud-moon";
    if (/cloudy|overcast/.test(t)) return "cloud";
    return daytime ? "sun" : "moon-stars";
  }
  function chanceOf(p) { return (p.probabilityOfPrecipitation || {}).value || 0; }
  function dayCards(b) {
    var off = offsetOf(b), ps = b.forecast.periods, days = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], startMs = Date.parse(p.startTime), d = barnDate(startMs, off);
      var name = i ? DOW[d.getUTCDay()] : (p.isDaytime ? "Today" : "Tonight");
      var day = {
        name: name, date: MON[d.getUTCMonth()] + " " + d.getUTCDate(),
        title: (i ? DAY[d.getUTCDay()] : name) + ", " + MON[d.getUTCMonth()] + " " + d.getUTCDate(),
        high: p.isDaytime ? p.temperature : null, low: p.isDaytime ? null : p.temperature,
        short: p.shortForecast, icon: iconFor(p.shortForecast, p.isDaytime), chance: chanceOf(p),
        startMs: startMs, endMs: Date.parse(p.endTime), parts: [{ name: p.name, text: p.detailedForecast }]
      };
      var n = ps[i + 1];
      if (p.isDaytime && n && !n.isDaytime && n.startTime.slice(0, 10) === p.startTime.slice(0, 10)) {
        day.low = n.temperature; day.chance = Math.max(day.chance, chanceOf(n)); day.endMs = Date.parse(n.endTime);
        day.parts.push({ name: n.name, text: n.detailedForecast }); i++;
      }
      day.showChance = day.chance >= MIN_CHANCE;
      days.push(day);
    }
    return days;
  }

  // ---------- NWS: the hourly grid ----------
  function hoursIn(dur) { var m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/.exec(dur || ""); return m ? Math.max(1, (+m[1] || 0) * 24 + (+m[2] || 0)) : 1; }
  function intervals(prop) {
    return ((prop || {}).values || []).map(function (v) { var x = v.validTime.split("/"); return { ms: Date.parse(x[0]), hours: hoursIn(x[1]), value: v.value }; });
  }
  function toF(v, u) { return /degC/.test(u || "") ? Math.round(v * 9 / 5 + 32) : Math.round(v); }
  function toMph(v, u) { return /km_h/.test(u || "") ? Math.round(v * 0.621371) : Math.round(v); }
  function series(grid, key, conv) {  // { hour ms: value }
    var prop = (grid || {})[key], out = {};
    intervals(prop).forEach(function (x) {
      if (x.value == null) return;
      var v = conv ? conv(x.value, prop.uom) : Math.round(x.value);
      for (var h = 0; h < x.hours; h++) out[x.ms + h * 36e5] = v;
    });
    return out;
  }
  function amounts(grid, key) {  // [{ms, hours, inches}]
    var prop = (grid || {})[key], mm = /mm$/.test((prop || {}).uom || "");
    return intervals(prop).filter(function (x) { return x.value > 0; }).map(function (x) { return { ms: x.ms, hours: x.hours, inches: mm ? x.value / 25.4 : x.value }; });
  }
  var TYPES = { snow: "Snow", snow_showers: "Snow", blowing_snow: "Snow", freezing_rain: "Freezing rain", freezing_drizzle: "Freezing rain", sleet: "Sleet", thunderstorms: "Thunderstorms" };
  function precipTypes(grid) {
    var out = {};
    intervals((grid || {}).weather).forEach(function (x) {
      var labels = (x.value || []).map(function (w) { return TYPES[w.weather]; }).filter(Boolean);
      if (!labels.length) return;
      for (var h = 0; h < x.hours; h++) { var k = x.ms + h * 36e5; out[k] = (out[k] || []).concat(labels); }
    });
    return out;
  }
  function parseGrid(b) {
    var g = b.grid; if (!g) return null;
    return {
      temp: series(g, "temperature", toF), dew: series(g, "dewpoint", toF), windChill: series(g, "windChill", toF),
      heatIndex: series(g, "heatIndex", toF), rh: series(g, "relativeHumidity"), sky: series(g, "skyCover"),
      wind: series(g, "windSpeed", toMph), gust: series(g, "windGust", toMph), pop: series(g, "probabilityOfPrecipitation"),
      thunder: series(g, "probabilityOfThunder"), rain: amounts(g, "quantitativePrecipitation"),
      snow: amounts(g, "snowfallAmount"), ice: amounts(g, "iceAccumulation"), types: precipTypes(g)
    };
  }
  // NWS rain blocks spread evenly over their hours, plus each hour's whole-block total.
  function rainByHour(G) {
    var spread = {}, block = {};
    (G ? G.rain : []).forEach(function (x) { for (var h = 0; h < x.hours; h++) { spread[x.ms + h * 36e5] = x.inches / x.hours; block[x.ms + h * 36e5] = x.inches; } });
    return { spread: spread, block: block };
  }

  // ---------- Open-Meteo: the four models, by hour ----------
  function parseModels(b) {
    var out = {}; if (!b.models) return out;
    var h = b.models.hourly, off = b.models.utc_offset_seconds * 1000;
    Object.keys(MODELS).forEach(function (id) {
      var s = {}, t = h["temperature_2m_" + id] || [];
      h.time.forEach(function (time, i) {
        if (t[i] == null) return;
        s[localToMs(time, off)] = { temp: Math.round(t[i]), rain: Math.max((h["precipitation_" + id] || [])[i] || 0, 0),
          pop: (h["precipitation_probability_" + id] || [])[i], gust: (h["wind_gusts_10m_" + id] || [])[i] };
      });
      out[MODELS[id]] = s;
    });
    return out;
  }

  // ---------- comparing every source over one NWS day (6 AM to 6 AM) ----------
  function windowHours(day) {
    var out = [], h = Math.floor(day.startMs / 36e5) * 36e5;
    for (; h <= day.endMs; h += 36e5) out.push(h);
    return out;
  }
  function summary(name, rows, isDay, off) {
    var have = rows.filter(function (r) { return r.v; });
    if (!have.length) return null;
    var dayT = [], nightT = [], pops = [], rain = 0;
    have.forEach(function (r) {
      var hr = hourOf(r.ms, off);
      if (r.v.temp != null) (hr >= 6 && hr < 18 ? dayT : nightT).push(r.v.temp);
      if (r.v.pop != null) pops.push(r.v.pop);
      rain += r.v.rain || 0;
    });
    return { name: name, high: isDay && dayT.length ? Math.max.apply(null, dayT) : null, low: nightT.length ? Math.min.apply(null, nightT) : null,
      rain: Math.round(rain * 100) / 100, chance: pops.length ? Math.max.apply(null, pops) : null, partial: have.length < rows.length * 0.8 };
  }
  function compareDay(ctx, day) {
    var off = ctx.off, hours = windowHours(day), win = hours.length > 1 ? hours.slice(0, -1) : hours, isDay = day.high != null, rows = [];
    if (ctx.G) {
      var rbh = rainByHour(ctx.G);
      var s = summary("National Weather Service", win.map(function (ms) {
        return { ms: ms, v: ctx.G.temp[ms] == null ? null : { temp: ctx.G.temp[ms], pop: ctx.G.pop[ms], rain: rbh.spread[ms] || 0 } };
      }), isDay, off);
      if (s) { s.high = day.high; s.low = day.low; s.chance = day.chance; rows.push(s); }
    }
    Object.keys(ctx.M).forEach(function (name) {
      var s = summary(name, win.map(function (ms) { return { ms: ms, v: ctx.M[name][ms] }; }), isDay, off);
      if (s) rows.push(s);
    });
    return { sources: rows, verdict: verdict(rows), range: range(rows) };
  }
  function range(rows) {
    var hi = rows.map(function (r) { return r.high; }).filter(function (v) { return v != null; });
    var rain = rows.map(function (r) { return r.rain; });
    return { high: hi.length ? [Math.min.apply(null, hi), Math.max.apply(null, hi)] : null,
      rain: rain.length ? [Math.min.apply(null, rain), Math.max.apply(null, rain)] : null,
      anyRain: rain.some(function (r) { return r >= RAIN_MIN; }) };
  }
  function verdict(rows) {
    if (!rows.length) return [];
    var out = [], hi = rows.map(function (r) { return r.high; }).filter(function (v) { return v != null; });
    if (hi.length) {
      var lo = Math.min.apply(null, hi), top = Math.max.apply(null, hi);
      out.push(top - lo <= 3 ? "All sources agree on the high, within " + (top - lo) + "°." : "Sources disagree on the high: " + lo + "° to " + top + "°.");
    }
    var wet = rows.filter(function (r) { return r.rain >= RAIN_MIN; });
    if (!wet.length) out.push("No source expects measurable rain.");
    else if (wet.length === rows.length) out.push("All " + rows.length + " sources expect rain (" + Math.min.apply(null, wet.map(function (r) { return r.rain; })).toFixed(2) + "–" + Math.max.apply(null, wet.map(function (r) { return r.rain; })).toFixed(2) + " in).");
    else if (wet.length === 1) out.push("Only " + wet[0].name + " expects rain (" + wet[0].rain.toFixed(2) + " in); the others don't.");
    else out.push(wet.length + " of " + rows.length + " sources expect rain (" + wet.map(function (r) { return r.name; }).join(", ") + ").");
    return out;
  }

  // ---------- one day's popup ----------
  function blocksIn(list, a, b, off) {
    return list.filter(function (x) { var end = x.ms + x.hours * 36e5; return end > a && x.ms < b && x.inches >= 0.005; })
      .map(function (x) { return { when: clock(x.ms, off) + " – " + clock(x.ms + x.hours * 36e5, off), amount: x.inches }; });
  }
  function dayDetail(ctx, index) {
    var day = ctx.days[index], off = ctx.off, G = ctx.G, hours = windowHours(day);
    var col = function (k) { return hours.map(function (ms) { var v = G[k][ms]; return v == null ? null : v; }); };
    var temp = col("temp"), feels = hours.map(function (ms) { return G.windChill[ms] != null ? G.windChill[ms] : (G.heatIndex[ms] != null ? G.heatIndex[ms] : null); });
    var showFeels = feels.some(function (f, i) { return f != null && temp[i] != null && Math.abs(f - temp[i]) >= 2; });
    var compared = compareDay(ctx, day), pops = col("pop").filter(function (v) { return v != null; });
    var rainBlocks = blocksIn(G.rain, hours[0], hours[hours.length - 1], off);
    var snow = blocksIn(G.snow, hours[0], hours[hours.length - 1], off), ice = blocksIn(G.ice, hours[0], hours[hours.length - 1], off);
    var anyChance = Math.max.apply(null, pops.concat([0])) >= MIN_CHANCE || compared.sources.some(function (s) { return (s.chance || 0) >= MIN_CHANCE; });
    var showRain = rainBlocks.length > 0 || compared.range.anyRain || anyChance;
    var thunder = Math.max.apply(null, col("thunder").filter(function (v) { return v != null; }).concat([0]));
    var gusts = col("gust").filter(function (v) { return v != null; });
    var types = {}; hours.forEach(function (ms) { (G.types[ms] || []).forEach(function (t) { if (t !== "Thunderstorms") types[t] = 1; }); });
    var models = Object.keys(ctx.M).map(function (name) {
      return { name: name, temp: hours.map(function (ms) { return (ctx.M[name][ms] || {}).temp; }),
        pop: showRain ? hours.map(function (ms) { return (ctx.M[name][ms] || {}).pop; }) : null };
    });
    var sum = function (l) { return l.reduce(function (a, x) { return a + x.amount; }, 0); };
    return {
      day: day, index: index,
      prev: index > 0 ? { index: index - 1, name: ctx.days[index - 1].name } : null,
      next: index + 1 < ctx.days.length ? { index: index + 1, name: ctx.days[index + 1].name } : null,
      compared: compared, rainBlocks: rainBlocks, snow: snow, ice: ice, snowTotal: sum(snow), iceTotal: sum(ice),
      types: Object.keys(types), thunder: thunder >= MIN_CHANCE ? thunder : 0, gustMax: gusts.length ? Math.max.apply(null, gusts) : 0,
      showRain: showRain, showFeels: showFeels,
      window: clock(hours[0], off) + " " + DOW[barnDate(hours[0], off).getUTCDay()] + " to " + clock(hours[hours.length - 1], off) + " " + DOW[barnDate(hours[hours.length - 1], off).getUTCDay()],
      chart: {
        labels: hours.map(function (ms) { return DOW[barnDate(ms, off).getUTCDay()] + " " + clock(ms, off); }),
        nws: { temp: temp, dew: col("dew"), feels: showFeels ? feels : null, wind: col("wind"), gust: col("gust"), sky: col("sky"), rh: col("rh"), pop: showRain ? col("pop") : null },
        models: models
      }
    };
  }

  // ---------- the stall guard's rain hours (next 72 hours, every source) ----------
  function rainHours(ctx) {
    var off = ctx.off, rbh = rainByHour(ctx.G), now = Math.floor(Date.now() / 36e5) * 36e5, hours = [];
    for (var i = 0; i < 72; i++) {
      var ms = now + i * 36e5, models = {};
      Object.keys(ctx.M).forEach(function (m) { var r = ctx.M[m][ms]; if (r) models[m] = Math.round(r.rain * 1000) / 1000; });
      hours.push({ ms: ms, nwsPop: ctx.G ? (ctx.G.pop[ms] != null ? ctx.G.pop[ms] : null) : null,
        nwsRain: rbh.spread[ms] || 0, nwsBlock: rbh.block[ms] || 0, models: models });
    }
    return { hours: hours, models: Object.keys(ctx.M), utcOffsetSeconds: off / 1000 };
  }

  // Everything the page needs from one bundle.
  function context(bundle) {
    var ctx = { bundle: bundle, off: offsetOf(bundle), G: parseGrid(bundle), M: parseModels(bundle) };
    ctx.days = dayCards(bundle);
    ctx.issued = issuedLabel(bundle.forecast.updated, ctx.off);
    return ctx;
  }

  window.Mane = { getPlace: getPlace, setPlace: setPlace, findPlace: findPlace, findHere: findHere, load: load, context: context,
    compareDay: compareDay, dayDetail: dayDetail, rainHours: rainHours, clock: clock, barnDate: barnDate };
})();
