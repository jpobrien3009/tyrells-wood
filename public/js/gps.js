/* Tyrrells Wood Golf — GPS wrapper (Session B)
 *
 * Single source of truth for the user's current position. Wraps
 * navigator.geolocation.watchPosition with the freshness / accuracy
 * gating that shot logging requires:
 *   - reading must be < 5s old
 *   - reported accuracy must be < 20m
 * The first position the browser hands back can be a stale cache hit,
 * so consumers should always check isFresh() before logging a shot.
 *
 * No DOM mutation in normal operation. A small debug overlay can be
 * activated by adding `#gps-debug` to the URL.
 */
(function () {
  'use strict';

  const FRESH_AGE_MS = 5000;
  const FRESH_ACCURACY_M = 20;

  let watchId = null;
  let lastReading = null;        // { lat, lng, accuracy, timestamp }
  let lastError = null;
  const subscribers = new Set();

  function notify() {
    const r = getReading();
    subscribers.forEach((fn) => {
      try { fn(r); } catch (err) { console.warn('[TWGps] subscriber threw', err); }
    });
  }

  function isSupported() {
    return 'geolocation' in navigator;
  }

  function isRunning() {
    return watchId !== null;
  }

  // Returns Promise<boolean>: true if first fix received, false if denied/unsupported.
  function start() {
    if (!isSupported()) {
      lastError = new Error('Geolocation not supported');
      return Promise.resolve(false);
    }
    if (watchId !== null) return Promise.resolve(true);

    return new Promise((resolve) => {
      let settled = false;
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          lastReading = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          };
          lastError = null;
          notify();
          if (!settled) { settled = true; resolve(true); }
        },
        (err) => {
          lastError = err;
          notify();
          if (!settled) { settled = true; resolve(false); }
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 }
      );
    });
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function getReading() {
    if (!lastReading) return null;
    return {
      lat: lastReading.lat,
      lng: lastReading.lng,
      accuracy: lastReading.accuracy,
      timestamp: lastReading.timestamp,
      age: Date.now() - lastReading.timestamp,
    };
  }

  function isFresh() {
    if (!lastReading) return false;
    const age = Date.now() - lastReading.timestamp;
    return age < FRESH_AGE_MS && lastReading.accuracy < FRESH_ACCURACY_M;
  }

  function getError() {
    return lastError;
  }

  function onAccuracyChange(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  // ---------- Debug overlay ----------

  function buildDebugOverlay() {
    if (document.getElementById('twGpsDebug')) return;
    const root = document.createElement('div');
    root.id = 'twGpsDebug';
    root.style.cssText = [
      'position:fixed',
      'top:max(0.5rem,env(safe-area-inset-top))',
      'right:0.5rem',
      'z-index:5000',
      'background:rgba(26,61,31,0.92)',
      'color:#f5f1e8',
      'padding:0.55rem 0.7rem',
      'border-radius:0.5rem',
      'font:500 11px/1.35 -apple-system,BlinkMacSystemFont,sans-serif',
      'min-width:170px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
    ].join(';');
    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.3rem">' +
        '<strong style="letter-spacing:0.04em">GPS DEBUG</strong>' +
        '<button id="twGpsDebugClose" aria-label="Close" style="background:transparent;border:1px solid rgba(245,241,232,0.4);border-radius:50%;width:1.2rem;height:1.2rem;color:#f5f1e8;font-size:0.7rem;cursor:pointer;line-height:1;padding:0">×</button>' +
      '</div>' +
      '<div id="twGpsDebugBody" style="font-variant-numeric:tabular-nums">Not started.</div>' +
      '<div style="display:flex;gap:0.3rem;margin-top:0.4rem">' +
        '<button id="twGpsDebugStart" style="flex:1;padding:0.35rem;background:#c9a961;color:#1a3d1f;border:none;border-radius:0.3rem;font-weight:700;font-size:11px;cursor:pointer">Start</button>' +
        '<button id="twGpsDebugStop" style="flex:1;padding:0.35rem;background:rgba(245,241,232,0.15);color:#f5f1e8;border:1px solid rgba(245,241,232,0.4);border-radius:0.3rem;font-weight:600;font-size:11px;cursor:pointer">Stop</button>' +
      '</div>';
    document.body.appendChild(root);
    document.getElementById('twGpsDebugClose').addEventListener('click', () => root.remove());
    document.getElementById('twGpsDebugStart').addEventListener('click', () => start());
    document.getElementById('twGpsDebugStop').addEventListener('click', () => stop());

    function render() {
      const body = document.getElementById('twGpsDebugBody');
      if (!body) return;
      const r = getReading();
      const err = getError();
      if (err && !r) {
        body.textContent = 'Error: ' + (err.message || err.code || 'unknown');
        return;
      }
      if (!r) {
        body.textContent = isRunning() ? 'Searching…' : 'Not started.';
        return;
      }
      const ageS = (r.age / 1000).toFixed(1);
      const fresh = isFresh();
      body.innerHTML =
        'lat ' + r.lat.toFixed(6) + '<br/>' +
        'lng ' + r.lng.toFixed(6) + '<br/>' +
        'acc ' + r.accuracy.toFixed(1) + ' m<br/>' +
        'age ' + ageS + ' s<br/>' +
        '<span style="color:' + (fresh ? '#c9a961' : '#e8b59a') + '">' +
          (fresh ? '✓ FRESH' : '✗ stale') +
        '</span>';
    }

    onAccuracyChange(render);
    setInterval(render, 500);
    render();
  }

  function maybeAutoEnableDebug() {
    if (/#.*gps-debug/.test(location.href)) buildDebugOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoEnableDebug);
  } else {
    maybeAutoEnableDebug();
  }

  window.TWGps = {
    start,
    stop,
    getReading,
    isFresh,
    isRunning,
    isSupported,
    getError,
    onAccuracyChange,
    showDebug: buildDebugOverlay,
  };
})();
