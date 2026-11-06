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

  /** The boards one round posts to: [{ board, score, at }]. */
  function entriesOf(s) {
    const out = [];
    for (const k of KINDS) {
      const score = k.of(s);
      if (score == null || !inRange(k.id, score)) continue;
      if (k.id === 'daily') out.push({ board: boardId('daily', s.daily), score, at: s.at });
      else {
        out.push({ board: boardId(k.id, 'all'), score, at: s.at });
        out.push({ board: boardId(k.id, `w${weekKey(s.at)}`), score, at: s.at });
      }
    }
    return out;
  }

  /**
   * A player's entry on every board their rounds reach: the best score (earliest
   * on a tie), except a daily, where the first try stands.
   */
  function bests(sessions) {
    const out = new Map();
    for (const s of sessions.slice().sort((a, b) => a.at - b.at)) {
      for (const e of entriesOf(s)) {
        const cur = out.get(e.board);
        if (!cur || (parseBoard(e.board).kind !== 'daily' && e.score > cur.score)) out.set(e.board, { score: e.score, at: e.at });
      }
    }
    return out;
  }

  /**
   * The entries still to post: every best that differs from what this device last
   * posted (`posted`: board → score). Catches up after offline rounds and new joins.
   */
  function pending(sessions, posted = {}) {
    return [...bests(sessions)].filter(([board, e]) => posted[board] !== e.score).map(([board, e]) => ({ board, ...e }));
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

  /**
   * Writes entries to the boards, stopping at the first network error (returned as
   * `error`, to retry later). Returns how many were written and which boards are
   * settled: written, or refused because the board already holds a better score or
   * that daily, which is expected rather than an error.
   */
  async function post(remote, uid, name, entries) {
    let written = 0;
    const settled = [];
    for (const e of entries) {
      try {
        await remote.put(e.board, uid, { name, score: e.score, at: e.at });
        written++;
      } catch (err) {
        if (!(err && err.code === 'permission-denied')) return { written, settled, error: err };
      }
      settled.push(e.board);
    }
    return { written, settled, error: null };
  }

  /** A new nickname on every board the player's rounds reach (scores untouched). */
  async function rename(remote, uid, name, sessions) {
    let n = 0;
    for (const board of bests(sessions).keys()) {
      try {
        await remote.rename(board, uid, name);
        n++;
      } catch (err) {
        if (!(err && err.code === 'not-found')) throw err; // a board never posted to
      }
    }
    return n;
  }

  /** Leaving: remove the player's entry from every board their rounds reach. */
  async function leave(remote, uid, sessions) {
    let n = 0;
    for (const board of bests(sessions).keys()) {
      await remote.remove(board, uid);
      n++;
    }
    return n;
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

  return { KINDS, kindById, weekKey, boardId, parseBoard, entriesOf, bests, pending, cleanName, ranked, post, rename, leave, firestoreBoards };
});
