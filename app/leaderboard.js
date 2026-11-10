// Leaderboards: a signed-in player who joins with a nickname posts their best
// scores to shared boards in Firestore that anyone can read. The Firestore rules
// (firestore.rules) check each entry: own entry only, a realistic score, never
// lowered, and a daily never changed. Rounds aren't replayed on a server, so a
// determined cheater could still post a fake score: the boards are for fun.
//
// Layout: boards/{board}/entries/{uid} = { name, score, at }
//   board = '<kind>.<period>'. period is 'all', 'w<Monday as YYYY-MM-DD>' for the
//   week, or for the Daily Challenge the day itself (one first try per player).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./e80.js'));
  else root.Leaderboard = factory(root.Engine, root.E80);
})(typeof self !== 'undefined' ? self : this, function (E, X) {
  'use strict';

  const OA_ONLY = (module, game) => (s) => (s.mode === 'oa' && s.module === module && (s.game || null) === game && !s.practice && !s.aborted ? s.score : null);

  /**
   * Every board kind, with the score range the rules accept (keep firestore.rules
   * in step: a test compares them) and how a saved round scores on it, or null.
   */
  const KINDS = [
    { id: 'daily', name: 'Daily Challenge', group: 'daily', range: [0, 250], of: (s) => (s.daily && s.mode === 'classic' ? s.score : null) },
    { id: 'classic', name: 'Classic', group: 'classic', range: [0, 250], of: (s) => (s.mode === 'classic' && !s.aborted && E.isDefaultConfig(s.config) ? s.score : null) },
    { id: 'e80', name: '80 in 8', group: 'e80', range: [-80, 80], of: (s) => (X.isAttempt(s) && s.settings && s.settings.penalty === 1 && !s.settings.allowSkip ? s.score : null) },
    { id: 'bto', name: 'Beat the Odds', group: 'oa', range: [-30, 30], of: OA_ONLY('bto', null) },
    { id: 'nl', name: 'NumberLogic', group: 'oa', range: [-26, 26], of: OA_ONLY('nl', null) },
    { id: 'll', name: 'Likelihood-list', group: 'oa', range: [0, 15], of: OA_ONLY('ll', null) },
    { id: 'iv', name: 'Intervals', group: 'oa', range: [0, 18], of: OA_ONLY('iv', null) },
    { id: 'ob', name: 'Orderbooks', group: 'oa', range: [0, 20], of: OA_ONLY('ob', null) },
    { id: 'numberbox', name: 'Number Box', group: 'oa', range: [-200, 90], of: OA_ONLY('zap', 'numberbox') },
    { id: 'codes', name: 'Code Compare', group: 'oa', range: [-60, 60], of: OA_ONLY('zap', 'codes') },
    { id: 'balloon', name: 'Balloon', group: 'oa', range: [0, 12800], of: OA_ONLY('zap', 'balloon') },
  ];
  const kindById = Object.fromEntries(KINDS.map((k) => [k.id, k]));

  /** The Monday that starts `at`'s local week, as 'YYYY-MM-DD'. */
  function weekKey(at) {
    const d = new Date(at);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return E.dayKey(d);
  }

  const boardId = (kind, period) => `${kind}.${period}`;
  const parseBoard = (board) => {
    const [kind, period] = board.split('.');
    return { kind, period };
  };

  const inRange = (kind, score) => Number.isFinite(score) && score >= kindById[kind].range[0] && score <= kindById[kind].range[1];

  // A saved round never changes, so its entries are worked out once per round object:
  // bests() runs after every round and on every leaderboard redraw, over every round.
  const entryCache = new WeakMap();

  /**
   * The boards one round reaches: [{ board, score, at }] (shared between calls: read
   * only). Its week's board gets a post only while that week is on (see pending).
   */
  function entriesOf(s) {
    const hit = entryCache.get(s);
    if (hit) return hit;
    const out = [];
    let week = null;
    for (const k of KINDS) {
      const score = k.of(s);
      if (score == null || !inRange(k.id, score)) continue;
      if (k.id === 'daily') out.push({ board: boardId('daily', s.daily), score, at: s.at });
      else {
        week = week || `w${weekKey(s.at)}`;
        out.push({ board: boardId(k.id, 'all'), score, at: s.at });
        out.push({ board: boardId(k.id, week), score, at: s.at });
      }
    }
    entryCache.set(s, out);
    return out;
  }

  /**
   * A player's entry on every board their rounds reach: the best score (earliest
   * on a tie), except a daily, where the first try stands. Past weeks included, so
   * rename and leave still reach entries posted to them.
   */
  function bests(sessions) {
    const out = new Map();
    for (const s of sessions.slice().sort((a, b) => a.at - b.at)) {
      for (const e of entriesOf(s)) {
        const cur = out.get(e.board);
        if (!cur || (!e.board.startsWith('daily.') && e.score > cur.score)) out.set(e.board, { score: e.score, at: e.at });
      }
    }
    return out;
  }

  /**
   * The entries still to post: every best that differs from what this device last
   * posted (`posted`: board → score). Catches up after offline rounds and new joins.
   * Weekly boards only for the week of `now`: the app shows no other week, so a
   * first join with a long history skips a write per kind for every week before.
   * Entries already on a past week's board stay where they are.
   */
  function pending(sessions, posted = {}, now = Date.now()) {
    const week = `w${weekKey(now)}`;
    const out = [];
    for (const [board, e] of bests(sessions)) {
      const { period } = parseBoard(board);
      if (period[0] === 'w' && period !== week) continue; // a past week
      if (posted[board] !== e.score) out.push({ board, ...e });
    }
    return out;
  }

  /** A tidy nickname, or null: 2–20 letters, digits, spaces, '_', '-' or '.'. */
  function cleanName(raw) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    return /^[A-Za-z0-9 _.-]{2,20}$/.test(name) ? name : null;
  }

  /** Competition ranking (1, 2, 2, 4) over entries sorted best first, earlier first on a tie. */
  function ranked(entries) {
    const list = entries.slice().sort((a, b) => b.score - a.score || a.at - b.at);
    let rank = 0;
    return list.map((e, i) => {
      if (!i || list[i - 1].score !== e.score) rank = i + 1;
      return { ...e, rank };
    });
  }

  // Writes go out this many at a time. One after another, a first join, rename or leave
  // waited a round trip per board, and a long-time player reaches hundreds of boards.
  const BATCH = 20;

  /**
   * Runs `fn` on every item, BATCH at a time, and gives each outcome as
   * Promise.allSettled does. Stops after a batch with an outcome `fatal` accepts.
   */
  async function inBatches(items, fn, fatal) {
    const out = [];
    for (let i = 0; i < items.length; i += BATCH) {
      const res = await Promise.allSettled(items.slice(i, i + BATCH).map(fn));
      out.push(...res);
      if (res.some((r) => r.status === 'rejected' && fatal(r.reason))) break;
    }
    return out;
  }

  const isCode = (code) => (err) => !!err && err.code === code;

  /**
   * Writes entries to the boards, stopping at the first network error (returned as
   * `error`, to retry later). Returns how many were written and which boards are
   * settled: written, or refused because the board already holds a better score or
   * that daily, which is expected rather than an error.
   */
  async function post(remote, uid, name, entries) {
    const refused = isCode('permission-denied');
    const res = await inBatches(entries, (e) => remote.put(e.board, uid, { name, score: e.score, at: e.at }), (err) => !refused(err));
    const settled = [];
    let written = 0;
    let error = null;
    res.forEach((r, i) => {
      if (r.status === 'fulfilled') written++;
      else if (!refused(r.reason)) {
        error = error || r.reason;
        return;
      }
      settled.push(entries[i].board);
    });
    return { written, settled, error };
  }

  /**
   * Every board the player's rounds reach, past weeks included, plus `extra` (the
   * boards this device posted to, e.g. for rounds deleted since).
   */
  const boardsOf = (sessions, extra = []) => [...new Set([...bests(sessions).keys(), ...extra])];

  /** A new nickname on every board the player's rounds reach (scores untouched). */
  async function rename(remote, uid, name, sessions, extra = []) {
    const missing = isCode('not-found'); // a board never posted to
    const res = await inBatches(boardsOf(sessions, extra), (board) => remote.rename(board, uid, name), (err) => !missing(err));
    const bad = res.find((r) => r.status === 'rejected' && !missing(r.reason));
    if (bad) throw bad.reason;
    return res.filter((r) => r.status === 'fulfilled').length;
  }

  /** Leaving: remove the player's entry from every board their rounds reach, and from `extra`. */
  async function leave(remote, uid, sessions, extra = []) {
    const boards = boardsOf(sessions, extra);
    const bad = (await inBatches(boards, (board) => remote.remove(board, uid), () => true)).find((r) => r.status === 'rejected');
    if (bad) throw bad.reason;
    return boards.length;
  }

  /** The Firestore side, through the compat SDK the app already loads. */
  function firestoreBoards(db) {
    const entries = (board) => db.collection('boards').doc(board).collection('entries');
    return {
      async top(board, n) {
        const snap = await entries(board).orderBy('score', 'desc').limit(n).get();
        const out = [];
        snap.forEach((doc) => out.push({ uid: doc.id, ...doc.data() }));
        return out;
      },
      async mine(board, uid) {
        const doc = await entries(board).doc(uid).get();
        return doc.exists ? { uid, ...doc.data() } : null;
      },
      put: (board, uid, entry) => entries(board).doc(uid).set(entry),
      rename: (board, uid, name) => entries(board).doc(uid).update({ name }),
      remove: (board, uid) => entries(board).doc(uid).delete(),
    };
  }

  return { KINDS, kindById, BATCH, weekKey, boardId, parseBoard, entriesOf, bests, pending, cleanName, ranked, post, rename, leave, firestoreBoards };
});
