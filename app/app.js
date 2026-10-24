(() => {
  'use strict';

  const E = window.Engine;
  const St = window.Stats;
  const X = window.E80;
  const C = window.Charts;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  // The web build can force a theme with data-theme; desktop follows the OS via Electron.
  const isDark = () => {
    const forced = document.documentElement.dataset.theme;
    return forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const S = {
    data: null,
    view: 'play',
    statsRange: 'd30',
    statsDrills: true,
    mapMetric: 'time',
    showAllCats: false,
    custom: new Set(),
    game: null,
    last: null,       // options of the last game, for "Try again"
    lastSession: null,
    resultsAt: 0,
  };

  // ---- helpers --------------------------------------------------------------

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  async function saveSettings(patch) {
    try {
      S.data.settings = await window.zm.updateSettings(patch);
      syncSoon(3000);
    } catch (e) {
      toast(`Couldn't save settings: ${e.message}`);
    }
  }

  const config = () => S.data.settings.config;
  const goals = () => S.data.settings.goals || { classic: 70, e80: 70 };
  /** "Hit 70 in 3 of your last 10" — consistency, not a one-off best. */
  function goalHtml(kind, scores) {
    const goal = goals()[kind];
    const last = scores.slice(-10);
    const hits = last.filter((v) => v >= goal).length;
    const avg = last.length ? last.reduce((t, v) => t + v, 0) / last.length : null;
    const pctHit = last.length ? hits / last.length : 0;
    const status = !last.length ? 'No games yet.'
      : hits === last.length && last.length >= 5 ? `Hit in all of your last ${last.length}. Consistent!`
      : `Hit in ${hits} of your last ${last.length}${avg != null && avg < goal ? ` · avg is ${(goal - avg).toFixed(1)} short` : ''}.`;
    return `<div class="goal">
        <div class="goal-head"><label class="goal-edit">Goal <input type="number" min="1" max="999" data-goal="${kind}" value="${goal}" aria-label="Goal score"></label>
          <span class="sub">${status}</span></div>
        <div class="goal-track" title="Share of your last 10 at or above the goal"><span style="width:${pctHit * 100}%"></span></div>
      </div>`;
  }
  const opBadge = (op) => `<span class="op" title="${esc(E.OP_NAME[op])}">${E.SYMBOL[op]}</span>`;

  /** Problems from the last 30 days, drills included — what drills are built from. */
  function recentProblems() {
    return St.flatten(St.selectSessions(S.data.sessions, { range: 'd30', drills: true }));
  }

  function show(view) {
    S.view = view;
    document.body.dataset.view = view;
    for (const sec of document.querySelectorAll('.view')) sec.classList.toggle('active', sec.id === `view-${view}`);
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === view);
    C.hideTip();
    if (view === 'play') renderPlay();
    else if (view === 'drill') renderDrill();
    else if (view === 'stats') renderStats();
    else if (view === 'e80') renderE80();
    if (view !== 'game') window.scrollTo(0, 0);
  }

  // ---- play (settings) -----------------------------------------------------

  function fillForm() {
    const c = config();
    for (const op of E.OPS) $(`op-${op}`).checked = c.ops[op];
    for (let i = 0; i < 4; i++) {
      $(`add${i}`).value = c.add[i];
      $(`mul${i}`).value = c.mul[i];
    }
    $('duration').value = String(c.duration);
    $('keypadMode').value = S.data.settings.keypad || 'auto';
    $('countdownOn').checked = S.data.settings.countdown !== false;
    syncRangeEnabled();
  }

  function syncRangeEnabled() {
    const addOn = $('op-add').checked || $('op-sub').checked;
    const mulOn = $('op-mul').checked || $('op-div').checked;
    for (let i = 0; i < 4; i++) {
      $(`add${i}`).disabled = !addOn;
      $(`mul${i}`).disabled = !mulOn;
    }
  }

  function readForm() {
    const c = config();
    const val = (id, fallback) => ($(id).value === '' ? fallback : $(id).value);
    return E.normalizeConfig({
      ops: Object.fromEntries(E.OPS.map((op) => [op, $(`op-${op}`).checked])),
      add: [0, 1, 2, 3].map((i) => val(`add${i}`, c.add[i])),
      mul: [0, 1, 2, 3].map((i) => val(`mul${i}`, c.mul[i])),
      duration: $('duration').value,
    });
  }

  async function onFormChange(e) {
    // Round options live in the same form but aren't part of the game config.
    if (e && e.target.id === 'keypadMode') return saveSettings({ keypad: e.target.value });
    if (e && e.target.id === 'countdownOn') return saveSettings({ countdown: e.target.checked });
    // Zetamac needs at least one operation; refuse to untick the last one.
    if (e && e.target.type === 'checkbox' && !E.OPS.some((op) => $(`op-${op}`).checked)) {
      e.target.checked = true;
      toast('Keep at least one operation switched on.');
    }
    syncRangeEnabled();
    await saveSettings({ config: readForm() });
    fillForm();
    renderPlaySide();
  }

  function renderPlay() {
    fillForm();
    renderPlaySide();
  }

  function renderPlaySide() {
    const fp = E.fingerprint(config());
    const sc = St.scoreSummary(S.data.sessions, fp);
    const rc = $('recordCard');
    if (!sc.games) {
      rc.innerHTML = `<h2>Your record</h2>
        <p class="empty-note">No games yet at these settings (${esc(E.describeConfig(config()))}). Your best and recent average will show here.</p>
        ${goalHtml('classic', [])}`;
    } else {
      rc.innerHTML = `<div class="card-head"><h2>Your record</h2><span class="sub">${esc(E.describeConfig(config()))}</span></div>
        <div class="record">
          <div><div class="mini-label">Best</div><div class="mini-value">${sc.best}</div></div>
          <div><div class="mini-label">Last 10 avg</div><div class="mini-value">${sc.recentAvg.toFixed(1)}</div></div>
          <div><div class="mini-label">Games</div><div class="mini-value">${sc.games}</div></div>
        </div>
        <div class="spark" id="playSpark"></div>
        ${goalHtml('classic', sc.history.map((h) => h.score))}`;
      C.sparkline($('playSpark'), sc.history.slice(-30).map((h) => h.score));
    }

    const fc = $('focusCard');
    const drill = St.smartDrill(recentProblems(), config(), 4);
    if (!drill) {
      fc.innerHTML = `<h2>What to work on</h2>
        <p class="empty-note">After a game or two, this lists the problem types that cost you the most time, with a one-click drill.</p>`;
      return;
    }
    fc.innerHTML = `<div class="card-head"><h2>What to work on</h2><span class="sub">last 30 days</span></div>
      <ul class="focus-list">${drill.rows.map((r) => `
        <li><span class="name">${esc(r.name)}</span>
        <span class="num" title="How much longer this type takes you than an average problem, with misses counted against it">${r.cost.toFixed(1)}×</span></li>`).join('')}
      </ul>
      <button class="btn" data-action="smart-drill">Drill these</button>`;
  }

  function startClassic() {
    const c = readForm();
    startGame({ mode: 'classic', plan: { kind: 'classic' }, config: c, duration: c.duration, label: null, returnTo: 'play' });
  }

  // ---- game ----------------------------------------------------------------

  function startGame(opts) {
    const cfg = E.normalizeConfig(opts.config);
    S.last = opts;
    S.game = {
      opts,
      config: cfg,
      next: E.createGenerator(opts.plan, cfg),
      problems: [],
      score: 0,
      startedAt: Date.now(),
      t0: 0,
      started: false,
      keypad: useKeypad(),
      durMs: opts.duration * 1000,
      cur: null,
      attempt: null,
      shownAt: 0,
      done: false,
      timer: 0,
    };
    show('game');
    $('gameLabel').textContent = opts.mode === 'drill' ? `Drill · ${opts.label}` : '';
    $('scoreLabel').textContent = 'Score: 0';
    const g = S.game;
    const input = $('answer');
    input.value = '';
    input.classList.remove('wrong');
    // The on-screen pad replaces the phone keyboard, so the input must not summon it.
    input.readOnly = g.keypad;
    input.inputMode = g.keypad ? 'none' : 'numeric';
    $('keypad').hidden = !g.keypad;
    $('view-game').classList.remove('hurry');
    $('problemText').textContent = '';
    $('secondsLeft').textContent = `Seconds left: ${opts.duration}`;
    $('timebar').style.transform = 'scaleX(1)';
    if (!g.keypad) input.focus(); // inside the tap, so phones raise their keyboard
    withCountdown(() => {
      g.started = true;
      g.t0 = performance.now();
      nextProblem();
      g.timer = setInterval(tick, 50);
      tick();
    });
  }

  function useKeypad() {
    const mode = S.data.settings.keypad || 'auto';
    return mode === 'on' || (mode === 'auto' && window.matchMedia('(pointer: coarse)').matches);
  }

  /** Optional 3-2-1 before a round; the clock starts when it ends. */
  function withCountdown(go) {
    if (S.data.settings.countdown === false) return go();
    const el = $('countdown');
    let n = 3;
    $('countdownNum').textContent = n;
    el.hidden = false;
    const t = setInterval(() => {
      n -= 1;
      if (n > 0) {
        $('countdownNum').textContent = n;
        return;
      }
      clearInterval(t);
      el.hidden = true;
      S.cancelCountdown = null;
      go();
    }, 700);
    S.cancelCountdown = () => {
      clearInterval(t);
      el.hidden = true;
      S.cancelCountdown = null;
    };
  }

  /** On-screen pad (and digit keys while it's showing). */
  function keypadPress(k) {
    const g = S.game;
    if (!g || !g.started || g.done) return;
    const input = $('answer');
    if (k === 'back') input.value = input.value.slice(0, -1);
    else if (k === 'clear') input.value = '';
    else if (/^\d$/.test(k) && input.value.length < 7) input.value += k;
    onAnswerInput();
  }

  function nextProblem() {
    const g = S.game;
    g.cur = g.next();
    g.attempt = E.createAttempt(g.cur);
    g.shownAt = performance.now();
    $('problemText').textContent = E.textOf(g.cur);
  }

  function tick() {
    const g = S.game;
    if (!g || g.done) return;
    const left = g.durMs - (performance.now() - g.t0);
    $('secondsLeft').textContent = `Seconds left: ${Math.max(0, Math.ceil(left / 1000))}`;
    $('view-game').classList.toggle('hurry', left <= 10000);
    $('timebar').style.transform = `scaleX(${Math.max(0, left / g.durMs)})`;
    if (left <= 0) finishGame(false);
  }

  function onAnswerInput() {
    const g = S.game;
    const input = $('answer');
    if (!g || g.done || !g.started) {
      input.value = '';
      return;
    }
    const clean = input.value.replace(/\D/g, '').slice(0, 7);
    if (clean !== input.value) input.value = clean;
    const r = g.attempt.input(clean);
    if (r === 'correct') {
      g.attempt.rec.ms = Math.round(performance.now() - g.shownAt);
      g.problems.push(g.attempt.rec);
      g.score++;
      $('scoreLabel').textContent = `Score: ${g.score}`;
      input.value = '';
      input.classList.remove('wrong');
      nextProblem();
    } else {
      input.classList.toggle('wrong', g.opts.mode === 'drill' && r === 'wrong');
    }
  }

  function onAnswerKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const g = S.game;
    if (!g || g.done) return;
    if (g.attempt.submit($('answer').value) === 'cleared') {
      $('answer').value = '';
      $('answer').classList.remove('wrong');
    }
  }

  async function finishGame(aborted) {
    if (S.cancelCountdown) S.cancelCountdown();
    const g = S.game;
    if (!g || g.done) return;
    g.done = true;
    clearInterval(g.timer);
    const rec = g.attempt ? g.attempt.rec : null;
    const session = {
      id: g.startedAt.toString(36) + Math.random().toString(36).slice(2, 7),
      at: g.startedAt,
      mode: g.opts.mode,
      label: g.opts.label || null,
      kind: g.opts.kind || null, // 'smart' for smart drills
      config: g.config,
      duration: g.opts.duration,
      score: g.score,
      aborted,
      problems: g.problems,
      unfinished: rec ? { ...rec, ms: Math.round(performance.now() - g.shownAt) } : null,
    };
    const before = St.scoreSummary(S.data.sessions, E.fingerprint(g.config));
    // A quit with nothing answered isn't worth a row; anything else is data.
    if (!aborted || g.problems.length) {
      try {
        await window.zm.addSession(session);
        rememberSession(session);
      } catch (e) {
        toast(`Couldn't save this game: ${e.message}`);
      }
    }
    S.game = null;
    if (aborted) {
      show(g.opts.returnTo || 'play');
      return;
    }
    renderResults(session, before);
    show('results');
  }

  // ---- results -------------------------------------------------------------

  function problemLine(p, right) {
    return `<span class="q">${esc(E.textOf(p))} = ${E.answerOf(p)}</span><span class="detail">${right || ''}</span>`;
  }

  /** "▲ 3.2 vs your recent average · 12 short of your 70 goal" */
  function deltaHtml(delta, unit, goal, score) {
    const parts = [];
    if (delta != null && Number.isFinite(delta)) {
      parts.push(`<span class="${delta >= 0 ? 'better' : 'worse'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}${unit}</span> vs your recent average`);
    }
    if (goal != null) {
      parts.push(score >= goal ? `<span class="better">Goal of ${goal} reached</span>` : `${goal - score} short of your ${goal} goal`);
    }
    return parts.join(' · ');
  }

  function renderResults(s, before) {
    S.lastSession = s;
    S.resultsAt = performance.now();
    const probs = St.flatten([s]);
    const all = St.agg(probs);
    $('resH1').textContent = 'Missed this round';
    $('resH2').textContent = 'Slowest this round';
    $('resH3').textContent = 'By operation';
    $('drillMissesBtn').textContent = "Drill this round's misses";

    $('resScore').textContent = s.score;
    const badge = $('resBadge');
    badge.hidden = true;
    if (s.mode === 'classic') {
      $('resLabel').textContent = `Score · ${E.describeConfig(s.config)}`;
      if (before.games && s.score > before.best) {
        badge.textContent = `New best (+${s.score - before.best})`;
        badge.hidden = false;
      } else if (s.score >= goals().classic) {
        badge.textContent = `Goal reached (${goals().classic})`;
        badge.hidden = false;
      }
      $('resSub').textContent = before.games
        ? `Previous best ${before.best} · recent average ${before.recentAvg.toFixed(1)}`
        : 'First game at these settings — this is your baseline.';
      $('resDelta').innerHTML = deltaHtml(before.games ? s.score - before.recentAvg : null, '', goals().classic, s.score);
    } else {
      // Drills vary in length, so they're scored by pace (problems per minute)
      // against earlier drills of the same kind.
      const pace = paceOf(s);
      const peers = drillPeers(s).map(paceOf);
      const best = peers.length ? Math.max(...peers) : null;
      const recent = peers.slice(-10);
      const recentAvg = recent.length ? recent.reduce((t, v) => t + v, 0) / recent.length : null;
      $('resLabel').textContent = `Drill · ${s.label} · problems per minute`;
      $('resScore').textContent = pace.toFixed(1);
      if (best != null && pace > best) {
        badge.textContent = `New best pace (+${(pace - best).toFixed(1)}/min)`;
        badge.hidden = false;
      }
      $('resSub').textContent = best != null
        ? `Previous best ${best.toFixed(1)}/min · recent average ${recentAvg.toFixed(1)}/min · ${s.score} solved in ${s.duration}s`
        : `First drill of this kind: ${s.score} solved in ${s.duration}s. This pace is your baseline.`;
      $('resDelta').innerHTML = deltaHtml(recentAvg != null ? pace - recentAvg : null, '/min', null);
    }

    const mistakes = probs.reduce((n, p) => n + p.errors, 0);
    $('resKpis').innerHTML = [
      ['First-try accuracy', all.n ? pct(all.accuracy) : '—'],
      ['Avg time / problem', all.n ? secs(all.meanMs) : '—'],
      ['Mistakes', String(mistakes)],
      ['Median time', all.n ? secs(all.medianMs) : '—'],
    ].map(([l, v]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

    const missed = probs.filter((p) => p.errors > 0);
    let missedHtml = missed.map((p) => {
      const kinds = [...new Set(p.wrong.map((w) => E.MISTAKE_INFO[E.mistakeKind(p, w)][0]))];
      return `<li>${problemLine(p, `typed <span class="typed">${p.wrong.map(esc).join(', ')}</span>${kinds.length ? ` · ${esc(kinds.join(', '))}` : ''}`)}<span class="t">${secs(p.ms)}</span></li>`;
    }).join('');
    if (s.unfinished && s.unfinished.ms > 1500) {
      missedHtml += `<li>${problemLine(s.unfinished, 'time ran out on this one')}<span class="t">${secs(s.unfinished.ms)}+</span></li>`;
    }
    $('resMissed').innerHTML = missedHtml
      ? `<ul class="plist">${missedHtml}</ul>`
      : '<p class="empty-note">No mistakes. Every answer went in clean.</p>';

    const slow = probs.slice().sort((x, y) => y.ms - x.ms).slice(0, 6);
    $('resSlow').innerHTML = slow.length
      ? `<ul class="plist">${slow.map((p) => `<li>${problemLine(p)}<span class="t">${secs(p.ms)}</span></li>`).join('')}</ul>`
      : '<p class="empty-note">Nothing answered.</p>';

    const ops = St.byOp(probs);
    $('resOps').innerHTML = ops.length
      ? `<ul class="plist">${ops.map((o) => `<li>${opBadge(o.op)}<span class="detail"><b>${o.name}</b><br>${o.n} solved · ${pct(o.accuracy)} first try</span><span class="t">${secs(o.meanMs)} avg</span></li>`).join('')}</ul>`
      : '<p class="empty-note">Nothing answered.</p>';

    const retry = retryListFromSession(s);
    $('drillMissesBtn').disabled = retry.length === 0;
  }

  /** This round's misses, the unfinished problem, and its slowest few. */
  function retryListFromSession(s) {
    const out = new Map();
    const add = (p) => out.set(E.keyOf(p), { op: p.op, a: p.a, b: p.b });
    s.problems.filter((p) => p.errors > 0).forEach(add);
    if (s.unfinished && s.unfinished.ms > 1500) add(s.unfinished);
    s.problems.slice().sort((x, y) => y.ms - x.ms).slice(0, 5).forEach(add);
    return [...out.values()];
  }

  function again() {
    if (!S.last) return;
    if (S.last.mode === 'e80') startE80(S.last);
    else startGame(S.last);
  }

  // ---- drills --------------------------------------------------------------

  function startDrill(plan, label, kind = null) {
    startGame({
      mode: 'drill',
      kind,
      plan,
      config: config(),
      duration: S.data.settings.drillDuration,
      label,
      returnTo: S.view === 'results' ? 'drill' : S.view,
    });
  }

  function drillKeys(keys, label) {
    startDrill({ kind: 'weights', weights: keys.map((key) => ({ key, w: 1 })) }, label);
  }

  function startSmartDrill() {
    const d = St.smartDrill(recentProblems(), config());
    if (!d) return toast('Play a game or two first so there is something to aim at.');
    startDrill({ kind: 'weights', weights: d.weights }, 'Smart mix', 'smart');
  }

  function startTroubleDrill() {
    const t = St.trouble(recentProblems(), 60);
    if (!t.rows.length) return toast('No trouble problems in the last 30 days.');
    startDrill({ kind: 'list', problems: t.rows }, 'Trouble problems');
  }

  function renderDrill() {
    const probs = recentProblems();
    const costs = Object.fromEntries(St.categories(probs).rows.filter((r) => !r.lowData).map((r) => [r.key, r.cost]));

    const smart = St.smartDrill(probs, config());
    $('smartCard').innerHTML = `<h2>Smart drill</h2>
      <p class="lede">A mix of your costliest problem types from the last 30 days. The worse a type is, the more often it comes up.</p>
      <div class="grow">${smart
        ? `<div class="chips">${smart.rows.map((r) => `<span class="chip">${esc(r.name)} <span class="c">${r.cost.toFixed(1)}×</span></span>`).join('')}</div>`
        : '<p class="empty-note">Not enough data yet. Play a classic game or two first.</p>'}</div>
      <div class="actions"><button class="btn primary" data-action="smart-drill" ${smart ? '' : 'disabled'}>Start smart drill</button></div>`;

    const t = St.trouble(probs, 60);
    $('retryCard').innerHTML = `<h2>Trouble problems</h2>
      <p class="lede">The exact problems you got wrong, or took twice your usual time on, in the last 30 days. They come round again until they're automatic.</p>
      <div class="grow">${t.rows.length
        ? `<div class="chips">${t.rows.slice(0, 10).map((r) => `<span class="chip">${esc(r.text)}</span>`).join('')}${t.rows.length > 10 ? `<span class="chip"><span class="c">+${t.rows.length - 10} more</span></span>` : ''}</div>`
        : '<p class="empty-note">None yet. Misses and slow answers will collect here.</p>'}
        ${t.retired.length ? `<p class="sub" style="margin-top:10px">${t.retired.length} mastered and retired (right and quick ${St.RETIRE_AFTER} times in a row since the last slip).</p>` : ''}</div>
      <div class="actions"><button class="btn primary" data-action="trouble-drill" ${t.rows.length ? '' : 'disabled'}>Drill ${t.rows.length || ''} problem${t.rows.length === 1 ? '' : 's'}</button></div>`;

    const groups = E.allCategories();
    const chip = (key) => {
      const info = E.categoryInfo(key);
      const c = costs[key];
      return `<button class="chip ${S.custom.has(key) ? 'on' : ''}" data-action="toggle-custom" data-key="${key}" title="e.g. ${esc(info.example)}">${esc(info.short)}${c ? ` <span class="c">${c.toFixed(1)}×</span>` : ''}</button>`;
    };
    const n = S.custom.size;
    $('customCard').innerHTML = `<div class="card-head"><h2>Pick your own</h2><span class="sub">Numbers show how much longer each type takes you than an average problem (1.0× = average)</span></div>
      ${E.OPS.map((op) => `<div class="pick-group"><div class="g">${E.OP_NAME[op]}</div><div class="chips">${groups[op].map(chip).join('')}</div></div>`).join('')}
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" data-action="custom-drill" ${n ? '' : 'disabled'}>Start drill${n ? ` (${n} type${n === 1 ? '' : 's'})` : ''}</button>
        ${n ? '<button class="btn ghost" data-action="clear-custom">Clear</button>' : ''}
      </div>`;
    renderSmartStats();
  }

  // Older smart drills predate the `kind` tag; their label identifies them.
  const isSmartDrill = (s) => s.mode === 'drill' && !s.aborted && (s.kind === 'smart' || s.label === 'Smart mix');
  const paceOf = (s) => s.score / (s.duration / 60);

  /** Earlier finished drills comparable with `s`: smart with smart, others by name. */
  function drillPeers(s) {
    const smart = isSmartDrill(s);
    return S.data.sessions.filter((x) => x.id !== s.id && x.mode === 'drill' && !x.aborted && x.at < s.at
      && (smart ? isSmartDrill(x) : !isSmartDrill(x) && x.label === s.label));
  }

  /** Stats for smart-drill rounds only: pace over time, and how each targeted type is moving. */
  function renderSmartStats() {
    const card = $('smartStatsCard');
    const drills = S.data.sessions.filter(isSmartDrill);
    if (!drills.length) {
      card.innerHTML = `<h2>Smart drill stats</h2>
        <p class="empty-note">Your smart drills will be tracked here: pace per round, and whether each targeted type is getting faster.</p>`;
      return;
    }
    const probs = St.flatten(drills);
    const all = St.agg(probs);
    // Drill length can change, so rounds are compared by problems solved per minute.
    const pace = drills.map((s, i) => ({ value: Math.round((s.score / (s.duration / 60)) * 10) / 10, label: i + 1, at: s.at, score: s.score, duration: s.duration }));
    const avg = (list) => list.reduce((t, p) => t + p.value, 0) / list.length;
    const recentPace = avg(pace.slice(-5));

    const inMix = new Set(((St.smartDrill(recentProblems(), config()) || {}).rows || []).map((r) => r.key));
    const byCat = {};
    for (const p of probs) (byCat[p.cls.cat] = byCat[p.cls.cat] || []).push(p);
    const rows = Object.entries(byCat).map(([key, list]) => {
      // Trend: average time over the later half of attempts minus the earlier half.
      let trend = null;
      if (list.length >= 6) {
        const half = Math.floor(list.length / 2);
        trend = St.agg(list.slice(half)).meanMs - St.agg(list.slice(0, half)).meanMs;
      }
      return { ...E.categoryInfo(key), ...St.agg(list), trend, live: inMix.has(key) };
    });
    rows.sort((x, y) => (y.live - x.live) || (y.n - x.n));
    const trendText = (t) => (t == null
      ? '<span class="muted" title="Needs 6+ attempts">—</span>'
      : `<span class="${t <= 0 ? 'better' : 'worse'}">${t <= 0 ? '▼' : '▲'} ${secs(Math.abs(t))}</span>`);
    const tile = (label, value, note) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
    const live = rows.filter((r) => r.live).length;

    card.innerHTML = `<div class="card-head"><h2>Smart drill stats</h2><span class="sub">${drills.length} round${drills.length === 1 ? '' : 's'} · all time</span></div>
      <div class="tiles four">
        ${tile('Pace', `${recentPace.toFixed(1)}/min`, `last ${Math.min(5, pace.length)} avg · best ${Math.max(...pace.map((p) => p.value)).toFixed(1)}/min`)}
        ${tile('First-try accuracy', pct(all.accuracy), `${all.n - all.errN} of ${all.n} problems`)}
        ${tile('Avg time / problem', secs(all.meanMs), `median ${secs(all.medianMs)}`)}
        ${tile('Types graduated', rows.length - live, `${live} still in the mix`)}
      </div>
      ${pace.length > 1 ? '<h3 class="mini-h">Pace per round</h3><div class="chart" id="smartChart"></div>' : ''}
      <h3 class="mini-h">Types it has drilled</h3>
      <table class="cats">
        <thead><tr><th>Problem type</th><th class="num">Seen</th><th class="num">First try</th><th class="num">Avg time</th><th class="num">Trend</th><th>Status</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td><div>${esc(r.name)}</div><div class="ex">e.g. ${esc(r.example)}</div></td>
          <td class="num">${r.n}</td><td class="num">${pct(r.accuracy)}</td><td class="num">${secs(r.meanMs)}</td>
          <td class="num">${trendText(r.trend)}</td>
          <td>${r.live ? '<span class="tag live">In the mix</span>' : '<span class="tag done">Graduated</span>'}</td></tr>`).join('')}</tbody>
      </table>
      <p class="fine">Trend compares your later attempts at a type with your earlier ones (▼ = faster). Graduated types have dropped out of your 6 costliest, so smart drills stop serving them.</p>`;
    if (pace.length > 1) {
      C.lineChart($('smartChart'), pace, {
        height: 200,
        xLabel: (p) => `#${p.label}`,
        tipHtml: (p) => `<b>Round ${p.label}</b> · ${esc(dateFmt.format(p.at))}<br><b>${p.value}</b>/min (${p.score} in ${p.duration}s)`,
      });
    }
  }

  function startCustomDrill() {
    const keys = [...S.custom];
    if (!keys.length) return;
    const names = keys.map((k) => E.categoryInfo(k).name);
    const label = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
    drillKeys(keys, label);
  }

  // ---- stats ---------------------------------------------------------------

  function renderRangeSeg() {
    $('rangeSeg').innerHTML = St.RANGES.map((r) =>
      `<button data-range="${r.key}" class="${S.statsRange === r.key ? 'on' : ''}">${r.label}</button>`).join('');
    $('incDrills').checked = S.statsDrills;
  }

  function renderStats() {
    renderRangeSeg();
    const body = $('statsBody');
    const sessions = St.selectSessions(S.data.sessions, { range: S.statsRange, drills: S.statsDrills });
    const probs = St.flatten(sessions);
    if (!probs.length) {
      body.innerHTML = `<div class="card empty"><h2>No games in this range yet</h2>
        <p>Play a round and this page breaks down which kinds of problems cost you time and where your mistakes come from.</p>
        <div class="actions" style="justify-content:center;margin-top:16px"><button class="btn primary" data-action="goto-play">Play a game</button></div></div>`;
      return;
    }

    const fp = E.fingerprint(config());
    const sc = St.scoreSummary(sessions, fp);
    const overall = St.agg(probs);
    const cats = St.categories(probs);
    const fm = St.factorMap(probs);
    const mk = St.mistakes(probs);
    const tr = St.trouble(probs, 15);
    const drills = sessions.filter((s) => s.mode === 'drill').length;

    const tile = (label, value, note) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
    const tiles = [
      tile('Games', sessions.length, drills ? `${sessions.length - drills} classic · ${drills} drill` : 'all classic'),
      tile('Best score', sc.best ?? '—', esc(E.describeConfig(config()))),
      tile('Average score', sc.recentAvg != null ? sc.recentAvg.toFixed(1) : '—', sc.games ? `last ${Math.min(10, sc.games)} classic · goal ${goals().classic}` : `goal ${goals().classic}`),
      tile('First-try accuracy', pct(overall.accuracy), `${overall.n - overall.errN} of ${overall.n} problems`),
      tile('Avg time / problem', secs(overall.meanMs), `median ${secs(overall.medianMs)}`),
    ].join('');

    const visible = S.showAllCats ? cats.rows : cats.rows.slice(0, 10);
    const maxCost = Math.max(1.5, ...cats.rows.map((r) => r.cost));
    const catRows = visible.map((r) => {
      const tip = `${r.name}\n${r.n} problems · ${pct(r.accuracy)} first try\navg ${secs(r.meanMs)} · median ${secs(r.medianMs)}`;
      return `<tr class="${r.lowData ? 'thin' : ''}">
        <td><div class="who"><div><div>${esc(r.name)}${r.lowData ? '<span class="tag">few samples</span>' : ''}</div><div class="ex">e.g. ${esc(r.example)}</div></div></div></td>
        <td class="num">${r.n}</td>
        <td class="num">${pct(r.accuracy)}</td>
        <td class="num">${secs(r.meanMs)}</td>
        <td class="costcell"><div class="cost" data-tip="${esc(tip)}">
          <div class="track"><div class="fill" style="width:${(r.cost / maxCost) * 100}%"></div><div class="avg" style="left:${(1 / maxCost) * 100}%"></div></div>
          <span class="v">${r.cost.toFixed(1)}×</span></div></td>
        <td><button class="btn small" data-action="drill-key" data-key="${r.key}" data-label="${esc(r.name)}">Drill</button></td>
      </tr>`;
    }).join('');

    const html = `
      <div class="tiles">${tiles}</div>

      <div class="card">
        <div class="card-head"><h2>Score per game</h2><span class="sub">Classic games at your current settings · ${esc(E.describeConfig(config()))}</span></div>
        ${sc.history.length ? '<div class="chart" id="scoreChart"></div>' : '<p class="empty-note">No classic games at these settings in this range. Change the range, or play one.</p>'}
      </div>

      <div class="card">
        <div class="card-head"><h2>Where you lose time</h2>
          <span class="sub">Slowdown: how much longer a type takes you than your average problem, with misses counted against it. The line in each bar marks 1.0×, your average.</span></div>
        <table class="cats">
          <thead><tr><th>Problem type</th><th class="num">Seen</th><th class="num">First try</th><th class="num">Avg time</th><th>Slowdown</th><th></th></tr></thead>
          <tbody>${catRows}</tbody>
        </table>
        ${cats.rows.length > 10 ? `<div class="more-row"><button class="btn link" data-action="toggle-cats">${S.showAllCats ? 'Show top 10' : `Show all ${cats.rows.length} types`}</button></div>` : ''}
      </div>

      <div class="stats-cols">
        <div class="card">
          <div class="card-head"><h2>Factor map</h2>
            <div class="seg" id="metricSeg">
              <button data-metric="time" class="${S.mapMetric === 'time' ? 'on' : ''}">Avg time</button>
              <button data-metric="errors" class="${S.mapMetric === 'errors' ? 'on' : ''}">Miss rate</button>
            </div></div>
          <p class="sub" style="margin:-4px 0 12px">Multiplication and division by factor. Click a cell to drill it, or a factor to drill all four.</p>
          ${factorMapHtml(fm)}
        </div>
        <div class="card">
          <div class="card-head"><h2>Mistake patterns</h2><span class="sub">${mk.total} wrong entr${mk.total === 1 ? 'y' : 'ies'}</span></div>
          ${mistakesHtml(mk)}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Trouble problems</h2>
          ${tr.count ? `<button class="btn" data-action="trouble-drill-range">Drill all ${tr.all.length}</button>` : ''}</div>
        ${tr.rows.length ? `<p class="sub" style="margin:-4px 0 10px">Missed, or at least twice your usual time for that type. Worst first.</p>
          <div class="trouble">${troubleColumns(tr.rows)}</div>`
        : '<p class="empty-note">Nothing here: no misses and no unusually slow answers in this range.</p>'}
      </div>`;

    body.innerHTML = html;
    S.statsTrouble = tr.all;

    if (sc.history.length) {
      C.lineChart($('scoreChart'), sc.history.map((h) => ({ value: h.score, label: h.i, at: h.at })), {
        xLabel: (p) => `#${p.label}`,
        ref: { value: goals().classic, label: `goal ${goals().classic}`, goal: true },
        tipHtml: (p) => `<b>Game ${p.label}</b> · ${esc(dateFmt.format(p.at))}<br>Score <b>${p.value}</b>`,
      });
    }
  }

  function factorMapHtml(fm) {
    const metric = S.mapMetric;
    const dark = isDark();
    const val = (c) => (metric === 'time' ? c.meanMs : c.errRate);
    const present = Object.entries(fm.cells).filter(([k, c]) => c.n > 0 && fm.cols.some((col) => k.startsWith(`${col.key}.`)));
    if (!present.length) return '<p class="empty-note">No multiplication or division in this range.</p>';
    const vals = present.map(([, c]) => val(c));
    const lo = metric === 'time' ? Math.min(...vals) : 0;
    const hi = metric === 'time' ? Math.max(...vals) : Math.max(0.25, ...vals);
    const fmt = (v) => (metric === 'time' ? (v / 1000).toFixed(1) : pct(v));

    let h = '<div class="hm"><div></div>';
    h += fm.cols.map((c) => `<div class="colh">${c.label}<small>${c.hint}</small></div>`).join('');
    for (const f of fm.factors) {
      h += `<button class="rowh" data-action="drill-factor" data-factor="${f}" title="Drill every × and ÷ with ${f}">${f}</button>`;
      for (const col of fm.cols) {
        const key = `${col.key}.${f}`;
        const c = fm.cells[key];
        if (!c) {
          h += '<div class="hm-cell hm-none" aria-hidden="true">·</div>';
          continue;
        }
        const { bg, fg } = C.heatColor(hi > lo ? (val(c) - lo) / (hi - lo) : 0.5, dark);
        const info = E.categoryInfo(key);
        const tip = `${info.name}\n${c.n} problem${c.n === 1 ? '' : 's'} · avg ${secs(c.meanMs)}\n${pct(c.accuracy)} first try${c.n < 3 ? '\n(few samples)' : ''}`;
        h += `<button class="hm-cell ${c.n < 3 ? 'thin' : ''}" style="background:${bg};color:${fg}" data-action="drill-key" data-key="${key}" data-label="${esc(info.name)}" data-tip="${esc(tip)}">${fmt(val(c))}</button>`;
      }
    }
    h += '</div>';
    h += `<div class="legend"><span>${metric === 'time' ? 'Faster' : 'Fewer misses'} ${fmt(lo)}${metric === 'time' ? 's' : ''}</span>
      <span class="ramp" style="background:${C.rampGradient(dark)}"></span>
      <span>${fmt(hi)}${metric === 'time' ? 's' : ''} ${metric === 'time' ? 'slower' : 'more misses'}</span></div>`;
    return h;
  }

  function mistakesHtml(mk) {
    if (!mk.total) return '<p class="empty-note">No wrong entries in this range.</p>';
    const max = Math.max(...mk.rows.map((r) => r.count));
    return `<ul class="mk">${mk.rows.map((r) => {
      const eg = r.examples[0];
      return `<li><div class="row1" data-tip="${esc(`${r.label}\n${r.help}`)}">
          <span class="label">${esc(r.label)}</span>
          <div class="track"><div class="fill" style="width:${(r.count / max) * 100}%"></div></div>
          <span class="n">${r.count}</span></div>
        <div class="eg">e.g. ${esc(eg.text)} = ${eg.answer}, typed <span class="typed">${esc(eg.wrong)}</span></div></li>`;
    }).join('')}</ul>`;
  }

  function troubleColumns(rows) {
    const per = Math.ceil(rows.length / 3);
    const cols = [rows.slice(0, per), rows.slice(per, per * 2), rows.slice(per * 2)];
    return cols.map((list) => `<ul class="plist">${list.map((t) => {
      const bits = [];
      if (t.missed) bits.push(`missed ${t.missed}/${t.seen}`);
      if (t.wrong.length) bits.push(`typed <span class="typed">${t.wrong.map(esc).join(', ')}</span>`);
      if (!t.missed) bits.push(`slow ${t.slow}/${t.seen}`);
      return `<li><span class="q">${esc(t.text)} = ${t.answer}</span><span class="detail">${bits.join(' · ')}</span><span class="t">${secs(t.meanMs)}</span></li>`;
    }).join('')}</ul>`).join('');
  }

  // ---- 80 in 8 -------------------------------------------------------------

  const e80Settings = () => ({ penalty: 1, allowSkip: false, ...(S.data.settings.e80 || {}) });
  const signed = (n) => (n < 0 ? `−${-n}` : String(n));
  // '357 ÷ ? = 51' already has its '='; show the answer after an arrow instead.
  const withAnswer = (p) => (p.q.includes('?') ? `${esc(p.q)} → ${esc(p.o[p.a])}` : `${esc(p.q)} = ${esc(p.o[p.a])}`);
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function renderE80() {
    const st = e80Settings();
    $('e80Penalty').value = String(st.penalty);
    $('e80Skip').checked = st.allowSkip;

    const sum = X.summary(S.data.sessions, st.penalty);
    const rc = $('e80Record');
    if (!sum.games) {
      rc.innerHTML = `<h2>Your record</h2>
        <p class="empty-note">No attempts yet with −${st.penalty} per wrong answer. The most-reported pass line is about ${X.PASS_LINE} net.</p>
        ${goalHtml('e80', [])}`;
    } else {
      rc.innerHTML = `<div class="card-head"><h2>Your record</h2><span class="sub">−${st.penalty} per wrong</span></div>
        <div class="record">
          <div><div class="mini-label">Best net</div><div class="mini-value">${signed(sum.best)}</div></div>
          <div><div class="mini-label">Last 10 avg</div><div class="mini-value">${sum.recentAvg.toFixed(1)}</div></div>
          <div><div class="mini-label">Attempts</div><div class="mini-value">${sum.games}</div></div>
        </div>
        <div class="spark" id="e80Spark"></div>
        ${goalHtml('e80', sum.history.map((h) => h.score))}
        <p class="sub" style="margin-top:8px">Reported pass line: about ${X.PASS_LINE} net.</p>`;
      C.sparkline($('e80Spark'), sum.history.slice(-30).map((h) => h.score));
    }

    const probs = X.flatten(S.data.sessions);
    const weak = X.weakPlan(probs);
    $('e80Focus').innerHTML = weak
      ? `<div class="card-head"><h2>Weakest question types</h2><span class="sub">all attempts</span></div>
        <ul class="focus-list">${weak.rows.map((r) => `
          <li><span class="name">${esc(r.name)}</span><span class="num">${pct(r.accuracy)} · ${secs(r.meanMs)}</span></li>`).join('')}
        </ul>
        <button class="btn" data-action="e80-practice-weak">Practice these</button>`
      : `<h2>Weakest question types</h2>
        <p class="empty-note">After an attempt, this lists the question types that cost you the most, with a practice round built from them.</p>`;

    const body = $('e80Body');
    if (!probs.length) {
      body.innerHTML = '';
      return;
    }
    const { rows } = X.byType(probs);
    const maxCost = Math.max(1.5, ...rows.map((r) => r.cost));
    const typeRows = rows.map((r) => {
      const tip = `${r.name}\n${r.n} seen · ${r.ok} right · ${r.wrong} wrong${r.skipped ? ` · ${r.skipped} skipped` : ''}\navg ${secs(r.meanMs)}`;
      return `<tr class="${r.lowData ? 'thin' : ''}">
        <td><div>${esc(r.name)}${r.lowData ? '<span class="tag">few samples</span>' : ''}</div><div class="ex">e.g. ${esc(r.example)}</div></td>
        <td class="num">${r.n}</td>
        <td class="num">${pct(r.accuracy)}</td>
        <td class="num">${secs(r.meanMs)}</td>
        <td class="costcell"><div class="cost" data-tip="${esc(tip)}">
          <div class="track"><div class="fill" style="width:${(r.cost / maxCost) * 100}%"></div><div class="avg" style="left:${(1 / maxCost) * 100}%"></div></div>
          <span class="v">${r.cost.toFixed(1)}×</span></div></td>
        <td><button class="btn small" data-action="e80-practice-type" data-key="${r.key}" data-label="${esc(r.name)}">Practice</button></td>
      </tr>`;
    }).join('');

    const wrong = probs.filter((p) => !p.ok).slice(-12).reverse();
    const wrongHtml = wrong.length
      ? `<div class="trouble">${[0, 1, 2].map((col) => `<ul class="plist">${wrong.filter((_, i) => i % 3 === col).map((p) => `
          <li><span class="q">${withAnswer(p)}</span>
          <span class="detail">${p.skipped ? 'skipped' : `picked <span class="typed">${esc(p.o[p.c])}</span>`}</span>
          <span class="t">${secs(p.ms)}</span></li>`).join('')}</ul>`).join('')}</div>`
      : '<p class="empty-note">No wrong answers yet.</p>';

    body.innerHTML = `
      ${sum.history.length ? `<div class="card" style="margin-top:16px">
        <div class="card-head"><h2>Net score per attempt</h2><span class="sub">Real attempts at −${st.penalty} per wrong · practice rounds excluded</span></div>
        <div class="chart" id="e80Chart"></div></div>` : ''}
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>By question type</h2>
          <span class="sub">Slowdown: how much longer a type takes you than your average question, with wrong answers counted against it. Practice rounds included.</span></div>
        <table class="cats">
          <thead><tr><th>Question type</th><th class="num">Seen</th><th class="num">Right</th><th class="num">Avg time</th><th>Slowdown</th><th></th></tr></thead>
          <tbody>${typeRows}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent wrong answers</h2><span class="sub">newest first</span></div>
        ${wrongHtml}
      </div>`;

    if (sum.history.length) {
      C.lineChart($('e80Chart'), sum.history.map((h) => ({ value: h.score, label: h.i, at: h.at })), {
        xLabel: (p) => `#${p.label}`,
        ref: [{ value: X.PASS_LINE, label: `reported pass ≈ ${X.PASS_LINE}` }, { value: goals().e80, label: `goal ${goals().e80}`, goal: true }],
        tipHtml: (p) => `<b>Attempt ${p.label}</b> · ${esc(dateFmt.format(p.at))}<br>Net <b>${signed(p.value)}</b>`,
      });
    }
  }

  /** opts: { practice, weights?, label?, returnTo } */
  function startE80(opts) {
    const st = e80Settings();
    S.last = { ...opts, mode: 'e80' };
    S.e80 = {
      opts: S.last,
      settings: st,
      next: X.createGenerator(opts.weights ? { weights: opts.weights } : null),
      recs: [],
      cur: null,
      shownAt: 0,
      startedAt: Date.now(),
      t0: 0,
      durMs: X.SECONDS * 1000,
      done: false,
      paused: false,
      timer: 0,
    };
    show('e80game');
    $('e80Label').textContent = opts.practice ? `Practice · ${opts.label}` : '';
    $('e80Hint').innerHTML = `<kbd>1</kbd>–<kbd>4</kbd> to answer${st.allowSkip ? ' · <kbd>Space</kbd> to skip' : ''} · <kbd>Esc</kbd> to quit`;
    const g = S.e80;
    $('view-e80game').classList.remove('hurry');
    $('e80Question').textContent = '';
    $('e80Opts').innerHTML = '';
    $('e80Time').textContent = `Time left ${clock(X.SECONDS * 1000)}`;
    $('e80Timebar').style.transform = 'scaleX(1)';
    withCountdown(() => {
      g.t0 = performance.now();
      nextE80();
      g.timer = setInterval(tickE80, 100);
      tickE80();
    });
  }

  function nextE80() {
    const g = S.e80;
    g.cur = g.next();
    g.shownAt = performance.now();
    $('e80Question').textContent = g.cur.text;
    $('e80Opts').innerHTML = g.cur.options.map((o, i) =>
      `<button class="e80-opt" tabindex="-1" data-pick="${i}"><span class="key">${i + 1}</span>${esc(o)}</button>`).join('');
    $('e80Count').textContent = `Question ${g.recs.length + 1} of ${X.QUESTIONS}`;
  }

  function tickE80() {
    const g = S.e80;
    if (!g || g.done) return;
    const left = g.durMs - (performance.now() - g.t0);
    $('e80Time').textContent = `Time left ${clock(Math.ceil(left / 1000) * 1000)}`;
    $('view-e80game').classList.toggle('hurry', left <= 30000);
    $('e80Timebar').style.transform = `scaleX(${Math.max(0, left / g.durMs)})`;
    if (left <= 0) finishE80(false);
  }

  /** i: option index, or null to skip. */
  function pickE80(i) {
    const g = S.e80;
    if (!g || g.done || g.paused || !g.cur) return;
    g.recs.push({ t: g.cur.type, q: g.cur.text, o: g.cur.options, a: g.cur.correct, c: i, ms: Math.round(performance.now() - g.shownAt) });
    const advance = () => {
      if (g.done) return;
      if (g.recs.length >= X.QUESTIONS) finishE80(false);
      else nextE80();
    };
    // Practice rounds flash the right answer after a miss; the clock keeps running.
    if (g.opts.practice && i != null && i !== g.cur.correct) {
      g.paused = true;
      const btns = $('e80Opts').children;
      btns[i].classList.add('bad');
      btns[g.cur.correct].classList.add('good');
      setTimeout(() => {
        g.paused = false;
        advance();
      }, 700);
      return;
    }
    advance();
  }

  function onE80Key(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      finishE80(true);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    if (e.repeat) return;
    const idx = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 }[e.key.toLowerCase()];
    if (idx != null) pickE80(idx);
    else if (e.key === ' ' && S.e80 && S.e80.settings.allowSkip) pickE80(null);
  }

  async function finishE80(aborted) {
    if (S.cancelCountdown) S.cancelCountdown();
    const g = S.e80;
    if (!g || g.done) return;
    g.done = true;
    clearInterval(g.timer);
    const sc = X.score(g.recs, g.settings.penalty);
    const session = {
      id: g.startedAt.toString(36) + Math.random().toString(36).slice(2, 7),
      at: g.startedAt,
      mode: 'e80',
      practice: !!g.opts.practice,
      label: g.opts.label || null,
      settings: { penalty: g.settings.penalty, allowSkip: g.settings.allowSkip },
      questions: X.QUESTIONS,
      seconds: X.SECONDS,
      timeUsedMs: Math.min(g.durMs, Math.round(performance.now() - g.t0)),
      score: sc.net,
      right: sc.right,
      wrong: sc.wrong,
      skipped: sc.skipped,
      aborted,
      problems: g.recs,
    };
    const before = X.summary(S.data.sessions, g.settings.penalty);
    if (!aborted || g.recs.length) {
      try {
        await window.zm.addSession(session);
        rememberSession(session);
      } catch (e) {
        toast(`Couldn't save this attempt: ${e.message}`);
      }
    }
    S.e80 = null;
    if (aborted) {
      show(g.opts.returnTo || 'e80');
      return;
    }
    renderE80Results(session, before);
    show('results');
  }

  function renderE80Results(s, before) {
    S.lastSession = s;
    S.resultsAt = performance.now();
    const probs = X.flatten([s]);
    const answered = s.right + s.wrong;

    $('resLabel').textContent = s.practice ? `80 in 8 practice · ${s.label}` : `80 in 8 · net score, −${s.settings.penalty} per wrong`;
    $('resScore').textContent = signed(s.score);
    const badge = $('resBadge');
    badge.hidden = true;
    if (!s.practice && before.games && s.score > before.best) {
      badge.textContent = `New best (+${s.score - before.best})`;
      badge.hidden = false;
    } else if (!s.practice && s.score >= goals().e80) {
      badge.textContent = `Goal reached (${goals().e80})`;
      badge.hidden = false;
    } else if (!s.practice && s.score >= X.PASS_LINE) {
      badge.textContent = 'Above the reported pass line';
      badge.hidden = false;
    }
    const bits = [`${s.right} right`, `${s.wrong} wrong`];
    if (s.skipped) bits.push(`${s.skipped} skipped`);
    bits.push(`${s.problems.length} of ${s.questions} reached`);
    if (!s.practice) bits.push(before.games ? `previous best ${signed(before.best)}` : `reported pass line ≈ ${X.PASS_LINE}`);
    $('resSub').textContent = bits.join(' · ');
    $('resDelta').innerHTML = s.practice ? '' : deltaHtml(before.games ? s.score - before.recentAvg : null, '', goals().e80, s.score);

    const meanMs = probs.length ? probs.reduce((t, p) => t + p.ms, 0) / probs.length : 0;
    $('resKpis').innerHTML = [
      ['Accuracy', answered ? pct(s.right / answered) : '—'],
      ['Avg time / question', probs.length ? secs(meanMs) : '—'],
      ['Reached', `${s.problems.length} / ${s.questions}`],
      ['Time used', clock(s.timeUsedMs)],
    ].map(([l, v]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

    $('resH1').textContent = 'Wrong answers';
    $('resH2').textContent = 'Slowest';
    $('resH3').textContent = 'By question type';
    const line = (p, detail) => `<li><span class="q">${withAnswer(p)}</span><span class="detail">${detail || ''}</span><span class="t">${secs(p.ms)}</span></li>`;
    const wrong = probs.filter((p) => !p.ok);
    $('resMissed').innerHTML = wrong.length
      ? `<ul class="plist">${wrong.map((p) => line(p, p.skipped ? 'skipped' : `picked <span class="typed">${esc(p.o[p.c])}</span>`)).join('')}</ul>`
      : '<p class="empty-note">No wrong answers.</p>';
    const slow = probs.slice().sort((x, y) => y.ms - x.ms).slice(0, 6);
    $('resSlow').innerHTML = slow.length ? `<ul class="plist">${slow.map((p) => line(p)).join('')}</ul>` : '<p class="empty-note">Nothing answered.</p>';
    const { rows } = X.byType(probs);
    $('resOps').innerHTML = rows.length
      ? `<ul class="plist">${rows.map((r) => `<li><span class="detail"><b>${esc(r.name)}</b><br>${r.ok} of ${r.n} right</span><span class="t">${secs(r.meanMs)} avg</span></li>`).join('')}</ul>`
      : '<p class="empty-note">Nothing answered.</p>';

    $('drillMissesBtn').textContent = 'Practice these types';
    $('drillMissesBtn').disabled = !practiceWeights(s);
  }

  /** Types from one attempt worth practising: anything missed, plus the slowest few. */
  function practiceWeights(s) {
    const w = {};
    const probs = X.flatten([s]);
    probs.filter((p) => !p.ok).forEach((p) => { w[p.t] = (w[p.t] || 0) + 2; });
    probs.slice().sort((x, y) => y.ms - x.ms).slice(0, 5).forEach((p) => { w[p.t] = (w[p.t] || 0) + 1; });
    return Object.keys(w).length ? w : null;
  }

  function practiceFromAttempt(s) {
    const weights = practiceWeights(s);
    if (weights) startE80({ practice: true, weights, label: "Last attempt's weak spots", returnTo: 'e80' });
  }

  function practiceWeakE80() {
    const weak = X.weakPlan(X.flatten(S.data.sessions));
    if (!weak) return toast('Do an attempt or two first so there is something to aim at.');
    startE80({ practice: true, weights: weak.weights, label: 'Weakest types', returnTo: 'e80' });
  }

  function wireE80() {
    $('e80Start').addEventListener('click', () => startE80({ practice: false, returnTo: 'e80' }));
    const saveE80 = async () => {
      await saveSettings({ e80: { penalty: Number($('e80Penalty').value), allowSkip: $('e80Skip').checked } });
      renderE80();
    };
    $('e80Penalty').addEventListener('change', saveE80);
    $('e80Skip').addEventListener('change', saveE80);
    // Option buttons never take focus, so Space/Enter can't re-press the last one clicked.
    $('e80Opts').addEventListener('mousedown', (e) => e.preventDefault());
    $('e80Opts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) pickE80(Number(b.dataset.pick));
    });
  }

  // ---- sync ----------------------------------------------------------------

  // ---- account sync (Firebase) ---------------------------------------------------

  const syncSoon = (ms) => {
    if (S.cloud) S.cloud.soon(ms);
    if (S.sync) S.sync.soon(ms);
  };
  const syncNow = () => {
    if (S.cloud) S.cloud.now();
    if (S.sync) S.sync.now();
  };

  function startCloud() {
    if (!window.ZETAPRO_FIREBASE || !window.firebase || !window.Cloud) return;
    try {
      S.cloud = window.Cloud.createCloud({
        firebase: window.firebase,
        config: window.ZETAPRO_FIREBASE,
        store: window.zm,
        onStatus: () => {
          updatePill();
          // Redraw the signed-in view only; never wipe a half-typed sign-in form.
          if (!$('syncModal').hidden && S.cloud && S.cloud.signedIn()) renderAccountModal();
        },
        onUser: (u) => {
          updatePill();
          if (u && S.signingIn) S.firstCloudSync = true;
          if (!$('syncModal').hidden) renderAccountModal();
        },
        onData: (merged, r) => {
          onSyncedData(merged);
          if (S.firstCloudSync) {
            S.firstCloudSync = false;
            S.signingIn = false;
            closeSyncModal();
            S.statsRange = 'all';
            S.statsDrills = true;
            show('stats');
            const bits = [];
            if (r.pulled) bits.push(`${r.pulled} game${r.pulled === 1 ? '' : 's'} downloaded`);
            if (r.pushed) bits.push(`${r.pushed} uploaded`);
            toast(`Signed in and synced${bits.length ? `: ${bits.join(', ')}` : ''}. Showing all time.`);
          }
        },
      });
    } catch (e) {
      console.error('Account sync failed to start:', e);
      S.cloud = null;
    }
  }

  /** One pill for both kinds of sync: the account when set up, else GitHub. */
  function updatePill() {
    const btn = $('syncBtn');
    if (!S.cloud) return;
    const st = S.cloud.state();
    let state = 'off';
    let label = 'Sign in';
    let title = 'Sign in to sync your games across devices';
    if (S.cloud.signedIn()) {
      state = st.status === 'idle' ? 'ok' : st.status;
      label = { syncing: 'Syncing…', ok: 'Synced', idle: 'Synced', error: 'Sync error' }[st.status] || 'Synced';
      title = st.status === 'error' ? `Sync error: ${st.error}` : `Signed in as ${st.user.email}`;
    }
    btn.dataset.state = state;
    $('syncText').textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }

  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  function renderAccountModal() {
    const body = $('syncBody');
    $('syncTitle').textContent = 'Account & sync';
    const web = window.zm.platform === 'web';
    const legacy = S.sync && S.sync.state().repo
      ? `<h3 class="mini-h">Old GitHub sync</h3>
        <p class="sub">Still connected to <b>${esc(S.sync.state().repo)}</b>${S.sync.state().status === 'error' ? ` (${esc(S.sync.state().error)})` : ''}. While it's connected, its games are merged in here and uploaded to your account. Once your account has everything, you can disconnect it.</p>
        <div class="actions"><button class="btn ghost" id="ghDisconnect">Disconnect GitHub sync</button></div>`
      : '';
    if (!S.cloud.signedIn()) {
      body.innerHTML = `
        <p class="lede">Sign in to keep your games, drills and settings in step on all your devices. It's free, and your data is private to your account.</p>
        ${web
          ? `<button class="btn google" id="cGoogle">${GOOGLE_G}<span>Continue with Google</span></button><div class="or"><span>or use email</span></div>`
          : '<p class="sub">Google sign-in only works in the browser version (Google blocks it inside desktop apps). Use email and password here. Signed up with Google in the browser? Add a password there first under Account & sync.</p>'}
        <label class="field">Email<input id="cEmail" type="email" autocomplete="email" spellcheck="false" autocapitalize="off"></label>
        <label class="field">Password<input id="cPass" type="password" autocomplete="current-password"></label>
        <div class="actions">
          <button class="btn primary" id="cSignIn">Sign in</button>
          <button class="btn" id="cCreate">Create account</button>
          <button class="btn link" id="cForgot">Forgot password?</button>
        </div>
        <p class="sync-msg" id="cMsg" role="status"></p>
        <p class="fine">Signing in uploads the games already on this device, then keeps everything in sync automatically.</p>
        ${legacy}`;
      if (web) $('cGoogle').addEventListener('click', () => accountAction(() => S.cloud.signInGoogle(), 'Opening Google…'));
      $('cSignIn').addEventListener('click', () => accountAction(() => S.cloud.signInEmail($('cEmail').value, $('cPass').value), 'Signing in…'));
      $('cCreate').addEventListener('click', () => accountAction(() => S.cloud.createAccount($('cEmail').value, $('cPass').value), 'Creating your account…'));
      $('cForgot').addEventListener('click', async () => {
        if (!$('cEmail').value.trim()) return accountMsg('Enter your email first, then press Forgot password.', true);
        try {
          await S.cloud.resetPassword($('cEmail').value);
          accountMsg('Check your email for a link to set a new password.');
        } catch (e) { accountMsg(e.message, true); }
      });
    } else {
      const st = S.cloud.state();
      const hasPassword = st.user.providers.includes('password');
      body.innerHTML = `
        <p class="lede">Signed in as <b>${esc(st.user.email)}</b>. Your games sync automatically after every round, when you change settings, and when you come back to the app.</p>
        <ul class="rules">
          <li><b>Status:</b> ${esc({ syncing: 'Syncing…', ok: 'Synced', idle: 'Ready', error: 'Sync error' }[st.status] || st.status)}${st.status === 'error' ? ` — ${esc(st.error)}` : ''}</li>
          <li><b>Last synced:</b> ${agoText(st.lastSyncAt)}</li>
          <li><b>On this device:</b> ${S.data.sessions.length} game${S.data.sessions.length === 1 ? '' : 's'}</li>
        </ul>
        <div class="actions">
          <button class="btn primary" id="cSyncNow" ${st.status === 'syncing' ? 'disabled' : ''}>Sync now</button>
          <button class="btn ghost" id="cSignOut">Sign out</button>
        </div>
        ${!hasPassword && web ? `<h3 class="mini-h">Use the Windows app too</h3>
          <p class="sub">The Windows app signs in with email and password. Add a password to this account (${esc(st.user.email)}):</p>
          <label class="field">New password<input id="cNewPass" type="password" autocomplete="new-password"></label>
          <div class="actions"><button class="btn" id="cAddPass">Add password</button></div>` : ''}
        <p class="sync-msg" id="cMsg" role="status"></p>
        <p class="fine">Signing out keeps this device's games; it just stops syncing.</p>
        ${legacy}`;
      $('cSyncNow').addEventListener('click', () => S.cloud.now());
      $('cSignOut').addEventListener('click', async () => { await S.cloud.signOut(); toast('Signed out. Your games stay on this device.'); });
      if ($('cAddPass')) {
        $('cAddPass').addEventListener('click', async () => {
          try {
            await S.cloud.addPassword($('cNewPass').value);
            toast('Password added. Use it to sign in on the Windows app.');
            renderAccountModal();
          } catch (e) { accountMsg(e.message, true); }
        });
      }
    }
    if ($('ghDisconnect')) {
      $('ghDisconnect').addEventListener('click', async () => {
        await S.sync.disconnect();
        renderAccountModal();
      });
    }
  }

  function accountMsg(text, bad = false) {
    const m = $('cMsg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  }

  async function accountAction(fn, busy) {
    const btns = [...$('syncBody').querySelectorAll('.btn')];
    btns.forEach((b) => { b.disabled = true; });
    accountMsg(busy);
    S.signingIn = true;
    try {
      await fn();
      // onUser takes over: it redraws the dialog and the first sync jumps to Stats.
    } catch (e) {
      S.signingIn = false;
      accountMsg(e.message, true);
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  /** Adds a just-saved game to the in-memory copy unless a sync already brought it in. */
  function rememberSession(session) {
    if (!S.data.sessions.some((x) => x.id === session.id)) S.data.sessions.push(session);
    syncSoon();
  }

  const deviceName = () => {
    if (window.zm.platform !== 'web') return 'desktop';
    return /iPhone|iPad|Android/i.test(navigator.userAgent) ? 'phone' : 'browser';
  };

  async function startSync() {
    S.sync = window.Sync.createSyncer({
      store: window.zm,
      device: deviceName(),
      onStatus: renderSyncStatus,
      onData: onSyncedData,
    });
    await S.sync.load();
    S.sync.now();
    // Catch up when the app comes back to the foreground (phone unlocked, window refocused).
    const wake = () => {
      if (document.hidden) return;
      if (Date.now() - S.sync.state().lastSyncAt > 20000) S.sync.now();
      if (S.cloud && S.cloud.signedIn() && Date.now() - S.cloud.state().lastSyncAt > 20000) S.cloud.now();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', syncNow);
  }

  /** Another device's games arrived: take the merged copy and redraw quietly. */
  function onSyncedData(merged) {
    if (!merged) return;
    S.data = merged;
    if (S.view === 'game' || S.view === 'e80game' || S.view === 'results') return;
    if (S.view === 'play') {
      // Don't yank a range box out from under someone typing in it.
      if (!$('setupForm').contains(document.activeElement)) fillForm();
      renderPlaySide();
    } else if (S.view === 'drill') renderDrill();
    else if (S.view === 'stats') renderStats();
    else if (S.view === 'e80') renderE80();
  }

  const SYNC_LABEL = { off: 'Sync off', idle: 'Sync on', syncing: 'Syncing…', ok: 'Synced', error: 'Sync error' };

  function agoText(t) {
    if (!t) return 'not yet';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return dateFmt.format(t);
  }

  function renderSyncStatus(st) {
    if (S.cloud) {
      updatePill();
      if (!$('syncModal').hidden && S.cloud.signedIn()) renderAccountModal();
      return;
    }
    const btn = $('syncBtn');
    btn.dataset.state = st.status;
    $('syncText').textContent = SYNC_LABEL[st.status] || 'Sync';
    btn.title = st.status === 'error' ? `Sync error: ${st.error}` : st.status === 'off' ? 'Sync across devices' : `Syncing with ${st.repo}`;
    btn.setAttribute('aria-label', btn.title);
    // The setup form isn't redrawn, so typing in it is never interrupted.
    if (!$('syncModal').hidden && S.sync && S.sync.enabled()) renderSyncModal();
  }

  function openSyncModal() {
    $('syncModal').hidden = false;
    renderSyncModal();
    const first = $('syncBody').querySelector('input, .btn.primary');
    if (first) first.focus();
  }

  function closeSyncModal() {
    $('syncModal').hidden = true;
  }

  function renderSyncModal() {
    if (S.cloud) return renderAccountModal();
    const body = $('syncBody');
    if (!S.sync.enabled()) {
      body.innerHTML = `
        <p class="lede">Keeps the desktop app and the phone app on the same games and settings. Everything lives in one file in a <b>private</b> GitHub repository that only you can see.</p>
        <ol class="steps">
          <li>Create a private repository, e.g. <code>zetapro-data</code>: <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a></li>
          <li>Make a token at <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>.
            Under <b>Repository access</b> choose <i>Only select repositories</i> → that repository.
            Under <b>Permissions → Repository permissions → Contents</b> choose <i>Read and write</i>.</li>
          <li>Paste both below, then do the same once on each other device.</li>
        </ol>
        <label class="field">Repository<input id="syncRepo" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="your-github-name/zetapro-data"></label>
        <label class="field">Access token<input id="syncToken" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="github_pat_…"></label>
        <div class="actions"><button class="btn primary" id="syncConnect">Connect</button></div>
        <p class="sync-msg" id="syncMsg" role="status"></p>
        <p class="fine">The token stays on this device${window.zm.platform === 'web' ? ' (in this browser)' : ', encrypted by Windows,'} and only ever goes to GitHub.</p>`;
      $('syncConnect').addEventListener('click', onSyncConnect);
      // Keep the repo name if one was set before (e.g. the token needs re-entering).
      const known = S.sync.state();
      if (known.repo) $('syncRepo').value = known.repo;
      if (known.status === 'error' && known.error) {
        $('syncMsg').textContent = known.error;
        $('syncMsg').classList.add('bad');
      }
      return;
    }
    const st = S.sync.state();
    const games = S.data.sessions.length;
    body.innerHTML = `
      <p class="lede">Syncing with <b>${esc(st.repo)}</b>. Games and settings made on any connected device show up on the others. The theme stays per device.</p>
      <ul class="rules">
        <li><b>Status:</b> ${esc(SYNC_LABEL[st.status])}${st.status === 'error' ? ` — ${esc(st.error)}` : ''}</li>
        <li><b>Last synced:</b> ${agoText(st.lastSyncAt)}</li>
        <li><b>On this device:</b> ${games} game${games === 1 ? '' : 's'}</li>
      </ul>
      <div class="actions">
        <button class="btn primary" id="syncNow" ${st.status === 'syncing' ? 'disabled' : ''}>Sync now</button>
        <button class="btn ghost" id="syncDisconnect">Disconnect this device</button>
      </div>
      <p class="fine">Syncing happens on its own after every game, when you change settings, and when the app comes back to the front. Disconnecting keeps this device's games; it just stops syncing and forgets the token.</p>`;
    $('syncNow').addEventListener('click', () => S.sync.now());
    $('syncDisconnect').addEventListener('click', async () => {
      await S.sync.disconnect();
      renderSyncModal();
    });
  }

  async function onSyncConnect() {
    const btn = $('syncConnect');
    const msg = $('syncMsg');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    msg.textContent = 'Checking with GitHub…';
    msg.classList.remove('bad');
    const known = new Set(S.data.sessions.map(DataModel.sessionKey));
    try {
      const r = await S.sync.connect($('syncRepo').value, $('syncToken').value);
      if (!r.merged) {
        // Connected, but the first pull failed; the dialog shows why.
        renderSyncModal();
        return;
      }
      // Show what the repo already held: straight to Stats, all time, so
      // nothing older than the default 30-day window looks missing.
      const pulled = r.merged.sessions.filter((s) => !known.has(DataModel.sessionKey(s))).length;
      closeSyncModal();
      S.statsRange = 'all';
      S.statsDrills = true;
      show('stats');
      const what = pulled ? `Pulled ${pulled} game${pulled === 1 ? '' : 's'} from ${r.repo}; showing all time.` : `Connected to ${r.repo}. No new games there yet; yours will upload.`;
      toast(r.private ? what : `${what} Warning: that repository is public, so anyone can read your games.`);
    } catch (e) {
      msg.textContent = e.message;
      msg.classList.add('bad');
      btn.disabled = false;
    }
  }

  function wireSync() {
    $('syncBtn').addEventListener('click', openSyncModal);
    $('syncClose').addEventListener('click', closeSyncModal);
    $('syncModal').addEventListener('mousedown', (e) => {
      if (e.target === $('syncModal')) closeSyncModal();
    });
  }

  // ---- version, what's new, updates --------------------------------------------

  const VER = window.ZetaproVersion;
  const SITE = 'https://amirkhan0725.github.io/zetapro/';
  const DOWNLOAD = 'https://github.com/amirkhan0725/zetapro/releases/latest';

  /** 1.10.0 > 1.9.2, compared part by part. */
  function newer(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  }

  function openInfo(title, html) {
    $('infoTitle').textContent = title;
    $('infoBody').innerHTML = html;
    $('infoModal').hidden = false;
  }

  function closeInfo() {
    $('infoModal').hidden = true;
  }

  function whatsNewHtml(changes) {
    return changes.map((c) => `<h3 class="mini-h">Version ${esc(c.version)} <span class="sub">· ${esc(c.date)}</span></h3>
      <ul class="changes">${c.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('');
  }

  function showNotice(html) {
    const bar = $('noticeBar');
    bar.innerHTML = `<div>${html}</div><button class="btn ghost small" data-dismiss-notice aria-label="Dismiss">✕</button>`;
    bar.hidden = false;
  }

  async function checkVersion() {
    $('appFoot').innerHTML = `Zetapro v${esc(VER.version)} · <button class="btn link" data-action="whats-new">What's new</button>`;
    // After an update, say so once.
    let seen = null;
    try {
      seen = localStorage.getItem('zetapro-seen-version');
      localStorage.setItem('zetapro-seen-version', VER.version);
    } catch { /* storage blocked: skip the notice */ }
    if (seen && seen !== VER.version) {
      showNotice(`Updated to v${esc(VER.version)}. <button class="btn link" data-action="whats-new">See what's new</button>`);
    }
    // The browser app updates itself; the Windows app needs a nudge.
    if (window.zm.platform !== 'desktop') return;
    try {
      const res = await fetch(`${SITE}version.json`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = await res.json();
      if (latest.version && newer(latest.version, VER.version)) {
        S.latest = latest;
        showNotice(`Zetapro ${esc(latest.version)} is available (you have ${esc(VER.version)}). <a href="${DOWNLOAD}" target="_blank" rel="noopener">Download</a> · <button class="btn link" data-action="whats-new-latest">What's new</button>`);
      }
    } catch { /* offline: try again next launch */ }
  }

  // ---- manage data -----------------------------------------------------------

  function gameLabel(s) {
    if (s.mode === 'e80') return s.practice ? `80 in 8 practice${s.label ? ` · ${s.label}` : ''}` : '80 in 8';
    if (s.mode === 'drill') return `Drill · ${s.label || ''}`;
    return `Zetamac · ${E.describeConfig(s.config)}`;
  }

  function gameScore(s) {
    const v = s.mode === 'e80' ? signed(s.score) : String(s.score);
    return s.aborted ? `${v} (quit)` : v;
  }

  function openDataModal() {
    S.history = null;
    $('dataModal').hidden = false;
    renderDataModal();
  }

  function closeDataModal() {
    $('dataModal').hidden = true;
    S.lastDeleted = null;
  }

  function renderDataModal() {
    const all = S.data.sessions;
    const zeta = all.filter((s) => s.mode !== 'e80');
    const e80 = all.filter((s) => s.mode === 'e80');
    const syncing = S.sync && S.sync.enabled();
    const rows = all.slice().reverse().slice(0, 300).map((s) => `
      <li><span class="q">${esc(dateFmt.format(s.at))}</span>
        <span class="detail">${esc(gameLabel(s))}</span>
        <span class="t">${esc(gameScore(s))}</span>
        <button class="btn ghost small danger" data-del="${esc(DataModel.sessionKey(s))}" aria-label="Delete this game">Delete</button></li>`).join('');
    const undo = S.lastDeleted
      ? `<div class="undo-bar"><span>Deleted ${S.lastDeleted.length} game${S.lastDeleted.length === 1 ? '' : 's'}.</span>
          <button class="btn small" data-undo>Undo</button></div>`
      : '';
    const history = syncing
      ? `<h2 style="margin-top:20px">Restore from sync history</h2>
        <p class="sub">Every sync is saved as a version on GitHub. Restoring adds that version's games back; games you have now are kept.</p>
        <div id="historyList">${S.history ? historyHtml(S.history) : '<div class="actions" style="margin-top:8px"><button class="btn small" data-load-history>Show saved versions</button></div>'}</div>`
      : '';
    $('dataBody').innerHTML = `${undo}
      <p class="lede">${all.length} game${all.length === 1 ? '' : 's'} saved: ${zeta.length} Zetamac (incl. drills), ${e80.length} 80 in 8.
        ${syncing ? 'Deletions also apply to your other synced devices.' : 'This only affects this device.'}</p>
      <div class="actions" style="margin:14px 0 6px">
        <button class="btn" data-del-group="zeta" ${zeta.length ? '' : 'disabled'}>Delete all Zetamac games</button>
        <button class="btn" data-del-group="e80" ${e80.length ? '' : 'disabled'}>Delete all 80 in 8 attempts</button>
        <button class="btn danger-solid" data-del-group="all" ${all.length ? '' : 'disabled'}>Delete everything</button>
      </div>
      ${all.length ? `<h2 style="margin-top:18px">Individual games</h2><ul class="plist game-list">${rows}</ul>` : '<p class="empty-note">Nothing saved.</p>'}
      ${history}
      <h2 style="margin-top:20px">Backup file</h2>
      <p class="sub">Save every game to a file, or add games from one (for example, to move them to another device or account). Importing keeps the games you have now.</p>
      <div class="actions" style="margin-top:8px">
        <button class="btn small" data-export-json>Export backup</button>
        <button class="btn small" data-import-json>Import backup…</button>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>
      <p class="fine">Settings and goals are kept. Consider <b>Export CSV</b> on the Stats page first if you want a copy.</p>`;
  }

  function historyHtml(list) {
    if (list.error) return `<p class="sync-msg bad">${esc(list.error)}</p>`;
    if (!list.length) return '<p class="empty-note">No saved versions yet.</p>';
    return `<ul class="plist game-list history">${list.map((v) => `
      <li><span class="q">${esc(dateFmt.format(v.at))}</span><span class="detail">${esc(v.message.split('\n')[0])}</span>
        <button class="btn ghost small" data-restore="${v.sha}">Restore</button></li>`).join('')}</ul>`;
  }

  async function loadHistory() {
    S.history = null;
    $('historyList').innerHTML = '<p class="sub">Loading…</p>';
    try {
      S.history = await S.sync.versions(25);
    } catch (e) {
      S.history = Object.assign([], { error: e.message });
    }
    $('historyList').innerHTML = historyHtml(S.history);
  }

  async function restoreVersion(sha) {
    const v = (S.history || []).find((x) => x.sha === sha);
    if (!window.confirm(`Add back the games from the version saved ${v ? dateFmt.format(v.at) : ''}? Games you have now are kept.`)) return;
    try {
      const old = await S.sync.readAt(sha);
      const games = old && Array.isArray(old.sessions) ? old.sessions : [];
      const have = new Set(S.data.sessions.map(DataModel.sessionKey));
      const added = games.filter((g) => !have.has(DataModel.sessionKey(g))).length;
      S.data = await window.zm.restoreSessions(games);
      S.lastDeleted = null;
      afterDataChange(added ? `Restored ${added} game${added === 1 ? '' : 's'}.` : 'Nothing to restore: you already have every game from that version.');
    } catch (e) {
      toast(`Couldn't restore: ${e.message}`);
    }
  }

  async function exportBackup() {
    const data = await window.zm.load();
    const name = `zetapro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'zetapro', exportedAt: Date.now(), ...DataModel.forUpload(data) })], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Saved ${data.sessions.length} games to ${name}`);
  }

  async function importBackup(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return toast("That file isn't a Zetapro backup.");
    }
    const games = DataModel.normalize(parsed).sessions;
    if (!games.length) return toast('No games found in that file.');
    const have = new Set(S.data.sessions.map(DataModel.sessionKey));
    const added = games.filter((g) => !have.has(DataModel.sessionKey(g))).length;
    if (!added) return toast('You already have every game in that file.');
    if (!window.confirm(`Add ${added} game${added === 1 ? '' : 's'} from this backup? Games you have now are kept.`)) return;
    S.data = await window.zm.restoreSessions(games);
    afterDataChange(`Imported ${added} game${added === 1 ? '' : 's'}.`);
  }

  async function undoDelete() {
    const games = S.lastDeleted || [];
    if (!games.length) return;
    S.data = await window.zm.restoreSessions(games);
    S.lastDeleted = null;
    afterDataChange(`Brought back ${games.length} game${games.length === 1 ? '' : 's'}.`);
  }

  async function deleteGames(keys, question) {
    if (!keys.length || !window.confirm(question)) return;
    const gone = new Set(keys);
    const removed = S.data.sessions.filter((s) => gone.has(DataModel.sessionKey(s)));
    try {
      S.data = await window.zm.deleteSessions(keys);
      S.lastDeleted = removed;
      afterDataChange(`Deleted ${keys.length} game${keys.length === 1 ? '' : 's'}.`);
    } catch (e) {
      toast(`Couldn't delete: ${e.message}`);
    }
  }

  async function deleteEverything() {
    // The store asks for confirmation itself (a native dialog on desktop).
    const removed = S.data.sessions.slice();
    if (!(await window.zm.reset())) return;
    S.data = await window.zm.load();
    S.lastDeleted = removed;
    afterDataChange('All games deleted.');
  }

  function afterDataChange(msg) {
    renderDataModal();
    onSyncedData(S.data);
    syncNow();
    toast(msg);
  }

  function wireDataModal() {
    $('dataClose').addEventListener('click', closeDataModal);
    $('dataBody').addEventListener('change', (e) => {
      if (e.target.id === 'importFile' && e.target.files[0]) importBackup(e.target.files[0]);
    });
    $('dataModal').addEventListener('mousedown', (e) => {
      if (e.target === $('dataModal')) closeDataModal();
    });
    $('dataBody').addEventListener('click', (e) => {
      if (e.target.closest('[data-undo]')) return undoDelete();
      if (e.target.closest('[data-export-json]')) return exportBackup();
      if (e.target.closest('[data-import-json]')) return $('importFile').click();
      if (e.target.closest('[data-load-history]')) return loadHistory();
      const rs = e.target.closest('[data-restore]');
      if (rs) return restoreVersion(rs.dataset.restore);
      const one = e.target.closest('[data-del]');
      if (one) {
        const s = S.data.sessions.find((x) => DataModel.sessionKey(x) === one.dataset.del);
        if (s) deleteGames([one.dataset.del], `Delete this game (${gameLabel(s)}, ${gameScore(s)}, ${dateFmt.format(s.at)})?`);
        return;
      }
      const group = e.target.closest('[data-del-group]');
      if (!group) return;
      const g = group.dataset.delGroup;
      if (g === 'all') return deleteEverything();
      const keys = S.data.sessions.filter((s) => (g === 'e80') === (s.mode === 'e80')).map(DataModel.sessionKey);
      deleteGames(keys, g === 'e80' ? `Delete all ${keys.length} 80 in 8 attempts?` : `Delete all ${keys.length} Zetamac games and drills?`);
    });
  }

  // ---- events --------------------------------------------------------------

  function onAction(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    if (a === 'smart-drill') startSmartDrill();
    else if (a === 'trouble-drill') startTroubleDrill();
    else if (a === 'trouble-drill-range') {
      if (S.statsTrouble && S.statsTrouble.length) startDrill({ kind: 'list', problems: S.statsTrouble }, 'Trouble problems');
    } else if (a === 'drill-key') drillKeys([el.dataset.key], el.dataset.label);
    else if (a === 'drill-factor') {
      const f = el.dataset.factor;
      drillKeys([`mul.t.${f}`, `mul.x.${f}`, `div.t.${f}`, `div.x.${f}`], `× and ÷ by ${f}`);
    } else if (a === 'toggle-custom') {
      const k = el.dataset.key;
      if (S.custom.has(k)) S.custom.delete(k); else S.custom.add(k);
      renderDrill();
    } else if (a === 'clear-custom') {
      S.custom.clear();
      renderDrill();
    } else if (a === 'custom-drill') startCustomDrill();
    else if (a === 'toggle-cats') {
      S.showAllCats = !S.showAllCats;
      renderStats();
    } else if (a === 'goto-play') show('play');
    else if (a === 'manage-data') openDataModal();
    else if (a === 'whats-new') openInfo("What's new", whatsNewHtml(VER.changes));
    else if (a === 'whats-new-latest') openInfo("What's new", whatsNewHtml((S.latest && S.latest.changes) || VER.changes));
    else if (a === 'e80-practice-weak') practiceWeakE80();
    else if (a === 'e80-practice-type') startE80({ practice: true, weights: { [el.dataset.key]: 1 }, label: el.dataset.label, returnTo: 'e80' });
  }

  function wire() {
    for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => show(t.dataset.view));

    for (const b of document.querySelectorAll('.theme-seg button')) {
      b.addEventListener('click', async () => {
        await saveSettings({ theme: b.dataset.theme });
        markTheme();
      });
    }

    const form = $('setupForm');
    form.addEventListener('change', onFormChange);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      startClassic();
    });
    $('defaultsBtn').addEventListener('click', async () => {
      await saveSettings({ config: E.defaultConfig() });
      renderPlay();
      toast('Back to Zetamac defaults.');
    });

    $('answer').addEventListener('input', onAnswerInput);
    $('answer').addEventListener('keydown', onAnswerKey);
    $('answer').addEventListener('blur', () => {
      if (S.view === 'game' && S.game && !S.game.keypad) setTimeout(() => $('answer').focus(), 0);
    });
    $('view-game').addEventListener('mousedown', (e) => {
      if (e.target !== $('answer')) e.preventDefault();
    });

    $('quitBtn').addEventListener('click', () => finishGame(true));
    // pointerdown, not click: no tap delay, and the input never loses its place.
    $('keypad').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      e.preventDefault();
      keypadPress(b.dataset.k);
    });
    $('e80QuitBtn').addEventListener('click', () => finishE80(true));
    $('againBtn').addEventListener('click', again);
    $('resBackBtn').addEventListener('click', () => show(S.last ? S.last.returnTo : 'play'));
    $('drillMissesBtn').addEventListener('click', () => {
      if (S.lastSession && S.lastSession.mode === 'e80') return practiceFromAttempt(S.lastSession);
      const list = S.lastSession ? retryListFromSession(S.lastSession) : [];
      if (list.length) startDrill({ kind: 'list', problems: list }, "Last round's misses");
    });

    $('drillDuration').addEventListener('change', (e) => saveSettings({ drillDuration: Number(e.target.value) }));

    $('rangeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      S.statsRange = b.dataset.range;
      renderStats();
    });
    $('incDrills').addEventListener('change', (e) => {
      S.statsDrills = e.target.checked;
      renderStats();
    });
    $('statsBody').addEventListener('click', (e) => {
      const m = e.target.closest('[data-metric]');
      if (m) {
        S.mapMetric = m.dataset.metric;
        renderStats();
      }
    });

    $('exportBtn').addEventListener('click', async () => {
      try {
        const p = await window.zm.exportCsv();
        if (p) toast(`Saved ${p}`);
      } catch (e) {
        toast(`Export failed: ${e.message}`);
      }
    });
    $('folderBtn').addEventListener('click', () => window.zm.openDataFolder());
    if (window.zm.platform === 'web') $('folderBtn').hidden = true;

    wireE80();
    document.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-goal]');
      if (!inp) return;
      await saveSettings({ goals: { ...goals(), [inp.dataset.goal]: Number(inp.value) } });
      if (S.view === 'play') renderPlaySide();
      else if (S.view === 'e80') renderE80();
    });
    wireSync();
    wireDataModal();
    $('infoClose').addEventListener('click', closeInfo);
    $('infoModal').addEventListener('mousedown', (e) => { if (e.target === $('infoModal')) closeInfo(); });
    $('noticeBar').addEventListener('click', (e) => { if (e.target.closest('[data-dismiss-notice]')) $('noticeBar').hidden = true; });
    document.addEventListener('click', onAction);

    // Hover tooltips for anything carrying data-tip (bars, heat-map cells).
    document.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      C.showTip(esc(el.dataset.tip).replace(/\n/g, '<br>').replace(/^([^<]*)/, '<b>$1</b>'), e.clientX, e.clientY);
    });
    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el && !el.contains(e.relatedTarget)) C.hideTip();
    });

    document.addEventListener('keydown', (e) => {
      if (!$('infoModal').hidden) {
        if (e.key === 'Escape') closeInfo();
        return;
      }
      if (!$('dataModal').hidden) {
        if (e.key === 'Escape') closeDataModal();
        return;
      }
      if (!$('syncModal').hidden) {
        if (e.key === 'Escape') closeSyncModal();
        else if (e.key === 'Enter' && e.target.closest('#syncBody input')) {
          e.preventDefault();
          onSyncConnect();
        }
        return;
      }
      if (S.view === 'game') {
        if (e.key === 'Escape') {
          e.preventDefault();
          finishGame(true);
        } else if (S.game && S.game.keypad && e.target !== $('answer')) {
          // Pad mode leaves the input read-only, so feed physical keys through the pad.
          if (/^\d$/.test(e.key)) keypadPress(e.key);
          else if (e.key === 'Backspace') keypadPress('back');
        }
        return;
      }
      if (S.view === 'results') {
        // A short guard so a late keystroke from the round doesn't restart it.
        if (e.key === 'Enter' && performance.now() - S.resultsAt > 700) {
          e.preventDefault();
          again();
        } else if (e.key === 'Escape') {
          show(S.last ? S.last.returnTo : 'play');
        }
        return;
      }
      if (S.view === 'e80game') {
        onE80Key(e);
        return;
      }
      if (S.view === 'e80' && e.key === 'Enter') {
        const tag = e.target.tagName;
        if (tag === 'BUTTON' || tag === 'SELECT') return;
        e.preventDefault();
        startE80({ practice: false, returnTo: 'e80' });
        return;
      }
      if (S.view === 'play' && e.key === 'Enter') {
        const tag = e.target.tagName;
        if (tag === 'BUTTON' || tag === 'SELECT') return;
        e.preventDefault();
        startClassic();
      }
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (S.view === 'stats') renderStats();
        else if (S.view === 'e80') renderE80();
        else if (S.view === 'drill') renderSmartStats();
      }, 120);
    });
    window.addEventListener('zm-theme', () => {
      if (S.view === 'stats') renderStats();
      else if (S.view === 'e80') renderE80();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (S.view === 'stats') renderStats();
    });
  }

  function markTheme() {
    for (const b of document.querySelectorAll('.theme-seg button')) {
      b.classList.toggle('on', b.dataset.theme === S.data.settings.theme);
    }
  }

  function fillSelects() {
    $('duration').innerHTML = E.DURATIONS.map((d) => `<option value="${d}">${d} seconds</option>`).join('');
    $('drillDuration').innerHTML = [60, 120, 300, 600].map((d) => `<option value="${d}">${d < 120 ? `${d} seconds` : `${d / 60} minutes`}</option>`).join('');
    $('drillDuration').value = String(S.data.settings.drillDuration);
    // Custom durations from an edited data file still need a matching option.
    const d = config().duration;
    if (!E.DURATIONS.includes(d)) $('duration').insertAdjacentHTML('beforeend', `<option value="${d}">${d} seconds</option>`);
  }

  async function boot() {
    S.data = await window.zm.load();
    document.body.dataset.platform = window.zm.platform || 'desktop';
    fillSelects();
    markTheme();
    wire();
    show('play');
    startCloud();
    await startSync();
    updatePill();
    checkVersion();
  }

  // Exposed for capture/automation runs only.
  window.__zm = { S, show, startGame, startSmartDrill, finishGame, renderStats, startE80, pickE80, finishE80 };

  boot().catch((e) => {
    document.body.innerHTML = `<div class="empty"><h2>Couldn't start</h2><p>${esc(e.message)}</p></div>`;
  });
})();
