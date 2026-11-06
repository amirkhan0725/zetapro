// Leaderboard screen: pick a board (Daily, Classic, 80 in 8 or an OA module),
// see the top 50, and join with a nickname to post your own bests after every
// round. Which rounds count and how entries are written live in leaderboard.js;
// this file is the screen and the glue to the signed-in account (S.cloud).
(() => {
  'use strict';

  const Q = window.QS;
  const S = Q.S;
  const LB = window.Leaderboard;
  const E = window.Engine;
  const { esc } = Q;
  const $ = (id) => document.getElementById(id);
  const TOP = 50;
  const FRESH_MS = 60000; // reuse a loaded board for a minute
  const FIRST_DAY = '2026-10-27'; // Daily #1

  const GROUPS = [['daily', 'Daily'], ['classic', 'Classic'], ['e80', '80 in 8'], ['oa', 'OA']];
  const RULES = {
    daily: 'First try only. Everyone plays the same set.',
    classic: 'Best 120-second round on the standard settings.',
    e80: 'Best net score with −1 marking and no skipping.',
    oa: 'Best Test-mode round, Full OA stages included. Learn mode doesn\'t count.',
  };

  const L = { group: 'daily', oa: 'bto', period: 'week', day: null, cache: new Map(), busy: false, renaming: false, posting: null, fake: null };

  const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const dayDate = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  };
  const shiftDay = (day, n) => {
    const d = dayDate(day);
    d.setDate(d.getDate() + n);
    return E.dayKey(d);
  };
  const fmtScore = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  // The account and database; `L.fake` stands in for both in smoke runs.
  let fsBoards = null;
  const remote = () => {
    if (L.fake) return L.fake.remote;
    if (!S.cloud || !S.cloud.db) return null;
    return fsBoards || (fsBoards = LB.firestoreBoards(S.cloud.db));
  };
  const uid = () => (L.fake ? L.fake.uid : S.cloud ? S.cloud.uid() : null);
  // The leaderboard profile, { uid, name, joined }, lives in the synced settings, so a
  // nickname entered once follows the account to every device. It counts only for
  // the account that set it: another account signing in on a shared device must join itself.
  const profile = () => {
    const p = (S.data.settings || {}).lb;
    return p && p.uid && p.uid === uid() ? p : null;
  };
  const saveProfile = (p) => Q.saveSettings({ lb: p });
  const joinedName = () => (profile() ? profile().name : null);
  const problem = (e) => (e && e.code === 'permission-denied' ? 'The leaderboard isn\'t switched on yet.'
    : 'Couldn\'t reach the leaderboard. Check your connection and try again.');

  function currentBoard() {
    if (L.group === 'daily') return LB.boardId('daily', L.day);
    const kind = L.group === 'oa' ? L.oa : L.group;
    return LB.boardId(kind, L.period === 'all' ? 'all' : `w${LB.weekKey(Date.now())}`);
  }

  // ---- posting ------------------------------------------------------------------

  // What this device has posted (board → score), so a round posts only what changed.
  // A new join (profile.joined) starts it afresh, so joining again posts everything.
  const bookKey = (id) => `zetapro-lb-${id}`;
  function loadBook(id) {
    const joined = profile() ? profile().joined : null;
    try {
      const b = JSON.parse(localStorage.getItem(bookKey(id)) || 'null');
      if (b && b.joined === joined) return b;
    } catch { /* ignore */ }
    return { joined, posted: {} };
  }
  function saveBook(id, book) {
    try { localStorage.setItem(bookKey(id), JSON.stringify(book)); } catch { /* ignore */ }
  }

  /** Posts every best this device hasn't posted yet; resolves to how many went up. */
  function catchUp() {
    const id = uid();
    const name = joinedName();
    const r = remote();
    if (!id || !name || !r) return Promise.resolve(0);
    if (L.posting) return L.posting;
    L.posting = (async () => {
      const book = loadBook(id);
      const todo = LB.pending(S.data.sessions, book.posted);
      if (!todo.length) return 0;
      const res = await LB.post(r, id, name, todo);
      for (const board of res.settled) book.posted[board] = todo.find((e) => e.board === board).score;
      saveBook(id, book);
      if (res.written) L.cache.clear();
      if (res.error) console.warn('Leaderboard: posting paused until the next round:', res.error);
      return res.written;
    })().finally(() => { L.posting = null; });
    return L.posting;
  }

  const refreshAfterPost = (n) => { if (n && S.view === 'lb') fillList(true); };
  Q.registerSaved(() => { catchUp().then(refreshAfterPost).catch(() => {}); });

  // ---- the board ----------------------------------------------------------------

  async function loadBoard(board, force) {
    const hit = L.cache.get(board);
    if (hit && !force && Date.now() - hit.t < FRESH_MS) return hit;
    const r = remote();
    const id = uid();
    const rows = await r.top(board, TOP);
    const mine = id && joinedName() && !rows.some((e) => e.uid === id) ? await r.mine(board, id) : null;
    const res = { t: Date.now(), rows, mine };
    L.cache.set(board, res);
    return res;
  }

  function listHtml({ rows, mine }) {
    const id = uid();
    if (!rows.length) return `<p class="lb-empty">No scores yet${L.group === 'daily' && L.day === E.dayKey() ? ' today' : ''}. ${joinedName() ? 'Yours will appear after your next round.' : 'Join to be the first.'}</p>`;
    const row = (e) => `<li class="lb-row${e.uid === id ? ' you' : ''}${e.rank && e.rank <= 3 ? ` top${e.rank}` : ''}">
        <span class="lb-rank">${e.rank || '—'}</span>
        <span class="lb-name">${esc(e.name)}${e.uid === id ? ' <span class="lb-you">you</span>' : ''}</span>
        <span class="lb-score">${fmtScore(e.score)}</span>
        <span class="lb-when">${shortDate.format(e.at)}</span>
      </li>`;
    return `<ol class="lb-rows">${LB.ranked(rows).map(row).join('')}</ol>
      ${mine ? `<p class="sub lb-sep">Your best, outside the top ${TOP}</p><ol class="lb-rows">${row(mine)}</ol>` : ''}`;
  }

  async function fillList(force = false) {
    const board = currentBoard();
    const box = $('lbList');
    if (!box) return;
    if (!remote()) {
      box.innerHTML = '<p class="lb-empty">Leaderboards need an internet connection.</p>';
      return;
    }
    if (force || !L.cache.has(board)) box.innerHTML = '<p class="lb-empty">Loading…</p>';
    try {
      const res = await loadBoard(board, force);
      if (S.view === 'lb' && currentBoard() === board) box.innerHTML = listHtml(res);
    } catch (e) {
      if (S.view !== 'lb' || currentBoard() !== board) return;
      box.innerHTML = `<p class="lb-empty">${problem(e)}</p>
        <div class="actions"><button class="btn small" data-lb-refresh>Try again</button></div>`;
    }
  }

  // ---- joining ------------------------------------------------------------------

  function meHtml() {
    if (!S.cloud && !L.fake) {
      return `<h2>Join the leaderboard</h2>
        <p class="sub">Joining needs an account, which isn't available in this copy of the app.</p>`;
    }
    if (!uid()) {
      return `<h2>Join the leaderboard</h2>
        <p class="sub">Sign in to post your scores. Anyone can view the boards.</p>
        <button class="btn primary" data-lb-signin>Sign in</button>`;
    }
    const name = joinedName();
    if (!name || L.renaming) {
      return `<h2>${name ? 'Change nickname' : 'Join the leaderboard'}</h2>
        <p class="sub">${name ? 'Your scores stay; only the name changes.'
          : 'Pick a nickname. It and your best scores are shown to everyone. Your email never is.'}</p>
        <label class="field">Nickname<input id="lbName" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(name || '')}" placeholder="2–20 letters or numbers"></label>
        <div class="actions"><button class="btn primary" data-lb-join>${name ? 'Save' : 'Join'}</button>${name ? '<button class="btn ghost" data-lb-cancel>Cancel</button>' : ''}</div>
        <p class="sync-msg" id="lbMsg"></p>`;
    }
    return `<h2>You're on the board</h2>
      <p>As <b>${esc(name)}</b>. Your best scores post after each round.</p>
      <div class="actions"><button class="btn small" data-lb-rename>Change nickname</button><button class="btn small ghost danger" data-lb-leave>Leave</button></div>`;
  }

  const drawMe = () => { $('lbMe').innerHTML = meHtml(); };

  async function saveName() {
    const msg = $('lbMsg');
    const name = LB.cleanName($('lbName').value);
    if (!name) {
      msg.className = 'sync-msg bad';
      msg.textContent = 'Use 2–20 letters, numbers, spaces, or _ - .';
      return;
    }
    const r = remote();
    const id = uid();
    if (!r || !id || L.busy) return;
    L.busy = true;
    const renaming = !!joinedName();
    msg.className = 'sync-msg';
    msg.textContent = renaming ? 'Saving…' : 'Joining…';
    try {
      if (renaming) {
        await LB.rename(r, id, name, S.data.sessions);
        await saveProfile({ ...profile(), name });
        Q.toast(`You're now ${name} on the leaderboard.`);
      } else {
        await r.top(LB.boardId('classic', 'all'), 1); // fails fast if the boards aren't switched on
        await saveProfile({ uid: id, name, joined: Date.now() });
        const n = await catchUp();
        Q.toast(n ? `Joined as ${name}: ${n} best score${n === 1 ? '' : 's'} posted.` : `Joined as ${name}. Your scores post after each round.`);
      }
      L.renaming = false;
      L.cache.clear();
      render();
    } catch (e) {
      msg.className = 'sync-msg bad';
      msg.textContent = problem(e);
    } finally {
      L.busy = false;
    }
  }

  async function leave() {
    if (!confirm('Leave the leaderboard? Your scores are removed from every board.')) return;
    const id = uid();
    try {
      await LB.leave(remote(), id, S.data.sessions);
      await saveProfile(null);
      try { localStorage.removeItem(bookKey(id)); } catch { /* ignore */ }
      L.cache.clear();
      Q.toast('You left the leaderboard. Your scores were removed.');
      render();
    } catch (e) {
      Q.toast(problem(e));
    }
  }

  // ---- the screen ---------------------------------------------------------------

  function render() {
    if (!L.day || L.day > E.dayKey()) L.day = E.dayKey();
    const today = E.dayKey();
    const kind = L.group === 'oa' ? L.oa : L.group;
    const title = L.group === 'daily' ? `Daily #${E.dailyNumber(L.day)} · ${longDate.format(dayDate(L.day))}`
      : `${LB.kindById[kind].name} · ${L.period === 'all' ? 'All time' : 'This week'}`;
    const picker = L.group === 'daily'
      ? `<div class="lb-day">
          <button class="btn small" data-lb-day="-1" aria-label="Previous day"${L.day <= FIRST_DAY ? ' disabled' : ''}>‹</button>
          <span>${L.day === today ? 'Today' : longDate.format(dayDate(L.day))}</span>
          <button class="btn small" data-lb-day="1" aria-label="Next day"${L.day >= today ? ' disabled' : ''}>›</button>
        </div>`
      : `<div class="seg" role="group" aria-label="Period">${[['week', 'This week'], ['all', 'All time']]
        .map(([p, l]) => `<button data-lb-period="${p}" class="${L.period === p ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    $('view-lb').innerHTML = `
      <div class="page-head">
        <div class="stats-title"><h1>Leaderboard</h1>
          <div class="seg" role="group" aria-label="Which board">${GROUPS
            .map(([g, l]) => `<button data-lb-group="${g}" class="${L.group === g ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="filters">${picker}</div>
      </div>
      ${L.group === 'oa' ? `<div class="chips lb-kinds">${LB.KINDS.filter((k) => k.group === 'oa')
        .map((k) => `<button class="chip${L.oa === k.id ? ' on' : ''}" data-lb-kind="${k.id}">${k.name}</button>`).join('')}</div>` : ''}
      <div class="lb-cols">
        <div class="card lb-board">
          <div class="card-head"><h2>${esc(title)}</h2><button class="btn link small" data-lb-refresh>Refresh</button></div>
          <p class="sub lb-rule">${RULES[L.group]}</p>
          <div id="lbList"></div>
        </div>
        <div class="card lb-me" id="lbMe">${meHtml()}</div>
      </div>
      <p class="sub lb-fine">Scores are checked for realistic ranges but not replayed, so treat the boards as friendly competition.</p>`;
    fillList();
    catchUp().then(refreshAfterPost).catch(() => {});
  }

  $('view-lb').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.lbGroup) L.group = d.lbGroup;
    else if (d.lbPeriod) L.period = d.lbPeriod;
    else if (d.lbKind) L.oa = d.lbKind;
    else if (d.lbDay) L.day = shiftDay(L.day, Number(d.lbDay));
    else if ('lbRefresh' in d) return fillList(true);
    else if ('lbSignin' in d) return Q.openAccount();
    else if ('lbJoin' in d) return saveName();
    else if ('lbRename' in d || 'lbCancel' in d) {
      L.renaming = 'lbRename' in d;
      drawMe();
      if (L.renaming) $('lbName').focus();
      return;
    } else if ('lbLeave' in d) return leave();
    else return;
    render();
  });
  $('view-lb').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'lbName') saveName();
  });

  Q.registerView('lb', render);

  // Exposed for capture/automation runs only.
  window.__lb = { L, render, catchUp, fake: (f) => { L.fake = f; L.cache.clear(); } };
})();
