/* Tyrrells Wood Golf — Scoring data layer
 *
 * Pure logic + localStorage. No DOM access.
 * Exposed as window.TWScoring.
 */
(function () {
  'use strict';

  const KEYS = {
    active: 'tw.activeRound',
    history: 'tw.history',
    settings: 'tw.settings',
  };

  const HISTORY_CAP = 50;

  // Course constants — single course, hard-coded to keep the brief tight.
  const TEES = {
    white:  { rating: 70.7, slope: 137, par: 71 },
    yellow: { rating: 69.7, slope: 134, par: 71 },
    red:    { rating: 67.5, slope: 126, par: 72 },
  };

  // ---------- storage helpers ----------

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[TWScoring] failed to read ${key}`, err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      if (value == null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
      return true;
    } catch (err) {
      console.error(`[TWScoring] failed to write ${key}`, err);
      return false;
    }
  }

  // ---------- ids ----------

  function uid(prefix) {
    return `${prefix || 'id'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // ---------- calculations ----------

  function computeCourseHandicap(handicapIndex, tee) {
    const t = TEES[tee];
    if (!t) throw new Error(`Unknown tee: ${tee}`);
    const raw = handicapIndex * (t.slope / 113) + (t.rating - t.par);
    return Math.round(raw);
  }

  // strokeIndexes: array of 18 SI values (in hole order 1..18, each 1..18)
  function computeStrokesPerHole(courseHandicap, strokeIndexes) {
    const ch = Math.max(0, Math.floor(courseHandicap));
    const base = Math.floor(ch / 18);
    const remainder = ch % 18;
    return strokeIndexes.map((si) => {
      let strokes = base;
      if (si <= remainder) strokes += 1;
      // Negative handicaps would be unusual here; spec says +1 again if CH > 18,
      // which is already handled by base = floor(ch/18) ≥ 1 for ch ≥ 18.
      return strokes;
    });
  }

  // Returns Stableford points for a single hole.
  // grossScore: number (or null/undefined to mean "no score" → 0 pts)
  // strokesReceived: number ≥ 0
  // par: par for that hole
  function computeStableford(grossScore, strokesReceived, par) {
    if (grossScore == null || grossScore <= 0) return 0;
    const net = grossScore - strokesReceived;
    const diff = net - par; // -3 albatross, -2 eagle, -1 birdie, 0 par, +1 bogey, +2 dbl bogey
    if (diff >= 2) return 0;        // net double bogey or worse
    if (diff === 1) return 1;       // net bogey
    if (diff === 0) return 2;       // net par
    if (diff === -1) return 3;      // net birdie
    if (diff === -2) return 4;      // net eagle
    return 5;                       // net albatross or better — capped
  }

  // Compute aggregate totals for a round.
  // Returns { perPlayer: { [playerId]: { strokes, points, vsPar, fairways, putts, holesPlayed } } }
  function computeRunningTotals(round, holes) {
    const out = { perPlayer: {} };
    if (!round || !round.players) return out;
    round.players.forEach((player) => {
      const stats = {
        strokes: 0,
        points: 0,
        vsPar: 0,
        fairways: 0,
        putts: 0,
        holesPlayed: 0,
        parPlayed: 0,
      };
      const playerScores = (round.scores && round.scores[player.id]) || {};
      holes.forEach((hole, idx) => {
        const entry = playerScores[hole.number];
        if (!entry || entry.gross == null || entry.gross <= 0) return;
        stats.strokes += entry.gross;
        stats.parPlayed += hole.par;
        stats.vsPar += entry.gross - hole.par;
        stats.holesPlayed += 1;
        if (typeof entry.putts === 'number') stats.putts += entry.putts;
        if (entry.fairwayHit === true) stats.fairways += 1;
        const strokesReceived = (player.strokesPerHole && player.strokesPerHole[idx]) || 0;
        stats.points += computeStableford(entry.gross, strokesReceived, hole.par);
      });
      out.perPlayer[player.id] = stats;
    });
    return out;
  }

  // ---------- state accessors ----------

  function getActiveRound() {
    return readJSON(KEYS.active, null);
  }

  function getHistory() {
    const arr = readJSON(KEYS.history, []);
    return Array.isArray(arr) ? arr : [];
  }

  function getSettings() {
    const s = readJSON(KEYS.settings, {});
    return s && typeof s === 'object' ? s : {};
  }

  function saveSettings(partial) {
    const merged = Object.assign({}, getSettings(), partial || {});
    writeJSON(KEYS.settings, merged);
    return merged;
  }

  // ---------- lifecycle ----------

  // playersInput: [{ name, handicapIndex, tee }]
  // strokeIndexes: array of 18 stroke index values (in hole order)
  function startRound(playersInput, strokeIndexes) {
    if (!Array.isArray(playersInput) || playersInput.length < 1 || playersInput.length > 4) {
      throw new Error('startRound: need 1–4 players');
    }
    if (!Array.isArray(strokeIndexes) || strokeIndexes.length !== 18) {
      throw new Error('startRound: stroke indexes must be length 18');
    }

    const players = playersInput.map((p, i) => {
      const name = (p.name || '').trim();
      if (!name) throw new Error(`Player ${i + 1} needs a name`);
      const hi = Number(p.handicapIndex);
      if (!Number.isFinite(hi) || hi < 0 || hi > 54) {
        throw new Error(`Player ${name}: handicap must be 0–54`);
      }
      const tee = p.tee;
      if (!TEES[tee]) throw new Error(`Player ${name}: invalid tee`);
      const courseHandicap = computeCourseHandicap(hi, tee);
      const strokesPerHole = computeStrokesPerHole(courseHandicap, strokeIndexes);
      return {
        id: uid('p'),
        name,
        handicapIndex: hi,
        tee,
        courseHandicap,
        strokesPerHole,
      };
    });

    const round = {
      id: uid('r'),
      courseId: 'tyrrells-wood',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      players,
      scores: Object.fromEntries(players.map((p) => [p.id, {}])),
      currentHole: 1,
    };

    writeJSON(KEYS.active, round);

    // Remember last-used names + default tee/handicap for the first player.
    saveSettings({
      defaultHandicap: players[0].handicapIndex,
      defaultTee: players[0].tee,
      lastPlayerNames: players.map((p) => p.name),
    });

    return round;
  }

  function recordScore(playerId, holeNum, entry) {
    const round = getActiveRound();
    if (!round) throw new Error('No active round');
    if (!round.scores[playerId]) round.scores[playerId] = {};
    const cleaned = {
      gross: Number.isFinite(entry.gross) ? entry.gross : null,
      putts: Number.isFinite(entry.putts) ? entry.putts : null,
      fairwayHit: entry.fairwayHit === true ? true : entry.fairwayHit === false ? false : null,
    };
    round.scores[playerId][holeNum] = cleaned;
    round.currentHole = holeNum;
    writeJSON(KEYS.active, round);
    return round;
  }

  function setCurrentHole(holeNum) {
    const round = getActiveRound();
    if (!round) return;
    round.currentHole = holeNum;
    writeJSON(KEYS.active, round);
  }

  function finishRound() {
    const round = getActiveRound();
    if (!round) return null;
    round.finishedAt = new Date().toISOString();
    const history = getHistory();
    history.unshift(round);
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
    writeJSON(KEYS.history, history);
    writeJSON(KEYS.active, null);
    return round;
  }

  function discardRound() {
    writeJSON(KEYS.active, null);
  }

  function deleteHistoryRound(roundId) {
    const history = getHistory().filter((r) => r.id !== roundId);
    writeJSON(KEYS.history, history);
  }

  // ---------- exports ----------

  window.TWScoring = {
    TEES,
    getActiveRound,
    getHistory,
    getSettings,
    saveSettings,
    startRound,
    recordScore,
    setCurrentHole,
    finishRound,
    discardRound,
    deleteHistoryRound,
    computeCourseHandicap,
    computeStrokesPerHole,
    computeStableford,
    computeRunningTotals,
  };
})();
