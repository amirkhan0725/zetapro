(() => {
  'use strict';

  const E = window.Engine;
  const St = window.Stats;
  const X = window.E80;
  const C = window.Charts;
  const Pg = window.Progress;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const tile = (label, value, note) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
  // data-theme names a color theme (or, in a browser, forces Light or Dark); Auto follows the OS.
  const Themes = window.ZetaproThemes;
  const isDark = () => {
    const forced = document.documentElement.dataset.theme;
    if (!forced) return window.matchMedia('(prefers-color-scheme: dark)').matches;
    return Themes.byId[forced] ? Themes.byId[forced].base === 'dark' : forced === 'dark';
  };
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const S = {
    data: null,
    view: 'play',
    statsKind: 'classic', // or 'oa'; Classic every time the app opens
    statsRange: 'd30',
    statsDrills: true,
    mapMetric: 'time',
    showAllCats: false,
    showAllLevels: false,
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
  /** A goal typed in a Goal box, or null when it's empty or not a score (1–999). */
  const goalOf = (text) => {
    const n = Number(text); // '' is 0, so it's caught with the out-of-range ones
    return Number.isFinite(n) && n >= 1 && n <= 999 ? Math.round(n) : null;
  };
  /** True while the player is typing in a Goal box inside `card`. */
  const typingGoalIn = (card) => {
    const el = document.activeElement;
    return !!el && el.matches('[data-goal]') && card.contains(el);
  };
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

  // ---- numbers kept per list of rounds ----------------------------------------
  // Every page works its numbers out from the saved rounds, and with a long
  // history that was most of a render (2,000 rounds: Play ~75 ms, Stats all time
  // ~230 ms). So results are kept with the rounds they came from, keyed by those
  // rounds' ids in order: a redraw with nothing new, or a sync that brings back an
  // identical copy, reuses them, and a new round only recomputes what includes it.
  // Cached results are shared, so callers must not change them.

  const listKeys = new WeakMap(); // array → { n, last, key }
  /** Identifies a list of rounds by content, whichever array holds it. */
  function roundsKey(list) {
    const last = list[list.length - 1];
    const hit = listKeys.get(list);
    if (hit && hit.n === list.length && hit.last === last) return hit.key;
    const key = list.map(DataModel.sessionKey).join('\n');
    listKeys.set(list, { n: list.length, last, key });
    return key;
  }

  const BAGS = 8; // lists kept: all rounds, all but the newest, the last 30 days, a Stats range…
  const bags = new Map(); // roundsKey → Map(what → result), most recently used last
  const CACHE = { computed: 0 }; // for the smoke test: redraws with nothing new add nothing
  /** fn()'s result for this list of rounds and `what`, worked out once while the list is in use. */
  function cached(list, what, fn) {
    const key = roundsKey(list);
    let bag = bags.get(key);
    if (bag) bags.delete(key);
    else bag = new Map();
    bags.set(key, bag);
    if (bags.size > BAGS) bags.delete(bags.keys().next().value);
    if (!bag.has(what)) {
      bag.set(what, fn());
      CACHE.computed++;
    }
    return bag.get(what);
  }

  const fps = new WeakMap(); // a saved round's settings → their fingerprint (saved rounds never change)
  const fpOf = (c) => {
    if (!c || typeof c !== 'object') return E.fingerprint(c);
    if (!fps.has(c)) fps.set(c, E.fingerprint(c));
    return fps.get(c);
  };

  const skillsOf = (list) => cached(list, 'skills', () => Pg.skills(list));
  // Stats.scoreSummary(list, fp), with each round's settings fingerprinted once, not on every new round.
  const scoreOf = (list, fp) => cached(list, `score ${fp}`, () =>
    St.scoreSummary(list.filter((s) => s.mode !== 'classic' || fpOf(s.config) === fp), null));
  const flatOf = (list) => cached(list, 'flat', () => St.flatten(list));
  // Recent slips move with the calendar day; the smart mix follows the operations switched on.
  const slipsOf = (list) => cached(list, `slips ${E.dayKey()}`, () => St.slips(flatOf(list)));
  const smartOf = (list, top) => cached(list, `smart ${top} ${E.fingerprint(config())}`, () => St.smartDrill(flatOf(list), config(), top));

  /** Rounds from the last 30 days, drills included — what drills are built from. */
  const recentRounds = () => St.selectSessions(S.data.sessions, { range: 'd30', drills: true });
  /** Recent slips in the operations switched on, worst first: what a smart drill mixes in. */
  const recentSlips = () => {
    const ops = E.normalizeConfig(config()).ops;
    return slipsOf(St.selectSessions(S.data.sessions, { range: 'all', drills: true })).rows.filter((t) => ops[t.op]);
  };

  // Pages that live under another page's tab, and renderers other files add
  // (oa-ui.js registers the assessment pages).
  const TAB_OF = { e80: 'oa', oaresults: 'oa', oamock: 'oa' };
  const VIEWS = {};
  const KEYS = {};
  const STATS = {}; // extra Stats views by kind (oa-ui.js adds 'oa')
  const SAVED = []; // called with each round once it's saved (lb-ui.js posts scores)

  function show(view) {
    S.view = view;
    document.body.dataset.view = view;
    for (const sec of document.querySelectorAll('.view')) sec.classList.toggle('active', sec.id === `view-${view}`);
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === (TAB_OF[view] || view));
    C.hideTip();
    if (view === 'play') renderPlay();
    else if (view === 'drill') renderDrill();
    else if (view === 'stats') renderStats();
    else if (view === 'e80') renderE80();
    else if (VIEWS[view]) VIEWS[view]();
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

  /** The Classic card's one-line summary: "Standard · 120 s · + – × ÷" or "Custom · 60 s · ×". */
  function setupSummary(c) {
    const n = E.normalizeConfig(c);
    const standard = E.isDefaultConfig({ ...n, duration: E.defaultConfig().duration });
    const ops = E.OPS.filter((o) => n.ops[o]).map((o) => E.SYMBOL[o]).join(' ');
    return `${standard ? 'Standard' : 'Custom'} · ${n.duration} s · ${ops}`;
  }

  /** The record card's goal: a small box and how often the last 10 reached it. */
  function recordGoalHtml(scores) {
    const goal = goals().classic;
    const last = scores.slice(-10);
    const hits = last.filter((v) => v >= goal).length;
    const status = !last.length ? '' : hits === last.length && last.length >= 5 ? `hit in all of the last ${last.length}` : `hit ${hits} of the last ${last.length}`;
    return `<div class="rec-goal">
        <label class="goal-edit">Goal <input type="number" min="1" max="999" data-goal="classic" value="${goal}" aria-label="Goal score"></label>
        ${status ? `<span class="sub" title="Rounds at or above your goal, out of your last ${last.length}">${status}</span>` : ''}
      </div>`;
  }

  /** sync: a sync redraw, which leaves the record card alone while its Goal box is being typed in. */
  function renderPlaySide({ sync = false } = {}) {
    $('setupSummary').textContent = setupSummary(config());
    renderDailyCard();
    renderWeekCard();
    const sc = scoreOf(S.data.sessions, E.fingerprint(config()));
    const rc = $('recordCard');
    const at = `At these settings: ${E.describeConfig(config())}`;
    if (sync && typingGoalIn(rc)) {
      // Keep the box (and what's typed in it); the next redraw catches the card up.
    } else if (!sc.games) {
      rc.innerHTML = `<div class="card-head"><h2>Record</h2><span class="sub" data-games="0" title="${esc(at)}">no games yet</span></div>
        ${recordGoalHtml([])}`;
    } else {
      rc.innerHTML = `<div class="card-head"><h2>Record</h2><span class="sub" data-games="${sc.games}" title="${esc(at)}">${sc.games} game${sc.games === 1 ? '' : 's'}</span></div>
        <div class="rec-row">
          <div><div class="rec-val">${sc.best}</div><div class="mini-label">best</div></div>
          <div><div class="rec-val">${sc.recentAvg.toFixed(1)}</div><div class="mini-label">last 10 avg</div></div>
          <div class="spark" id="playSpark" title="Your last ${Math.min(30, sc.history.length)} scores"></div>
        </div>
        ${recordGoalHtml(sc.history.map((h) => h.score))}`;
      C.sparkline($('playSpark'), sc.history.slice(-30).map((h) => h.score), { height: 40 });
    }

    renderNextUp();
  }

  /**
   * One suggested round with its reason: the smart drill (pointing out a type
   * close to its next level), then a level within reach.
   */
  function renderNextUp() {
    const fc = $('focusCard');
    const recent = recentRounds();
    const next = Pg.nextUp({
      smart: smartOf(recent, 4),
      levels: skillsOf(S.data.sessions),
    });
    const toGo = (r) => Math.max(1, Math.ceil((r.level + 1) * 10 - r.pace));
    const pts = (r) => `${toGo(r)} point${toGo(r) === 1 ? '' : 's'} of pace from level ${r.level + 1}`;
    // One compact row: a small label, one line, and its button (the why sits in the tooltip).
    const row = (why, line, button = '') => {
      fc.title = why;
      fc.innerHTML = `<div class="tr-main"><div class="tr-label">Next up</div><div class="tr-line">${line}</div></div>${button}`;
    };
    if (!next) {
      row('After a game or two, this suggests what to practice next: the types that cost you the most time, or a level within reach.',
        '<span class="muted">Play a round or two first</span>');
    } else if (next.kind === 'smart') {
      const list = next.rows.map((r) => `${r.name} ${r.cost.toFixed(1)}×`).join('\n');
      const near = next.near ? `\n${levelName(next.near.key)} is ${pts(next.near)}.` : '';
      const top = next.rows[0];
      row(`Your costliest types over the last 30 days (× = time against an average problem, misses counted):\n${list}${near}`,
        `${esc(top.name)}${next.rows.length > 1 ? ` <span class="muted">+${next.rows.length - 1} more</span>` : ''}`,
        '<button class="btn small" data-action="smart-drill">Drill these</button>');
    } else {
      const r = next.row;
      row(`A level within reach: ${levelName(r.key)} is ${pts(r)}. A short drill of just this type; results say when it levels up.`,
        `<b>${esc(levelName(r.key))}</b> <span class="muted">· ${toGo(r)} to level ${r.level + 1}</span>`,
        `<button class="btn small" data-action="drill-key" data-key="${r.key}" data-label="${esc(levelName(r.key))}">Drill</button>`);
    }
  }

  function startClassic() {
    const c = readForm();
    startGame({ mode: 'classic', plan: { kind: 'classic' }, config: c, duration: c.duration, label: null, returnTo: 'play' });
  }

  // ---- daily challenge -----------------------------------------------------
  // One shared 120-second set a day at Zetamac's defaults. The day's first saved
  // round is the ranked one; it's an ordinary classic game in every other way.

  const dailyAttempt = (day) => S.data.sessions.find((s) => s.daily === day) || null;

  function startDaily() {
    const day = E.dayKey();
    if (dailyAttempt(day)) return startClassic();
    startGame({ mode: 'classic', plan: { kind: 'classic' }, config: E.defaultConfig(), duration: 120, label: null, daily: day, returnTo: 'play' });
  }

  function dailyShareText(s) {
    const all = St.agg(St.flatten([s]));
    const quit = s.aborted ? ' (quit early)' : '';
    return `Zetapro Daily #${E.dailyNumber(s.daily)}: ${s.score}${quit} · ${all.n ? pct(all.accuracy) : '0%'} first try\n${SITE}`;
  }

  async function copyDaily(s) {
    const text = dailyShareText(s);
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied. Paste it anywhere.');
    } catch {
      toast(text.replace('\n', ' · '));
    }
  }

  function renderDailyCard() {
    const day = E.dayKey();
    const n = E.dailyNumber(day);
    const done = dailyAttempt(day);
    const dc = $('dailyCard');
    if (!done) {
      dc.title = "Today's set is the same for everyone: 120 seconds at Zetamac's defaults. Your first try is the one that counts.";
      dc.innerHTML = `<div class="tr-main"><div class="tr-label">Daily #${n}</div><div class="tr-line muted">Not played yet</div></div>
        <button class="btn small" data-action="daily-start">Play</button>`;
      return;
    }
    const played = S.data.sessions.filter((s) => s.daily).length;
    dc.title = `Done for today; the next one is at midnight. ${played} dail${played === 1 ? 'y' : 'ies'} played.`;
    dc.innerHTML = `<div class="tr-main"><div class="tr-label">Daily #${n}</div>
        <div class="tr-line"><span class="tr-big">${done.score}</span>${done.aborted ? ' <span class="muted">quit</span>' : ''}</div></div>
      <button class="btn small" data-action="daily-share">Copy result</button>`;
  }

  // ---- practice: calendar, weekly goal, last week ------------------------------

  // One formatter for the calendar's ~140 day labels: toLocaleDateString builds a new one per call.
  const calDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  /** GitHub-style calendar of the last 20 weeks: any finished round marks a day. */
  function calendarHtml(byDay) {
    const today = E.dayKey();
    const level = (n) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
    const label = (day) => calDay.format(new Date(`${day}T12:00`));
    const cells = St.calendarWeeks(byDay, 20).flat().map((c) => (c
      ? `<i class="l${level(c.n)}${c.day === today ? ' today' : ''}" data-tip="${label(c.day)}\n${c.n ? `${c.n} round${c.n > 1 ? 's' : ''}` : 'No practice'}"></i>`
      : '<i class="future"></i>')).join('');
    const last30 = St.daysPractised(byDay, 30);
    return `<div class="cal" role="img" aria-label="Practice calendar: ${last30} of the last 30 days">${cells}</div>
      <p class="sub cal-note">Practiced ${last30} of the last 30 days</p>`;
  }

  /**
   * The weekly goal, framed like the score goals: days this week and the streak as
   * big numbers, then one line on how the week is going and how many recent weeks
   * met it. A missed week just doesn't count; nothing "breaks".
   */
  function weekGoalHtml(g, streak) {
    const past = g.goal && g.past.weeks ? ` · met ${g.past.met} of the last ${g.past.weeks} week${g.past.weeks === 1 ? '' : 's'}` : '';
    const status = !g.goal ? 'No weekly goal'
      : g.met ? `<span class="better">Goal of ${g.goal} met</span>${past}`
        : `${g.left} more to go${past}`;
    return `<div class="wk-stats">
        <div><div class="rec-val wk-days">${g.days}${g.goal ? `<small>/${g.goal}</small>` : ''}</div><div class="mini-label">day${g.days === 1 && !g.goal ? '' : 's'} this week</div></div>
        <div><div class="rec-val">${streak}</div><div class="mini-label">day streak</div></div>
      </div>
      ${g.goal ? `<div class="goal-track" title="Days practiced this week"><span style="width:${Math.min(1, g.days / g.goal) * 100}%"></span></div>` : ''}
      <p class="sub wk-status">${status}</p>`;
  }

  /**
   * Progress.lastWeek reads only rounds from before this week, so it's worked out
   * from those: new rounds this week leave it as it was.
   */
  function lastWeekOf(sessions, now = new Date()) {
    const to = Pg.weekStart(now).getTime();
    const before = sessions.filter((s) => s.at < to);
    return cached(before, `lastWeek ${to}`, () => Pg.lastWeek(before, now));
  }

  /** Last week in two lines, shown all this week; nothing at all if last week was empty. */
  function lastWeekHtml() {
    const w = lastWeekOf(S.data.sessions);
    if (!w) return '';
    const bits = [];
    if (w.classicBest != null) bits.push(`Classic best ${w.classicBest}${w.newBest ? ' <span class="better">(a new best)</span>' : ''}`);
    if (w.e80Best != null) bits.push(`80 in 8 best ${w.e80Best < 0 ? `−${-w.e80Best}` : w.e80Best}`);
    if (w.oaTests) bits.push(`${w.oaTests} Arcade test${w.oaTests === 1 ? '' : 's'}`);
    const ups = w.levelUps.filter((u) => u.kind === 'op');
    if (ups.length) bits.push(`${ups.map((u) => `${esc(E.OP_NAME[u.key])} to level ${u.to}`).join(', ')}`);
    else if (w.levelUps.length) bits.push(`${w.levelUps.length} type${w.levelUps.length === 1 ? '' : 's'} leveled up`);
    return `<div class="recap">
        <h3 class="mini-h">Last week</h3>
        <p>${w.days} day${w.days === 1 ? '' : 's'} · ${w.rounds} round${w.rounds === 1 ? '' : 's'} · ${w.minutes} min</p>
        ${bits.length ? `<p class="sub">${bits.join(' · ')}</p>` : ''}
      </div>`;
  }

  // Open/closed state of the Play page's two disclosures, kept per device.
  const OPEN_KEYS = { customize: 'zetapro-customize-open', calendar: 'zetapro-calendar-open' };
  function openPref(which) {
    try { return localStorage.getItem(OPEN_KEYS[which]) === '1'; } catch { return false; }
  }
  function setOpenPref(which, open) {
    try { localStorage.setItem(OPEN_KEYS[which], open ? '1' : '0'); } catch { /* storage blocked: just don't remember */ }
  }

  function renderWeekCard() {
    const byDay = cached(S.data.sessions, 'byDay', () => St.practiceByDay(S.data.sessions));
    const g = Pg.weekGoal(byDay, S.data.settings.weeklyGoal);
    const opts = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === g.goal ? 'selected' : ''}>${n ? `${n} day${n === 1 ? '' : 's'}` : 'Off'}</option>`).join('');
    $('weekCard').innerHTML = `<div class="card-head"><h2>This week</h2>
        <label class="goal-edit wk-goal" title="Practice days a week">Goal <select data-week-goal aria-label="Weekly goal: practice days a week">${opts}</select></label></div>
      ${weekGoalHtml(g, St.practiceStreak(byDay))}
      <details class="cal-details" data-open-pref="calendar"${openPref('calendar') ? ' open' : ''}>
        <summary><span class="when-closed">Show calendar</span><span class="when-open">Hide calendar</span></summary>
        ${calendarHtml(byDay)}
        ${lastWeekHtml()}
      </details>`;
  }

  // ---- game ----------------------------------------------------------------

  function startGame(opts) {
    const cfg = E.normalizeConfig(opts.config);
    S.last = opts;
    S.game = {
      opts,
      config: cfg,
      next: opts.daily ? E.dailyGenerator(opts.daily) : E.createGenerator(opts.plan, cfg),
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
    $('gameLabel').textContent = opts.mode === 'drill' ? `Drill · ${opts.label}` : opts.daily ? `Daily #${E.dailyNumber(opts.daily)}` : '';
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
    // No problem yet during the 3-2-1, so an early Enter has nothing to clear.
    if (!g || g.done || !g.attempt) return;
    if (g.attempt.submit($('answer').value) === 'cleared') {
      $('answer').value = '';
      $('answer').classList.remove('wrong');
    }
  }

  /** restart: after a quit, go straight into a fresh round with the same setup. */
  async function finishGame(aborted, restart = false) {
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
      ...(g.opts.daily ? { daily: g.opts.daily } : {}),
      config: g.config,
      duration: g.opts.duration,
      score: g.score,
      aborted,
      problems: g.problems,
      unfinished: rec ? { ...rec, ms: Math.round(performance.now() - g.shownAt) } : null,
    };
    const before = scoreOf(S.data.sessions, E.fingerprint(g.config));
    // A quit with nothing answered isn't worth a row; anything else is data.
    if (!aborted || g.problems.length) await saveSession(session);
    S.game = null;
    if (aborted) {
      // A daily can't be retried once a round of it is saved; restart plays a normal one.
      if (restart) (g.opts.daily && dailyAttempt(g.opts.daily) ? startClassic() : startGame(g.opts));
      else show(g.opts.returnTo || 'play');
      return;
    }
    renderResults(session, before);
    show('results');
  }

  // ---- results -------------------------------------------------------------

  function problemLine(p, right) {
    return `<span class="q">${esc(E.textOf(p))} = ${E.answerOf(p)}</span><span class="detail">${right || ''}</span>`;
  }

  /**
   * One line comparing a result with the player's history:
   * "▼ 2.0 vs your recent average (5.0) · 3 short of your best (6) · 67 short of your 70 goal".
   * unit is '' for scores or '/min' for drill pace; fmt formats the best.
   */
  function deltaHtml({ score, avg = null, best = null, goal = null, unit = '', fmt = String }) {
    const parts = [];
    if (avg != null && Number.isFinite(avg)) {
      const d = score - avg;
      parts.push(`<span class="${d >= 0 ? 'better' : 'worse'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}${unit}</span> vs your recent average (${avg.toFixed(1)}${unit})`);
    }
    // Above the best is already celebrated by the badge.
    if (best != null && Number.isFinite(best) && score <= best) {
      const gap = unit ? (best - score).toFixed(1) : String(best - score);
      parts.push(Number(gap) === 0 ? 'Tied your best' : `${gap}${unit} short of your best (${fmt(best)})`);
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
    setResultsActions(s);
    if (s.mode === 'classic') {
      $('resLabel').textContent = `${s.daily ? `Daily #${E.dailyNumber(s.daily)}` : 'Score'} · ${E.describeConfig(s.config)}`;
      if (before.games && s.score > before.best) {
        const mark = Pg.milestone(s.score, before.best);
        badge.textContent = `New best (+${s.score - before.best})${mark ? ` · first ${mark}+` : ''}`;
        badge.hidden = false;
      } else if (s.score >= goals().classic) {
        badge.textContent = `Goal reached (${goals().classic})`;
        badge.hidden = false;
      }
      $('resSub').textContent = before.games ? '' : 'First game at these settings — this is your baseline.';
      $('resDelta').innerHTML = before.games
        ? deltaHtml({ score: s.score, avg: before.recentAvg, best: before.best, goal: goals().classic })
        : deltaHtml({ score: s.score, goal: goals().classic });
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
        ? `${s.score} solved in ${s.duration}s`
        : `First drill of this kind: ${s.score} solved in ${s.duration}s. This pace is your baseline.`;
      $('resDelta').innerHTML = deltaHtml({ score: pace, avg: recentAvg, best, unit: '/min', fmt: (v) => `${v.toFixed(1)}/min` });
    }

    $('resLevels').innerHTML = levelsLine(s);

    const mistakes = probs.reduce((n, p) => n + p.errors, 0);
    $('resKpis').innerHTML = [
      ['First-try accuracy', all.n ? pct(all.accuracy) : '—'],
      ['Avg time / problem', all.n ? secs(all.meanMs) : '—'],
      ['Mistakes', String(mistakes)],
      ['Median time', all.n ? secs(all.medianMs) : '—'],
    ].map(([l, v]) => tile(l, v)).join('');

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

  // ---- skill levels --------------------------------------------------------

  const levelName = (key) => (E.OPS.includes(key) ? E.OP_NAME[key] : E.categoryInfo(key).name);

  /** The results line: level-ups this round earned, or a first round's starting levels. */
  function levelsLine(s) {
    // "Before" is usually the list Play last drew from, so only "after" is new work.
    const before = skillsOf(S.data.sessions.filter((x) => x.id !== s.id));
    const after = skillsOf(S.data.sessions);
    const ups = Pg.levelUps(before, after);
    if (ups.length) {
      const shown = ups.slice(0, 3).map((u) => `${esc(levelName(u.key))} to <b>${u.to}</b>`).join(' · ');
      return `<span class="better">▲ Level up</span> ${shown}${ups.length > 3 ? ` · ${ups.length - 3} more in Stats` : ''}`;
    }
    const first = Pg.firstLevels(before, after);
    if (!first.length) return '';
    return `Starting levels: ${first.map((f) => `${E.SYMBOL[f.key]} <b>${f.level}</b>`).join(' · ')}. They go up as you get faster (Stats).`;
  }

  const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

  /**
   * One level with its bar to the next. The change is against `then` (the same
   * key 30 days ago) or, for newer players, against where the level started.
   */
  function levelRow(r, then, drill = false) {
    const info = E.OPS.includes(r.key) ? null : E.categoryInfo(r.key);
    const base = then && then.pace != null ? { pace: then.pace, when: 'in 30 days' }
      : r.start && r.start.pace !== r.pace ? { pace: r.start.pace, when: `since ${shortDay.format(r.start.at)}` } : null;
    const d = base ? Math.floor(r.pace) - Math.floor(base.pace) : 0;
    const change = d > 0 ? ` · <span class="better">▲ ${d}</span> ${base.when}` : d < 0 ? ` · ▼ ${-d} ${base.when}` : '';
    const toGo = Math.max(1, Math.ceil((r.level + 1) * 10 - r.pace));
    // The pace and sample size behind the level sit in the row's tooltip.
    const tip = `Pace ${Math.floor(r.pace)} · ${Math.round(r.next * 100)}% of the way to level ${r.level + 1}${r.full ? '' : ` · from ${r.n} problems`}`;
    return `<li class="lv-row">${opBadge(info ? info.op : r.key)}
        <div class="lv-main" title="${tip}">
          <div class="lv-top"><span class="lv-name">${esc(levelName(r.key))}</span><span class="lv-level">Level ${r.level}</span></div>
          <div class="lv-bar"><span style="width:${r.next * 100}%"></span></div>
          <div class="lv-sub">${toGo} to level ${r.level + 1}${change}</div>
        </div>
        ${drill ? `<button class="btn small" data-action="drill-key" data-key="${r.key}" data-label="${esc(levelName(r.key))}">Drill</button>` : ''}</li>`;
  }

  /** Stats → Classic: a level per operation, the types closest to their next level, and every type on request. */
  function levelsCardHtml() {
    const lv = skillsOf(S.data.sessions);
    // Progress.skillsAt(sessions, at) is skills() of the rounds started before `at`.
    const cut = Date.now() - 30 * Pg.DAY;
    const then = skillsOf(S.data.sessions.filter((s) => s.at < cut));
    const ops = E.OPS.map((op) => lv.get(op)).filter((r) => r && r.level != null);
    const how = 'Level 6 is fast enough to score 60–69 in a Classic round of just those problems.\n\n'
      + `Pace is the score your average time would make in 120 seconds: over your last ${Pg.WINDOW.op} problems of an operation, or ${Pg.WINDOW.type} of a type. `
      + 'Standard ranges only, drills included, whatever the range above.';
    const head = `<div class="card-head"><h2>Skill levels</h2><span class="sub hint" title="${esc(how)}">Level 6 ≈ a Classic score of 60–69</span></div>`;
    if (!ops.length) {
      return `<div class="card">${head}<p class="empty-note">Your levels show once you've answered ${Pg.MIN_N} problems of a kind at Zetamac's standard ranges.</p></div>`;
    }
    const near = Pg.withinReach(lv, 3);
    const groups = E.allCategories();
    const types = E.OPS.flatMap((op) => groups[op]).map((k) => lv.get(k)).filter((r) => r && r.level != null);
    const waiting = [...lv.values()].filter((r) => r.kind === 'type' && r.level == null).length;
    return `<div class="card">${head}
      <ul class="lv-list">${ops.map((r) => levelRow(r, then.get(r.key))).join('')}</ul>
      ${near.length ? `<h3 class="mini-h">Closest to the next level</h3>
        <ul class="lv-list">${near.map((r) => levelRow(r, then.get(r.key), true)).join('')}</ul>` : ''}
      ${S.showAllLevels ? `<h3 class="mini-h">Every type</h3>
        <ul class="lv-list">${types.map((r) => levelRow(r, then.get(r.key), true)).join('')}</ul>
        ${waiting ? `<p class="sub">${waiting} more type${waiting === 1 ? '' : 's'} need ${Pg.MIN_N} problems first.</p>` : ''}` : ''}
      <div class="more-row"><button class="btn link" data-action="toggle-levels">${S.showAllLevels ? 'Hide the types' : `Show every type (${types.length})`}</button></div>
    </div>`;
  }

  function again() {
    if (!S.last) return;
    if (S.last.mode === 'e80') startE80(S.last);
    else if (S.last.daily) startClassic();
    else startGame(S.last);
  }

  /** Daily results get "Copy result", and the again button plays a normal round. */
  function setResultsActions(s) {
    $('againBtn').innerHTML = `${s.daily ? 'Normal round' : 'Try again'} <kbd>Enter</kbd>`;
    $('shareBtn').hidden = !s.daily;
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
    const d = smartOf(recentRounds(), 6);
    if (!d) return toast('Play a game or two first so there is something to aim at.');
    // About one problem in four is a recent slip, worst first, cycling.
    const slips = recentSlips().map((t) => ({ op: t.op, a: t.a, b: t.b }));
    startDrill({ kind: 'weights', weights: d.weights, ...(slips.length ? { slips } : {}) }, 'Smart mix', 'smart');
  }

  function renderDrill() {
    const recent = recentRounds();
    const costs = cached(recent, 'costs', () => Object.fromEntries(St.categories(flatOf(recent)).rows
      .filter((r) => !r.lowData).map((r) => [r.key, r.cost])));

    const smart = smartOf(recent, 6);
    const costTip = '× is how much longer a type takes you than an average problem, with misses counted against it';
    // Recent slips ride along: one quiet line naming the worst few.
    const slips = smart ? recentSlips() : [];
    const NAMED = 4;
    const slipLine = slips.length
      ? `<p class="sub slip-line" title="Problems you missed or were slow on in the last ${St.SLIP_DAYS} days. About one in four smart-drill problems is one of these, worst first; each drops off after ${St.CLEAR_AFTER} clean answers in a row.">Includes ${slips.length} recent slip${slips.length === 1 ? '' : 's'}: ${slips.slice(0, NAMED).map((t) => esc(t.text)).join(', ')}${slips.length > NAMED ? '…' : ''}</p>`
      : '';
    $('smartCard').innerHTML = `<h2>Smart drill</h2>
      <p class="sub drill-desc" title="A mix of your costliest problem types from the last 30 days. The worse a type is, the more often it comes up.">Your costliest types, the worst most often.</p>
      <div class="grow">${smart
        ? `<div class="chips">${smart.rows.map((r) => `<span class="chip" title="${r.cost.toFixed(1)}× · ${costTip}">${esc(r.name)}</span>`).join('')}</div>${slipLine}`
        : '<p class="empty-note">Not enough data yet.</p>'}</div>
      <div class="actions"><button class="btn primary" data-action="smart-drill" ${smart ? '' : 'disabled'}>Start smart drill</button></div>`;

    const groups = E.allCategories();
    const chip = (key) => {
      const info = E.categoryInfo(key);
      const c = costs[key];
      return `<button class="chip ${S.custom.has(key) ? 'on' : ''}" data-action="toggle-custom" data-key="${key}" title="e.g. ${esc(info.example)}${c ? ` · ${c.toFixed(1)}× your average time` : ''}">${esc(info.short)}${c ? ` <span class="c">${c.toFixed(1)}×</span>` : ''}</button>`;
    };
    const n = S.custom.size;
    $('customCard').innerHTML = `<h2>Pick your own</h2>
      <p class="sub drill-desc" title="${costTip} (1.0× = average).">Any types you choose; × is your time against average.</p>
      ${E.OPS.map((op) => `<div class="pick-group"><div class="g">${E.OP_NAME[op]}</div><div class="chips">${groups[op].map(chip).join('')}</div></div>`).join('')}
      <div class="actions pick-actions">
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
        <p class="sub drill-desc" title="Pace per round, and whether each targeted type is getting faster.">Your smart drills will be tracked here.</p>`;
      return;
    }
    // Drill length can change, so rounds are compared by problems solved per minute.
    const pace = drills.map((s, i) => ({ value: Math.round((s.score / (s.duration / 60)) * 10) / 10, label: i + 1, at: s.at, score: s.score, duration: s.duration }));
    const avg = (list) => list.reduce((t, p) => t + p.value, 0) / list.length;
    const recentPace = avg(pace.slice(-5));

    // Per type, from these drills alone; only which types are still in the mix follows the last 30 days.
    const { all, types } = cached(drills, 'smartStats', () => {
      const probs = St.flatten(drills);
      const byCat = {};
      for (const p of probs) (byCat[p.cls.cat] = byCat[p.cls.cat] || []).push(p);
      return {
        all: St.agg(probs),
        types: Object.entries(byCat).map(([key, list]) => {
          // Trend: average time over the later half of attempts minus the earlier half.
          let trend = null;
          if (list.length >= 6) {
            const half = Math.floor(list.length / 2);
            trend = St.agg(list.slice(half)).meanMs - St.agg(list.slice(0, half)).meanMs;
          }
          return { ...E.categoryInfo(key), ...St.agg(list), trend };
        }),
      };
    });
    const inMix = new Set(((smartOf(recentRounds(), 6) || {}).rows || []).map((r) => r.key));
    const rows = types.map((r) => ({ ...r, live: inMix.has(r.key) }));
    rows.sort((x, y) => (y.live - x.live) || (y.n - x.n));
    const trendText = (t) => (t == null
      ? '<span class="muted" title="Needs 6+ attempts">—</span>'
      : `<span class="${t <= 0 ? 'better' : 'worse'}">${t <= 0 ? '▼' : '▲'} ${secs(Math.abs(t))}</span>`);
    const live = rows.filter((r) => r.live).length;
    // Big number, small label; the detail moves into the tooltip.
    const stat = (label, value, tip) => `<div class="tile" title="${esc(tip)}"><div class="value">${value}</div><div class="label">${label}</div></div>`;

    card.innerHTML = `<div class="card-head"><h2>Smart drill stats</h2><span class="sub">${drills.length} round${drills.length === 1 ? '' : 's'}</span></div>
      <div class="tiles four">
        ${stat('pace / min', recentPace.toFixed(1), `Problems per minute, last ${Math.min(5, pace.length)} avg · best ${Math.max(...pace.map((p) => p.value)).toFixed(1)}/min`)}
        ${stat('first try', pct(all.accuracy), `${all.n - all.errN} of ${all.n} problems right first time`)}
        ${stat('avg time', secs(all.meanMs), `Average time per problem · median ${secs(all.medianMs)}`)}
        ${stat('graduated', `${rows.length - live}<small>/${rows.length}</small>`, `${live} type${live === 1 ? '' : 's'} still in the mix. Graduated types have dropped out of your 6 costliest, so smart drills stop serving them.`)}
      </div>
      ${pace.length > 1 ? '<h3 class="mini-h">Pace per round</h3><div class="chart" id="smartChart"></div>' : ''}
      <h3 class="mini-h">Types it has drilled</h3>
      <table class="cats">
        <thead><tr><th>Problem type</th><th class="num">Seen</th><th class="num">First try</th><th class="num">Avg time</th><th class="num" title="Your later attempts at a type against your earlier ones (▼ = faster)">Trend</th><th title="Graduated types have dropped out of your 6 costliest, so smart drills stop serving them">Status</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td title="e.g. ${esc(r.example)}">${esc(r.name)}</td>
          <td class="num">${r.n}</td><td class="num">${pct(r.accuracy)}</td><td class="num">${secs(r.meanMs)}</td>
          <td class="num">${trendText(r.trend)}</td>
          <td>${r.live ? '<span class="st live">In the mix</span>' : '<span class="st done">Graduated</span>'}</td></tr>`).join('')}</tbody>
      </table>`;
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

  /** A tile whose fuller explanation is its tooltip. */
  const titledTile = (tip, ...a) => tile(...a).replace('<div class="tile">', `<div class="tile" title="${esc(tip)}">`);

  // Stats sections below the headline cards fold away, and each remembers whether
  // it was left open (kept in memory too, for when storage is unavailable).
  const FOLD_KEY = 'zetapro-stats-open';
  const folds = (() => {
    try {
      const m = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}');
      return m && typeof m === 'object' ? m : {};
    } catch { return {}; }
  })();

  /** A named section that folds away: its title and a one-line summary show while it's closed. */
  const foldHtml = (id, title, summary, inner) => `
      <details class="card fold" data-fold="${id}"${folds[id] ? ' open' : ''}>
        <summary><h2>${title}</h2><span class="fold-sum">${summary}</span></summary>
        <div class="fold-body">${inner}</div>
      </details>`;

  function wireFolds(body) {
    for (const d of body.querySelectorAll('details[data-fold]')) {
      d.addEventListener('toggle', () => {
        folds[d.dataset.fold] = d.open;
        try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch { /* this session only */ }
      });
    }
  }

  /** The factor map's one-liner: its worst cell for the metric shown, preferring cells with a few samples. */
  function factorSummary(fm) {
    const time = S.mapMetric === 'time';
    let worst = null;
    for (const col of fm.cols) {
      for (const f of fm.factors) {
        const key = `${col.key}.${f}`;
        const c = fm.cells[key];
        if (!c || !c.n) continue;
        const v = time ? c.meanMs : c.errRate;
        const solid = c.n >= 3;
        if (!worst || (solid && !worst.solid) || (solid === worst.solid && v > worst.v)) worst = { key, v, solid };
      }
    }
    if (!worst) return 'No × or ÷ in this range';
    if (!time && !worst.v) return 'No misses on × or ÷';
    return `${time ? 'Slowest' : 'Most missed'}: ${esc(E.categoryInfo(worst.key).name)} · ${time ? secs(worst.v) : pct(worst.v)}`;
  }

  // Score per game: 'fit' zooms the Y axis to the games shown (the default),
  // 'full' runs it from zero. The choice is remembered on this device.
  const SCORE_SCALE_KEY = 'zetapro-score-scale';
  let scoreScaleNow = null; // the choice when storage is blocked
  function scoreScale() {
    if (scoreScaleNow) return scoreScaleNow;
    try { return localStorage.getItem(SCORE_SCALE_KEY) === 'full' ? 'full' : 'fit'; } catch { return 'fit'; }
  }
  function setScoreScale(scale) {
    scoreScaleNow = scale;
    try { localStorage.setItem(SCORE_SCALE_KEY, scale); } catch { /* this session only */ }
  }

  function scoreScaleSegHtml() {
    const on = scoreScale();
    return `<div class="seg" id="scoreScaleSeg" role="group" aria-label="Score axis">${[
      ['fit', 'Fit', 'Zoom the axis to the games shown'],
      ['full', 'Full', 'Run the axis from zero'],
    ].map(([k, l, t]) => `<button data-scale="${k}" class="${on === k ? 'on' : ''}" aria-pressed="${on === k}" title="${t}">${l}</button>`).join('')}</div>`;
  }

  /** Draws the score chart at the remembered scale; the Fit / Full buttons redraw just the chart. */
  function drawScoreChart(sc) {
    const el = $('scoreChart');
    if (!el) return;
    C.lineChart(el, sc.history.map((h) => ({ value: h.score, label: h.i, at: h.at })), {
      scale: scoreScale(),
      xLabel: (p) => `#${p.label}`,
      ref: { value: goals().classic, label: `goal ${goals().classic}`, goal: true },
      tipHtml: (p) => `<b>Game ${p.label}</b> · ${esc(dateFmt.format(p.at))}<br>Score <b>${p.value}</b>`,
    });
    const seg = $('scoreScaleSeg');
    if (seg && !seg.dataset.wired) {
      seg.dataset.wired = '1';
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-scale]');
        if (!b || b.dataset.scale === scoreScale()) return;
        setScoreScale(b.dataset.scale);
        for (const x of seg.querySelectorAll('[data-scale]')) {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        }
        C.hideTip();
        drawScoreChart(sc);
      });
    }
  }

  function renderStats() {
    $('statsKindSeg').innerHTML = [['classic', 'Classic'], ['oa', 'Arcade']]
      .map(([k, l]) => `<button data-kind="${k}" class="${S.statsKind === k ? 'on' : ''}">${l}</button>`).join('');
    // The range and drills filters only apply to Classic.
    $('statsFilters').hidden = S.statsKind !== 'classic';
    if (S.statsKind === 'oa' && STATS.oa) return STATS.oa($('statsBody'));
    renderRangeSeg();
    const body = $('statsBody');
    const sessions = St.selectSessions(S.data.sessions, { range: S.statsRange, drills: S.statsDrills });
    // Everything below the tiles comes from these rounds' problems: worked out once per
    // range, then toggles, the map metric, resizes and theme changes only redraw.
    const st = cached(sessions, `stats ${E.dayKey()}`, () => {
      const probs = St.flatten(sessions);
      return {
        n: probs.length,
        overall: St.agg(probs),
        cats: St.categories(probs),
        fm: St.factorMap(probs),
        mk: St.mistakes(probs),
      };
    });
    // Most missed is all time, whatever the range (drills follow the toggle).
    const allRounds = St.selectSessions(S.data.sessions, { range: 'all', drills: S.statsDrills });
    const tr = cached(allRounds, 'mostMissed', () => St.mostMissed(flatOf(allRounds), 15));
    if (!st.n) {
      body.innerHTML = `<div class="card empty"><h2>No games in this range yet</h2>
        <p>Play a round and this page breaks down which kinds of problems cost you time and where your mistakes come from.</p>
        <div class="actions" style="justify-content:center;margin-top:16px"><button class="btn primary" data-action="goto-play">Play a game</button></div></div>`;
      return;
    }

    const sc = scoreOf(sessions, E.fingerprint(config()));
    const { overall, cats, fm, mk } = st;
    const drills = sessions.filter((s) => s.mode === 'drill').length;

    // Headline numbers: one short note each; the longer story is in the tooltip.
    const tiles = [
      tile('Games', sessions.length, drills ? `${sessions.length - drills} classic · ${drills} drill` : 'all classic'),
      tile('Best score', sc.best ?? '—', esc(E.describeConfig(config()))),
      titledTile(sc.games ? `Your last ${Math.min(10, sc.games)} classic games at these settings` : 'Classic games at these settings',
        'Average score', sc.recentAvg != null ? sc.recentAvg.toFixed(1) : '—', `goal ${goals().classic}`),
      tile('First-try accuracy', pct(overall.accuracy), `${overall.n - overall.errN} of ${overall.n}`),
      tile('Avg time / problem', secs(overall.meanMs), `median ${secs(overall.medianMs)}`),
    ].join('');

    const visible = S.showAllCats ? cats.rows : cats.rows.slice(0, 10);
    const maxCost = Math.max(1.5, ...cats.rows.map((r) => r.cost));
    const catRows = visible.map((r) => {
      const tip = `${r.name}\n${r.n} problems · ${pct(r.accuracy)} first try\navg ${secs(r.meanMs)} · median ${secs(r.medianMs)}`;
      return `<tr class="${r.lowData ? 'thin' : ''}">
        <td title="e.g. ${esc(r.example)}">${esc(r.name)}${r.lowData ? '<span class="tag">few samples</span>' : ''}</td>
        <td class="num">${r.n}</td>
        <td class="num">${pct(r.accuracy)}</td>
        <td class="num">${secs(r.meanMs)}</td>
        <td class="costcell"><div class="cost" data-tip="${esc(tip)}">
          <div class="track"><div class="fill" style="width:${(r.cost / maxCost) * 100}%"></div><div class="avg" style="left:${(1 / maxCost) * 100}%"></div></div>
          <span class="v">${r.cost.toFixed(1)}×</span></div></td>
        <td><button class="btn small" data-action="drill-key" data-key="${r.key}" data-label="${esc(r.name)}">Drill</button></td>
      </tr>`;
    }).join('');
    const slowest = cats.rows[0];
    const slowdownHow = 'How much longer a type takes you than your average problem, with misses counted against it. The line in each bar marks 1.0×, your average.';

    // Open: the tiles, Skill levels and the score chart. Everything else folds away.
    const html = `
      <div class="tiles">${tiles}</div>

      ${levelsCardHtml()}

      <div class="card">
        <div class="card-head"><h2>Score per game</h2><div class="score-head-tools"><span class="sub" title="Classic games at your current settings">${esc(E.describeConfig(config()))}</span>${sc.history.length ? scoreScaleSegHtml() : ''}</div></div>
        ${sc.history.length ? '<div class="chart" id="scoreChart"></div>' : '<p class="empty-note">No classic games at these settings in this range.</p>'}
      </div>

      <div class="folds">
      ${foldHtml('cats', 'Where you lose time',
        slowest ? `Slowest: ${esc(slowest.name)} · ${slowest.cost.toFixed(1)}×` : 'No problem types yet', `
        <table class="cats">
          <thead><tr><th>Problem type</th><th class="num">Seen</th><th class="num">First try</th><th class="num">Avg time</th><th><span class="hint" title="${esc(slowdownHow)}">Slowdown</span></th><th></th></tr></thead>
          <tbody>${catRows}</tbody>
        </table>
        ${cats.rows.length > 10 ? `<div class="more-row"><button class="btn link" data-action="toggle-cats">${S.showAllCats ? 'Show top 10' : `Show all ${cats.rows.length} types`}</button></div>` : ''}`)}

      ${foldHtml('factors', 'Factor map', factorSummary(fm), `
        <div class="fold-tools"><div class="seg" id="metricSeg">
          <button data-metric="time" class="${S.mapMetric === 'time' ? 'on' : ''}">Avg time</button>
          <button data-metric="errors" class="${S.mapMetric === 'errors' ? 'on' : ''}">Miss rate</button>
        </div></div>
        ${factorMapHtml(fm)}`)}

      ${foldHtml('mistakes', 'Mistake patterns',
        mk.total ? `${mk.total} wrong entr${mk.total === 1 ? 'y' : 'ies'} · mostly ${esc(mk.rows[0].label.toLowerCase())}` : 'No wrong entries',
        mistakesHtml(mk))}

      ${foldHtml('trouble', 'Most missed',
        tr.count ? `All time · worst ${esc(tr.rows[0].text)} = ${tr.rows[0].answer}` : 'Nothing missed yet',
        tr.rows.length ? `
          <div class="fold-tools"><span class="sub">All time, whatever the range: most misses first, then most slow answers (twice your usual time).</span>
            <button class="btn" data-action="most-missed-drill">Drill these ${tr.rows.length}</button></div>
          <div class="trouble">${missedColumns(tr.rows)}</div>`
        : '<p class="empty-note">Nothing here: no misses and no unusually slow answers yet.</p>')}
      </div>`;

    body.innerHTML = html;
    wireFolds(body);
    S.mostMissed = tr.rows;

    if (sc.history.length) drawScoreChart(sc);
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
      <span>${fmt(hi)}${metric === 'time' ? 's' : ''} ${metric === 'time' ? 'slower' : 'more misses'}</span>
      <span class="legend-hint">Click a cell or a factor to drill it</span></div>`;
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

  function missedColumns(rows) {
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

  /** sync: a sync redraw, which leaves the record card alone while its Goal box is being typed in. */
  function renderE80({ sync = false } = {}) {
    const st = e80Settings();
    $('e80Penalty').value = String(st.penalty);
    $('e80Skip').checked = st.allowSkip;

    const sum = X.summary(S.data.sessions, st.penalty);
    const rc = $('e80Record');
    if (sync && typingGoalIn(rc)) {
      // Keep the box (and what's typed in it); the next redraw catches the card up.
    } else if (!sum.games) {
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
    if (!aborted || g.recs.length) await saveSession(session);
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

    setResultsActions(s);
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
    if (!s.practice && !before.games) bits.push(`reported pass line ≈ ${X.PASS_LINE}`);
    $('resSub').textContent = bits.join(' · ');
    $('resLevels').innerHTML = '';
    $('resDelta').innerHTML = s.practice ? ''
      : before.games ? deltaHtml({ score: s.score, avg: before.recentAvg, best: before.best, goal: goals().e80, fmt: signed })
        : deltaHtml({ score: s.score, goal: goals().e80 });

    const meanMs = probs.length ? probs.reduce((t, p) => t + p.ms, 0) / probs.length : 0;
    $('resKpis').innerHTML = [
      ['Accuracy', answered ? pct(s.right / answered) : '—'],
      ['Avg time / question', probs.length ? secs(meanMs) : '—'],
      ['Reached', `${s.problems.length} / ${s.questions}`],
      ['Time used', clock(s.timeUsedMs)],
    ].map(([l, v]) => tile(l, v)).join('');

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

  /** Types from one attempt worth practicing: anything missed, plus the slowest few. */
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
          // Redraw the signed-in view only, and never over something being typed.
          if (!$('syncModal').hidden && S.cloud && S.cloud.signedIn() && !typingInDialog()) renderAccountModal();
          // A failed first sync shouldn't make a later one jump to Stats.
          if (S.cloud && S.cloud.state().status === 'error') { S.firstCloudSync = false; S.signingIn = false; }
        },
        onUser: (u) => {
          updatePill();
          if (u && S.signingIn) S.firstCloudSync = true;
          if (!$('syncModal').hidden) renderAccountModal();
          if (S.view === 'lb') VIEWS.lb();
        },
        onData: (merged, r) => {
          onSyncedData(merged);
          if (S.firstCloudSync) {
            S.firstCloudSync = false;
            S.signingIn = false;
            closeSyncModal();
            const bits = [];
            if (r.pulled) bits.push(`${r.pulled} game${r.pulled === 1 ? '' : 's'} downloaded`);
            if (r.pushed) bits.push(`${r.pushed} uploaded`);
            const synced = `Signed in and synced${bits.length ? `: ${bits.join(', ')}` : ''}.`;
            // Signing in from the leaderboard stays there, ready to join.
            if (S.view === 'lb') return toast(synced);
            S.statsRange = 'all';
            S.statsDrills = true;
            show('stats');
            toast(`${synced} Showing all time.`);
          }
        },
      });
    } catch (e) {
      console.error('Account sync failed to start:', e);
      S.cloud = null;
    }
  }

  const typingInDialog = () => {
    const el = document.activeElement;
    return !!el && el.tagName === 'INPUT' && $('syncBody').contains(el) || [...$('syncBody').querySelectorAll('input')].some((i) => i.value);
  };

  /**
   * The top bar's account button (the signed-in initial, or "Sign in", with a
   * status dot) and the "Account & sync" item in its menu.
   */
  function setPill({ state, status, title, initial = '' }) {
    const btn = $('acctBtn');
    btn.dataset.state = state;
    btn.classList.toggle('signed-in', !!initial);
    $('acctLabel').textContent = initial || 'Sign in';
    btn.title = title;
    btn.setAttribute('aria-label', `Account and settings: ${title}`);
    const item = $('syncBtn');
    item.dataset.state = state;
    item.title = title;
    $('syncText').textContent = status;
  }

  /** One pill for both kinds of sync: the account when set up, else GitHub. */
  function updatePill() {
    if (!S.cloud) return;
    const st = S.cloud.state();
    if (!S.cloud.signedIn()) {
      setPill({ state: 'off', status: 'Not signed in', title: 'Sign in to sync your games across devices' });
      return;
    }
    const email = st.user.email || '';
    const label = { syncing: 'Syncing…', error: 'Sync error' }[st.status] || email || 'Synced';
    setPill({
      state: st.status === 'idle' ? 'ok' : st.status,
      status: label,
      title: st.status === 'error' ? `Sync error: ${st.error}` : `Signed in as ${email}${st.status === 'syncing' ? ' · syncing' : ' · synced'}`,
      initial: (email.trim()[0] || '•').toUpperCase(),
    });
  }

  // ---- account menu (top bar) ----------------------------------------------------

  const menuOpen = () => !$('acctMenu').hidden;
  function setMenu(open, { focusButton = false } = {}) {
    $('acctMenu').hidden = !open;
    $('acctBtn').setAttribute('aria-expanded', String(open));
    if (!open && focusButton) $('acctBtn').focus();
  }

  function wireAccountMenu() {
    $('acctBtn').addEventListener('click', () => setMenu(!menuOpen()));
    wireThemePicker();
    // Picking Account & sync or Manage data closes it; the theme row stays open to show the change.
    $('acctMenu').addEventListener('click', (e) => { if (e.target.closest('.menu-item')) setMenu(false); });
    document.addEventListener('pointerdown', (e) => {
      if (menuOpen() && !$('acct').contains(e.target)) setMenu(false);
    });
    // Keyboard focus leaving the menu closes it too.
    $('acct').addEventListener('focusout', (e) => {
      if (menuOpen() && e.relatedTarget && !$('acct').contains(e.relatedTarget)) setMenu(false);
    });
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
        <p class="lede acct-lede">Sign in to keep your games, drills and settings in step on all your devices. It's free, and your data is private to your account.</p>
        <button class="btn google" id="cGoogle">${GOOGLE_G}<span>Continue with Google</span></button>
        <p class="fine acct-fine">Signing in uploads the games already on this device, then keeps everything in sync.</p>
        <p class="sync-msg acct-msg" id="cMsg" role="status"></p>
        <details class="legacy-signin">
          <summary class="sub">Used an email and password before?</summary>
          <p class="sub" style="margin-top: 6px">Sign in once, then link Google to your account.</p>
          <label class="field">Email<input id="cEmail" type="email" autocomplete="email" spellcheck="false" autocapitalize="off"></label>
          <label class="field">Password<input id="cPass" type="password" autocomplete="current-password"></label>
          <div class="actions">
            <button class="btn" id="cSignIn">Sign in</button>
            <button class="btn link" id="cForgot">Forgot password?</button>
          </div>
        </details>
        ${legacy}`;
      $('cGoogle').addEventListener('click', () => accountAction(() => S.cloud.signInGoogle(), web ? 'Opening Google…' : 'Finish in your browser…'));
      $('cSignIn').addEventListener('click', () => accountAction(() => S.cloud.signInEmail($('cEmail').value, $('cPass').value), 'Signing in…'));
      $('cForgot').addEventListener('click', async () => {
        if (!$('cEmail').value.trim()) return accountMsg('Enter your email first, then press Forgot password.', true);
        try {
          await S.cloud.resetPassword($('cEmail').value);
          accountMsg('Check your email for a link to set a new password.');
        } catch (e) { accountMsg(e.message, true); }
      });
    } else {
      const st = S.cloud.state();
      // An older email-and-password account: one step moves it to Google.
      const passwordOnly = st.user.providers.length > 0 && st.user.providers.every((p) => p === 'password');
      body.innerHTML = `
        ${passwordOnly ? `<h3 class="mini-h" style="margin-top: 0">Link Google to this account</h3>
          <p class="sub">Sign-in is now Google only. Link Google once: your games stay, and this password is retired.</p>
          <button class="btn google" id="cLinkGoogle">${GOOGLE_G}<span>Link Google</span></button>
          <p class="sync-msg" id="cMsg" role="status"></p>` : ''}
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
        ${passwordOnly ? '' : '<p class="sync-msg" id="cMsg" role="status"></p>'}
        <p class="fine">Signing out keeps this device's games; it just stops syncing.</p>
        ${legacy}`;
      $('cSyncNow').addEventListener('click', () => S.cloud.now());
      $('cSignOut').addEventListener('click', async () => {
        const n = S.data.sessions.length;
        const clear = n > 0 && window.confirm(`Also remove this account's ${n} game${n === 1 ? '' : 's'} from this device? They stay safe in your account and come back when you sign in again.\n\nOK = remove from this device · Cancel = keep them here`);
        const uid = await S.cloud.signOut();
        if (clear) {
          S.cloud.forgetDevice(uid);
          S.data = await window.zm.clearDevice();
          onSyncedData(S.data);
          toast('Signed out and cleared this device.');
        } else {
          toast('Signed out. Your games stay on this device.');
        }
      });
      if ($('cLinkGoogle')) {
        $('cLinkGoogle').addEventListener('click', () => accountAction(async () => {
          await S.cloud.linkGoogle();
          toast('Google linked. From now on, sign in with Google.');
          renderAccountModal();
        }, web ? 'Opening Google…' : 'Finish in your browser…', { signingIn: false }));
      }
    }
    if ($('ghDisconnect')) {
      $('ghDisconnect').addEventListener('click', async () => {
        await S.sync.disconnect();
        renderAccountModal();
      });
    }
    if (S.accountBusy && S.accountBusy.signedIn === S.cloud.signedIn()) accountMsg(S.accountBusy.text);
  }

  function accountMsg(text, bad = false) {
    const m = $('cMsg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  }

  async function accountAction(fn, busy, { signingIn = true } = {}) {
    const run = S.accountRun = (S.accountRun || 0) + 1;
    const btns = [...$('syncBody').querySelectorAll('.btn')];
    btns.forEach((b) => { b.disabled = true; });
    // A redraw while this runs (a sync finishing, the dialog reopened) keeps the note.
    S.accountBusy = { text: busy, signedIn: S.cloud.signedIn() };
    accountMsg(busy);
    if (signingIn) S.signingIn = true;
    try {
      await fn();
      // onUser takes over: it redraws the dialog and the first sync jumps to Stats.
      if (run === S.accountRun && $('cMsg') && $('cMsg').textContent === busy) accountMsg('');
    } catch (e) {
      // Pressed again since (a browser sign-in can wait minutes): the newer try owns the dialog.
      if (run !== S.accountRun) return;
      if (signingIn) S.signingIn = false;
      S.accountBusy = null;
      accountMsg(e.message, true);
      btns.forEach((b) => { b.disabled = false; });
    } finally {
      if (run === S.accountRun) S.accountBusy = null;
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
      // Nor a Goal box: the record card holding it waits while it has focus.
      renderPlaySide({ sync: true });
    } else if (S.view === 'drill') renderDrill();
    else if (S.view === 'stats') renderStats();
    else if (S.view === 'e80') renderE80({ sync: true });
    else if (S.view === 'lb' && !(document.activeElement && document.activeElement.id === 'lbName')) VIEWS.lb();
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
      if (!$('syncModal').hidden && S.cloud.signedIn() && !typingInDialog()) renderAccountModal();
      return;
    }
    setPill({
      state: st.status,
      status: SYNC_LABEL[st.status] || 'Sync',
      title: st.status === 'error' ? `Sync error: ${st.error}` : st.status === 'off' ? 'Sync across devices' : `Syncing with ${st.repo}`,
    });
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
    wireAccountMenu();
    $('syncBtn').addEventListener('click', openSyncModal);
    $('syncClose').addEventListener('click', closeSyncModal);
    $('syncModal').addEventListener('mousedown', (e) => {
      if (e.target === $('syncModal')) closeSyncModal();
    });
  }

  // ---- version, what's new, updates --------------------------------------------

  const VER = window.ZetaproVersion;
  const SITE = 'https://zetapro.app/';
  const DOWNLOAD = 'https://github.com/amirkhan0725/zetapro/releases/latest/download/Zetapro-Windows-x64.zip';

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

  /** The latest release in full; earlier ones fold away behind "Show earlier updates". */
  function whatsNewHtml(changes) {
    const one = (c) => `<h3 class="mini-h">Version ${esc(c.version)} <span class="sub">· ${esc(c.date)}</span></h3>
      <ul class="changes">${c.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    const [latest, ...earlier] = changes;
    if (!latest) return '';
    return one(latest) + (earlier.length
      ? `<details class="changes-more"><summary>Show earlier updates (${earlier.length})</summary>${earlier.map(one).join('')}</details>`
      : '');
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

  /** Manage data's bulk-delete groups: Classic and drills, 80 in 8, the other assessment modules. */
  const dataGroup = (s) => (s.mode === 'e80' || s.mode === 'oa' ? s.mode : 'zeta');

  function gameLabel(s) {
    if (s.mode === 'e80') return s.practice ? `80 in 8 practice${s.label ? ` · ${s.label}` : ''}` : '80 in 8';
    if (s.mode === 'oa') return `${OA.moduleName(s.module)}${s.practice ? ' · learn' : ''}`;
    if (s.mode === 'drill') return `Drill · ${s.label || ''}`;
    return `Classic · ${E.describeConfig(s.config)}`;
  }

  function gameScore(s) {
    const v = s.mode === 'e80' ? signed(s.score) : s.mode === 'oa' ? OA.formatScore(s.score) : String(s.score);
    return s.aborted ? `${v} (quit)` : v;
  }

  function openDataModal() {
    S.history = null;
    S.dataShowAll = false;
    $('dataModal').hidden = false;
    renderDataModal();
  }

  function closeDataModal() {
    $('dataModal').hidden = true;
    S.lastDeleted = null;
  }

  function renderDataModal() {
    const all = S.data.sessions;
    const zeta = all.filter((s) => dataGroup(s) === 'zeta');
    const e80 = all.filter((s) => dataGroup(s) === 'e80');
    const oa = all.filter((s) => dataGroup(s) === 'oa');
    const syncing = S.sync && S.sync.enabled();
    // The newest 20 by default, so the dialog scrolls once instead of a list inside it.
    const shown = all.slice().reverse().slice(0, S.dataShowAll ? 300 : 20);
    const rows = shown.map((s) => `
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
    const more = all.length > shown.length
      ? `<div class="actions" style="margin-top:8px"><button class="btn small" data-show-all-games>Show all ${all.length}</button></div>` : '';
    $('dataBody').innerHTML = `${undo}
      <p class="lede">${all.length} game${all.length === 1 ? '' : 's'} saved: ${zeta.length} Classic and drill, ${e80.length} 80 in 8${oa.length ? `, ${oa.length} Arcade` : ''}.
        ${syncing ? 'Deletions also apply to your other synced devices.' : 'Deleting only affects this device.'}</p>
      <h2 style="margin-top:18px">Backup file</h2>
      <p class="sub">Save every game to a file, or add games from one (for example, to move them to another device or account). Importing keeps the games you have now.</p>
      <div class="actions" style="margin-top:8px">
        <button class="btn small" data-export-json>Export backup</button>
        <button class="btn small" data-import-json>Import backup…</button>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>
      ${all.length ? `<h2 style="margin-top:22px">Individual games</h2><ul class="plist game-list">${rows}</ul>${more}` : '<p class="empty-note">Nothing saved.</p>'}
      ${history}
      <h2 style="margin-top:22px">Delete in bulk</h2>
      <div class="actions" style="margin-top:8px">
        <button class="btn small" data-del-group="zeta" ${zeta.length ? '' : 'disabled'}>Delete all Classic games and drills</button>
        <button class="btn small" data-del-group="e80" ${e80.length ? '' : 'disabled'}>Delete all 80 in 8 attempts</button>
        ${oa.length ? `<button class="btn small" data-del-group="oa">Delete all Arcade rounds</button>` : ''}
        <button class="btn small danger-outline" data-del-group="all" ${all.length ? '' : 'disabled'}>Delete everything</button>
      </div>
      <p class="fine">Settings and goals are kept. Export a backup first if you might want the games back.</p>`;
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

  /** What a backup file holds (also what move.js hands to zetapro.app). */
  const backupOf = (data) => ({ app: 'zetapro', exportedAt: Date.now(), ...DataModel.forUpload(data) });

  async function exportBackup() {
    const data = await window.zm.load();
    const name = `zetapro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(backupOf(data))], { type: 'application/json' }));
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
    return addGames(parsed, { place: 'that file', source: 'this backup' });
  }

  /**
   * Adds the games in a parsed backup that aren't here yet, after asking.
   * Returns how many were added: 0 when there were none or the answer was no.
   */
  async function addGames(parsed, { place, source }) {
    const games = DataModel.normalize(parsed).sessions;
    if (!games.length) {
      toast(`No games found in ${place}.`);
      return 0;
    }
    const have = new Set(S.data.sessions.map(DataModel.sessionKey));
    const added = games.filter((g) => !have.has(DataModel.sessionKey(g))).length;
    if (!added) {
      toast(`You already have every game in ${place}.`);
      return 0;
    }
    if (!window.confirm(`Add ${added} game${added === 1 ? '' : 's'} from ${source}? Games you have now are kept.`)) return 0;
    S.data = await window.zm.restoreSessions(games);
    afterDataChange(`Imported ${added} game${added === 1 ? '' : 's'}.`);
    return added;
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
      if (e.target.closest('[data-show-all-games]')) {
        S.dataShowAll = true;
        return renderDataModal();
      }
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
      const keys = S.data.sessions.filter((s) => dataGroup(s) === g).map(DataModel.sessionKey);
      const what = { e80: '80 in 8 attempts', oa: 'Arcade rounds', zeta: 'Classic games and drills' }[g];
      deleteGames(keys, `Delete all ${keys.length} ${what}?`);
    });
  }

  // ---- events --------------------------------------------------------------

  /**
   * Enter on Play or 80 in 8 starts a round, except on a control that takes Enter
   * itself: a button, a select, a link, or a goal box, where it means "done" (the
   * box blurs, and its change event saves the goal).
   */
  function enterStarts(e) {
    const el = e.target;
    if (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || el.tagName === 'A' || el.tagName === 'SUMMARY') return false;
    if (el.matches('[data-goal]')) {
      e.preventDefault();
      el.blur();
      return false;
    }
    return true;
  }

  function onAction(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    if (a === 'smart-drill') startSmartDrill();
    else if (a === 'daily-start') startDaily();
    else if (a === 'daily-share') {
      const done = dailyAttempt(E.dayKey());
      if (done) copyDaily(done);
    }
    else if (a === 'most-missed-drill') {
      if (S.mostMissed && S.mostMissed.length) startDrill({ kind: 'list', problems: S.mostMissed }, 'Most missed');
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
    } else if (a === 'toggle-levels') {
      S.showAllLevels = !S.showAllLevels;
      renderStats();
    } else if (a === 'goto-play') show('play');
    else if (a === 'goto-e80') show('e80');
    else if (a === 'manage-data') openDataModal();
    else if (a === 'whats-new') openInfo("What's new", whatsNewHtml(VER.changes));
    else if (a === 'whats-new-latest') openInfo("What's new", whatsNewHtml((S.latest && S.latest.changes) || VER.changes));
    else if (a === 'e80-practice-weak') practiceWeakE80();
    else if (a === 'e80-practice-type') startE80({ practice: true, weights: { [el.dataset.key]: 1 }, label: el.dataset.label, returnTo: 'e80' });
  }

  function wire() {
    for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => show(t.dataset.view));

    for (const b of document.querySelectorAll('.theme-seg button[data-theme], #themeSwatches button')) {
      b.addEventListener('click', async () => {
        await saveSettings({ theme: b.dataset.theme });
        applyTheme(S.data.settings.theme);
        markTheme();
      });
    }
    // Random: any named theme except the one in use, saved like a picked one.
    $('randomThemeBtn').addEventListener('click', async () => {
      const pool = Themes.LIST.filter((t) => t.id !== S.data.settings.theme);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      await saveSettings({ theme: pick.id });
      applyTheme(S.data.settings.theme);
      markTheme();
      toast(`Theme: ${pick.name}`);
    });

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
    // Customize (Classic settings) and Show calendar remember whether they were open.
    // toggle doesn't bubble, so it's caught on the way down.
    $('customize').open = openPref('customize');
    document.addEventListener('toggle', (e) => {
      const d = e.target;
      if (d.id === 'customize') setOpenPref('customize', d.open);
      else if (d.dataset && d.dataset.openPref) setOpenPref(d.dataset.openPref, d.open);
    }, true);

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
    $('shareBtn').addEventListener('click', () => { if (S.lastSession && S.lastSession.daily) copyDaily(S.lastSession); });
    $('resBackBtn').addEventListener('click', () => show(S.last ? S.last.returnTo : 'play'));
    $('drillMissesBtn').addEventListener('click', () => {
      if (S.lastSession && S.lastSession.mode === 'e80') return practiceFromAttempt(S.lastSession);
      const list = S.lastSession ? retryListFromSession(S.lastSession) : [];
      if (list.length) startDrill({ kind: 'list', problems: list }, "Last round's misses");
    });

    $('drillDuration').addEventListener('change', (e) => saveSettings({ drillDuration: Number(e.target.value) }));

    $('statsKindSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b || b.dataset.kind === S.statsKind) return;
      S.statsKind = b.dataset.kind;
      renderStats();
    });
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
      if (e.target.matches('[data-week-goal]')) {
        await saveSettings({ weeklyGoal: Number(e.target.value) });
        if (S.view === 'play') renderWeekCard();
        return;
      }
      const inp = e.target.closest('[data-goal]');
      if (!inp) return;
      const goal = goalOf(inp.value);
      if (goal == null) {
        // Emptied or not a score: keep the goal there was, and show it again.
        inp.value = String(goals()[inp.dataset.goal]);
        return;
      }
      await saveSettings({ goals: { ...goals(), [inp.dataset.goal]: goal } });
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
      if (menuOpen() && e.key === 'Escape') {
        e.preventDefault();
        setMenu(false, { focusButton: true });
        return;
      }
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
          // Enter submits the form it was typed in: sign in, add a password, or connect GitHub.
          const go = e.target.id === 'cNewPass' ? $('cAddPass') : $('cSignIn');
          if (go) go.click();
          else onSyncConnect();
        }
        return;
      }
      if (KEYS[S.view]) {
        KEYS[S.view](e);
        return;
      }
      if (S.view === 'game') {
        if (e.key === 'Escape') {
          e.preventDefault();
          finishGame(true);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finishGame(true, true);
        } else if (S.game && S.game.keypad) {
          // Pad mode leaves the input read-only, so feed physical keys through the pad,
          // also when the box itself has focus (a click puts it there).
          if (/^\d$/.test(e.key)) keypadPress(e.key);
          else if (e.key === 'Backspace') keypadPress('back');
          else if (e.key === 'Enter' && e.target !== $('answer')) onAnswerKey(e); // the box handles its own
        }
        return;
      }
      if (S.view === 'results') {
        // A short guard so a late keystroke from the round doesn't restart it.
        if ((e.key === 'Enter' || e.key === 'Tab') && performance.now() - S.resultsAt > 700) {
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
        if (!enterStarts(e)) return;
        e.preventDefault();
        startE80({ practice: false, returnTo: 'e80' });
        return;
      }
      if (S.view === 'play' && e.key === 'Enter') {
        if (!enterStarts(e)) return;
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
      syncWindowColours();
      if (S.view === 'stats') renderStats();
    });
  }

  function markTheme() {
    const cur = S.data.settings.theme;
    for (const b of document.querySelectorAll('.theme-seg button, #themeSwatches button, #tpList .tp-item')) {
      b.classList.toggle('on', b.dataset.theme === cur);
      b.setAttribute('aria-pressed', String(b.dataset.theme === cur));
    }
    // "More themes…" names the theme in use when it's one of those.
    const t = Themes.byId[cur];
    const more = t && !t.main ? t : null;
    $('moreThemesBtn').classList.toggle('on', !!more);
    $('moreThemesNow').textContent = more ? more.name : '';
    if (more) $('moreThemesNow').style.setProperty('--sw-accent', more.swatch[2]);
  }

  /** Colors a swatch with its theme's page, card and accent (through the CSSOM, which any CSP allows). */
  function colourSwatch(el, t) {
    ['--sw-page', '--sw-surface', '--sw-accent'].forEach((k, i) => el.style.setProperty(k, t.swatch[i]));
  }

  /** The eight main color themes in the account menu, from themes.js. */
  function renderSwatches() {
    const box = $('themeSwatches');
    box.innerHTML = Themes.MAIN.map((t) => `<button data-theme="${t.id}" title="${esc(t.name)}" aria-label="${esc(t.name)} theme"><span class="sw" aria-hidden="true"></span><span class="sw-name">${esc(t.name)}</span></button>`).join('');
    for (const b of box.children) colourSwatch(b, Themes.byId[b.dataset.theme]);
  }

  /**
   * Puts a theme's colors on the page without saving anything (the picker's
   * preview uses this too). A theme from themes.js sets its whole palette on <html>
   * and names itself in data-theme. Light and Dark are the stylesheet's own
   * colors: in a browser data-theme picks one; on desktop, Light, Dark and Auto
   * come from the OS setting main.js makes (a theme's base, for the others).
   */
  function paintTheme(theme) {
    const root = document.documentElement;
    const t = Themes.byId[theme];
    const own = t && !t.css ? Themes.palette(theme) : null;
    for (const k of Themes.TOKENS) root.style.removeProperty(`--${k}`);
    root.style.removeProperty('color-scheme');
    if (own) {
      for (const [k, v] of Object.entries(own)) root.style.setProperty(k, v);
      root.style.setProperty('color-scheme', t.base);
    }
    if (own || (window.zm.platform === 'web' && (theme === 'light' || theme === 'dark'))) root.dataset.theme = theme;
    else delete root.dataset.theme;
    syncWindowColours();
  }

  /** Puts a theme on the page and tells the charts (which redraw for light or dark). */
  function applyTheme(theme) {
    paintTheme(theme);
    window.dispatchEvent(new Event('zm-theme'));
  }

  /** The Windows title-bar buttons take the theme's page and text colors. */
  function syncWindowColours() {
    if (!window.zm.setTitleBarColors) return;
    const cs = getComputedStyle(document.documentElement);
    window.zm.setTitleBarColors({ color: cs.getPropertyValue('--page').trim(), symbolColor: cs.getPropertyValue('--ink-2').trim() }).catch(() => {});
  }

  // ---- More themes: the rest, grouped light / mid-tone / dark ---------------------
  // Pointing at a theme, or moving to it with the keys, shows it on the whole app;
  // leaving puts the saved one back. A click or Enter keeps it and closes the
  // picker; Esc, Close or a click outside closes it with the saved theme back.

  const TP = { open: false, hover: null, focus: null, painted: null, timer: 0 };
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const toneName = (tone) => (Themes.TONES.find(([id]) => id === tone) || ['', ''])[1];
  const tpItems = () => [...$('tpList').querySelectorAll('.tp-item:not([hidden])')];

  function renderThemePicker() {
    const list = $('tpList');
    list.innerHTML = Themes.TONES.map(([tone, label]) => {
      const items = Themes.MORE.filter((t) => t.tone === tone);
      return items.length ? `<section class="tp-group"><h3 class="tp-group-h" id="tpg-${tone}">${label}</h3>
        <div class="tp-grid" role="group" aria-labelledby="tpg-${tone}">${items.map((t) => `<button type="button" class="tp-item" data-theme="${t.id}" tabindex="-1" aria-pressed="false"><span class="tp-name">${esc(t.name)}</span><span class="tp-chip" aria-hidden="true"></span></button>`).join('')}</div></section>` : '';
    }).join('');
    // Each button is drawn in its own theme's colors.
    for (const b of list.querySelectorAll('.tp-item')) {
      const p = Themes.palette(b.dataset.theme);
      for (const k of ['page', 'surface', 'ink', 'accent']) b.style.setProperty(`--tp-${k}`, p[`--${k}`]);
    }
  }

  /** One theme button is in the Tab order (arrows move between them): the current theme, else the first shown. */
  function roveTo(b) {
    for (const x of $('tpList').querySelectorAll('.tp-item')) x.tabIndex = x === b ? 0 : -1;
  }

  /** Shows only the themes whose name (or light / mid-tone / dark) has every word typed. */
  function filterThemes() {
    const words = fold($('tpSearch').value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const g of $('tpList').querySelectorAll('.tp-group')) {
      let n = 0;
      for (const b of g.querySelectorAll('.tp-item')) {
        const t = Themes.byId[b.dataset.theme];
        const hay = fold(`${t.name} ${t.id.replace(/-/g, ' ')} ${toneName(t.tone)}`);
        b.hidden = !words.every((w) => hay.includes(w));
        if (!b.hidden) n++;
      }
      g.hidden = !n;
      shown += n;
    }
    $('tpEmpty').hidden = shown > 0;
    const items = tpItems();
    roveTo(items.find((b) => b.dataset.theme === S.data.settings.theme) || items[0] || null);
  }

  function previewTheme(id) {
    if (id === TP.painted) return;
    const wasDark = isDark();
    paintTheme(id);
    TP.painted = id;
    if (isDark() !== wasDark) window.dispatchEvent(new Event('zm-theme'));
  }

  /** Shows the theme pointed at or focused, or (a moment later, so crossing the gap between two buttons doesn't flash) the saved one. */
  function updatePreview() {
    clearTimeout(TP.timer);
    if (!TP.open) return;
    const id = TP.hover || TP.focus;
    if (id) previewTheme(id);
    else TP.timer = setTimeout(() => { if (TP.open && !TP.hover && !TP.focus) previewTheme(S.data.settings.theme); }, 80);
  }

  function openThemePicker() {
    if (!$('tpList').firstChild) renderThemePicker();
    Object.assign(TP, { open: true, hover: null, focus: null, painted: S.data.settings.theme });
    $('tpSearch').value = '';
    filterThemes();
    markTheme();
    $('themePicker').showModal();
    // Phones: no on-screen keyboard popping up; elsewhere, typing searches straight away.
    if (window.matchMedia('(pointer: coarse)').matches) $('tpList').focus({ preventScroll: true });
    else $('tpSearch').focus();
    $('tpList').scrollTop = 0;
    const cur = $('tpList').querySelector('.tp-item.on');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  /** Closes the picker, keeping `keep` on the page (a pick being saved) or putting the saved theme back. */
  function closeThemePicker(keep = null) {
    if (!TP.open) return;
    clearTimeout(TP.timer);
    TP.open = false;
    $('themePicker').close();
    if (keep) previewTheme(keep);
    else if (TP.painted !== S.data.settings.theme) applyTheme(S.data.settings.theme);
    TP.painted = null;
    // Back to the account button: "More themes…" was in its menu, which is closed now.
    $('acctBtn').focus();
  }

  async function chooseTheme(id) {
    closeThemePicker(id);
    await saveSettings({ theme: id });
    applyTheme(S.data.settings.theme);
    markTheme();
  }

  /** The theme button above or below `b`: the nearest row that way, then the closest column. */
  function themeAbove(b, items, dir) {
    const r = b.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    let best = null;
    let bestScore = Infinity;
    for (const x of items) {
      const q = x.getBoundingClientRect();
      const dy = dir > 0 ? q.top - r.bottom : r.top - q.bottom;
      if (x === b || dy < -1) continue;
      const score = Math.round(dy) * 1e4 + Math.abs(q.left + q.width / 2 - mid);
      if (score < bestScore) [best, bestScore] = [x, score];
    }
    return best;
  }

  /** Moves to a theme button (or the search box) and previews what's there, without waiting on focus events. */
  function focusInPicker(el) {
    el.focus();
    const b = el.classList.contains('tp-item') ? el : null;
    if (b) roveTo(b);
    TP.focus = b ? b.dataset.theme : null;
    updatePreview();
  }

  function onThemePickerKey(e) {
    e.stopPropagation(); // keys in here never reach the page behind (Enter would start a round)
    if (e.key === 'Escape') {
      e.preventDefault();
      closeThemePicker();
      return;
    }
    const items = tpItems();
    if (e.target === $('tpSearch')) {
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault();
        focusInPicker(items[0]);
      } else if (e.key === 'Enter' && items.length) {
        e.preventDefault();
        chooseTheme(items[0].dataset.theme);
      }
      return;
    }
    const b = e.target.closest && e.target.closest('.tp-item');
    if (!b) return;
    const at = items.indexOf(b);
    let next;
    if (e.key === 'ArrowRight') next = items[at + 1];
    else if (e.key === 'ArrowLeft') next = items[at - 1];
    else if (e.key === 'ArrowDown') next = themeAbove(b, items, 1);
    else if (e.key === 'ArrowUp') next = themeAbove(b, items, -1) || $('tpSearch');
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else {
      // Typing a letter on a theme goes to the search box.
      if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) $('tpSearch').focus();
      return;
    }
    e.preventDefault();
    if (next) focusInPicker(next);
  }

  function wireThemePicker() {
    const dlg = $('themePicker');
    const list = $('tpList');
    $('moreThemesBtn').addEventListener('click', openThemePicker);
    $('tpClose').addEventListener('click', () => closeThemePicker());
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeThemePicker();
    });
    // A click on the backdrop lands on the dialog itself, outside its box.
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeThemePicker();
    });
    dlg.addEventListener('keydown', onThemePickerKey);
    $('tpSearch').addEventListener('input', filterThemes);
    // Touch has no hover: a tap just picks.
    list.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const b = e.target.closest('.tp-item');
      TP.hover = b ? b.dataset.theme : null;
      updatePreview();
    });
    list.addEventListener('pointerleave', () => {
      TP.hover = null;
      updatePreview();
    });
    list.addEventListener('focusin', (e) => {
      const b = e.target.closest('.tp-item');
      if (b) roveTo(b);
      TP.focus = b ? b.dataset.theme : null;
      updatePreview();
    });
    list.addEventListener('focusout', (e) => {
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.tp-item')) return;
      TP.focus = null;
      updatePreview();
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.tp-item');
      if (b) chooseTheme(b.dataset.theme);
    });
  }

  // A one-time note for players updating to the release with themes: shown once
  // per device, and only to someone who has played before (new players find the
  // themes in the menu like everything else).
  const THEMES_NOTE = 'zetapro-seen-themes';
  function announceThemes() {
    try {
      if (localStorage.getItem(THEMES_NOTE)) return;
      localStorage.setItem(THEMES_NOTE, '1');
    } catch { return; }
    if (!S.data.sessions.length) return;
    const el = document.createElement('div');
    el.className = 'announce';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="announce-swatches" aria-hidden="true">${Themes.MAIN.map(() => '<i></i>').join('')}</span>
      <span class="announce-text"><b>New: color themes</b><span>Eight in the menu, from Paper to Midnight, and ${Themes.MORE.length} more under More themes, such as Nord, Solarized and Dracula.</span></span>
      <button class="btn primary small" data-announce="try">Try themes</button>
      <button class="btn ghost small" data-announce="close">Not now</button>`;
    el.querySelectorAll('.announce-swatches i').forEach((dot, i) => dot.style.setProperty('background', Themes.MAIN[i].swatch[2]));
    document.body.append(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-announce]');
      if (!b) return;
      el.remove();
      if (b.dataset.announce !== 'try') return;
      // After this click has finished, or the menu's outside-click handler would close it again.
      setTimeout(() => {
        setMenu(true);
        const current = document.querySelector('.theme-seg button.on, #themeSwatches button.on, #moreThemesBtn.on') || document.querySelector('#themeSwatches button');
        if (current) current.focus();
      });
    });
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
    renderSwatches();
    applyTheme(S.data.settings.theme);
    markTheme();
    wire();
    show('play');
    announceThemes();
    startCloud();
    // First run: the welcome (tour.js, which may load after this file and then calls it itself).
    S.booted = true;
    // The old address hands over to zetapro.app first (move.js; may send this page there).
    if (window.ZetaproMove && window.ZetaproMove.boot() === 'leaving') return;
    if (window.ZetaproTour) window.ZetaproTour.boot();
    await startSync();
    updatePill();
    checkVersion();
  }

  /** Saves a finished round locally, syncs it, and tells the SAVED listeners (every mode). */
  async function saveSession(session) {
    try {
      await window.zm.addSession(session);
      rememberSession(session);
      for (const fn of SAVED) fn(session);
      return true;
    } catch (e) {
      toast(`Couldn't save this round: ${e.message}`);
      return false;
    }
  }

  // What oa-ui.js and lb-ui.js build on: shared state, navigation and saving.
  window.QS = {
    S, show, toast, esc, saveSession, saveSettings, tile, renderStats, openAccount: openSyncModal,
    exportBackup, addGames, backup: async () => backupOf(await window.zm.load()),
    dateFmt: (at) => dateFmt.format(at),
    registerView: (name, render) => { VIEWS[name] = render; },
    registerStats: (kind, render) => { STATS[kind] = render; },
    registerKeys: (name, handler) => { KEYS[name] = handler; },
    registerSaved: (fn) => { SAVED.push(fn); },
  };

  // Exposed for capture/automation runs only.
  window.__zm = { S, show, startGame, startSmartDrill, finishGame, renderStats, startE80, pickE80, finishE80, onSyncedData, cache: CACHE, announceThemes };

  boot().catch((e) => {
    document.body.innerHTML = `<div class="empty"><h2>Couldn't start</h2><p>${esc(e.message)}</p></div>`;
  });
})();
