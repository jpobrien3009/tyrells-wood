# Tyrrells Wood Golf — Hole Map App

A Progressive Web App (PWA) showing hole-by-hole information for **Tyrrells Wood Golf Club** in Leatherhead, Surrey. Designed for iPhone (installs to home screen, works like a native app) but runs in any modern browser.

## What it does today (v0.1)

- Shows a satellite map of the course
- Hole-by-hole picker with par, stroke index and yardages from white/yellow/red tees
- "Distance to pin" via iPhone GPS (when geometry is added)
- Installable to iPhone home screen as a standalone app

## What's not done yet

- **Hole geometry** — the JSON has all 18 holes with par, SI and white yardages, but no tee/green/fairway/bunker polygons yet. Hole 1 has a description; 2–18 are placeholders.
- **Yellow and red tee yardages** — only white is in the public data. Easy to add when you have the scorecard.
- **Hole descriptions and play tips** — only hole 1 is filled in.
- **Service worker** — for true offline use at the course (signal can be patchy). Trivial to add once everything else is stable.

## Project structure

```
tyrrells-wood-app/
├── data/
│   └── tyrrells-wood.json       # Course data — single source of truth
├── public/                      # Everything that gets deployed
│   ├── index.html
│   ├── manifest.json            # PWA install metadata
│   ├── css/styles.css
│   ├── js/app.js                # All the app logic (~250 lines)
│   ├── icons/                   # Home-screen icons (placeholder TW logo)
│   └── data/tyrrells-wood.json  # Copy used at runtime
└── README.md
```

## Running it locally

You need *any* static web server. Easiest:

```bash
cd public
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

> **Note:** Opening `index.html` directly with `file://` won't work — the JSON `fetch` is blocked by CORS. Always go through a server.

## Testing on your iPhone (same Wi-Fi)

1. On your laptop: `cd public && python3 -m http.server 8000`
2. Find your laptop's local IP (e.g. `192.168.1.42`)
3. On the iPhone, open Safari and go to `http://192.168.1.42:8000`
4. Tap Share → Add to Home Screen
5. The app opens fullscreen, just like a native app

> **GPS only works over HTTPS.** Local HTTP testing won't give you GPS. To test GPS you need to host on Cloudflare Pages / Vercel / similar (free) — see *Deploying* below.

## Adding hole geometry

This is the main remaining work. Each hole in `data/tyrrells-wood.json` has a `geometry: null` field that should be filled in like this:

```json
"geometry": {
  "tees": {
    "white": [51.28555, -0.29678],
    "yellow": [51.28560, -0.29672],
    "red":    [51.28565, -0.29665]
  },
  "pin": [51.28612, -0.29554],
  "green": [
    [51.28608, -0.29560],
    [51.28615, -0.29548],
    [51.28617, -0.29550],
    [51.28610, -0.29562]
  ],
  "fairway": [
    [51.28556, -0.29675],
    [51.28580, -0.29630],
    ...
  ],
  "bunkers": [
    [ [51.28590, -0.29610], [51.28593, -0.29605], ... ],
    [ [51.28575, -0.29615], ... ]
  ],
  "water": [],
  "bounds": [
    [51.28555, -0.29680],
    [51.28620, -0.29545]
  ]
}
```

### How to capture geometry

Use **[geojson.io](https://geojson.io)** — free browser tool:

1. Open geojson.io, navigate to Tyrrells Wood (search "KT22 8QP")
2. Switch to satellite view (Mapbox Satellite in the top-right)
3. Use the polygon tool to trace each green, fairway and bunker
4. Use the point tool for tee positions and pin
5. Copy the resulting GeoJSON, convert each feature's coordinates to `[lat, lng]` arrays (geojson.io gives `[lng, lat]` — flip them) and paste into the JSON

A worked example for hole 1 takes about 10 minutes once you've got the hang of it. Then 17 more, ~3 hours total.

## Deploying

**Cloudflare Pages** (recommended — free, fast, HTTPS by default which we need for GPS):

1. Push the `public/` folder to a GitHub repo
2. Sign up at pages.cloudflare.com
3. Connect the repo, set build command empty, output directory `public`
4. Done — you'll get a URL like `tyrrells-wood.pages.dev`

## Data sources

All data is from publicly accessible sources, none scraped from the club's own site:

- **Scorecard (par, stroke index, white yardages):** 18Birdies
- **Tee summary (white/yellow/red ratings):** Golfshake
- **Course description:** Golfshake, GolfPass, Surrey Golf
- **Clubhouse coordinates:** 18Birdies (mapped to Google Maps)
- **OpenStreetMap:** for hole centerlines (to be added in Phase 2)

If we later go fully public/shareable, all data here is freely re-distributable; no club imagery or copyrighted material has been used.

## Roadmap

- **Phase 1 (now):** Working app with placeholder data ✓
- **Phase 2:** Trace all 18 holes — tees, greens, bunkers, fairways
- **Phase 3:** Carry distances and lay-up markers per hole
- **Phase 4:** Service worker for offline use
- **Phase 5:** Shot tracking — tap to record each shot, build round summaries
- **Phase 6:** Multi-course support; add other courses he visits
- **Phase 7:** Optional public release with user accounts

## Tech stack

- **Frontend:** vanilla HTML / CSS / JS (no build step, no framework)
- **Mapping:** Leaflet 1.9.4 (CDN)
- **Tiles:** Esri World Imagery (free, no key needed)
- **GPS:** browser Geolocation API (HTTPS only)
- **PWA:** manifest.json + Apple meta tags (service worker to be added)
- **Hosting:** any static host
