// Screens for the online-assessment modules: the OA hub, one runner shared by
// every module (Test: the reported format and timing; Learn: untimed, with an
// explanation after each answer) and the review page. Builds on app.js
// through window.QS, and on oa.js and each module's question file.
(() => {
  'use strict';

  const Q = window.QS;
  const S = Q.S;
  const X = window.E80;
  const { esc } = Q;
  const $ = (id) => document.getElementById(id);
  const clock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // Question sources for the modules built so far.
  const SOURCES = {
    bto: { set: (n) => window.OAOdds.set(Math.random, n) },
    nl: { set: (n) => window.OASeq.set(Math.random, n) },
    ll: { set: (n) => window.OARank.set(Math.random, n) },
    ob: { set: (n) => window.OABooks.set(Math.random, n) },
    iv: {
      set: (n) => window.OAIntervals.set(Math.random, n),
      extra: (s) => {
        const c = window.OAIntervals.calibration(s.problems);
        if (!c) return '';
        return `<div class="card oa-cal"><h2>Calibration</h2>
          <div class="tiles compact">${[
            ['Contained', `${c.hits} of ${c.answered}`],
            ['Avg score when contained', c.hits ? c.avgHit.toFixed(2) : '—'],
          ].map(([l, v]) => Q.tile(l, v)).join('')}</div>
          <p class="sub">${esc(c.advice)}</p></div>`;
      },
    },
  };

  // ---- hub -------------------------------------------------------------------

  function recordLine(sum, noun = 'test') {
    if (!sum.tests) return `<span class="muted">${noun === 'test' ? 'No test yet' : 'Not played yet'}</span>`;
    return `Best <b>${OA.formatScore(sum.best)}</b> · last ${OA.formatScore(sum.last)} · ${sum.tests} ${noun}${sum.tests === 1 ? '' : 's'}`;
  }

  function formatLine(m) {
    if (!m.test) return 'Short games, 2–15 minutes each';
    const t = m.test;
    return `${t.questions} ${m.id === 'ob' ? 'boards' : 'questions'} · ${t.seconds / 60} min${t.perQuestion ? ` · ${t.perQuestion}s each` : ''}`;
  }

  function renderHub() {
    const st = S.data.settings.e80 || {};
    const e80 = X.summary(S.data.sessions, st.penalty);
    const e80Rec = e80.games
      ? `Best <b>${e80.best}</b> · last-10 average ${e80.recentAvg.toFixed(1)} · ${e80.games} attempt${e80.games === 1 ? '' : 's'}`
      : '<span class="muted">No attempt yet</span>';
    const cards = OA.MODULES.map((m, i) => {
      if (m.id === 'zap') {
        // One row per game, each with its own record.
        return `<div class="card oa-card">
          <div class="oa-head"><span class="oa-num">${i + 1}</span><div><h2>${esc(m.name)}</h2><div class="sub">${esc(m.generic)}</div></div></div>
          <p class="oa-about">${esc(m.about)} The real set varies; these are the most reported.</p>
          <div class="zap-games">${OAZap.GAMES.map((g) => `<div class="zap-row">
              <div><b>${esc(g.name)}</b><div class="sub">${esc(g.rules)}</div><div class="oa-rec">${recordLine(OA.summary(S.data.sessions, 'zap', g.id), 'play')}</div></div>
              <button class="btn" data-zap="${g.id}">Play</button></div>`).join('')}</div>
        </div>`;
      }
      const ready = !!SOURCES[m.id];
      return `<div class="card oa-card${ready ? '' : ' soon'}">
          <div class="oa-head"><span class="oa-num">${i + 1}</span><div><h2>${esc(m.name)}</h2><div class="sub">${esc(m.generic)}</div></div></div>
          <p class="oa-about">${esc(m.about)}</p>
          <p class="oa-format">${formatLine(m)}</p>
          ${ready ? `<p class="oa-rec">${recordLine(OA.summary(S.data.sessions, m.id))}</p>
          <div class="actions"><button class="btn" data-oa-start="${m.id}" data-mode="test">Test</button><button class="btn ghost" data-oa-start="${m.id}" data-mode="learn">Learn</button></div>`
          : '<p class="oa-rec muted">Coming soon</p>'}
        </div>`;
    }).join('');
    $('view-oa').innerHTML = `<div class="page-head"><div>
        <h1>Online assessment</h1>
        <p class="lede">Practice for each part of Optiver's online assessment. <b>Test</b> follows the reported format and timing; <b>Learn</b> is untimed and explains every answer.</p>
      </div></div>
      ${mockCard()}
      <div class="oa-grid">
        <div class="card oa-card">
          <div class="oa-head"><span class="oa-num">✦</span><div><h2>80 in 8</h2><div class="sub">Mental maths</div></div></div>
          <p class="oa-about">80 multiple-choice arithmetic questions: whole numbers, decimals, fractions and missing numbers.</p>
          <p class="oa-format">80 questions · 8 min</p>
          <p class="oa-rec">${e80Rec}</p>
          <div class="actions"><button class="btn" data-action="goto-e80">Open</button></div>
        </div>
        ${cards}
      </div>
      <p class="fine">Independent practice, not affiliated with Optiver. Formats follow Optiver's invite and candidate reports, so question counts and per-question limits are approximate.</p>`;
  }

  // ---- runner ------------------------------------------------------------------

  /** `mock` ({ run, stage }) marks a stage of a Full OA practice run. */
  function start(id, learn, mock = null) {
    const m = OA.byId[id];
    const src = SOURCES[id];
    if (!m || !src) return;
    const t = m.test;
    const qs = src.set(learn ? 1 : t.questions);
    S.oa = {
      m, src, learn, qs, mock,
      // Questions still to show, by number; a revisitable skip goes back on the end once.
      queue: qs.map((_, i) => i).slice(1),
      i: 0,
      deferred: new Set(),
      items: [],
      startedAt: Date.now(),
      t0: performance.now(),
      qStart: performance.now(),
      total: learn ? null : t.seconds * 1000,
      per: learn || !t.perQuestion ? null : t.perQuestion * 1000,
      reviewing: false,
      done: false,
      timer: 0,
    };
    Q.show('oagame');
    $('oaLabel').textContent = `${mock ? 'Full OA · ' : ''}${m.name}${learn ? ' · Learn' : ''}`;
    $('view-oagame').classList.remove('hurry');
    renderQuestion();
    S.oa.timer = setInterval(tick, 100);
    tick();
  }

  function tick() {
    const g = S.oa;
    if (!g || g.done) return;
    const now = performance.now();
    if (g.learn) {
      $('oaTime').textContent = 'Untimed';
      $('oaTimebar').style.transform = 'scaleX(0)';
      return;
    }
    const left = g.total - (now - g.t0);
    $('oaTime').textContent = `Time left ${clock(left)}`;
    let frac = left / g.total;
    if (g.per && !g.reviewing) {
      const qLeft = g.per - (now - g.qStart);
      frac = Math.max(0, qLeft / g.per);
      $('view-oagame').classList.toggle('hurry', qLeft <= 10000);
      if (qLeft <= 0) return submit(currentAnswer(), true);
    } else {
      $('view-oagame').classList.toggle('hurry', left <= 30000);
    }
    $('oaTimebar').style.transform = `scaleX(${Math.max(0, frac)})`;
    if (left <= 0) finish(false);
  }

  function count() {
    const g = S.oa;
    $('oaCount').textContent = g.learn ? `Question ${g.items.length + 1}`
      : `Question ${g.i + 1} of ${g.qs.length}${g.deferred.has(g.i) ? ' · second look' : ''}`;
  }

  // ---- question kinds: render, read the current answer, and mark ----------------

  const KINDS = {
    choice: {
      html: (q) => `<p class="oa-prompt${q.big ? ' big' : ''}">${esc(q.prompt)}</p>
        <div class="oa-choices">${q.options.map((o, i) => `<button class="oa-choice" data-choice="${i}"><span class="k">${i + 1}</span>${esc(o)}</button>`).join('')}</div>`,
      answer: () => null, // a choice is only ever a click; a timeout is a skip
      mark: (q, a) => (a == null ? { g: null, ok: null, pts: 0 } : { g: q.options[a], ok: a === q.correct, pts: a === q.correct ? 1 : -1 }),
      reveal: (q, a) => {
        for (const b of document.querySelectorAll('.oa-choice')) {
          const i = Number(b.dataset.choice);
          b.classList.toggle('right', i === q.correct);
          b.classList.toggle('wrong', i === a && a !== q.correct);
          b.disabled = true;
        }
      },
    },

    // Click the outcomes from most to least likely; the last one fills itself in.
    rank: {
      html: (q) => `<p class="oa-prompt">${esc(q.prompt)}</p>
        ${contextHtml(q.context)}
        <p class="oa-hint">Click from <b>most</b> to <b>least</b> likely.</p>
        <div class="oa-rank">${q.items.map((t, i) => `<button class="oa-rank-item" data-rank-item="${i}">
            <span class="slot"></span><span class="letter">${OARank.LETTERS[i]}</span><span class="text">${esc(t)}</span><span class="p"></span></button>`).join('')}</div>
        <div class="actions oa-rank-actions"><button class="btn primary" data-rank-submit disabled>Submit <kbd>Enter</kbd></button><button class="btn ghost small" data-rank-undo>Undo</button></div>`,
      answer: () => (S.oa.rankSel.length >= 2 ? completeRank(S.oa.rankSel) : null),
      mark: (q, a) => {
        if (a == null) return { g: null, ok: null, pts: 0 };
        const ok = a.join() === q.correct.join();
        return { g: a.map((i) => OARank.LETTERS[i]).join(' > '), ok, pts: ok ? 1 : 0 };
      },
      reveal: (q) => {
        for (const b of document.querySelectorAll('.oa-rank-item')) {
          const i = Number(b.dataset.rankItem);
          b.querySelector('.p').textContent = q.hideProbs ? '' : OA.pct(q.probs[i]);
          b.querySelector('.slot').textContent = String(q.correct.indexOf(i) + 1);
          b.classList.add('done');
          b.disabled = true;
        }
        document.querySelector('.oa-rank-actions').hidden = true;
      },
    },
  };

  // Lower and upper bound; scored lower ÷ upper when the range holds the answer.
  KINDS.interval = {
    html: (q) => `<p class="oa-prompt">${esc(q.prompt)}</p>
      ${visualHtml(q.visual)}
      <div class="oa-iv">
        <label>Lower<input id="ivLo" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
        <span class="to">to</span>
        <label>Upper<input id="ivHi" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
        ${q.unit ? `<span class="unit">${esc(q.unit)}</span>` : ''}
        <button class="btn primary" data-iv-submit>Submit <kbd>Enter</kbd></button>
      </div>`,
    answer: () => {
      const read = (id) => Number(String($(id).value).replace(/[$,%\s]/g, ''));
      const lo = read('ivLo');
      const hi = read('ivHi');
      return $('ivLo').value.trim() && $('ivHi').value.trim() && Number.isFinite(lo) && Number.isFinite(hi) ? [Math.min(lo, hi), Math.max(lo, hi)] : null;
    },
    mark: (q, a) => {
      if (a == null) return { g: null, ok: null, pts: 0 };
      const pts = Math.round(OAIntervals.score(a[0], a[1], q.truth) * 1000) / 1000;
      const f = OAIntervals.fmt;
      // Holding the answer counts as contained even when the range scores 0 (it starts at 0 or below).
      const held = OAIntervals.contains(a[0], a[1], q.truth);
      return { g: `[${f(a[0])}, ${f(a[1])}] → ${pts.toFixed(2)}${held && !pts ? ' (starts at 0 or below)' : ''}`, ok: held, pts };
    },
    reveal: () => {
      for (const el of document.querySelectorAll('.oa-iv input, [data-iv-submit]')) el.disabled = true;
    },
    feedback: (q, r) => (r.g == null ? `Answer: ${q.answer}.`
      : !r.ok ? `Missed: the answer is ${q.answer}. Score 0.`
        : r.pts ? `Contained: ${q.answer}. Score ${r.pts.toFixed(2)}.`
          : `Contained: ${q.answer}, but a range that starts at 0 or below scores 0 (lower ÷ upper). Start the lower bound above 0.`),
  };

  // Orderbooks: stage buys and sells card by card; submit once flat and profitable.
  KINDS.board = {
    html: (q) => `<p class="oa-prompt">${esc(q.prompt)}</p>
      <div class="ob-grid${q.board.cards.length > 6 ? ' wide' : ''}">${q.board.cards.map((c, i) => `<div class="ob-card" data-card="${i}">
          <div class="ob-top"><span class="ob-letter">${OABooks.LETTERS[i]}</span><span class="ob-pos"></span></div>
          <div class="ob-legs">${Object.entries(c.legs).map(([k, n]) => `<div><b>${n}</b> ${esc(k)}</div>`).join('')}</div>
          <div class="ob-btns"><button class="ob-sell" data-ob="${i}" data-dir="-1">Sell <b>${c.bid}</b></button><button class="ob-buy" data-ob="${i}" data-dir="1">Buy <b>${c.ask}</b></button></div>
        </div>`).join('')}</div>
      <div class="ob-status" id="obStatus"></div>
      <div class="actions"><button class="btn primary" data-ob-submit>Submit <kbd>Enter</kbd></button><button class="btn ghost small" data-ob-reset>Reset <kbd>R</kbd></button></div>
      <p class="ob-msg" id="obMsg" role="status"></p>`,
    answer: () => (S.oa.pos && S.oa.pos.some((n) => n) ? S.oa.pos.slice() : null),
    validate: (q, a) => {
      const r = OABooks.check(q.board, a);
      if (!r.flat) return `Not flat yet: ${Object.entries(r.nets).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}.`;
      if (r.cash <= 0) return `Flat, but cash is ${r.cash}. Look for a different combination.`;
      return null;
    },
    mark: (q, a) => {
      if (a == null) return { g: null, ok: null, pts: 0 };
      const r = OABooks.check(q.board, a);
      const steps = a.map((n, i) => [OABooks.LETTERS[i], n]).filter(([, n]) => n).map(([l, n]) => `${n > 0 ? 'buy' : 'sell'} ${Math.abs(n)} × ${l}`).join(', ');
      return { g: `${steps} (${r.cash >= 0 ? '+' : ''}${r.cash})`, ok: r.valid, pts: r.valid ? 1 : 0 };
    },
    reveal: (q) => {
      document.querySelectorAll('.ob-card').forEach((el, i) => {
        const n = q.solution[i];
        el.querySelector('.ob-pos').textContent = n ? `${n > 0 ? 'buy' : 'sell'} ${Math.abs(n)}` : '';
        el.classList.toggle('in-answer', !!n);
      });
      for (const b of document.querySelectorAll('.ob-btns button, [data-ob-submit], [data-ob-reset]')) b.disabled = true;
    },
    feedback: (q, r) => (r.ok ? `Valid: ${r.g}.` : `One answer: ${q.answer}.`),
  };

  function obTrade(i, dir) {
    const g = S.oa;
    if (g.reviewing) return;
    g.pos[i] += dir;
    drawBoard();
  }

  function drawBoard() {
    const g = S.oa;
    const q = g.qs[g.i];
    const r = OABooks.check(q.board, g.pos);
    document.querySelectorAll('.ob-card').forEach((el, i) => {
      const n = g.pos[i];
      el.querySelector('.ob-pos').textContent = n ? `${n > 0 ? 'bought' : 'sold'} ${Math.abs(n)}` : '';
      el.classList.toggle('long', n > 0);
      el.classList.toggle('short', n < 0);
    });
    $('obStatus').innerHTML = `${Object.entries(r.nets).map(([k, v]) => `<span class="${v ? 'off' : 'ok'}">${esc(k)} <b>${v > 0 ? '+' : ''}${v}</b></span>`).join('')}
      <span class="cash ${r.cash > 0 ? 'ok' : r.cash < 0 ? 'off' : ''}">Cash <b>${r.cash > 0 ? '+' : ''}${r.cash}</b></span>`;
    $('obMsg').textContent = '';
  }

  /** Pictures that Intervals questions are asked about. */
  function visualHtml(v) {
    if (!v) return '';
    if (v.type === 'shapes') {
      const cell = (c, i) => {
        const x = (i % 10) * 30 + 15;
        const y = Math.floor(i / 10) * 30 + 15;
        const cls = `sh-${c.colour}`;
        if (c.shape === 'circle') return `<circle class="${cls}" cx="${x}" cy="${y}" r="10"/>`;
        if (c.shape === 'square') return `<rect class="${cls}" x="${x - 9}" y="${y - 9}" width="18" height="18" rx="2"/>`;
        return `<polygon class="${cls}" points="${x},${y - 11} ${x + 11},${y + 9} ${x - 11},${y + 9}"/>`;
      };
      return `<svg class="oa-visual shapes" viewBox="0 0 300 300" role="img" aria-label="A grid of 100 coloured shapes">${v.cells.map(cell).join('')}</svg>`;
    }
    if (v.type === 'dice') {
      const PIPS = { 1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]], 5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]] };
      const size = v.cols * 34;
      const die = (f, i) => {
        const x = (i % v.cols) * 34 + 2;
        const y = Math.floor(i / v.cols) * 34 + 2;
        return `<rect class="die" x="${x}" y="${y}" width="30" height="30" rx="5"/>${PIPS[f].map(([a, b]) => `<circle class="pip" cx="${x + a * 7.5}" cy="${y + b * 7.5}" r="2.6"/>`).join('')}`;
      };
      return `<svg class="oa-visual dice" viewBox="0 0 ${size} ${size}" role="img" aria-label="A grid of dice">${v.faces.map(die).join('')}</svg>`;
    }
    if (v.type === 'path') {
      const pts = v.pts.map(([x, y]) => `${x},${y}`).join(' ');
      const [sx, sy] = v.pts[0];
      return `<svg class="oa-visual path" viewBox="0 0 100 72" role="img" aria-label="A path and a 10 m scale bar">
        <polyline points="${pts}"/><circle cx="${sx}" cy="${sy}" r="1.4"/>
        <g class="bar"><line x1="4" y1="67" x2="${4 + v.bar}" y2="67"/><line x1="4" y1="65.5" x2="4" y2="68.5"/><line x1="${4 + v.bar}" y1="65.5" x2="${4 + v.bar}" y2="68.5"/>
        <text x="${6 + v.bar}" y="68.4">10 m</text></g></svg>`;
    }
    if (v.type === 'numbers') return `<div class="oa-numbers${v.values.length > 40 ? ' dense' : ''}">${v.values.map((n) => `<span>${n}</span>`).join('')}</div>`;
    if (v.type === 'coins') {
      return `<div class="oa-coins" style="--cols:${v.grid[0].length}">${v.grid.map((row) => row.map((h) => (h ? '<b>H</b>' : '<i>T</i>')).join('')).join('')}</div>`;
    }
    if (v.type === 'trend') return trendSvg(v);
    return '';
  }

  /** Monthly figures so far, with the month to call marked "?" further along. */
  function trendSvg(v) {
    const W = 520; const H = 244; const L = 46; const R = 16; const T = 22; const B = 34;
    const months = v.values.length + v.ahead;
    // Room for where the line is heading (end to end, not the fitted trend), plus a margin.
    const n = v.values.length;
    const heading = v.values[n - 1] + ((v.values[n - 1] - v.values[0]) / (n - 1)) * v.ahead;
    const lo0 = Math.min(...v.values, heading);
    const hi0 = Math.max(...v.values, heading);
    const pad = (hi0 - lo0) * 0.12 + 1;
    const raw = (hi0 - lo0 + 2 * pad) / 6;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const lo = Math.max(0, Math.floor((lo0 - pad) / step) * step);
    const hi = Math.ceil((hi0 + pad) / step) * step;
    const X = (m) => L + ((m - 1) / (months - 1)) * (W - L - R);
    const Y = (y) => H - B - ((y - lo) / (hi - lo)) * (H - T - B);
    let grid = '';
    for (let y = lo; y <= hi + 1e-9; y += step) {
      grid += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}"/><text class="tick" x="${L - 6}" y="${Y(y) + 4}" text-anchor="end">${Math.round(y * 100) / 100}</text>`;
    }
    for (let m = 1; m <= months; m++) {
      if (m === 1 || (m % 5 === 0 && months - m > 1) || m === months) grid += `<text class="tick" x="${X(m)}" y="${H - 7}" text-anchor="middle">${m}</text>`;
    }
    const pts = v.values.map((y, i) => `${X(i + 1).toFixed(1)},${Y(y).toFixed(1)}`);
    const dots = v.values.map((y, i) => `<circle class="pt" cx="${X(i + 1).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.6"/>`).join('');
    const xq = X(months);
    return `<svg class="oa-visual trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly sales for ${v.values.length} months">
      ${grid}<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      <line class="mark q" x1="${xq}" x2="${xq}" y1="${T}" y2="${H - B}"/><text class="qmark" x="${xq}" y="${T - 6}" text-anchor="middle">?</text>
      <polyline class="curve c0" points="${pts.join(' ')}"/>${dots}</svg>`;
  }

  const completeRank = (sel) => (sel.length === 2 ? [...sel, [0, 1, 2].find((i) => !sel.includes(i))] : sel.slice());

  function rankPick(i) {
    const g = S.oa;
    if (g.reviewing || g.rankSel.includes(i) || g.rankSel.length >= 3) return;
    g.rankSel = completeRank([...g.rankSel, i]);
    drawRank();
  }

  function drawRank() {
    const sel = S.oa.rankSel;
    for (const b of document.querySelectorAll('.oa-rank-item')) {
      const pos = sel.indexOf(Number(b.dataset.rankItem));
      b.querySelector('.slot').textContent = pos < 0 ? '' : String(pos + 1);
      b.classList.toggle('picked', pos >= 0);
    }
    document.querySelector('[data-rank-submit]').disabled = sel.length < 3;
  }

  /** Tables and score sheets some questions come with. */
  function contextHtml(ctx) {
    if (!ctx) return '';
    if (ctx.type === 'table') {
      return `<table class="oa-table"><thead><tr>${ctx.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${ctx.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    if (ctx.type === 'scores') {
      const half = Math.ceil(ctx.pairs.length / 2);
      const rows = Array.from({ length: half }, (_, i) => [i, i + half].map((j) => (ctx.pairs[j]
        ? `<td class="n">${j + 1}</td><td>${ctx.pairs[j][0]}</td><td>${ctx.pairs[j][1]}</td>` : '<td></td><td></td><td></td>')).join(''));
      const head = `<th class="n">#</th>${ctx.head.map((h) => `<th>${esc(h)}</th>`).join('')}`;
      return `<table class="oa-table scores"><thead><tr>${head}${head}</tr></thead><tbody>${rows.map((r) => `<tr>${r}</tr>`).join('')}</tbody></table>`;
    }
    if (ctx.type === 'density') return densitySvg(ctx);
    if (ctx.type === 'graph') return graphSvg(ctx);
    return '';
  }

  /** Normal densities to read by eye: no y-axis, just centres, widths and a marked bar. */
  function densitySvg(ctx) {
    const W = 520; const H = 210; const L = 24; const R = 24; const T = 30; const B = 26;
    const pdf = (c, x) => Math.exp(-(((x - c.mu) / c.sd) ** 2) / 2) / (c.sd * Math.sqrt(2 * Math.PI));
    const top = Math.max(...ctx.curves.map((c) => pdf(c, c.mu))) * 1.08;
    const X = (x) => L + ((x - ctx.lo) / (ctx.hi - ctx.lo)) * (W - L - R);
    const Y = (y) => H - B - (y / top) * (H - T - B);
    const ticks = [];
    for (let t = ctx.lo; t <= ctx.hi; t += 10) ticks.push(t);
    const grid = ticks.map((t) => `<line class="gl" x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${H - B}"/>
      <text class="tick${(t - ctx.lo) % 20 ? ' odd' : ''}" x="${X(t)}" y="${H - 8}" text-anchor="middle">${t}${esc(ctx.unit)}</text>`).join('');
    const curves = ctx.curves.map((c, i) => {
      const pts = [];
      for (let k = 0; k <= 200; k++) {
        const x = ctx.lo + ((ctx.hi - ctx.lo) * k) / 200;
        pts.push(`${X(x).toFixed(1)},${Y(pdf(c, x)).toFixed(1)}`);
      }
      return `<polyline class="curve c${i}" points="${pts.join(' ')}"/>`;
    }).join('');
    const legend = ctx.curves.map((c, i) => `<g transform="translate(${L + 8 + i * 110},14)">
      <line class="curve c${i}" x1="0" x2="26" y1="0" y2="0"/><text class="tick key" x="32" y="4">${esc(c.label)}</text></g>`).join('');
    const mark = `<line class="mark" x1="${X(ctx.mark)}" x2="${X(ctx.mark)}" y1="${T - 4}" y2="${H - B}"/>`;
    return `<svg class="oa-visual density" viewBox="0 0 ${W} ${H}" role="img" aria-label="Three return distributions">
      ${grid}<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${mark}${curves}${legend}</svg>`;
  }

  /** A three-node chain: curved arrows between squares, loops for staying put. */
  function graphSvg(ctx) {
    const pos = [[70, 240], [310, 240], [190, 96]];
    const r = 24;
    const cx = pos.reduce((t, p) => t + p[0], 0) / 3;
    const cy = pos.reduce((t, p) => t + p[1], 0) / 3;
    const unit = (dx, dy) => { const d = Math.hypot(dx, dy); return [dx / d, dy / d]; };
    const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const f = (v) => v.toFixed(1);
    let edges = '';
    let labels = '';
    ctx.P.forEach((row, i) => row.forEach((p, j) => {
      if (!p) return;
      const [x1, y1] = pos[i];
      if (i === j) {
        // A loop on the side facing away from the middle.
        const u = unit(x1 - cx, y1 - cy);
        const [a, b] = [rot(u, -0.6), rot(u, 0.6)];
        const [c1, c2] = [rot(u, -0.55), rot(u, 0.55)];
        edges += `<path class="edge" marker-end="url(#oaArrow)" d="M${f(x1 + a[0] * r)},${f(y1 + a[1] * r)} C${f(x1 + c1[0] * (r + 70))},${f(y1 + c1[1] * (r + 70))} ${f(x1 + c2[0] * (r + 70))},${f(y1 + c2[1] * (r + 70))} ${f(x1 + b[0] * (r + 3))},${f(y1 + b[1] * (r + 3))}"/>`;
        labels += `<text class="w" x="${f(x1 + u[0] * (r + 56))}" y="${f(y1 + u[1] * (r + 56))}">${p}</text>`;
        return;
      }
      // i→j and j→i bend to opposite sides, so both arrows stay readable.
      const [x2, y2] = pos[j];
      const d = unit(x2 - x1, y2 - y1);
      const n = [-d[1], d[0]];
      const qx = (x1 + x2) / 2 + n[0] * 34;
      const qy = (y1 + y2) / 2 + n[1] * 34;
      const s = unit(qx - x1, qy - y1);
      const e = unit(qx - x2, qy - y2);
      edges += `<path class="edge" marker-end="url(#oaArrow)" d="M${f(x1 + s[0] * r)},${f(y1 + s[1] * r)} Q${f(qx)},${f(qy)} ${f(x2 + e[0] * (r + 3))},${f(y2 + e[1] * (r + 3))}"/>`;
      labels += `<text class="w" x="${f((x1 + x2) / 4 + qx / 2)}" y="${f((y1 + y2) / 4 + qy / 2)}">${p}</text>`;
    }));
    const nodes = ctx.nodes.map((name, i) => `<g class="node${i === ctx.start ? ' start' : ''}"><circle cx="${pos[i][0]}" cy="${pos[i][1]}" r="${r}"/>
      <text x="${pos[i][0]}" y="${pos[i][1]}">${esc(name)}</text></g>`).join('');
    return `<svg class="oa-visual graph" viewBox="-20 0 420 310" role="img" aria-label="Transition graph between ${ctx.nodes.join(', ')}">
      <defs><marker id="oaArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
      ${edges}${nodes}${labels}</svg>`;
  }

  function currentAnswer() {
    const q = S.oa.qs[S.oa.i];
    return KINDS[q.kind].answer(q);
  }

  function renderQuestion() {
    const g = S.oa;
    const q = g.qs[g.i];
    g.qStart = performance.now();
    g.reviewing = false;
    g.rankSel = [];
    g.pos = q.kind === 'board' ? q.board.cards.map(() => 0) : null;
    count();
    const comeBack = !g.learn && g.m.test.revisit && !g.deferred.has(g.i);
    const skip = g.learn ? 'Show answer' : comeBack ? 'Skip for now' : 'Skip';
    $('oaStage').innerHTML = `<div class="oa-q">
        ${KINDS[q.kind].html(q)}
        <div class="oa-foot">
          <button class="btn ghost small" data-oa-skip>${skip} <kbd>Space</kbd></button>
          ${g.learn ? '<button class="btn ghost small" data-oa-finish>Finish and review</button>' : ''}
        </div>
        <div class="oa-explain" id="oaExplain" hidden></div>
      </div>`;
    if (q.kind === 'board') drawBoard();
    // Ready to type, except on touch screens where focus would pop the keyboard over the picture.
    if (q.kind === 'interval' && !matchMedia('(pointer: coarse)').matches) $('ivLo').focus();
  }

  function submit(a, timedOut = false) {
    const g = S.oa;
    if (!g || g.done || g.reviewing) return;
    const q = g.qs[g.i];
    // A wrong board costs time, not a point: say what's off and let them fix it.
    const err = a != null && KINDS[q.kind].validate ? KINDS[q.kind].validate(q, a) : null;
    if (err) {
      if (timedOut) a = null;
      else {
        $('obMsg').textContent = err;
        return;
      }
    }
    if (a == null && !timedOut && !g.learn && g.m.test.revisit && !g.deferred.has(g.i)) {
      g.deferred.add(g.i);
      g.queue.push(g.i);
      return next();
    }
    record(g.i, a, timedOut);
    if (!g.learn) return next();
    const r = g.items[g.items.length - 1];
    // Learn mode: show what was right and why, then wait for Next.
    g.reviewing = true;
    KINDS[q.kind].reveal(q, a);
    const ex = $('oaExplain');
    ex.hidden = false;
    const verdict = KINDS[q.kind].feedback ? KINDS[q.kind].feedback(q, r)
      : r.ok ? 'Right.' : r.g == null ? `Answer: ${q.answer}.` : `Not quite. Answer: ${q.answer}.`;
    ex.innerHTML = `<p class="${r.ok && r.pts > 0 ? 'better' : 'worse'}"><b>${esc(verdict)}</b></p>
      <p>${esc(q.explain)}</p>
      <div class="actions"><button class="btn primary" data-oa-next>Next <kbd>Enter</kbd></button></div>`;
    document.querySelector('[data-oa-skip]').hidden = true;
  }

  /** Marks question `n` and keeps the review line for it. */
  function record(n, a, timedOut = false, ms = Math.round(performance.now() - S.oa.qStart)) {
    const g = S.oa;
    const q = g.qs[n];
    const r = KINDS[q.kind].mark(q, a);
    g.items.push({
      n, t: q.topic, q: q.summary || q.prompt, a: q.answer, x: q.explain,
      g: r.g, ok: r.ok, pts: r.pts, ms, ...(timedOut ? { late: 1 } : {}),
    });
  }

  function next() {
    const g = S.oa;
    if (g.learn && !g.queue.length) {
      g.qs.push(...g.src.set(1));
      g.queue.push(g.qs.length - 1);
    }
    if (!g.queue.length) return finish(false);
    g.i = g.queue.shift();
    renderQuestion();
  }

  async function finish(aborted) {
    const g = S.oa;
    if (!g || g.done) return;
    g.done = true;
    clearInterval(g.timer);
    // Skipped-for-later questions that never came round again count as skips.
    const answered = new Set(g.items.map((p) => p.n));
    for (const n of g.deferred) if (!answered.has(n)) record(n, null, false, 0);
    const items = g.items.sort((x, y) => x.n - y.n);
    const right = items.filter((p) => p.ok).length;
    const skipped = items.filter((p) => p.g == null).length;
    const session = {
      id: g.startedAt.toString(36) + Math.random().toString(36).slice(2, 7),
      at: g.startedAt,
      mode: 'oa',
      module: g.m.id,
      practice: g.learn,
      aborted,
      score: Math.round(items.reduce((t, p) => t + p.pts, 0) * 100) / 100,
      right,
      wrong: items.length - right - skipped,
      skipped,
      total: g.learn ? items.length : g.qs.length,
      timeUsedMs: Math.round(performance.now() - g.t0),
      problems: items,
      ...(g.mock ? { mock: g.mock.run, mockStage: g.mock.stage } : {}),
    };
    const before = OA.summary(S.data.sessions, g.m.id);
    if (items.length) await Q.saveSession(session);
    if (g.mock) return afterMockStage(g.mock, aborted);
    if (aborted && !items.length) return Q.show('oa');
    S.oaBack = 'oa';
    renderResults(session, before);
    Q.show('oaresults');
  }

  // ---- results and review --------------------------------------------------------

  function renderResults(s, before) {
    const m = OA.byId[s.module];
    S.oaLast = { id: m.id, learn: s.practice };
    const topics = OA.byTopic(s.problems);
    const isTest = !s.practice && !s.aborted;
    const best = isTest && before.tests && s.score > before.best ? `<span class="badge">New best (+${OA.formatScore(s.score - before.best)})</span>` : '';
    const vs = isTest && before.tests ? `Previous best ${OA.formatScore(before.best)} · last ${OA.formatScore(before.last)}` : '';
    const review = s.problems.map((p, i) => `
      <details class="oa-review"${p.ok ? '' : ' open'}>
        <summary><span class="n">${(p.n ?? i) + 1}</span><span class="q">${esc(p.q)}</span>
          <span class="mark ${p.ok ? 'better' : p.g == null ? 'muted' : 'worse'}">${p.ok ? '✓' : p.g == null ? (p.late ? 'time' : 'skip') : '✗'}</span></summary>
        <p>Your answer: <b>${p.g == null ? '—' : esc(p.g)}</b> · Correct: <b>${esc(p.a)}</b></p>
        <p class="sub">${esc(p.x)}</p>
      </details>`).join('');
    $('view-oaresults').innerHTML = `
      <div class="card hero-card">
        <div class="hero-top"><div>
          <div class="hero-label">${esc(m.name)} · ${s.practice ? 'Learn' : s.aborted ? 'Test (quit early)' : 'Test'}</div>
          <div class="hero-row"><span class="hero">${OA.formatScore(s.score)}</span>${best}</div>
          <p class="hero-sub">${s.right} right · ${s.wrong} wrong · ${s.skipped} skipped${s.practice ? '' : ` · ${s.problems.length} of ${s.total} reached`}</p>
          ${vs ? `<p class="hero-delta">${vs}</p>` : ''}
        </div>
        <div class="tiles compact">${[
          ['Accuracy', s.right + s.wrong ? `${Math.round((s.right / (s.right + s.wrong)) * 100)}%` : '—'],
          ['Avg time / question', s.problems.length ? `${(s.problems.reduce((t, p) => t + p.ms, 0) / s.problems.length / 1000).toFixed(1)}s` : '—'],
        ].map(([l, v]) => Q.tile(l, v)).join('')}</div></div>
        <div class="actions">
          <button class="btn primary" data-oa-again>${s.practice ? 'Learn more' : 'Try again'} <kbd>Enter</kbd></button>
          ${s.practice ? `<button class="btn" data-oa-start="${m.id}" data-mode="test">Take the test</button>` : `<button class="btn" data-oa-start="${m.id}" data-mode="learn">Learn mode</button>`}
          <button class="btn ghost" data-action="goto-oa">Back <kbd>Esc</kbd></button>
        </div>
      </div>
      <div class="res-cols oa-res">
        <div>${SOURCES[m.id].extra ? SOURCES[m.id].extra(s) : ''}<div class="card"><h2>By topic</h2>${topics.length ? `<ul class="plist">${topics.map((r) => `<li><span class="q">${esc(r.topic)}</span><span class="detail">${r.right} of ${r.n} right${r.skipped ? ` · ${r.skipped} skipped` : ''}</span></li>`).join('')}</ul>` : '<p class="empty-note">Nothing answered.</p>'}</div></div>
        <div class="card oa-review-card"><h2>Every question</h2>${review || '<p class="empty-note">Nothing answered.</p>'}</div>
      </div>`;
    S.oaResultsAt = performance.now();
  }

  // ---- Zap-N games ---------------------------------------------------------------

  function startZap(id, mock = null) {
    const meta = OAZap.GAMES.find((x) => x.id === id);
    if (!meta) return;
    S.zap = { id, meta, mock, score: 0, items: [], startedAt: Date.now(), t0: performance.now(), done: false, timer: 0, busy: false };
    Q.show('zapgame');
    $('zapLabel').textContent = `${mock ? 'Full OA · ' : ''}Zap-N · ${meta.name}`;
    $('view-zapgame').classList.remove('hurry');
    ZAP[id].init(S.zap);
    zapScore();
    S.zap.timer = setInterval(zapTick, 100);
    zapTick();
  }

  function zapScore() {
    const z = S.zap;
    $('zapScore').textContent = z.id === 'balloon' ? `Total ${z.score}` : `Score ${z.score}`;
  }

  function zapTick() {
    const z = S.zap;
    if (!z || z.done) return;
    const now = performance.now();
    if (z.meta.seconds) {
      const left = z.meta.seconds * 1000 - (now - z.t0);
      $('zapTime').textContent = `Time left ${clock(left)}`;
      $('view-zapgame').classList.toggle('hurry', left <= 10000);
      if (z.id !== 'codes') $('zapTimebar').style.transform = `scaleX(${Math.max(0, left / (z.meta.seconds * 1000))})`;
      if (left <= 0) return finishZap(false);
    } else {
      $('zapTime').textContent = `Balloon ${Math.min(z.i + 1, z.meta.balloons)} of ${z.meta.balloons}`;
      $('zapTimebar').style.transform = `scaleX(${1 - z.i / z.meta.balloons})`;
    }
    if (ZAP[z.id].tick) ZAP[z.id].tick(z, now);
  }

  const ZAP = {
    numberbox: {
      init(z) { this.next(z); },
      next(z) {
        z.p = OAZap.numberBox(Math.random);
        z.tiles = z.p.nums.map((v) => ({ v, e: String(v) }));
        z.history = [];
        z.sel = null;
        z.op = null;
        z.qStart = performance.now();
        this.draw(z);
      },
      draw(z, msg = '') {
        $('zapStage').innerHTML = `<div class="oa-q zap">
            <p class="nb-target">Target <b>${z.p.target}</b></p>
            <div class="nb-tiles">${z.tiles.map((t, i) => `<button class="nb-tile${z.sel === i ? ' sel' : ''}" data-nb-tile="${i}"><span class="k">${i + 1}</span>${t.v}</button>`).join('')}</div>
            <div class="nb-ops">${['+', '−', '×', '÷'].map((o) => `<button class="nb-op${z.op === o ? ' sel' : ''}" data-nb-op="${o}">${o}</button>`).join('')}</div>
            <p class="nb-msg" role="status">${esc(msg)}</p>
            <div class="oa-foot"><button class="btn ghost small" data-nb-undo>Undo <kbd>⌫</kbd></button><button class="btn ghost small" data-nb-skip>Skip (−1) <kbd>Space</kbd></button></div>
          </div>`;
      },
      tile(z, i) {
        if (z.busy) return;
        if (z.sel == null || z.op == null) {
          z.sel = z.sel === i ? null : i;
          return this.draw(z);
        }
        if (i === z.sel) return;
        const a = z.tiles[z.sel];
        const b = z.tiles[i];
        const v = OAZap.apply(a.v, z.op, b.v);
        if (v == null || v < 0) {
          z.op = null;
          return this.draw(z, v == null ? 'Whole numbers only.' : 'No negative numbers.');
        }
        z.history.push(z.tiles);
        const merged = { v, e: `(${a.e} ${z.op} ${b.e})` };
        const keep = z.tiles.filter((_, k) => k !== z.sel && k !== i);
        const at = Math.min(z.sel, i);
        z.tiles = [...keep.slice(0, at), merged, ...keep.slice(at)];
        z.sel = z.tiles.indexOf(merged);
        z.op = null;
        if (z.tiles.length === 1 && v === z.p.target) {
          z.score++;
          z.items.push({ t: 'Number Box', q: `${z.p.nums.join(' ')} → ${z.p.target}`, a: z.p.solution, g: merged.e.replace(/^\((.*)\)$/, '$1'), ok: true, pts: 1, ms: Math.round(performance.now() - z.qStart) });
          zapScore();
          z.busy = true;
          this.draw(z, 'Got it!');
          document.querySelector('.nb-tile').classList.add('win');
          return setTimeout(() => { z.busy = false; if (!z.done) this.next(z); }, 500);
        }
        this.draw(z, z.tiles.length === 1 ? `That makes ${v}, not ${z.p.target}. Undo and try another way.` : '');
      },
      op(z, o) {
        if (z.busy || z.sel == null) return this.draw(z, 'Pick a number first.');
        z.op = z.op === o ? null : o;
        this.draw(z);
      },
      undo(z) {
        if (z.busy || !z.history.length) return;
        z.tiles = z.history.pop();
        z.sel = null;
        z.op = null;
        this.draw(z);
      },
      skip(z) {
        if (z.busy) return;
        z.score--;
        z.items.push({ t: 'Number Box', q: `${z.p.nums.join(' ')} → ${z.p.target}`, a: z.p.solution, g: null, ok: false, pts: -1, ms: Math.round(performance.now() - z.qStart) });
        zapScore();
        z.busy = true;
        this.draw(z, `One way: ${z.p.solution} = ${z.p.target}`);
        setTimeout(() => { z.busy = false; if (!z.done) this.next(z); }, 1600);
      },
      key(z, e) {
        if (/^[1-4]$/.test(e.key) && Number(e.key) <= z.tiles.length) this.tile(z, Number(e.key) - 1);
        else if ({ '+': '+', '-': '−', '*': '×', x: '×', '/': '÷' }[e.key]) this.op(z, { '+': '+', '-': '−', '*': '×', x: '×', '/': '÷' }[e.key]);
        else if (e.key === 'Backspace') this.undo(z);
        else if (e.key === ' ') {
          e.preventDefault();
          this.skip(z);
        }
      },
    },

    codes: {
      init(z) {
        z.streak = 0;
        this.next(z);
      },
      next(z) {
        z.c = OAZap.codes(Math.random);
        z.qStart = performance.now();
        z.limit = OAZap.codeTime(z.streak) * 1000;
        $('zapStage').innerHTML = `<div class="oa-q zap">
            <p class="cc-code">${z.c.code}</p>
            <div class="cc-opts">${z.c.options.map((o, i) => `<button class="cc-opt" data-cc="${i}"><span class="k">${i + 1}</span>${o}</button>`).join('')}</div>
            <p class="nb-msg" role="status"></p>
          </div>`;
      },
      answer(z, i) {
        const ok = i === z.c.correct;
        z.score += ok ? 1 : -1;
        z.streak = ok ? z.streak + 1 : 0;
        z.items.push({ t: 'Code Compare', q: z.c.code, a: z.c.code, g: i == null ? null : z.c.options[i], ok, pts: ok ? 1 : -1, ms: Math.round(performance.now() - z.qStart) });
        zapScore();
        this.next(z);
        if (!ok) document.querySelector('.nb-msg').textContent = i == null ? 'Too slow.' : 'Not an exact match.';
      },
      tick(z, now) {
        const left = z.limit - (now - z.qStart);
        $('zapTimebar').style.transform = `scaleX(${Math.max(0, left / z.limit)})`;
        if (left <= 0) this.answer(z, null);
      },
      key(z, e) {
        if (/^[1-4]$/.test(e.key)) this.answer(z, Number(e.key) - 1);
      },
    },

    balloon: {
      init(z) {
        z.i = 0;
        z.rounds = [];
        z.max = OAZap.balloonMax(Math.random); // hidden; shown in the results
        this.next(z);
      },
      next(z) {
        z.pumps = 0;
        z.pop = OAZap.popAt(Math.random, z.max);
        z.qStart = performance.now();
        this.draw(z);
      },
      draw(z, msg = '', popped = false) {
        // Grows smoothly without a ceiling, so its size gives nothing away about the limit.
        const r = 34 + 116 * (1 - Math.exp(-z.pumps / 45));
        $('zapStage').innerHTML = `<div class="oa-q zap">
            <svg class="bl-svg" viewBox="0 0 320 340" role="img" aria-label="Balloon">
              ${popped ? '<text x="160" y="175" text-anchor="middle" class="bl-pop">POP</text>'
                : `<circle cx="160" cy="${180 - r * 0.15}" r="${r}" class="bl-balloon"/><line x1="160" y1="${180 - r * 0.15 + r}" x2="160" y2="335" class="bl-string"/>`}
            </svg>
            <p class="bl-bank">This balloon: <b>${z.pumps * OAZap.PUMP_POINTS}</b> points</p>
            <p class="nb-msg" role="status">${esc(msg)}</p>
            <div class="actions bl-actions"><button class="btn primary" data-bl-pump ${z.busy ? 'disabled' : ''}>Pump <kbd>Space</kbd></button>
              <button class="btn" data-bl-cash ${z.busy || !z.pumps ? 'disabled' : ''}>Cash in <kbd>Enter</kbd></button></div>
          </div>`;
      },
      pump(z) {
        if (z.busy) return;
        z.pumps++;
        if (z.pumps >= z.pop) return this.end(z, false);
        this.draw(z);
      },
      cash(z) {
        if (z.busy || !z.pumps) return;
        this.end(z, true);
      },
      end(z, cashed) {
        const pts = cashed ? z.pumps * OAZap.PUMP_POINTS : 0;
        z.score += pts;
        z.rounds.push({ cashed, pumps: z.pumps });
        z.items.push({ t: 'Balloon', q: `Balloon ${z.i + 1}`, a: `would pop at pump ${z.pop}`, g: cashed ? `cashed in after ${z.pumps}` : `popped at ${z.pumps}`, ok: cashed, pts, ms: Math.round(performance.now() - z.qStart) });
        zapScore();
        z.busy = true;
        this.draw(z, cashed ? `+${pts} (it would have popped at pump ${z.pop})` : `Popped at pump ${z.pumps}: lost ${(z.pumps - 1) * OAZap.PUMP_POINTS}.`, !cashed);
        setTimeout(() => {
          z.busy = false;
          if (z.done) return;
          z.i++;
          if (z.i >= z.meta.balloons) return finishZap(false);
          this.next(z);
        }, 900);
      },
      key(z, e) {
        if (e.key === ' ') {
          e.preventDefault();
          this.pump(z);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.cash(z);
        }
      },
    },
  };

  async function finishZap(aborted) {
    const z = S.zap;
    if (!z || z.done) return;
    z.done = true;
    clearInterval(z.timer);
    const right = z.items.filter((p) => p.ok).length;
    const session = {
      id: z.startedAt.toString(36) + Math.random().toString(36).slice(2, 7),
      at: z.startedAt, mode: 'oa', module: 'zap', game: z.id, practice: false, aborted,
      score: z.score, right, wrong: z.items.length - right, skipped: 0, total: z.items.length,
      timeUsedMs: Math.round(performance.now() - z.t0), problems: z.items,
      ...(z.id === 'balloon' ? { balloonMax: z.max } : {}),
      ...(z.mock ? { mock: z.mock.run, mockStage: z.mock.stage } : {}),
    };
    const before = OA.summary(S.data.sessions, 'zap', z.id);
    if (z.items.length) await Q.saveSession(session);
    if (z.mock) return afterMockStage(z.mock, aborted);
    if (aborted && !z.items.length) return Q.show('oa');
    S.oaBack = 'oa';
    renderZapResults(session, before);
    Q.show('oaresults');
  }

  function renderZapResults(s, before) {
    const meta = OAZap.GAMES.find((x) => x.id === s.game);
    S.oaLast = { zap: s.game };
    const isTest = !s.aborted;
    const best = isTest && before.tests && s.score > before.best ? `<span class="badge">New best (+${s.score - before.best})</span>` : '';
    let detail = '';
    if (s.game === 'balloon') {
      const st = OAZap.balloonStats(s.problems.map((p) => ({ cashed: p.ok, pumps: Number(p.g.match(/\d+/)[0]) })), s.balloonMax || OAZap.BALLOON_MAX);
      detail = `<p class="hero-sub">${st.cashed} cashed in · ${st.popped} popped · ${st.avgPumps.toFixed(1)} pumps on average when cashing in</p><p class="hero-delta">${esc(st.advice)}</p>`;
    } else if (s.game === 'codes') {
      const ms = s.problems.filter((p) => p.ok).map((p) => p.ms);
      detail = `<p class="hero-sub">${s.right} right · ${s.wrong} wrong or too slow${ms.length ? ` · ${(ms.reduce((a, b) => a + b, 0) / ms.length / 1000).toFixed(2)}s per right answer` : ''}</p>`;
    } else {
      detail = `<p class="hero-sub">${s.right} solved · ${s.wrong} skipped</p>`;
    }
    const missed = s.game === 'numberbox' ? s.problems.filter((p) => !p.ok) : [];
    $('view-oaresults').innerHTML = `
      <div class="card hero-card">
        <div class="hero-label">Zap-N · ${esc(meta.name)}${s.aborted ? ' (quit early)' : ''}</div>
        <div class="hero-row"><span class="hero">${s.score}</span>${best}</div>
        ${detail}
        ${isTest && before.tests ? `<p class="hero-delta">Previous best ${before.best} · last ${before.last}</p>` : ''}
        <div class="actions" style="margin-top:16px">
          <button class="btn primary" data-oa-again>Play again <kbd>Enter</kbd></button>
          <button class="btn ghost" data-action="goto-oa">Back <kbd>Esc</kbd></button>
        </div>
      </div>
      ${missed.length ? `<div class="card" style="margin-top:16px"><h2>Skipped targets</h2><ul class="plist">${missed.map((p) => `<li><span class="q">${esc(p.q)}</span><span class="detail">${esc(p.a)}</span></li>`).join('')}</ul></div>` : ''}`;
    S.oaResultsAt = performance.now();
  }

  document.addEventListener('click', (e) => {
    const zs = e.target.closest('[data-zap]');
    if (zs) return startZap(zs.dataset.zap);
    const z = S.zap;
    if (S.view !== 'zapgame' || !z || z.done) return;
    const g = ZAP[z.id];
    const t = e.target.closest('[data-nb-tile]');
    if (t) return g.tile(z, Number(t.dataset.nbTile));
    const o = e.target.closest('[data-nb-op]');
    if (o) return g.op(z, o.dataset.nbOp);
    if (e.target.closest('[data-nb-undo]')) return g.undo(z);
    if (e.target.closest('[data-nb-skip]')) return g.skip(z);
    const cc = e.target.closest('[data-cc]');
    if (cc) return g.answer(z, Number(cc.dataset.cc));
    if (e.target.closest('[data-bl-pump]')) return g.pump(z);
    if (e.target.closest('[data-bl-cash]')) return g.cash(z);
  });
  $('zapQuitBtn').addEventListener('click', () => finishZap(true));
  Q.registerKeys('zapgame', (e) => {
    const z = S.zap;
    if (!z || z.done) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      return finishZap(true);
    }
    ZAP[z.id].key(z, e);
  });

  // ---- Stats page: OA view -------------------------------------------------------

  /** One row per module, with each Zap-N game on its own row. */
  const statRows = () => [
    ...OA.MODULES.filter((m) => m.id !== 'zap').map((m) => ({ key: m.id, id: m.id, game: null, name: m.name, sub: m.generic })),
    ...OAZap.GAMES.map((g) => ({ key: `zap:${g.id}`, id: 'zap', game: g.id, name: g.name, sub: 'Zap-N' })),
  ];
  const pctOf = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const fmtNum = (v) => (v == null ? '—' : OA.formatScore(Math.round(v * 10) / 10));

  function renderOAStats(body) {
    const row = S.oaStatsModule && statRows().find((r) => r.key === S.oaStatsModule);
    if (row) return renderOAModuleStats(body, row);
    const sessions = S.data.sessions;
    const o = OA.overview(sessions);
    const st = S.data.settings.e80 || {};
    const e80 = X.summary(sessions, st.penalty);
    if (!o.rounds && !e80.games) {
      body.innerHTML = `<div class="card empty"><h2>No assessment practice yet</h2>
        <p>Take a Test or Learn round in the OA tab and this page tracks your scores, accuracy and weakest topics for every module.</p>
        <div class="actions" style="justify-content:center;margin-top:16px"><button class="btn primary" data-action="goto-oa">Open the OA tab</button></div></div>`;
      return;
    }
    const e80Attempts = sessions.filter((s) => X.isAttempt(s));
    const e80Right = e80Attempts.reduce((t, s) => t + s.right, 0);
    const e80Wrong = e80Attempts.reduce((t, s) => t + s.wrong, 0);
    // The same attempts the 80 in 8 record uses (scored with the current penalty).
    const e80Scored = e80Attempts.filter((s) => !st.penalty || (s.settings && s.settings.penalty) === st.penalty);
    const minus = (v) => (v < 0 ? `−${-v}` : String(v));
    const lines = [{
      key: 'e80', name: '80 in 8', sub: 'Mental maths', tests: e80.games,
      best: e80.best, last: e80.history.length ? e80.history[e80.history.length - 1].score : null, avg: e80.recentAvg,
      acc: e80Right + e80Wrong ? e80Right / (e80Right + e80Wrong) : null, open: 'goto-e80',
      points: e80Scored.map((s, i) => ({
        value: s.score,
        tip: trendTip(`Attempt ${i + 1}`, s.at, `Net ${minus(s.score)} · ${s.right + s.wrong ? pctOf(s.right / (s.right + s.wrong)) : '—'} right`, s.timeUsedMs),
      })),
    }, ...statRows().map((r) => {
      const sum = OA.summary(sessions, r.id, r.game);
      const items = OA.rounds(sessions, r.id, r.game).flatMap((s) => s.problems || []);
      const zap = r.id === 'zap';
      return {
        key: r.key, name: r.name, sub: r.sub, tests: sum.tests, best: sum.best, last: sum.last, avg: sum.avg,
        acc: zap && r.game !== 'codes' ? null : OA.accuracy(items),
        rounds: OA.rounds(sessions, r.id, r.game).length,
        points: OA.history(sessions, r.id, r.game).map((h) => ({
          value: h.score,
          tip: trendTip(`Test ${h.i}`, h.at,
            `Score ${OA.formatScore(h.score)}${zap ? '' : ` of ${h.total}`}${zap && r.game !== 'codes' ? '' : ` · ${pctOf(h.acc)} right`}`, h.timeMs),
        })),
      };
    })];
    body.innerHTML = `
      <div class="tiles four">${[
        Q.tile('Rounds', o.rounds, `${o.tests} test${o.tests === 1 ? '' : 's'} · ${o.learn} learn`),
        Q.tile('Questions answered', o.answered, 'Zap-N games not counted'),
        Q.tile('Accuracy', pctOf(o.accuracy), 'right ÷ answered'),
        Q.tile('Time practised', `${Math.round(o.timeMs / 60000)} min`, 'assessment modules'),
      ].join('')}</div>
      <div class="card">
        <div class="card-head"><h2>By module</h2><span class="sub">Best, last and average count Test rounds only; accuracy counts every round.</span></div>
        <table class="cats oas">
          <thead><tr><th>Module</th><th class="num">Tests</th><th class="num">Best</th><th class="num">Last</th><th class="num avg">Recent avg</th><th class="num">Accuracy</th><th class="spk">Trend</th><th></th></tr></thead>
          <tbody>${lines.map((l, i) => `<tr class="${l.tests || l.rounds ? '' : 'thin'}">
              <td><div>${esc(l.name)}</div><div class="ex">${esc(l.sub)}</div></td>
              <td class="num">${l.tests || 0}</td><td class="num">${fmtNum(l.best)}</td><td class="num">${fmtNum(l.last)}</td>
              <td class="num avg">${fmtNum(l.avg)}</td><td class="num">${pctOf(l.acc)}</td>
              <td class="spk"><div class="spark oas-spark" data-spark="${i}"></div></td>
              <td>${l.open ? `<button class="btn small" data-action="${l.open}">Open</button>`
                : l.tests || l.rounds ? `<button class="btn small" data-oas-module="${l.key}">Details</button>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
    // Hover a trend for a dot per recent test, each with its date, score and time.
    body.querySelectorAll('[data-spark]').forEach((el) => {
      const pts = lines[Number(el.dataset.spark)].points.slice(-20);
      window.Charts.sparkline(el, pts.map((p) => p.value), { width: 140, height: 32, tips: pts.map((p) => p.tip) });
    });
  }

  /** "Test 7 · Oct 29, 10:45 PM / Score 12 of 20 · 72% right / Took 18:32" */
  const trendTip = (label, at, line, timeMs) =>
    [`${label} · ${Q.dateFmt(at)}`, line, timeMs ? `Took ${clock(timeMs)}` : ''].filter(Boolean).join('\n');

  function renderOAModuleStats(body, row) {
    const sessions = S.data.sessions;
    const all = OA.rounds(sessions, row.id, row.game);
    const sum = OA.summary(sessions, row.id, row.game);
    const hist = OA.history(sessions, row.id, row.game);
    const items = all.flatMap((s) => s.problems || []);
    const answered = items.filter((p) => p.g != null);
    const quiz = row.id !== 'zap';
    const avgMs = answered.length ? answered.reduce((t, p) => t + (p.ms || 0), 0) / answered.length : null;
    const topics = quiz ? OA.byTopic(items) : [];
    const cal = row.id === 'iv' ? OAIntervals.calibration(items) : null;
    const recent = all.slice().reverse().slice(0, 30);
    const kind = (s) => (s.practice ? 'Learn' : s.aborted ? 'Test (quit)' : 'Test');
    body.innerHTML = `
      <div class="oas-head"><button class="btn link back-link" data-oas-module="">← All modules</button>
        <h2>${esc(row.name)} <span class="sub">${esc(row.sub)}</span></h2></div>
      <div class="tiles four">${[
        Q.tile('Tests', sum.tests, `${all.length - sum.tests} learn or quit`),
        Q.tile('Best', fmtNum(sum.best), sum.tests ? `last ${fmtNum(sum.last)}` : 'no test yet'),
        Q.tile('Recent average', fmtNum(sum.avg), sum.tests ? `last ${Math.min(5, sum.tests)} tests` : ''),
        quiz ? Q.tile('Accuracy', pctOf(OA.accuracy(items)), avgMs != null ? `${(avgMs / 1000).toFixed(1)}s a question` : '')
          : Q.tile('Rounds', all.length, ''),
      ].join('')}</div>
      <div class="card">
        <div class="card-head"><h2>Score per test</h2><span class="sub">${esc(row.name)} Test rounds, oldest first</span></div>
        ${hist.length ? '<div class="chart" id="oaScoreChart"></div>' : '<p class="empty-note">Take a Test round to start the chart.</p>'}
      </div>
      ${cal ? `<div class="card oa-cal"><h2>Calibration, every round</h2>
          <div class="tiles compact">${Q.tile('Contained', `${cal.hits} of ${cal.answered}`)}${Q.tile('Avg score when contained', cal.hits ? cal.avgHit.toFixed(2) : '—')}</div>
          <p class="sub">${esc(cal.advice)}</p></div>` : ''}
      ${quiz ? `<div class="card"><div class="card-head"><h2>By topic, every round</h2><span class="sub">Weakest first</span></div>
          ${topics.length ? `<table class="cats"><thead><tr><th>Topic</th><th class="num">Seen</th><th class="num">Right</th><th class="num">Skipped</th><th class="num">Avg time</th></tr></thead>
            <tbody>${topics.map((t) => `<tr class="${t.n < 3 ? 'thin' : ''}"><td>${esc(t.topic)}</td><td class="num">${t.n}</td>
              <td class="num">${pctOf(t.right / t.n)}</td><td class="num">${t.skipped}</td><td class="num">${(t.avgMs / 1000).toFixed(1)}s</td></tr>`).join('')}</tbody></table>`
          : '<p class="empty-note">Nothing answered yet.</p>'}</div>` : ''}
      <div class="card"><div class="card-head"><h2>Rounds</h2><span class="sub">Newest first. Review shows every question again.</span></div>
        ${recent.length ? `<ul class="plist oas-rounds">${recent.map((s) => `<li>
            <span class="q">${esc(Q.dateFmt(s.at))}</span>
            <span class="detail">${kind(s)} · ${s.problems.length}${s.module === 'zap' ? '' : ` of ${s.total}`} · ${quiz ? `${pctOf(OA.accuracy(s.problems))} right` : `${s.right} ${row.game === 'balloon' ? 'cashed in' : 'right'}`}</span>
            <span class="t">${OA.formatScore(s.score)}</span>
            <button class="btn ghost small" data-oas-review="${esc(s.id)}">Review</button></li>`).join('')}</ul>`
        : '<p class="empty-note">No rounds yet.</p>'}</div>`;
    if (hist.length) {
      window.Charts.lineChart($('oaScoreChart'), hist.map((h) => ({ value: h.score, label: h.i, at: h.at, total: h.total })), {
        xLabel: (p) => `#${p.label}`,
        tipHtml: (p) => `<b>Test ${p.label}</b> · ${esc(Q.dateFmt(p.at))}<br>Score <b>${OA.formatScore(p.value)}</b>${row.id === 'zap' ? '' : ` of ${p.total}`}`,
      });
    }
  }

  /** Re-open a saved round's review from Stats or a Full OA report; Back returns there. */
  function reviewRound(id, back = 'stats') {
    const s = S.data.sessions.find((x) => x.id === id);
    if (!s) return;
    if (s.module === 'zap') renderZapResults(s, { tests: 0 });
    else renderResults(s, { tests: 0 });
    S.oaBack = back;
    document.querySelectorAll('#view-oaresults [data-action="goto-oa"]').forEach((b) => { b.dataset.action = back === 'mock' ? 'goto-mock' : 'goto-stats'; });
    Q.show('oaresults');
  }

  // ---- Full OA practice ----------------------------------------------------------
  // Every stage in order, breaks allowed between them (the run is kept in settings,
  // and each finished stage is a saved round), then a report. As on the real
  // assessment, scores stay hidden until the end.

  const STAGE_COUNT = OAMock.STAGES.length;
  const stageLabel = (st) => (st.game ? `Zap-N · ${st.name}` : st.name);

  /** The run in progress, or null (none started, or every stage done). */
  function activeRun() {
    const r = S.data.settings.oaMock;
    if (!r || !r.id) return null;
    return OAMock.progress(S.data.sessions, r).done ? null : r;
  }

  /** 4:05 under an hour, "1 h 05 min" over. */
  function dur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
  }

  function mockCard() {
    const run = activeRun();
    const p = run && OAMock.progress(S.data.sessions, run);
    const last = OAMock.runs(S.data.sessions).find((r) => r.done);
    const status = p ? `In progress: ${p.taken} of ${STAGE_COUNT} stages done · next <b>${esc(stageLabel(p.stages[p.next]))}</b>`
      : last ? `Last finished ${Q.dateFmt(last.endedAt)}` : '';
    return `<div class="card oa-mock-card">
        <div class="oa-head"><span class="oa-num">◆</span><div><h2>Full OA practice</h2><div class="sub">Every module, in Optiver's order</div></div></div>
        <p class="oa-about">Take all six modules one after another, with a break between stages for as long as you like. At the end, a report rates each module and lists what to work on.</p>
        <p class="oa-format">${STAGE_COUNT} stages · about ${Math.round(OAMock.totalMinutes() / 5) * 5} min of tests</p>
        ${status ? `<p class="oa-rec">${status}</p>` : ''}
        <div class="actions"><button class="btn primary" data-mock-open>${p ? 'Resume' : 'Start'}</button>${last ? `<button class="btn ghost" data-mock-report="${esc(last.id)}">Last report</button>` : ''}</div>
      </div>`;
  }

  function renderMock() {
    clearInterval(S.mockTimer);
    S.mockShownAt = performance.now();
    if (S.mockReport) return renderMockReport(S.mockReport);
    const run = activeRun();
    const p = run ? OAMock.progress(S.data.sessions, run) : null;
    const nextIdx = p ? p.next : 0;
    const rows = OAMock.STAGES.map((st, i) => {
      const s = p && p.stages[i].session;
      const cls = s ? ' done' : i === nextIdx ? ' next' : '';
      return `<li class="mk-stage${cls}"><span class="mk-dot">${s ? '✓' : i + 1}</span>
          <div class="mk-name"><b>${esc(stageLabel(st))}</b><div class="sub">${esc(OAMock.stageFormat(st))}</div></div>
          <span class="mk-state">${s ? `Done · ${dur(s.timeUsedMs || 0)}` : i === nextIdx ? 'Next' : ''}</span></li>`;
    }).join('');
    const st = OAMock.STAGES[nextIdx];
    const game = st.game && OAZap.GAMES.find((g) => g.id === st.game);
    const rules = game ? `${game.about} ${game.rules}` : OA.byId[st.module].rules;
    const onBreak = p && p.lastEnd;
    const history = OAMock.runs(S.data.sessions).filter((r) => r.done);
    $('view-oamock').innerHTML = `<div class="page-head"><div>
        <h1>Full OA practice</h1>
        <p class="lede">Each stage runs exactly like its Test. Between stages, rest as long as you like: your place is saved, even if you close the app. Quit a stage part-way and it starts over. Scores stay hidden until the report, as on the real assessment.</p>
      </div></div>
      <div class="mk-cols">
        <div class="card mk-next">
          <div class="hero-label">${p ? `Stage ${nextIdx + 1} of ${STAGE_COUNT}` : 'Ready when you are'}</div>
          <h2 class="mk-title">${esc(stageLabel(st))}</h2>
          <p class="oa-format">${esc(OAMock.stageFormat(st))}</p>
          <p class="oa-about">${esc(rules)}</p>
          ${onBreak ? `<p class="mk-break">On a break for <b id="mockBreak">${dur(Date.now() - p.lastEnd)}</b></p>` : ''}
          <div class="actions"><button class="btn primary" data-mock-go>${p ? `Start ${esc(st.name)}` : 'Begin with Beat the Odds'} <kbd>Enter</kbd></button>
            <button class="btn ghost" data-action="goto-oa">Back <kbd>Esc</kbd></button></div>
          ${p ? '<button class="btn ghost small mk-abandon" data-mock-abandon>Abandon this run</button>' : ''}
        </div>
        <div class="card"><h2>${p ? `${p.taken} of ${STAGE_COUNT} done` : 'The stages'}</h2><ol class="mk-stages">${rows}</ol></div>
      </div>
      ${history.length ? `<div class="card"><h2>Past reports</h2><ul class="plist">${history.map((r) => `<li><span class="q">${Q.dateFmt(r.endedAt)}</span>
          <span class="detail">${dur(r.endedAt - r.startedAt)} from first stage to last</span><button class="btn ghost small" data-mock-report="${esc(r.id)}">View report</button></li>`).join('')}</ul></div>` : ''}`;
    if (onBreak) {
      S.mockTimer = setInterval(() => {
        const el = $('mockBreak');
        if (S.view !== 'oamock' || !el) return clearInterval(S.mockTimer);
        el.textContent = dur(Date.now() - p.lastEnd);
      }, 1000);
    }
  }

  const badge = (k, cls = '') => (k == null ? `<span class="mk-badge none${cls}">Not taken</span>` : `<span class="mk-badge r${k}${cls}">${OAMock.RATINGS[k]}</span>`);

  function renderMockReport(id) {
    const r = OAMock.report(S.data.sessions, { id });
    if (!r) {
      S.mockReport = null;
      return renderMock();
    }
    const focus = r.findings.length ? `<ol class="mk-focus">${r.findings.map((f) => `<li>
          <div class="mk-f-head"><span class="mk-tag">${esc(f.name)}</span><b>${esc(f.title)}</b></div>
          <p class="sub">${esc(f.detail.replace(/\.$/, ''))}.</p>
          <p class="mk-action">${esc(f.action)}</p>
          ${f.module === 'zap' ? `<button class="btn ghost small" data-zap="${esc(f.stage.slice(4))}">Play ${esc(f.name.replace('Zap-N · ', ''))}</button>`
            : `<button class="btn ghost small" data-oa-start="${f.module}" data-mode="learn">Practise in Learn mode</button>`}
        </li>`).join('')}</ol>`
      : '<p class="empty-note">Nothing stood out: every module was on track or strong. Next time, aim to move the on-track ones up.</p>';
    const quizLine = (x) => {
      const extra = [x.late ? `${x.late} timed out` : '', x.unreached ? `${x.unreached} not reached` : ''].filter(Boolean).join(' · ');
      return `<p class="mk-line"><b>${OA.formatScore(x.score)}</b> of ${x.max}${x.module === 'iv' ? ' points' : ''}</p>
        <p class="mk-sub">${x.acc == null ? 'Nothing answered' : x.module === 'iv' ? `${Math.round(x.acc * 100)}% of ranges held the answer` : `${Math.round(x.acc * 100)}% of answers right`} · ${x.right} ${x.module === 'iv' ? 'contained' : 'right'} · ${x.wrong} ${x.module === 'iv' ? 'missed' : 'wrong'} · ${x.skipped} skipped</p>
        <p class="mk-sub">${dur(x.timeUsedMs)} of ${x.limitMs / 60000}:00${extra ? ` · ${extra}` : ''}</p>`;
    };
    const mods = r.modules.map((m) => {
      const body = !m.results.length ? '<p class="mk-sub">Not taken in this run.</p>'
        : m.id === 'zap' ? m.results.map((x) => `<div class="mk-game"><div class="mk-game-head"><b>${esc(x.name)}</b>${badge(x.rating, ' small')}</div><p class="mk-sub">${esc(x.line)}</p></div>`).join('')
          : quizLine(m.results[0]);
      const reviews = m.results.map((x) => `<button class="btn ghost small" data-mock-review="${esc(x.session.id)}">Review${m.id === 'zap' ? ` ${esc(x.name)}` : ''}</button>`).join('');
      return `<div class="card mk-mod"><div class="mk-mod-head"><h2>${esc(m.name)}</h2>${badge(m.rating)}</div>${body}${reviews ? `<div class="actions">${reviews}</div>` : ''}</div>`;
    }).join('');
    $('view-oamock').innerHTML = `
      <div class="card hero-card mk-hero">
        <div class="hero-label">Full OA practice · report${r.done ? '' : ` (${r.stagesDone} of ${STAGE_COUNT} stages)`}</div>
        <div class="mk-tally">${[2, 1, 0].map((k) => `<span class="mk-badge big r${k}">${r.tally[k]} ${OAMock.RATINGS[k].toLowerCase()}</span>`).join('')}</div>
        <p class="hero-sub">${Q.dateFmt(r.startedAt)} · ${dur(r.activeMs)} on the clock · ${dur(r.breakMs)} of breaks</p>
        <div class="actions"><button class="btn primary" data-mock-new>New full practice</button><button class="btn ghost" data-action="goto-oa">Back <kbd>Esc</kbd></button></div>
      </div>
      <div class="mk-cols report">
        <div class="card"><h2>Focus areas</h2><p class="sub mk-lede">Ranked by points lost. Each comes with what to practise.</p>${focus}</div>
        <div class="card"><h2>Going well</h2>${r.strengths.length ? `<ul class="plist">${r.strengths.map((s) => `<li><span class="detail">${esc(s)}</span></li>`).join('')}</ul>` : '<p class="empty-note">No module reached Strong this time.</p>'}</div>
      </div>
      <div class="mk-mods">${mods}</div>
      <p class="fine">Ratings use Zetapro's own guide marks, such as Strong at 60% of the maximum in Beat the Odds and NumberLogic. Optiver doesn't publish cut-offs.</p>`;
  }

  async function mockGo() {
    let run = activeRun();
    if (!run) {
      run = OAMock.newRun();
      await Q.saveSettings({ oaMock: run });
    }
    const p = OAMock.progress(S.data.sessions, run);
    const st = p.stages[p.next];
    const ctx = { run: run.id, stage: st.key };
    if (st.game) startZap(st.game, ctx);
    else start(st.module, false, ctx);
  }

  /** Back to the run after a stage: the next stage, or the report once all are done. */
  async function afterMockStage(ctx, aborted) {
    if (aborted) Q.toast('Stage stopped. It starts over when you are ready.');
    S.mockReport = null;
    if (OAMock.progress(S.data.sessions, { id: ctx.run }).done) {
      S.mockReport = ctx.run;
      if (S.data.settings.oaMock) await Q.saveSettings({ oaMock: null });
    }
    Q.show('oamock');
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-mock-open]') || e.target.closest('[data-action="goto-mock"]')) {
      if (!e.target.closest('[data-action="goto-mock"]')) S.mockReport = null;
      return Q.show('oamock');
    }
    const rep = e.target.closest('[data-mock-report]');
    if (rep) {
      S.mockReport = rep.dataset.mockReport;
      return Q.show('oamock');
    }
    if (e.target.closest('[data-mock-go]')) return mockGo();
    if (e.target.closest('[data-mock-new]')) {
      S.mockReport = null;
      return Q.show('oamock');
    }
    const rv = e.target.closest('[data-mock-review]');
    if (rv) return reviewRound(rv.dataset.mockReview, 'mock');
    if (e.target.closest('[data-mock-abandon]') && window.confirm('Abandon this run? Stages you finished stay in your stats, but this run will not get a report.')) {
      await Q.saveSettings({ oaMock: null });
      return renderMock();
    }
  });
  Q.registerKeys('oamock', (e) => {
    if (e.key === 'Escape') return Q.show('oa');
    // A held Enter from the last answer mustn't start the next stage.
    if (e.key === 'Enter' && !S.mockReport && performance.now() - (S.mockShownAt || 0) > 1000) {
      e.preventDefault();
      mockGo();
    }
  });
  Q.registerView('oamock', renderMock);

  Q.registerStats('oa', renderOAStats);

  // ---- events --------------------------------------------------------------------

  document.addEventListener('click', (e) => {
    const st = e.target.closest('[data-oa-start]');
    if (st) return start(st.dataset.oaStart, st.dataset.mode === 'learn');
    if (S.view === 'oaresults' && e.target.closest('[data-oa-again]') && S.oaLast) return again();
    if (e.target.closest('[data-action="goto-oa"]')) return Q.show('oa');
    if (e.target.closest('[data-action="goto-stats"]')) return Q.show('stats');
    const om = e.target.closest('[data-oas-module]');
    if (om && S.view === 'stats') {
      S.oaStatsModule = om.dataset.oasModule || null;
      Q.renderStats();
      return window.scrollTo(0, 0);
    }
    const rv = e.target.closest('[data-oas-review]');
    if (rv) return reviewRound(rv.dataset.oasReview);
    if (e.target.closest('[data-action="goto-e80"]')) return Q.show('e80');
    if (S.view !== 'oagame' || !S.oa) return;
    const ch = e.target.closest('[data-choice]');
    if (ch && !S.oa.reviewing) return submit(Number(ch.dataset.choice));
    const ri = e.target.closest('[data-rank-item]');
    if (ri) return rankPick(Number(ri.dataset.rankItem));
    const ob = e.target.closest('[data-ob]');
    if (ob) return obTrade(Number(ob.dataset.ob), Number(ob.dataset.dir));
    if (e.target.closest('[data-ob-reset]')) {
      S.oa.pos = S.oa.pos.map(() => 0);
      return drawBoard();
    }
    if (e.target.closest('[data-ob-submit]')) {
      const a = KINDS.board.answer();
      return a ? submit(a) : ($('obMsg').textContent = 'Stage some trades first.');
    }
    if (e.target.closest('[data-iv-submit]')) {
      const a = KINDS.interval.answer();
      return a ? submit(a) : Q.toast('Enter both a lower and an upper bound.');
    }
    if (e.target.closest('[data-rank-undo]')) {
      S.oa.rankSel = S.oa.rankSel.length === 3 ? S.oa.rankSel.slice(0, 1) : S.oa.rankSel.slice(0, -1);
      return drawRank();
    }
    if (e.target.closest('[data-rank-submit]') && S.oa.rankSel.length === 3) return submit(S.oa.rankSel.slice());
    if (e.target.closest('[data-oa-skip]')) return submit(null);
    if (e.target.closest('[data-oa-next]')) return next();
    if (e.target.closest('[data-oa-finish]')) return finish(false);
  });
  $('oaQuitBtn').addEventListener('click', () => finish(true));

  Q.registerKeys('oagame', (e) => {
    const g = S.oa;
    if (!g || g.done) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      return finish(true);
    }
    if (g.reviewing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        next();
      }
      return;
    }
    const q = g.qs[g.i];
    if (e.key === ' ' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      return submit(null);
    }
    if (q.kind === 'choice' && /^[1-9]$/.test(e.key) && Number(e.key) <= q.options.length) submit(Number(e.key) - 1);
    if (q.kind === 'board') {
      if (e.key === 'Enter') {
        e.preventDefault();
        const a = KINDS.board.answer();
        if (a) submit(a);
      } else if (e.key.toLowerCase() === 'r') {
        g.pos = g.pos.map(() => 0);
        drawBoard();
      }
    }
    if (q.kind === 'interval' && e.key === 'Enter') {
      e.preventDefault();
      const a = KINDS.interval.answer();
      if (a) submit(a);
      else if (e.target.id === 'ivLo') $('ivHi').focus();
      else Q.toast('Enter both a lower and an upper bound.');
    }
    if (q.kind === 'rank') {
      const i = { a: 0, b: 1, c: 2, 1: 0, 2: 1, 3: 2 }[e.key.toLowerCase()];
      if (i != null) rankPick(i);
      else if (e.key === 'Backspace') {
        g.rankSel = g.rankSel.length === 3 ? g.rankSel.slice(0, 1) : g.rankSel.slice(0, -1);
        drawRank();
      } else if (e.key === 'Enter' && g.rankSel.length === 3) {
        e.preventDefault();
        submit(g.rankSel.slice());
      }
    }
  });
  /** Play again: the same module and mode, or the same Zap-N game. */
  const again = () => (S.oaLast.zap ? startZap(S.oaLast.zap) : start(S.oaLast.id, S.oaLast.learn));

  Q.registerKeys('oaresults', (e) => {
    if (e.key === 'Escape') Q.show({ stats: 'stats', mock: 'oamock' }[S.oaBack] || 'oa');
    else if (e.key === 'Enter' && performance.now() - (S.oaResultsAt || 0) > 700 && S.oaLast) {
      e.preventDefault();
      again();
    }
  });
  Q.registerView('oa', renderHub);

  // Exposed for capture/automation runs only.
  window.__oa = { start, submit, finish, next, startZap, finishZap, mockGo };
})();
