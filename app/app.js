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
      if (S.sync) S.sync.soon(3000);
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
        <span class="num" title="Cost relative to your average problem">${r.cost.toFixed(1)}×</span></li>`).join('')}
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
      t0: performance.now(),
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
    const input = $('answer');
    input.value = '';
    input.classList.remove('wrong');
    nextProblem();
    input.focus();
    S.game.timer = setInterval(tick, 50);
    tick();
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
    $('timebar').style.transform = `scaleX(${Math.max(0, left / g.durMs)})`;
    if (left <= 0) finishGame(false);
  }

  function onAnswerInput() {
    const g = S.game;
    const input = $('answer');
    if (!g || g.done) {
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
    } else {
      $('resLabel').textContent = `Drill · ${s.label}`;
      $('resSub').textContent = `${s.duration}s drill. Drills count toward your stats but not your score history.`;
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

  function startDrill(plan, label) {
    startGame({
      mode: 'drill',
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
    startDrill({ kind: 'weights', weights: d.weights }, 'Smart mix');
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
        : '<p class="empty-note">None yet. Misses and slow answers will collect here.</p>'}</div>
      <div class="actions"><button class="btn primary" data-action="trouble-drill" ${t.rows.length ? '' : 'disabled'}>Drill ${t.rows.length || ''} problem${t.rows.length === 1 ? '' : 's'}</button></div>`;

    const groups = E.allCategories();
    const chip = (key) => {
      const info = E.categoryInfo(key);
      const c = costs[key];
      return `<button class="chip ${S.custom.has(key) ? 'on' : ''}" data-action="toggle-custom" data-key="${key}" title="e.g. ${esc(info.example)}">${esc(info.short)}${c ? ` <span class="c">${c.toFixed(1)}×</span>` : ''}</button>`;
    };
    const n = S.custom.size;
    $('customCard').innerHTML = `<div class="card-head"><h2>Pick your own</h2><span class="sub">Numbers are your cost vs. an average problem, where there's enough data</span></div>
      ${E.OPS.map((op) => `<div class="pick-group"><div class="g">${E.OP_NAME[op]}</div><div class="chips">${groups[op].map(chip).join('')}</div></div>`).join('')}
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" data-action="custom-drill" ${n ? '' : 'disabled'}>Start drill${n ? ` (${n} type${n === 1 ? '' : 's'})` : ''}</button>
        ${n ? '<button class="btn ghost" data-action="clear-custom">Clear</button>' : ''}
      </div>`;
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
          <span class="sub">Cost = avg time × (1 + miss rate), vs. your average problem. The line in each bar marks 1.0×.</span></div>
        <table class="cats">
          <thead><tr><th>Problem type</th><th class="num">Seen</th><th class="num">First try</th><th class="num">Avg time</th><th>Cost</th><th></th></tr></thead>
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
          <span class="sub">Cost = avg time × (2 − accuracy), vs. your average question. Practice rounds included.</span></div>
        <table class="cats">
          <thead><tr><th>Question type</th><th class="num">Seen</th><th class="num">Right</th><th class="num">Avg time</th><th>Cost</th><th></th></tr></thead>
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
      t0: performance.now(),
      durMs: X.SECONDS * 1000,
      done: false,
      paused: false,
      timer: 0,
    };
    show('e80game');
    $('e80Label').textContent = opts.practice ? `Practice · ${opts.label}` : '';
    $('e80Hint').innerHTML = `<kbd>1</kbd>–<kbd>4</kbd> to answer${st.allowSkip ? ' · <kbd>Space</kbd> to skip' : ''} · <kbd>Esc</kbd> to quit`;
    nextE80();
    S.e80.timer = setInterval(tickE80, 100);
    tickE80();
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
    $('e80Timebar').style.transform = `scaleX(${Math.max(0, left / g.durMs)})`;
    if (left <= 0) finishE80(false);
  }

  /** i: option index, or null to skip. */
  function pickE80(i) {
    const g = S.e80;
    if (!g || g.done || g.paused) return;
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

  /** Adds a just-saved game to the in-memory copy unless a sync already brought it in. */
  function rememberSession(session) {
    if (!S.data.sessions.some((x) => x.id === session.id)) S.data.sessions.push(session);
    if (S.sync) S.sync.soon();
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
      if (!document.hidden && Date.now() - S.sync.state().lastSyncAt > 20000) S.sync.now();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', () => S.sync.now());
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
    try {
      const r = await S.sync.connect($('syncRepo').value, $('syncToken').value);
      renderSyncModal();
      toast(r.private ? 'Sync connected.' : 'Connected, but that repository is public: anyone can read your games. Make it private on GitHub.');
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
    $('dataModal').hidden = false;
    renderDataModal();
  }

  function closeDataModal() {
    $('dataModal').hidden = true;
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
    $('dataBody').innerHTML = `
      <p class="lede">${all.length} game${all.length === 1 ? '' : 's'} saved: ${zeta.length} Zetamac (incl. drills), ${e80.length} 80 in 8.
        ${syncing ? 'Deletions also apply to your other synced devices.' : 'This only affects this device.'}</p>
      <div class="actions" style="margin:14px 0 6px">
        <button class="btn" data-del-group="zeta" ${zeta.length ? '' : 'disabled'}>Delete all Zetamac games</button>
        <button class="btn" data-del-group="e80" ${e80.length ? '' : 'disabled'}>Delete all 80 in 8 attempts</button>
        <button class="btn danger-solid" data-del-group="all" ${all.length ? '' : 'disabled'}>Delete everything</button>
      </div>
      ${all.length ? `<h2 style="margin-top:18px">Individual games</h2><ul class="plist game-list">${rows}</ul>` : '<p class="empty-note">Nothing saved.</p>'}
      <p class="fine">Settings and goals are kept. Consider <b>Export CSV</b> on the Stats page first if you want a copy.</p>`;
  }

  async function deleteGames(keys, question) {
    if (!keys.length || !window.confirm(question)) return;
    try {
      S.data = await window.zm.deleteSessions(keys);
      afterDataChange(`Deleted ${keys.length} game${keys.length === 1 ? '' : 's'}.`);
    } catch (e) {
      toast(`Couldn't delete: ${e.message}`);
    }
  }

  async function deleteEverything() {
    // The store asks for confirmation itself (a native dialog on desktop).
    if (!(await window.zm.reset())) return;
    S.data = await window.zm.load();
    afterDataChange('All games deleted.');
  }

  function afterDataChange(msg) {
    renderDataModal();
    onSyncedData(S.data);
    if (S.sync) S.sync.now();
    toast(msg);
  }

  function wireDataModal() {
    $('dataClose').addEventListener('click', closeDataModal);
    $('dataModal').addEventListener('mousedown', (e) => {
      if (e.target === $('dataModal')) closeDataModal();
    });
    $('dataBody').addEventListener('click', (e) => {
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
      if (S.view === 'game') setTimeout(() => $('answer').focus(), 0);
    });
    $('view-game').addEventListener('mousedown', (e) => {
      if (e.target !== $('answer')) e.preventDefault();
    });

    $('quitBtn').addEventListener('click', () => finishGame(true));
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
        else if (S.view === 'e80') renderE80();
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
    await startSync();
  }

  // Exposed for capture/automation runs only.
  window.__zm = { S, show, startGame, startSmartDrill, finishGame, renderStats, startE80, pickE80, finishE80 };

  boot().catch((e) => {
    document.body.innerHTML = `<div class="empty"><h2>Couldn't start</h2><p>${esc(e.message)}</p></div>`;
  });
})();
