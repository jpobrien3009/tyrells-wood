/* Tyrrells Wood Golf — Hole Map App
 *
 * Loads course data, displays the course on a Leaflet satellite map,
 * lets the user navigate hole-by-hole, and (optionally) shows GPS position.
 *
 * Hole geometry (tee/green/fairway/bunkers) is loaded from data/tyrrells-wood.json.
 * When a hole has no geometry yet, we fall back to a course-wide overview.
 */

const COURSE_URL = 'data/tyrrells-wood.json';

// Global state
let course = null;
let holes = [];
let currentHole = 1;
let map = null;
let holeLayer = null;
let gpsMarker = null;
let gpsWatchId = null;

// ---------- Init ----------

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch(COURSE_URL);
    const data = await res.json();
    course = data.course;
    holes = data.holes;
  } catch (err) {
    console.error('Failed to load course data', err);
    document.getElementById('holeDescription').textContent =
      'Could not load course data. Check that data/tyrrells-wood.json is reachable.';
    return;
  }

  initMap();
  buildHolePicker();
  bindEvents();

  // Expose a small surface for the scoring UI before the first setHole,
  // so anything listening for tw:holechange can already query state.
  window.TWApp = {
    getCurrentHole: () => currentHole,
    getHoles: () => holes,
    getCourse: () => course,
    setHole,
  };

  // If a round is active, jump to the saved current hole instead of hole 1.
  let initialHole = 1;
  try {
    const saved = window.TWScoring && window.TWScoring.getActiveRound();
    if (saved && Number.isFinite(saved.currentHole)) initialHole = saved.currentHole;
  } catch (e) { /* ignore */ }
  setHole(initialHole);
});

// ---------- Map ----------

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
  }).setView([course.clubhouse.lat, course.clubhouse.lng], 16);

  // Esri World Imagery — free, no API key, decent res over Surrey
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Imagery © Esri',
    }
  ).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Clubhouse marker
  L.marker([course.clubhouse.lat, course.clubhouse.lng], {
    title: 'Clubhouse',
  })
    .addTo(map)
    .bindPopup('<b>Tyrrells Wood Golf Club</b><br/>Clubhouse');
}

// ---------- Hole rendering ----------

function setHole(holeNum) {
  const hole = holes.find((h) => h.number === holeNum);
  if (!hole) return;

  currentHole = holeNum;
  updateHoleInfo(hole);
  drawHole(hole);
  updateHolePicker();
  updateNavButtons();

  // Persist active-round currentHole + let the scoring UI react.
  if (window.TWScoring && typeof window.TWScoring.setCurrentHole === 'function') {
    if (window.TWScoring.getActiveRound()) window.TWScoring.setCurrentHole(holeNum);
  }
  window.dispatchEvent(new CustomEvent('tw:holechange', { detail: { hole: holeNum } }));
}

function updateHoleInfo(hole) {
  const yards = hole.yardage || {};
  document.getElementById('holeSubtitle').textContent =
    `Hole ${hole.number} · Par ${hole.par} · ${yards.white ?? '–'}y`;
  document.getElementById('parValue').textContent = hole.par;
  document.getElementById('siValue').textContent = hole.stroke_index;
  document.getElementById('whiteYards').textContent = yards.white ? `${yards.white}y` : '–';
  document.getElementById('yellowYards').textContent = yards.yellow ? `${yards.yellow}y` : '–';
  document.getElementById('redYards').textContent = yards.red ? `${yards.red}y` : '–';
  document.getElementById('holeDescription').textContent = hole.description || '';
  document.getElementById('holeTip').textContent = hole.play_tip || '';
}

function drawHole(hole) {
  // Clear previous hole geometry
  if (holeLayer) {
    map.removeLayer(holeLayer);
    holeLayer = null;
  }

  if (!hole.geometry) {
    // No geometry yet — center on clubhouse with a wider view
    map.setView([course.clubhouse.lat, course.clubhouse.lng], 16);
    return;
  }

  const layers = [];
  const g = hole.geometry;

  // Fairway
  if (g.fairway) {
    layers.push(
      L.polygon(g.fairway, {
        color: '#4caf50',
        weight: 1,
        fillColor: '#4caf50',
        fillOpacity: 0.25,
      })
    );
  }

  // Green
  if (g.green) {
    layers.push(
      L.polygon(g.green, {
        color: '#8bc34a',
        weight: 2,
        fillColor: '#8bc34a',
        fillOpacity: 0.5,
      })
    );
  }

  // Bunkers
  if (g.bunkers) {
    g.bunkers.forEach((b) => {
      layers.push(
        L.polygon(b, {
          color: '#d4a574',
          weight: 1,
          fillColor: '#f5deb3',
          fillOpacity: 0.7,
        })
      );
    });
  }

  // Water
  if (g.water) {
    g.water.forEach((w) => {
      layers.push(
        L.polygon(w, {
          color: '#1e88e5',
          weight: 1,
          fillColor: '#42a5f5',
          fillOpacity: 0.5,
        })
      );
    });
  }

  // Tees
  if (g.tees) {
    Object.entries(g.tees).forEach(([colour, latlng]) => {
      const marker = L.circleMarker(latlng, {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: teeColour(colour),
        fillOpacity: 1,
      }).bindTooltip(`${colour} tee`, { permanent: false });
      layers.push(marker);
    });
  }

  // Pin
  if (g.pin) {
    layers.push(
      L.marker(g.pin, {
        icon: L.divIcon({
          className: 'pin-icon',
          html: '⛳',
          iconSize: [24, 24],
          iconAnchor: [12, 24],
        }),
      })
    );
  }

  holeLayer = L.layerGroup(layers).addTo(map);
  if (g.bounds) {
    map.fitBounds(g.bounds, { padding: [40, 40] });
  } else if (g.tees && g.pin) {
    const all = [...Object.values(g.tees), g.pin];
    map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  }
}

function teeColour(name) {
  switch (name) {
    case 'white': return '#ffffff';
    case 'yellow': return '#ffeb3b';
    case 'red': return '#e53935';
    case 'blue': return '#1e88e5';
    default: return '#9e9e9e';
  }
}

// ---------- Hole picker ----------

function buildHolePicker() {
  const picker = document.getElementById('holePicker');
  picker.innerHTML = '';
  holes.forEach((h) => {
    const chip = document.createElement('button');
    chip.className = 'hole-chip';
    chip.dataset.hole = h.number;
    chip.innerHTML = `<span class="chip-num">${h.number}</span><span class="chip-par">P${h.par}</span>`;
    chip.addEventListener('click', () => setHole(h.number));
    picker.appendChild(chip);
  });
}

function updateHolePicker() {
  const picker = document.getElementById('holePicker');
  picker.querySelectorAll('.hole-chip').forEach((chip) => {
    const num = parseInt(chip.dataset.hole, 10);
    chip.classList.toggle('active', num === currentHole);
    if (num === currentHole) {
      chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });
}

function updateNavButtons() {
  document.getElementById('prevHole').disabled = currentHole <= 1;
  document.getElementById('nextHole').disabled = currentHole >= 18;
}

// ---------- Events ----------

function bindEvents() {
  document.getElementById('prevHole').addEventListener('click', () => {
    if (currentHole > 1) setHole(currentHole - 1);
  });
  document.getElementById('nextHole').addEventListener('click', () => {
    if (currentHole < 18) setHole(currentHole + 1);
  });
  document.getElementById('gpsBtn').addEventListener('click', toggleGPS);
}

// ---------- GPS ----------

function toggleGPS() {
  const btn = document.getElementById('gpsBtn');
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    if (gpsMarker) {
      map.removeLayer(gpsMarker);
      gpsMarker = null;
    }
    btn.classList.remove('active');
    return;
  }

  if (!('geolocation' in navigator)) {
    alert('GPS not supported on this device.');
    return;
  }

  btn.classList.add('active');
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (!gpsMarker) {
        gpsMarker = L.marker([latitude, longitude], {
          icon: L.divIcon({
            className: '',
            html: '<div class="gps-pulse"></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).addTo(map);
      } else {
        gpsMarker.setLatLng([latitude, longitude]);
      }
      // Distance to pin (if hole has geometry)
      const hole = holes.find((h) => h.number === currentHole);
      if (hole && hole.geometry && hole.geometry.pin) {
        const dist = haversineYards(
          latitude,
          longitude,
          hole.geometry.pin[0],
          hole.geometry.pin[1]
        );
        document.getElementById('holeSubtitle').textContent =
          `Hole ${hole.number} · Par ${hole.par} · ${Math.round(dist)}y to pin`;
      }
    },
    (err) => {
      console.warn('GPS error', err);
      alert('Could not get GPS fix. Check location permissions.');
      btn.classList.remove('active');
      gpsWatchId = null;
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

function haversineYards(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const metres = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return metres * 1.09361; // metres to yards
}
