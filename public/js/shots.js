/* Tyrrells Wood Golf — Shot tracking data layer (Session B)
 *
 * Stores per-shot data within the active round, plus the user's bag.
 * Pure logic + localStorage. No DOM.
 *
 * Active-round write strategy: scoring.js owns tw.activeRound, but adding
 * shots needs to mutate that same object. We read via TWScoring.getActive
 * Round() and write back to the same key directly, leaving scoring.js
 * untouched (per Session B brief). Session A's finishRound() then carries
 * shots into history automatically.
 */
(function () {
  'use strict';

  const ACTIVE_KEY = 'tw.activeRound';
  const BAG_KEY = 'tw.bag';
  const ACCURACY_WARN_M = 15;

  const DEFAULT_BAG = [
    { id: 'driver', name: 'Driver',  typicalYards: 240 },
    { id: '3w',     name: '3-Wood',  typicalYards: 215 },
    { id: '5w',     name: '5-Wood',  typicalYards: 195 },
    { id: '4i',     name: '4-iron',  typicalYards: 185 },
    { id: '5i',     name: '5-iron',  typicalYards: 175 },
    { id: '6i',     name: '6-iron',  typicalYards: 165 },
    { id: '7i',     name: '7-iron',  typicalYards: 155 },
    { id: '8i',     name: '8-iron',  typicalYards: 145 },
    { id: '9i',     name: '9-iron',  typicalYards: 135 },
    { id: 'pw',     name: 'PW',      typicalYards: 125 },
    { id: 'gw',     name: 'GW',      typicalYards: 110 },
    { id: 'sw',     name: 'SW',      typicalYards: 95  },
    { id: 'lw',     name: 'LW',      typicalYards: 80  },
    { id: 'putter', name: 'Putter',  typicalYards: null },
  ];

  const VALID_LIES    = ['tee', 'fairway', 'rough', 'bunker', 'green', 'hazard'];
  const VALID_RESULTS = ['fairway', 'rough', 'bunker', 'green', 'hazard', 'holed'];

  // ---------- storage helpers ----------

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[TWShots] failed to read ' + key, err);
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error('[TWShots] failed to write ' + key, err);
      return false;
    }
  }

  function getActiveRound() {
    if (window.TWScoring && typeof window.TWScoring.getActiveRound === 'function') {
      return window.TWScoring.getActiveRound();
    }
    return readJSON(ACTIVE_KEY, null);
  }
  function writeActiveRound(round) {
    return writeJSON(ACTIVE_KEY, round);
  }

  function ensureContainer(round, playerId, holeNum) {
    if (!round.shots) round.shots = {};
    if (!round.shots[playerId]) round.shots[playerId] = {};
    if (!Array.isArray(round.shots[playerId][holeNum])) round.shots[playerId][holeNum] = [];
    return round.shots[playerId][holeNum];
  }

  // ---------- bag ----------

  function getBag() {
    const stored = readJSON(BAG_KEY, null);
    if (stored && Array.isArray(stored.clubs) && stored.clubs.length) return stored.clubs;
    return DEFAULT_BAG.slice();
  }
  function saveBag(clubs) {
    if (!Array.isArray(clubs) || !clubs.length) throw new Error('saveBag: clubs required');
    writeJSON(BAG_KEY, { clubs });
  }
  function getClubById(id) {
    return getBag().find((c) => c.id === id) || null;
  }

  // ---------- distance ----------

  // Haversine; returns yards. Same shape as app.js haversineYards.
  function computeDistance(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    const metres = R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    return metres * 1.09361;
  }

  // ---------- shot CRUD ----------

  function getShots(playerId, holeNum) {
    const round = getActiveRound();
    if (!round || !round.shots || !round.shots[playerId]) return [];
    return (round.shots[playerId][holeNum] || []).slice();
  }

  function logShot(playerId, holeNum, shotData) {
    const round = getActiveRound();
    if (!round) throw new Error('No active round');
    if (!shotData || !shotData.position) throw new Error('logShot: position required');
    const list = ensureContainer(round, playerId, holeNum);
    const prev = list[list.length - 1];

    const dist = prev ? computeDistance(prev.position, shotData.position) : null;
    const lowAcc = dist != null && (
      (prev && prev.position.accuracy > ACCURACY_WARN_M) ||
      shotData.position.accuracy > ACCURACY_WARN_M
    );

    const shot = {
      n: list.length + 1,
      loggedAt: new Date().toISOString(),
      position: {
        lat: shotData.position.lat,
        lng: shotData.position.lng,
        accuracy: shotData.position.accuracy,
      },
      club: shotData.club || null,
      lie: shotData.lie || null,
      result: shotData.result || null,
      distanceYards: dist != null ? Math.round(dist) : null,
      distanceLowAccuracy: !!lowAcc,
      distanceManuallySet: false,
    };
    list.push(shot);
    writeActiveRound(round);

    if (shot.result === 'holed') {
      window.dispatchEvent(new CustomEvent('tw:shot-holed', {
        detail: { playerId, holeNum, gross: list.length },
      }));
    }
    return shot;
  }

  function editShot(playerId, holeNum, shotN, partial) {
    const round = getActiveRound();
    if (!round) throw new Error('No active round');
    const list = ensureContainer(round, playerId, holeNum);
    const idx = list.findIndex((s) => s.n === shotN);
    if (idx < 0) throw new Error('Shot ' + shotN + ' not found');
    const target = list[idx];
    const wasHoled = target.result === 'holed';

    if (partial.club   !== undefined) target.club   = partial.club;
    if (partial.lie    !== undefined) target.lie    = partial.lie;
    if (partial.result !== undefined) target.result = partial.result;
    if (partial.position !== undefined) {
      target.position = partial.position;
      if (!target.distanceManuallySet && idx > 0) {
        const d = computeDistance(list[idx - 1].position, target.position);
        target.distanceYards = d != null ? Math.round(d) : null;
      }
    }
    if (partial.distanceYards !== undefined) {
      target.distanceYards = partial.distanceYards;
      target.distanceManuallySet = true;
    }
    writeActiveRound(round);

    if (target.result === 'holed' && !wasHoled) {
      window.dispatchEvent(new CustomEvent('tw:shot-holed', {
        detail: { playerId, holeNum, gross: list.length },
      }));
    }
    return target;
  }

  function deleteShot(playerId, holeNum, shotN) {
    const round = getActiveRound();
    if (!round) throw new Error('No active round');
    const list = ensureContainer(round, playerId, holeNum);
    const idx = list.findIndex((s) => s.n === shotN);
    if (idx < 0) return false;
    list.splice(idx, 1);
    list.forEach((s, i) => { s.n = i + 1; });
    list.forEach((s, i) => {
      if (s.distanceManuallySet) return;
      if (i === 0) { s.distanceYards = null; return; }
      const d = computeDistance(list[i - 1].position, s.position);
      s.distanceYards = d != null ? Math.round(d) : null;
    });
    writeActiveRound(round);
    return true;
  }

  // Insert a shot at a specific position (for "I forgot to log shot 3" recovery).
  function insertShotAt(playerId, holeNum, position, shotData) {
    const round = getActiveRound();
    if (!round) throw new Error('No active round');
    const list = ensureContainer(round, playerId, holeNum);
    const insertIdx = Math.max(0, Math.min(position - 1, list.length));
    const shot = {
      n: 0,
      loggedAt: new Date().toISOString(),
      position: shotData.position || { lat: null, lng: null, accuracy: null },
      club: shotData.club || null,
      lie: shotData.lie || null,
      result: shotData.result || null,
      distanceYards: null,
      distanceLowAccuracy: false,
      distanceManuallySet: false,
    };
    list.splice(insertIdx, 0, shot);
    list.forEach((s, i) => { s.n = i + 1; });
    list.forEach((s, i) => {
      if (s.distanceManuallySet) return;
      if (i === 0 || !s.position || s.position.lat == null) { s.distanceYards = null; return; }
      const d = computeDistance(list[i - 1].position, s.position);
      s.distanceYards = d != null ? Math.round(d) : null;
    });
    writeActiveRound(round);
    return shot;
  }

  // ---------- stats ----------

  function getHolePar(holeNum) {
    if (window.TWApp && typeof window.TWApp.getHoles === 'function') {
      const h = window.TWApp.getHoles().find((x) => x.number === holeNum);
      return h ? h.par : null;
    }
    return null;
  }

  function holeStats(playerId, holeNum) {
    const list = getShots(playerId, holeNum);
    const par = getHolePar(holeNum);
    const stats = {
      totalShots: list.length,
      putts: list.filter((s) => s.lie === 'green').length,
      bunkerShots: list.filter((s) => s.lie === 'bunker').length,
      complete: list.some((s) => s.result === 'holed'),
      fwHit: null,
      gir: null,
      sandSaveOpp: false,
      sandSaveMade: false,
    };
    if (par != null && list.length) {
      if (par >= 4) stats.fwHit = list[0].lie === 'tee' && list[0].result === 'fairway';
      const reachedAt = list.findIndex((s) => s.result === 'green' || s.result === 'holed');
      stats.gir = reachedAt >= 0 && (reachedAt + 1) <= (par - 2);
      // sand-save opportunity: a bunker shot was played and the hole was completed
      if (stats.bunkerShots > 0 && stats.complete) {
        stats.sandSaveOpp = true;
        // saved if the hole was finished within 2 strokes of any bunker shot
        const bunkerIdx = list.findIndex((s) => s.lie === 'bunker');
        const holedIdx  = list.findIndex((s) => s.result === 'holed');
        if (bunkerIdx >= 0 && holedIdx >= 0 && (holedIdx - bunkerIdx + 1) <= 2) {
          stats.sandSaveMade = true;
        }
      }
    }
    return stats;
  }

  function roundStats(playerId) {
    const empty = {
      byClub: {}, totalShots: 0, totalPutts: 0,
      fwHit: 0, fwPossible: 0, fwPct: null,
      girHit: 0, girPossible: 0, girPct: null,
      sandSaves: 0, sandOpps: 0, sandSavePct: null,
    };
    const round = getActiveRound();
    if (!round || !round.shots || !round.shots[playerId]) return empty;
    const playerShots = round.shots[playerId];
    const result = empty;

    Object.keys(playerShots).forEach((key) => {
      const holeNum = parseInt(key, 10);
      const list = playerShots[key] || [];
      const stats = holeStats(playerId, holeNum);
      result.totalShots += stats.totalShots;
      result.totalPutts += stats.putts;
      if (stats.fwHit !== null) {
        result.fwPossible += 1;
        if (stats.fwHit) result.fwHit += 1;
      }
      if (stats.gir !== null) {
        result.girPossible += 1;
        if (stats.gir) result.girHit += 1;
      }
      if (stats.sandSaveOpp) {
        result.sandOpps += 1;
        if (stats.sandSaveMade) result.sandSaves += 1;
      }
      list.forEach((s) => {
        if (!s.club) return;
        if (!result.byClub[s.club]) {
          result.byClub[s.club] = { count: 0, totalDistance: 0, distances: [], avgDistance: null };
        }
        const c = result.byClub[s.club];
        c.count += 1;
        if (s.distanceYards != null) {
          c.totalDistance += s.distanceYards;
          c.distances.push(s.distanceYards);
        }
      });
    });

    Object.values(result.byClub).forEach((c) => {
      c.avgDistance = c.distances.length ? Math.round(c.totalDistance / c.distances.length) : null;
    });
    if (result.fwPossible)   result.fwPct      = Math.round((result.fwHit   / result.fwPossible) * 100);
    if (result.girPossible)  result.girPct     = Math.round((result.girHit  / result.girPossible) * 100);
    if (result.sandOpps)     result.sandSavePct = Math.round((result.sandSaves / result.sandOpps) * 100);
    return result;
  }

  // ---------- exports ----------

  window.TWShots = {
    DEFAULT_BAG,
    VALID_LIES,
    VALID_RESULTS,
    ACCURACY_WARN_M,
    getBag,
    saveBag,
    getClubById,
    getShots,
    logShot,
    editShot,
    deleteShot,
    insertShotAt,
    computeDistance,
    holeStats,
    roundStats,
  };
})();
