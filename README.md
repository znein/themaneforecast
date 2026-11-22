# Team Mikey · The Mane Forecast

Mikey's weather report for Mom: the National Weather Service 7-day forecast, checked against four
weather models (GFS, ECMWF, ICON, GEM via Open-Meteo). Tap a day for hour-by-hour charts and a
side-by-side comparison.

- **Stall guard notice:** when rain is coming, when to leave for the barn (rain start minus the barn
  trip: drive + prep + spare). The earliest source wins. Overnight rain moves to the evening visit.
- **Blanket Mikey tonight?** Neighcast's own blanket code (copied byte for byte into
  `static/js/neighcast.js`).
- **Mikey's settings:** the barn's zip code, his coat, shelter, feels the cold, and the barn trip.
  All saved on the visitor's device only.

## How it works

A plain static site (GitHub Pages, no build step, no server, no keys). The visitor's browser looks
up the zip code with Open-Meteo's place search, rounds it to about 1 km, saves it on the device, and
fetches the forecast straight from NWS and Open-Meteo. Results are kept on the device for 30 minutes.
The site's files never contain a location.

## Preview locally

From the repo folder:

```
python3 -m http.server 5050
```

Then open http://127.0.0.1:5050 and enter a zip code.

## Keeping the blanket rules in step with Neighcast

```
python3 scripts/sync_neighcast_rules.py          # check
python3 scripts/sync_neighcast_rules.py --write  # copy Neighcast's current code
```
