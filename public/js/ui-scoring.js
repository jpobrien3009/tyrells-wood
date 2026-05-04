/* Tyrrells Wood Golf — Scoring UI layer
 *
 * DOM/event glue. Depends on window.TWScoring + the existing app.js
 * (uses window.TWApp.getCurrentHole() and window.TWApp.getHoles()).
 */
(function () {
  'use strict';

  const TEES = ['white', 'yellow', 'red'];

  // ---------- DOM helpers ----------

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

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return iso || '';
    }
  }

  // ---------- Generic backdrop/sheet ----------

  // Returns { backdrop, sheet, body, footer, close }
  function buildSheet(opts) {
    const {
      title,
      subtitle,
      modalCenter = false,
      onClose,
      footerButtons = [], // [{ label, kind: 'primary'|'secondary'|'danger', onClick }]
    } = opts || {};

    const closeBtn = el('button', {
      class: 'score-sheet-close',
      'aria-label': 'Close',
      type: 'button',
      onclick: () => close(),
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
            class: `btn btn-${b.kind || 'secondary'}`,
            type: 'button',
            onclick: () => b.onClick(close),
          }, b.label)))
      : null;

    const sheet = el('div', {
      class: 'score-sheet' + (modalCenter ? ' score-sheet-modal' : ''),
      role: 'dialog',
      'aria-modal': 'true',
    }, [header, body, footer]);

    const backdrop = el('div', {
      class: 'score-backdrop' + (modalCenter ? ' center' : ''),
      onclick: (e) => { if (e.target === backdrop) close(); },
    }, sheet);

    document.body.appendChild(backdrop);
    // Trigger transition
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

  // Stepper component returning { node, getValue, setValue }
  function buildStepper(initial, min, max, onChange) {
    let value = initial;
    const valueEl = el('span', { class: 'stepper-value' }, String(value));
    const minus = el('button', {
      type: 'button',
      'aria-label': 'Decrease',
      onclick: () => set(value - 1),
    }, '−');
    const plus = el('button', {
      type: 'button',
      'aria-label': 'Increase',
      onclick: () => set(value + 1),
    }, '+');
    const node = el('div', { class: 'stepper' }, [minus, valueEl, plus]);

    function set(n) {
      value = clamp(Math.round(n), min, max);
      valueEl.textContent = String(value);
      minus.disabled = value <= min;
      plus.disabled = value >= max;
      if (onChange) onChange(value);
    }
    set(value);

    return {
      node,
      getValue: () => value,
      setValue: set,
    };
  }

  // ---------- Confirm dialog ----------

  function confirmDialog(opts) {
    const { title, message, confirmLabel = 'OK', confirmKind = 'primary', cancelLabel = 'Cancel', onConfirm } = opts;
    const sheet = buildSheet({
      title,
      modalCenter: true,
      footerButtons: [
        { label: cancelLabel, kind: 'secondary', onClick: (close) => close() },
        { label: confirmLabel, kind: confirmKind, onClick: (close) => { close(); if (onConfirm) onConfirm(); } },
      ],
    });
    sheet.body.appendChild(el('p', { class: 'confirm-text' }, message));
  }

  // ---------- Menu drawer ----------

  let menuBackdrop = null;
  let menuDrawer = null;

  function ensureMenu() {
    if (menuBackdrop) return;
    menuBackdrop = el('div', {
      class: 'menu-backdrop',
      onclick: closeMenu,
    });
    menuDrawer = el('aside', { class: 'menu-drawer', role: 'dialog', 'aria-label': 'Menu' });
    document.body.appendChild(menuBackdrop);
    document.body.appendChild(menuDrawer);
  }

  function openMenu() {
    ensureMenu();
    renderMenu();
    menuBackdrop.classList.add('open');
    menuDrawer.classList.add('open');
  }

  function closeMenu() {
    if (!menuBackdrop) return;
    menuBackdrop.classList.remove('open');
    menuDrawer.classList.remove('open');
  }

  function renderMenu() {
    const active = TWScoring.getActiveRound();
    const history = TWScoring.getHistory();

    menuDrawer.innerHTML = '';
    const header = el('div', { class: 'menu-header' }, [
      el('span', {}, 'Tyrrells Wood'),
      el('span', { class: 'menu-sub' }, active ? 'Round in progress' : 'Tap to start'),
    ]);

    const items = [];
    if (active) {
      items.push({
        label: 'Round summary',
        sub: `${active.players.map((p) => p.name).join(', ')} · started ${fmtDate(active.startedAt)}`,
        onClick: () => { closeMenu(); openSummary(); },
      });
      items.push({
        label: 'Continue → score current hole',
        sub: `Hole ${active.currentHole || 1}`,
        onClick: () => { closeMenu(); openScoreEntry(active.currentHole || (window.TWApp ? window.TWApp.getCurrentHole() : 1)); },
      });
      items.push({
        label: 'Discard round',
        sub: 'Throw away the active round',
        onClick: () => {
          closeMenu();
          confirmDialog({
            title: 'Discard active round?',
            message: 'This will delete all entered scores. This cannot be undone.',
            confirmLabel: 'Discard',
            confirmKind: 'danger',
            onConfirm: () => {
              TWScoring.discardRound();
              refreshScoreTrigger();
            },
          });
        },
      });
    } else {
      items.push({
        label: 'Start round',
        sub: '1–4 players, Stableford + Strokeplay',
        onClick: () => { closeMenu(); openStartRoundModal(); },
      });
    }

    items.push({
      label: `History${history.length ? ' (' + history.length + ')' : ''}`,
      sub: history.length ? 'Past rounds' : 'No past rounds yet',
      onClick: () => { closeMenu(); openHistory(); },
      disabled: history.length === 0,
    });

    const list = el('ul', { class: 'menu-list' },
      items.map((it) => el('li', {}, [
        el('button', {
          class: 'menu-item',
          type: 'button',
          disabled: !!it.disabled,
          onclick: () => { if (!it.disabled) it.onClick(); },
        }, [
          document.createTextNode(it.label),
          it.sub ? el('span', { class: 'menu-item-sub' }, it.sub) : null,
        ]),
      ]))
    );

    menuDrawer.appendChild(header);
    menuDrawer.appendChild(list);
  }

  // ---------- Start round modal ----------

  function openStartRoundModal() {
    const settings = TWScoring.getSettings();
    const lastNames = settings.lastPlayerNames || [];
    const defaultTee = settings.defaultTee || 'yellow';
    const defaultHandicap = settings.defaultHandicap != null ? settings.defaultHandicap : 18;

    let players = [
      {
        name: lastNames[0] || '',
        handicapIndex: defaultHandicap,
        tee: defaultTee,
      },
    ];

    let sheet;

    function render() {
      sheet.body.innerHTML = '';
      const cards = el('div', {}, players.map((p, i) => playerCard(p, i)));
      sheet.body.appendChild(cards);

      if (players.length < 4) {
        sheet.body.appendChild(el('div', { class: 'start-add-row' }, [
          el('button', {
            class: 'btn btn-secondary',
            type: 'button',
            onclick: () => {
              players.push({
                name: lastNames[players.length] || '',
                handicapIndex: defaultHandicap,
                tee: defaultTee,
              });
              render();
            },
          }, '+ Add player'),
        ]));
      }
    }

    function playerCard(p, idx) {
      const removeBtn = players.length > 1
        ? el('button', {
            class: 'start-player-card-remove',
            type: 'button',
            onclick: () => { players.splice(idx, 1); render(); },
          }, 'Remove')
        : null;

      const nameInput = el('input', {
        type: 'text',
        value: p.name,
        placeholder: `Player ${idx + 1}`,
        autocomplete: 'off',
        oninput: (e) => { p.name = e.target.value; },
      });
      const hiInput = el('input', {
        type: 'number',
        min: '0',
        max: '54',
        step: '0.1',
        value: String(p.handicapIndex),
        inputmode: 'decimal',
        oninput: (e) => { p.handicapIndex = parseFloat(e.target.value); },
      });
      const teeSelect = el('select', {
        onchange: (e) => { p.tee = e.target.value; },
      }, TEES.map((t) => el('option', { value: t, selected: t === p.tee }, t.charAt(0).toUpperCase() + t.slice(1))));

      return el('div', { class: 'start-player-card' }, [
        el('div', { class: 'start-player-card-head' }, [
          el('h3', {}, `Player ${idx + 1}`),
          removeBtn,
        ]),
        el('div', { class: 'start-field' }, [el('label', {}, 'Name'), nameInput]),
        el('div', { class: 'start-field' }, [el('label', {}, 'Handicap'), hiInput]),
        el('div', { class: 'start-field' }, [el('label', {}, 'Tee'), teeSelect]),
      ]);
    }

    sheet = buildSheet({
      title: 'Start round',
      subtitle: 'Tyrrells Wood — 18 holes',
      footerButtons: [
        { label: 'Cancel', kind: 'secondary', onClick: (close) => close() },
        {
          label: 'Start',
          kind: 'primary',
          onClick: (close) => {
            try {
              const holes = window.TWApp.getHoles();
              const strokeIndexes = holes.map((h) => h.stroke_index);
              const round = TWScoring.startRound(players, strokeIndexes);
              close();
              refreshScoreTrigger();
              // Jump straight to score entry for hole 1.
              if (window.TWApp && typeof window.TWApp.setHole === 'function') {
                window.TWApp.setHole(round.currentHole || 1);
              }
              openScoreEntry(round.currentHole || 1);
            } catch (err) {
              console.error(err);
              alert(err.message || 'Could not start round');
            }
          },
        },
      ],
    });
    render();
  }

  // ---------- Score entry sheet ----------

  function openScoreEntry(holeNum) {
    const round = TWScoring.getActiveRound();
    if (!round) {
      alert('No active round. Start one from the menu.');
      return;
    }
    const holes = window.TWApp.getHoles();
    const hole = holes.find((h) => h.number === holeNum);
    if (!hole) return;
    const holeIndex = holes.indexOf(hole);

    // Working copy of entries, one per player
    const entries = round.players.map((player) => {
      const existing = (round.scores[player.id] || {})[holeNum] || {};
      return {
        player,
        gross: Number.isFinite(existing.gross) ? existing.gross : hole.par,
        putts: Number.isFinite(existing.putts) ? existing.putts : 2,
        fairwayHit: existing.fairwayHit === true ? true : existing.fairwayHit === false ? false : null,
      };
    });

    let sheet;

    function pointsFor(entry) {
      const strokesReceived = entry.player.strokesPerHole[holeIndex] || 0;
      return TWScoring.computeStableford(entry.gross, strokesReceived, hole.par);
    }

    function buildRow(entry) {
      const pointsLabel = el('span', { class: 'score-row-points' }, `${pointsFor(entry)} pts`);
      const grossStepper = buildStepper(entry.gross, 1, 15, (v) => {
        entry.gross = v;
        pointsLabel.textContent = `${pointsFor(entry)} pts`;
      });
      const puttsStepper = buildStepper(entry.putts, 0, 8, (v) => { entry.putts = v; });

      const isPar3 = hole.par === 3;
      let fwToggle = null;
      if (!isPar3) {
        const yBtn = el('button', { type: 'button' }, 'Y');
        const nBtn = el('button', { type: 'button' }, 'N');
        function syncFW() {
          yBtn.classList.toggle('active', entry.fairwayHit === true);
          nBtn.classList.toggle('active', entry.fairwayHit === false);
        }
        yBtn.addEventListener('click', () => {
          entry.fairwayHit = entry.fairwayHit === true ? null : true;
          syncFW();
        });
        nBtn.addEventListener('click', () => {
          entry.fairwayHit = entry.fairwayHit === false ? null : false;
          syncFW();
        });
        fwToggle = el('div', { class: 'fw-toggle', role: 'group', 'aria-label': 'Fairway hit' }, [yBtn, nBtn]);
        syncFW();
      }

      const strokesReceived = entry.player.strokesPerHole[holeIndex] || 0;
      const strokeMark = strokesReceived > 0 ? ' · ' + '•'.repeat(strokesReceived) : '';

      return el('div', { class: 'score-row' }, [
        el('p', { class: 'score-row-name' }, [
          document.createTextNode(entry.player.name),
          el('span', { class: 'score-row-meta' }, `CH ${entry.player.courseHandicap}${strokeMark}`),
        ]),
        el('div', { class: 'score-row-line' }, [
          el('span', { class: 'score-row-line-label' }, 'Score'),
          grossStepper.node,
          pointsLabel,
        ]),
        el('div', { class: 'score-row-line' }, [
          el('span', { class: 'score-row-line-label' }, 'Putts'),
          puttsStepper.node,
          fwToggle ? el('span', { class: 'score-row-line-label', style: { marginLeft: '0.5rem' } }, 'FW') : null,
          fwToggle,
        ]),
      ]);
    }

    sheet = buildSheet({
      title: `Hole ${hole.number} · Par ${hole.par} · SI ${hole.stroke_index}`,
      subtitle: hole.yardage ? `${hole.yardage.white || '–'}y white` : '',
      footerButtons: [
        { label: 'Cancel', kind: 'secondary', onClick: (close) => close() },
        {
          label: 'Save',
          kind: 'primary',
          onClick: (close) => {
            try {
              entries.forEach((e) => {
                TWScoring.recordScore(e.player.id, hole.number, {
                  gross: e.gross,
                  putts: e.putts,
                  fairwayHit: e.fairwayHit,
                });
              });
              close();
              refreshScoreTrigger();
            } catch (err) {
              console.error(err);
              alert(err.message || 'Could not save scores');
            }
          },
        },
      ],
    });

    entries.forEach((e) => sheet.body.appendChild(buildRow(e)));
  }

  // ---------- Summary screen ----------

  function openSummary() {
    const round = TWScoring.getActiveRound();
    if (!round) {
      openHistory();
      return;
    }
    const holes = window.TWApp.getHoles();

    const sheet = buildSheet({
      title: 'Round summary',
      subtitle: `${fmtDate(round.startedAt)} — Tyrrells Wood`,
      footerButtons: [
        { label: 'Continue', kind: 'secondary', onClick: (close) => close() },
        {
          label: 'Finish round',
          kind: 'primary',
          onClick: (close) => {
            close();
            confirmDialog({
              title: 'Finish round?',
              message: 'This moves the round to History. You can still view it but not edit scores.',
              confirmLabel: 'Finish',
              confirmKind: 'primary',
              onConfirm: () => {
                TWScoring.finishRound();
                refreshScoreTrigger();
              },
            });
          },
        },
      ],
    });

    renderRoundDetail(sheet.body, round, holes, { editable: true });
  }

  // ---------- History list + detail ----------

  function openHistory() {
    const sheet = buildSheet({
      title: 'History',
      subtitle: 'Past rounds',
      footerButtons: [{ label: 'Close', kind: 'secondary', onClick: (close) => close() }],
    });

    function render() {
      sheet.body.innerHTML = '';
      const history = TWScoring.getHistory();
      if (!history.length) {
        sheet.body.appendChild(el('div', { class: 'history-empty' }, 'No past rounds yet.'));
        return;
      }
      const holes = window.TWApp.getHoles();
      history.forEach((round) => {
        const totals = TWScoring.computeRunningTotals(round, holes);
        let topName = '';
        let topPoints = -1;
        round.players.forEach((p) => {
          const t = totals.perPlayer[p.id];
          if (t && t.points > topPoints) { topPoints = t.points; topName = p.name; }
        });
        const playersStr = round.players.map((p) => p.name).join(', ');
        const card = el('div', { class: 'history-card' }, [
          el('div', { class: 'history-card-body' }, [
            el('div', { class: 'history-card-date' }, fmtDate(round.finishedAt || round.startedAt)),
            el('div', { class: 'history-card-title' }, `${round.players.length} player${round.players.length > 1 ? 's' : ''} · ${topPoints >= 0 ? topPoints + ' pts' : '–'} (${topName || '–'})`),
            el('div', { class: 'history-card-detail' }, playersStr),
          ]),
          el('div', { class: 'history-card-actions' }, [
            el('button', {
              class: 'history-card-btn',
              type: 'button',
              onclick: () => openHistoryDetail(round),
            }, 'View'),
            el('button', {
              class: 'history-card-btn danger',
              type: 'button',
              onclick: () => {
                confirmDialog({
                  title: 'Delete round?',
                  message: 'This permanently removes the round from history.',
                  confirmLabel: 'Delete',
                  confirmKind: 'danger',
                  onConfirm: () => {
                    TWScoring.deleteHistoryRound(round.id);
                    render();
                  },
                });
              },
            }, 'Delete'),
          ]),
        ]);
        sheet.body.appendChild(card);
      });
    }
    render();
  }

  function openHistoryDetail(round) {
    const holes = window.TWApp.getHoles();
    const sheet = buildSheet({
      title: round.players.map((p) => p.name).join(', '),
      subtitle: fmtDate(round.finishedAt || round.startedAt),
      footerButtons: [{ label: 'Close', kind: 'secondary', onClick: (close) => close() }],
    });
    renderRoundDetail(sheet.body, round, holes, { editable: false });
  }

  // ---------- Shared scorecard renderer ----------

  function renderRoundDetail(container, round, holes, opts) {
    const totals = TWScoring.computeRunningTotals(round, holes);

    container.appendChild(el('div', { class: 'summary-info' }, [
      el('h3', {}, 'Tyrrells Wood'),
      el('div', { class: 'summary-meta' }, [
        round.players.map((p) => `${p.name} (${p.tee}, CH ${p.courseHandicap})`).join(' · '),
      ]),
    ]));

    // Scorecard table
    const wrap = el('div', { class: 'scorecard-wrap' });
    const table = el('table', { class: 'scorecard' });

    // Header
    const thead = el('thead');
    const headRow = el('tr', {}, [
      el('th', { class: 'scorecard-hole' }, 'H'),
      el('th', {}, 'Par'),
      el('th', {}, 'SI'),
      ...round.players.flatMap((p) => [
        el('th', {}, abbreviateName(p.name)),
        el('th', {}, 'Pts'),
      ]),
    ]);
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Body
    const tbody = el('tbody');
    holes.forEach((hole, idx) => {
      const row = el('tr', {}, [
        el('td', { class: 'scorecard-hole' }, String(hole.number)),
        el('td', {}, String(hole.par)),
        el('td', {}, String(hole.stroke_index)),
        ...round.players.flatMap((p) => {
          const entry = (round.scores[p.id] || {})[hole.number];
          if (!entry || entry.gross == null) {
            return [
              el('td', { class: 'scorecard-empty' }, '–'),
              el('td', { class: 'scorecard-empty' }, '–'),
            ];
          }
          const strokesReceived = p.strokesPerHole[idx] || 0;
          const points = TWScoring.computeStableford(entry.gross, strokesReceived, hole.par);
          return [
            el('td', { class: 'scorecard-gross' }, String(entry.gross)),
            el('td', { class: 'scorecard-pts' }, String(points)),
          ];
        }),
      ]);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    // Footer totals
    const totalPar = holes.reduce((s, h) => s + h.par, 0);
    const tfoot = el('tfoot');
    const totalsRow = el('tr', {}, [
      el('td', { class: 'scorecard-hole' }, 'Σ'),
      el('td', {}, String(totalPar)),
      el('td', {}, ''),
      ...round.players.flatMap((p) => {
        const t = totals.perPlayer[p.id] || {};
        return [
          el('td', {}, t.strokes ? String(t.strokes) : '–'),
          el('td', {}, t.points != null ? String(t.points) : '–'),
        ];
      }),
    ]);
    tfoot.appendChild(totalsRow);
    table.appendChild(tfoot);

    wrap.appendChild(table);
    container.appendChild(wrap);

    // Per-player summary cards
    const cards = el('div', { class: 'summary-cards' });
    round.players.forEach((p) => {
      const t = totals.perPlayer[p.id] || {};
      const vsParStr = t.vsPar > 0 ? `+${t.vsPar}` : t.vsPar < 0 ? String(t.vsPar) : 'E';
      cards.appendChild(el('div', { class: 'summary-card' }, [
        el('div', { class: 'summary-card-name' }, `${p.name} — ${p.tee}, CH ${p.courseHandicap}`),
        el('div', { class: 'summary-card-stats' }, [
          el('span', { class: 'stat-points' }, `${t.points || 0} pts`),
          document.createTextNode(`  ·  ${t.strokes || 0} strokes (${vsParStr})  ·  ${t.fairways || 0} FW  ·  ${t.putts || 0} putts  ·  ${t.holesPlayed || 0}/18 holes`),
        ]),
      ]));
    });
    container.appendChild(cards);
  }

  function abbreviateName(name) {
    const trimmed = (name || '').trim();
    if (trimmed.length <= 6) return trimmed;
    return trimmed.slice(0, 6);
  }

  // ---------- Hole-info Score button ----------

  function ensureScoreTrigger() {
    const holeInfo = document.getElementById('holeInfo');
    if (!holeInfo) return null;
    let row = document.getElementById('scoreTriggerRow');
    if (row) return row;
    row = el('div', { class: 'score-trigger-row', id: 'scoreTriggerRow' }, [
      el('button', {
        class: 'score-trigger-btn',
        id: 'scoreTriggerBtn',
        type: 'button',
        onclick: () => {
          const round = TWScoring.getActiveRound();
          const currentHole = window.TWApp ? window.TWApp.getCurrentHole() : 1;
          if (round) {
            openScoreEntry(currentHole);
          } else {
            openStartRoundModal();
          }
        },
      }, [
        el('span', { class: 'score-trigger-label', id: 'scoreTriggerLabel' }, 'Start round'),
        el('span', { class: 'score-trigger-summary', id: 'scoreTriggerSummary' }, ''),
      ]),
    ]);
    holeInfo.appendChild(row);
    return row;
  }

  function refreshScoreTrigger() {
    ensureScoreTrigger();
    const round = TWScoring.getActiveRound();
    const label = document.getElementById('scoreTriggerLabel');
    const summary = document.getElementById('scoreTriggerSummary');
    const subtitle = document.getElementById('holeSubtitle');
    const currentHole = window.TWApp ? window.TWApp.getCurrentHole() : 1;
    const holes = window.TWApp ? window.TWApp.getHoles() : [];
    const hole = holes.find((h) => h.number === currentHole);

    if (!round) {
      label.textContent = 'Start round';
      summary.textContent = '';
      return;
    }

    const player = round.players[0];
    const entry = (round.scores[player.id] || {})[currentHole];
    label.textContent = `Score hole ${currentHole}`;
    if (entry && entry.gross != null && hole) {
      const diff = entry.gross - hole.par;
      const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? String(diff) : 'E';
      summary.textContent = `${player.name}: ${entry.gross} (${diffStr})`;
      // Also reflect in topbar subtitle if not currently hijacked by GPS.
      if (subtitle && hole) {
        subtitle.textContent = `Hole ${hole.number} · Par ${hole.par} · ${entry.gross} (${diffStr})`;
      }
    } else {
      summary.textContent = `${player.name}: —`;
    }
  }

  // ---------- Resume prompt ----------

  function promptResume() {
    const round = TWScoring.getActiveRound();
    if (!round) return;
    const sheet = buildSheet({
      title: 'Resume round?',
      modalCenter: true,
      footerButtons: [
        {
          label: 'Discard',
          kind: 'danger',
          onClick: (close) => {
            close();
            TWScoring.discardRound();
            refreshScoreTrigger();
          },
        },
        {
          label: 'Resume',
          kind: 'primary',
          onClick: (close) => {
            close();
            if (window.TWApp && typeof window.TWApp.setHole === 'function') {
              window.TWApp.setHole(round.currentHole || 1);
            }
            refreshScoreTrigger();
          },
        },
      ],
    });
    sheet.body.appendChild(el('p', { class: 'confirm-text' },
      `A round started ${fmtDate(round.startedAt)} with ${round.players.map((p) => p.name).join(', ')} is in progress.`));
  }

  // ---------- Init ----------

  function init() {
    // Wire menu button
    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', openMenu);
    }
    ensureScoreTrigger();
    refreshScoreTrigger();
    if (TWScoring.getActiveRound()) promptResume();
  }

  // Wait for app.js to have loaded the course before initialising the trigger,
  // so getHoles() works for the score button.
  function whenAppReady(cb) {
    if (window.TWApp && Array.isArray(window.TWApp.getHoles()) && window.TWApp.getHoles().length) {
      cb();
      return;
    }
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      if (window.TWApp && Array.isArray(window.TWApp.getHoles()) && window.TWApp.getHoles().length) {
        clearInterval(iv);
        cb();
      } else if (tries > 50) { // 5s
        clearInterval(iv);
        cb(); // best effort — start with degraded UI
      }
    }, 100);
  }

  window.TWUIScoring = {
    openMenu,
    closeMenu,
    openStartRoundModal,
    openScoreEntry,
    openSummary,
    openHistory,
    refreshScoreTrigger,
  };

  window.addEventListener('DOMContentLoaded', () => {
    whenAppReady(init);
  });

  // Allow app.js to notify us of hole changes.
  window.addEventListener('tw:holechange', () => {
    refreshScoreTrigger();
  });
})();
