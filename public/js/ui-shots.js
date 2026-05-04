/* Tyrrells Wood Golf — Shot tracking UI (Session B)
 *
 * DOM layer for shot logging, bag settings and round-wide shots review.
 * Reuses .score-sheet / .score-backdrop / .btn classes from scoring.css
 * for visual continuity with Session A modals; adds .shot-* / .club-* /
 * .chip-* / .bag-* / .review-* in shots.css.
 *
 * Depends on TWGps, TWShots, TWScoring (read-only) and TWApp.
 */
(function () {
  'use strict';

  // ---------- DOM helpers (mirrored from ui-scoring.js, kept local) ----------

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v == null) return;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') node.innerHTML = v;
        else if (k in node) node[k] = v;
        else node.setAttribute(k, v);
      });
    }
    appendChildren(node, children);
    return node;
  }
  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach((c) => {
      if (c == null || c === false) return;
      if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
      else node.appendChild(c);
    });
  }

  function buildSheet(opts) {
    const { title, subtitle, modalCenter, footerButtons = [], onClose } = opts || {};
    const closeBtn = el('button', {
      class: 'score-sheet-close', 'aria-label': 'Close', type: 'button', onclick: () => close(),
    }, '✕');
    const header = el('div', { class: 'score-sheet-header' }, [
      el('div', {}, [
        el('h2', {}, title || ''),
        subtitle ? el('span', { class: 'sheet-sub' }, subtitle) : null,
      ]),
      closeBtn,
    ]);
    const body = el('div', { class: 'score-sheet-body' });
    const footer = footerButtons.length
      ? el('div', { class: 'score-sheet-footer' },
          footerButtons.map((b) => el('button', {
            class: 'btn btn-' + (b.kind || 'secondary'),
            type: 'button', disabled: !!b.disabled,
            onclick: () => b.onClick(close),
          }, b.label)))
      : null;
    const sheet = el('div', {
      class: 'score-sheet' + (modalCenter ? ' score-sheet-modal' : ''),
      role: 'dialog', 'aria-modal': 'true',
    }, [header, body, footer]);
    const backdrop = el('div', {
      class: 'score-backdrop' + (modalCenter ? ' center' : ''),
      onclick: (e) => { if (e.target === backdrop) close(); },
    }, sheet);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));
    function close() {
      backdrop.classList.remove('open');
      setTimeout(() => {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (onClose) onClose();
      }, 220);
    }
    return { backdrop, sheet, body, footer, close };
  }

  function confirmDialog(opts) {
    const { title, message, confirmLabel = 'OK', confirmKind = 'primary', cancelLabel = 'Cancel', onConfirm } = opts;
    const sheet = buildSheet({
      title, modalCenter: true,
      footerButtons: [
        { label: cancelLabel, kind: 'secondary', onClick: (close) => close() },
        { label: confirmLabel, kind: confirmKind, onClick: (close) => { close(); if (onConfirm) onConfirm(); } },
      ],
    });
    sheet.body.appendChild(el('p', { class: 'confirm-text' }, message));
  }

  // ---------- Module state ----------

  let lastUsedClubId = null;
  let pendingDelete = null;   // { playerId, holeNum, shot, timeoutId }

  // ---------- Helpers ----------

  function activeRound() {
    return window.TWScoring ? window.TWScoring.getActiveRound() : null;
  }
  function activePlayer() {
    const r = activeRound();
    return r && r.players[0] ? r.players[0] : null;
  }
  function getHole(holeNum) {
    if (!window.TWApp) return null;
    const holes = window.TWApp.getHoles();
    return holes && holes.find((h) => h.number === holeNum) || null;
  }
  function clubName(id) {
    if (!id) return '—';
    const c = window.TWShots.getClubById(id);
    return c ? c.name : id;
  }
  function shortLie(v) {
    return ({ tee: 'T', fairway: 'F', rough: 'R', bunker: 'B', green: 'G', hazard: 'H' })[v] || '–';
  }
  function shortResult(v) {
    if (v === 'holed') return '●';
    return shortLie(v);
  }

  // ---------- Shot entry sheet ----------

  function openEntrySheet(holeNum) {
    const round = activeRound();
    if (!round) { alert('Start a round first.'); return; }
    const player = activePlayer();
    if (!player) return;
    const hole = getHole(holeNum);
    if (!hole) return;

    if (window.TWGps && !window.TWGps.isRunning()) window.TWGps.start();

    const sheet = buildSheet({
      title: `Hole ${hole.number} · Par ${hole.par} · shots`,
      subtitle: `${player.name} · live tracking`,
      onClose: () => { if (gpsUnsub) gpsUnsub(); },
    });

    let mode = 'list';            // 'list' | 'entry'
    let editingShotN = null;
    const gpsUnsub = window.TWGps && window.TWGps.onAccuracyChange(() => {
      if (mode === 'list') render();
    });

    function render() {
      sheet.body.innerHTML = '';
      if (mode === 'entry') renderEntry();
      else renderList();
    }

    // --- list mode ---

    function renderList() {
      const shots = window.TWShots.getShots(player.id, holeNum);
      const stats = window.TWShots.holeStats(player.id, holeNum);
      sheet.body.appendChild(buildGpsStatus());
      sheet.body.appendChild(buildPinDistance());

      if (!shots.length) {
        sheet.body.appendChild(el('p', { class: 'shots-empty' }, 'No shots logged yet.'));
      } else {
        const list = el('div', { class: 'shot-list' });
        shots.forEach((s) => list.appendChild(buildShotRow(s)));
        sheet.body.appendChild(list);
        sheet.body.appendChild(buildHoleTotals(stats));
      }

      if (pendingDelete && pendingDelete.holeNum === holeNum && pendingDelete.playerId === player.id) {
        const undo = el('div', { class: 'shots-undo' }, [
          el('span', {}, 'Shot deleted.'),
          el('button', {
            class: 'btn btn-secondary', type: 'button',
            onclick: () => { undoDelete(); render(); },
          }, 'Undo'),
        ]);
        sheet.body.appendChild(undo);
      }

      sheet.body.appendChild(buildListActions());
    }

    function buildGpsStatus() {
      const gps = window.TWGps;
      const reading = gps && gps.getReading();
      const fresh = gps && gps.isFresh();
      const status = el('div', { class: 'shots-status' + (fresh ? ' fresh' : '') });
      if (!gps || !gps.isSupported()) status.textContent = 'GPS not supported on this device.';
      else if (!gps.isRunning()) status.textContent = 'GPS off — tap Start to enable.';
      else if (!reading) status.textContent = 'Searching for GPS fix…';
      else if (!fresh) status.textContent = 'Waiting for GPS fix… acc ' + reading.accuracy.toFixed(0) + 'm, age ' + (reading.age / 1000).toFixed(1) + 's';
      else status.textContent = 'GPS ✓ accuracy ±' + reading.accuracy.toFixed(0) + 'm';
      return status;
    }

    function buildPinDistance() {
      const reading = window.TWGps && window.TWGps.getReading();
      if (!reading || !hole.geometry || !hole.geometry.pin) return el('span');
      const d = window.TWShots.computeDistance(
        { lat: reading.lat, lng: reading.lng },
        { lat: hole.geometry.pin[0], lng: hole.geometry.pin[1] }
      );
      return el('div', { class: 'shots-pin-dist' }, Math.round(d) + 'y to pin');
    }

    function buildShotRow(shot) {
      const dist = shot.distanceYards != null
        ? (shot.distanceLowAccuracy ? '~' : '') + shot.distanceYards + 'y'
        : '—';
      return el('div', {
        class: 'shot-row',
        onclick: () => { mode = 'entry'; editingShotN = shot.n; render(); },
      }, [
        el('span', { class: 'shot-row-n' }, shot.n + '.'),
        el('span', { class: 'shot-row-club' }, clubName(shot.club)),
        el('span', { class: 'shot-row-meta' }, shortLie(shot.lie) + ' → ' + shortResult(shot.result)),
        el('span', { class: 'shot-row-dist' + (shot.distanceManuallySet ? ' manual' : '') }, dist),
        el('button', {
          class: 'shot-row-delete', type: 'button', 'aria-label': 'Delete shot',
          onclick: (e) => { e.stopPropagation(); softDelete(shot); },
        }, '×'),
      ]);
    }

    function buildHoleTotals(stats) {
      const par = hole.par;
      const v = stats.totalShots - par;
      const vs = v > 0 ? '+' + v : v < 0 ? String(v) : 'E';
      const flags = [];
      if (stats.fwHit === true) flags.push('FW ✓');
      if (stats.gir === true) flags.push('GIR ✓');
      if (stats.sandSaveMade) flags.push('Sand save ✓');
      const text = stats.totalShots + ' shots · ' + stats.putts + ' putts · ' + vs +
        (flags.length ? ' · ' + flags.join(' · ') : '');
      return el('div', { class: 'shots-totals' }, text);
    }

    function buildListActions() {
      const gps = window.TWGps;
      const canLog = gps && gps.isRunning() && gps.isFresh();
      const buttons = [];
      if (gps && !gps.isRunning()) {
        buttons.push(el('button', {
          class: 'btn btn-secondary', type: 'button',
          onclick: () => { gps.start().then(render); },
        }, 'Start GPS'));
      }
      buttons.push(el('button', {
        class: 'btn btn-primary shots-log-btn', type: 'button', disabled: !canLog,
        onclick: () => {
          if (!canLog) return;
          mode = 'entry'; editingShotN = null; render();
        },
      }, '+ Log shot'));
      buttons.push(el('button', {
        class: 'btn btn-secondary', type: 'button',
        onclick: () => sheet.close(),
      }, 'Done'));
      return el('div', { class: 'shots-actions' }, buttons);
    }

    function softDelete(shot) {
      if (pendingDelete) clearTimeout(pendingDelete.timeoutId);
      const snapshot = JSON.parse(JSON.stringify(shot));
      window.TWShots.deleteShot(player.id, holeNum, shot.n);
      pendingDelete = {
        playerId: player.id, holeNum, shot: snapshot,
        timeoutId: setTimeout(() => { pendingDelete = null; if (mode === 'list') render(); }, 5000),
      };
      render();
    }
    function undoDelete() {
      if (!pendingDelete) return;
      const d = pendingDelete;
      clearTimeout(d.timeoutId);
      window.TWShots.insertShotAt(d.playerId, d.holeNum, d.shot.n, {
        position: d.shot.position, club: d.shot.club, lie: d.shot.lie, result: d.shot.result,
      });
      pendingDelete = null;
    }

    // --- entry mode ---

    function renderEntry() {
      const shots = window.TWShots.getShots(player.id, holeNum);
      const editing = editingShotN != null ? shots.find((s) => s.n === editingShotN) : null;
      const prevShot = editing
        ? shots[shots.findIndex((s) => s.n === editingShotN) - 1]
        : shots[shots.length - 1];

      const reading = window.TWGps && window.TWGps.getReading();
      const usePosition = editing
        ? editing.position
        : (reading ? { lat: reading.lat, lng: reading.lng, accuracy: reading.accuracy } : null);

      let club = editing ? editing.club : (lastUsedClubId || (prevShot ? prevShot.club : null) || 'driver');
      let lie = editing ? editing.lie : (prevShot ? prevShot.result : 'tee');
      if (!editing && !prevShot) lie = 'tee';
      let result = editing ? editing.result : null;
      let editingDistanceOverride = null;

      sheet.body.appendChild(el('div', { class: 'shots-entry-head' },
        editing ? 'Edit shot ' + editing.n : 'Log shot ' + (shots.length + 1)
      ));

      sheet.body.appendChild(buildChips('Lie', window.TWShots.VALID_LIES, lie, (v) => { lie = v; }));
      sheet.body.appendChild(buildClubGrid(club, (v) => { club = v; }));
      sheet.body.appendChild(buildChips('Result', window.TWShots.VALID_RESULTS, result, (v) => { result = v; }));

      // Distance preview
      let distancePreview = null;
      if (editing && editing.distanceYards != null) {
        distancePreview = editing.distanceYards + 'y' + (editing.distanceManuallySet ? ' (manual)' : '');
      } else if (!editing && prevShot && usePosition && prevShot.position) {
        const d = window.TWShots.computeDistance(prevShot.position, usePosition);
        if (d != null) distancePreview = Math.round(d) + 'y from previous shot';
      }
      if (distancePreview) {
        sheet.body.appendChild(el('div', { class: 'shots-dist-preview' }, distancePreview));
      }

      // Manual distance correction (edit mode only)
      if (editing) {
        sheet.body.appendChild(el('div', { class: 'chip-section' }, [
          el('div', { class: 'chip-section-label' }, 'Distance (yards)'),
          el('input', {
            type: 'number', min: 0, max: 600, inputmode: 'numeric',
            value: editing.distanceYards != null ? editing.distanceYards : '',
            placeholder: '—',
            oninput: (e) => {
              const n = parseInt(e.target.value, 10);
              editingDistanceOverride = Number.isFinite(n) ? n : null;
            },
            style: { width: '100%', padding: '0.55rem 0.65rem', border: '1px solid var(--tw-border)', borderRadius: '0.45rem', fontSize: '0.95rem', background: 'var(--tw-bg)' },
          }),
        ]));
      }

      sheet.body.appendChild(el('div', { class: 'shots-actions' }, [
        el('button', {
          class: 'btn btn-secondary', type: 'button',
          onclick: () => { mode = 'list'; editingShotN = null; render(); },
        }, 'Cancel'),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => save(),
        }, 'Save'),
      ]));

      function save() {
        if (!result) { alert('Pick a result.'); return; }
        try {
          if (editing) {
            const partial = { club, lie, result };
            if (editingDistanceOverride != null && editingDistanceOverride !== editing.distanceYards) {
              partial.distanceYards = editingDistanceOverride;
            }
            window.TWShots.editShot(player.id, holeNum, editing.n, partial);
          } else {
            if (!usePosition) { alert('Need a GPS fix first.'); return; }
            window.TWShots.logShot(player.id, holeNum, { position: usePosition, club, lie, result });
          }
          lastUsedClubId = club;
          if (result === 'holed') handleHoleCompleted();
          mode = 'list';
          editingShotN = null;
          render();
        } catch (err) {
          console.error(err);
          alert(err.message || 'Could not save shot');
        }
      }
    }

    function buildChips(label, options, current, onPick) {
      const chips = el('div', { class: 'chip-row' });
      let activeBtn = null;
      options.forEach((v) => {
        const btn = el('button', {
          class: 'chip-button' + (v === current ? ' active' : ''),
          type: 'button',
          onclick: () => {
            if (activeBtn) activeBtn.classList.remove('active');
            btn.classList.add('active');
            activeBtn = btn;
            onPick(v);
          },
        }, v);
        if (v === current) activeBtn = btn;
        chips.appendChild(btn);
      });
      return el('div', { class: 'chip-section' }, [
        el('div', { class: 'chip-section-label' }, label),
        chips,
      ]);
    }

    function buildClubGrid(currentId, onPick) {
      const bag = window.TWShots.getBag();
      const grid = el('div', { class: 'club-grid' });
      let activeBtn = null;
      bag.forEach((c) => {
        const btn = el('button', {
          class: 'club-button' + (c.id === currentId ? ' active' : ''),
          type: 'button',
          onclick: () => {
            if (activeBtn) activeBtn.classList.remove('active');
            btn.classList.add('active');
            activeBtn = btn;
            onPick(c.id);
          },
        }, c.name);
        if (c.id === currentId) activeBtn = btn;
        grid.appendChild(btn);
      });
      const editLink = el('button', {
        class: 'bag-edit-link', type: 'button',
        onclick: () => { sheet.close(); openBagSettings(); },
      }, 'Edit bag…');
      return el('div', { class: 'chip-section' }, [
        el('div', { class: 'chip-section-label' }, 'Club'),
        grid,
        editLink,
      ]);
    }

    function handleHoleCompleted() {
      const shots = window.TWShots.getShots(player.id, holeNum);
      const round = activeRound();
      if (!round) return;
      const par = hole.par;
      const grossFromShots = shots.length;
      const puttsFromShots = shots.filter((s) => s.lie === 'green').length;
      const fwHit = par >= 4 && shots[0] && shots[0].lie === 'tee' && shots[0].result === 'fairway';
      const existing = (round.scores[player.id] || {})[holeNum];

      const apply = () => {
        window.TWScoring.recordScore(player.id, holeNum, {
          gross: grossFromShots,
          putts: puttsFromShots,
          fairwayHit: par >= 4 ? !!fwHit : null,
        });
        if (window.TWUIScoring && typeof window.TWUIScoring.refreshScoreTrigger === 'function') {
          window.TWUIScoring.refreshScoreTrigger();
        }
      };

      if (!existing || existing.gross == null || existing.gross === grossFromShots) {
        apply();
        return;
      }
      confirmDialog({
        title: 'Update gross score?',
        message: 'Hole ' + holeNum + ' had ' + existing.gross + ' on the card. Shot tracker says ' + grossFromShots + '. Update from shots?',
        confirmLabel: 'Update',
        onConfirm: apply,
      });
    }

    render();
  }

  // ---------- Bag settings ----------

  function openBagSettings() {
    let bag = window.TWShots.getBag().map((c) => Object.assign({}, c));
    let sheet;

    function render() {
      sheet.body.innerHTML = '';
      sheet.body.appendChild(el('p', { class: 'bag-help' },
        'Edit your 14 clubs. Typical yardage is optional.'));
      bag.forEach((c, i) => {
        sheet.body.appendChild(el('div', { class: 'bag-row' }, [
          el('input', {
            type: 'text', value: c.name, placeholder: 'Club name', autocomplete: 'off',
            oninput: (e) => { bag[i].name = e.target.value; },
          }),
          el('input', {
            type: 'number', value: c.typicalYards != null ? c.typicalYards : '',
            placeholder: 'yds', min: 0, max: 400, inputmode: 'numeric',
            oninput: (e) => {
              const n = parseInt(e.target.value, 10);
              bag[i].typicalYards = Number.isFinite(n) ? n : null;
            },
          }),
        ]));
      });
    }

    sheet = buildSheet({
      title: 'Bag settings',
      subtitle: '14 clubs',
      footerButtons: [
        { label: 'Reset', kind: 'secondary', onClick: () => {
          confirmDialog({
            title: 'Reset bag?',
            message: 'Replace your bag with the default 14 clubs?',
            confirmLabel: 'Reset', confirmKind: 'danger',
            onConfirm: () => {
              bag = window.TWShots.DEFAULT_BAG.map((c) => Object.assign({}, c));
              render();
            },
          });
        }},
        { label: 'Save', kind: 'primary', onClick: (close) => {
          try {
            const cleaned = bag.map((c) => ({
              id: c.id,
              name: (c.name || '').trim() || c.id,
              typicalYards: Number.isFinite(c.typicalYards) ? c.typicalYards : null,
            }));
            window.TWShots.saveBag(cleaned);
            close();
          } catch (err) { alert(err.message || 'Could not save'); }
        }},
      ],
    });
    render();
  }

  // ---------- Shots review ----------

  function openShotsReview(round) {
    round = round || activeRound() || (window.TWScoring.getHistory()[0] || null);
    if (!round) { alert('No round to review.'); return; }
    const player = round.players[0];
    const stats = computeReviewStats(round, player.id);

    const sheet = buildSheet({
      title: 'Shots review',
      subtitle: player.name + ' · ' + (round.startedAt || '').slice(0, 10),
      footerButtons: [{ label: 'Close', kind: 'secondary', onClick: (close) => close() }],
    });

    sheet.body.appendChild(el('div', { class: 'review-summary' }, [
      reviewStat(stats.totalShots, 'shots'),
      reviewStat(stats.totalPutts, 'putts'),
      reviewStat(stats.fwPct != null ? stats.fwPct + '%' : '—', 'FW'),
      reviewStat(stats.girPct != null ? stats.girPct + '%' : '—', 'GIR'),
      reviewStat(stats.sandSaves || 0, 'sand'),
    ]));

    const ids = Object.keys(stats.byClub);
    if (!ids.length) {
      sheet.body.appendChild(el('p', { class: 'shots-empty' }, 'No shots logged with a club yet.'));
      return;
    }
    const table = el('table', { class: 'club-table' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Club'),
      el('th', {}, 'Shots'),
      el('th', {}, 'Avg yds'),
    ])));
    const tbody = el('tbody');
    const bag = window.TWShots.getBag();
    ids.sort((a, b) => {
      const ai = bag.findIndex((c) => c.id === a);
      const bi = bag.findIndex((c) => c.id === b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    ids.forEach((id) => {
      const c = stats.byClub[id];
      tbody.appendChild(el('tr', {}, [
        el('td', {}, clubName(id)),
        el('td', {}, String(c.count)),
        el('td', {}, c.avgDistance != null ? String(c.avgDistance) : '—'),
      ]));
    });
    table.appendChild(tbody);
    sheet.body.appendChild(table);
  }

  function reviewStat(num, lbl) {
    return el('div', { class: 'review-stat' }, [
      el('span', { class: 'review-stat-num' }, String(num)),
      el('span', { class: 'review-stat-lbl' }, lbl),
    ]);
  }

  // For the active round we delegate to TWShots.roundStats; for history rounds
  // we walk shots manually since TWShots.roundStats reads from active.
  function computeReviewStats(round, playerId) {
    const active = window.TWScoring.getActiveRound();
    if (active && active.id === round.id) return window.TWShots.roundStats(playerId);

    const r = {
      byClub: {}, totalShots: 0, totalPutts: 0,
      fwHit: 0, fwPossible: 0, fwPct: null,
      girHit: 0, girPossible: 0, girPct: null,
      sandSaves: 0, sandOpps: 0, sandSavePct: null,
    };
    const ps = (round.shots && round.shots[playerId]) || {};
    const holes = window.TWApp ? window.TWApp.getHoles() : [];
    Object.keys(ps).forEach((k) => {
      const list = ps[k] || [];
      const holeNum = parseInt(k, 10);
      const par = (holes.find((h) => h.number === holeNum) || {}).par || null;
      r.totalShots += list.length;
      r.totalPutts += list.filter((s) => s.lie === 'green').length;
      if (par && par >= 4 && list.length) {
        r.fwPossible += 1;
        if (list[0].lie === 'tee' && list[0].result === 'fairway') r.fwHit += 1;
      }
      if (par && list.length) {
        const reachedAt = list.findIndex((s) => s.result === 'green' || s.result === 'holed');
        r.girPossible += 1;
        if (reachedAt >= 0 && (reachedAt + 1) <= (par - 2)) r.girHit += 1;
      }
      const bunkerIdx = list.findIndex((s) => s.lie === 'bunker');
      const holedIdx = list.findIndex((s) => s.result === 'holed');
      if (bunkerIdx >= 0 && holedIdx >= 0) {
        r.sandOpps += 1;
        if ((holedIdx - bunkerIdx + 1) <= 2) r.sandSaves += 1;
      }
      list.forEach((s) => {
        if (!s.club) return;
        if (!r.byClub[s.club]) r.byClub[s.club] = { count: 0, totalDistance: 0, distances: [], avgDistance: null };
        r.byClub[s.club].count += 1;
        if (s.distanceYards != null) {
          r.byClub[s.club].totalDistance += s.distanceYards;
          r.byClub[s.club].distances.push(s.distanceYards);
        }
      });
    });
    Object.values(r.byClub).forEach((c) => {
      c.avgDistance = c.distances.length ? Math.round(c.totalDistance / c.distances.length) : null;
    });
    if (r.fwPossible)  r.fwPct  = Math.round((r.fwHit  / r.fwPossible)  * 100);
    if (r.girPossible) r.girPct = Math.round((r.girHit / r.girPossible) * 100);
    if (r.sandOpps)    r.sandSavePct = Math.round((r.sandSaves / r.sandOpps) * 100);
    return r;
  }

  // ---------- exports ----------

  window.TWShotsUI = {
    openEntrySheet,
    openBagSettings,
    openShotsReview,
  };
})();
