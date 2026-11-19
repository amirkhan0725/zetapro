// @ts-check
// The saved-data shape and the rules for changing and merging it. Shared by the
// desktop store (Node), the phone's browser store, and cross-device sync, so
// every copy of the data follows exactly the same rules.
(function (/** @type {any} */ root, /** @type {Function} */ factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./engine.js'), require('./e80.js'));
  else root.DataModel = factory(root.Engine, root.E80);
})(typeof self !== 'undefined' ? self : this, function (E, X) {
  'use strict';

  // ---- Types -------------------------------------------------------------------
  // The shape of everything saved, written down once. These are comments: they run
  // nothing, and `npm run typecheck` reads them. They describe what the code writes
  // today (renderer/app.js finishGame and finishE80, renderer/oa-ui.js finish and
  // finishZap), including the optional fields.

  /** @typedef {{ add: boolean, sub: boolean, mul: boolean, div: boolean }} OpsEnabled which of the four operations are on */

  /**
   * A Classic round's setup, as in Zetamac. `add` and `mul` are [leftMin, leftMax, rightMin, rightMax];
   * subtraction and division reuse them in reverse.
   * @typedef {{ ops: OpsEnabled, add: number[], mul: number[], duration: number }} Config
   */

  /**
   * Everything the player has set. `lb` and `oaMock` are only there once used. `theme` and `keypad` stay on
   * the device (LOCAL_ONLY); the rest syncs.
   * @typedef {object} Settings
   * @property {Config} config
   * @property {number} drillDuration seconds, 10 to 3600
   * @property {string} theme 'system' or a theme id from THEMES
   * @property {{ penalty: 1 | 2, allowSkip: boolean }} e80 how 80 in 8 is scored
   * @property {{ classic: number, e80: number }} goals the score to hit consistently
   * @property {number} weeklyGoal practice days a week, 0 to 7 (0 = none)
   * @property {boolean} countdown the 3-2-1 before a round
   * @property {'auto' | 'on' | 'off'} keypad
   * @property {number} updatedAt when a synced setting last changed (ms)
   * @property {{ uid: string, name: string, joined: number } | null} [lb] the leaderboard nickname, for one account
   * @property {{ id: string, startedAt: number } | null} [oaMock] the Full run in progress
   */

  /**
   * One Classic or drill question and how it went.
   * @typedef {object} ArithmeticProblem
   * @property {'add' | 'sub' | 'mul' | 'div'} op
   * @property {number} a
   * @property {number} b
   * @property {number} ms time to the right answer
   * @property {number} errors how many separate mistakes
   * @property {string[]} wrong the wrong entries typed (the first few)
   */

  /**
   * One 80 in 8 question and the answer given.
   * @typedef {object} E80Record
   * @property {string} t question type id
   * @property {string} q the question text
   * @property {string[]} o the four options
   * @property {number} a index of the right option
   * @property {number | null} c index picked, null for a skip or a timeout
   * @property {number} ms
   */

  /**
   * One Arcade question (or one Zap-N item) and how it went. Fields vary by module; `n`, `x` and `late` come from
   * the quiz modules, `c` and `m` from Balloon.
   * @typedef {object} ArcadeItem
   * @property {number} [n] question number in the round
   * @property {string} t topic, or the game name for Zap-N
   * @property {string} q what was asked
   * @property {string | number} [a] the answer
   * @property {string} [x] the explanation
   * @property {unknown} g what the player gave (null when skipped)
   * @property {boolean} ok
   * @property {number} pts
   * @property {number} ms
   * @property {1} [late] answered after the time limit
   * @property {string} [c] Balloon: the balloon's color id
   * @property {number} [m] Balloon: its hidden limit
   */

  /** @typedef {ArithmeticProblem | E80Record | ArcadeItem} Problem anything in a session's `problems` list */

  /**
   * What Classic and drill rounds share.
   * @typedef {object} ArithmeticFields
   * @property {string | null} label a drill's name, or null
   * @property {string | null} kind 'smart' for smart drills
   * @property {string} [daily] the Daily Challenge's day (YYYY-MM-DD) when this round was it
   * @property {number} [seed] the seed of a round others can challenge
   * @property {string} [dailySet] the Daily whose problems a challenge round replays (YYYY-MM-DD)
   * @property {{ score: number, name: string }} [challenge] the score being challenged
   * @property {Config} config
   * @property {number} duration seconds
   * @property {number} score problems answered
   * @property {ArithmeticProblem[]} problems
   * @property {ArithmeticProblem | null} unfinished the question on screen when the round ended
   */

  /**
   * What every saved round has. `id` is missing from very old rounds (see sessionKey).
   * @typedef {object} SessionBase
   * @property {string} [id]
   * @property {number} at when the round started (ms)
   * @property {boolean} aborted quit before the end
   */

  /** @typedef {SessionBase & ArithmeticFields & { mode: 'classic' }} ClassicSession */
  /** @typedef {SessionBase & ArithmeticFields & { mode: 'drill' }} DrillSession */

  /**
   * An 80 in 8 attempt (or a practice round).
   * @typedef {object} E80Fields
   * @property {'e80'} mode
   * @property {boolean} practice
   * @property {string | null} label
   * @property {{ penalty: number, allowSkip: boolean }} settings how it was scored
   * @property {number} questions
   * @property {number} seconds the time limit
   * @property {number} timeUsedMs
   * @property {number} score net points
   * @property {number} right
   * @property {number} wrong
   * @property {number} skipped
   * @property {E80Record[]} problems
   */
  /** @typedef {SessionBase & E80Fields} E80Session */

  /**
   * An Arcade round: one module's quiz, Quick play, or a Zap-N game.
   * @typedef {object} ArcadeFields
   * @property {'oa'} mode
   * @property {string} module module id ('bto', 'zap', ...)
   * @property {string} [game] Zap-N game id
   * @property {boolean} practice Learn and Quick play rounds
   * @property {number} score
   * @property {number} right
   * @property {number} wrong
   * @property {number} skipped
   * @property {number} total
   * @property {number} timeUsedMs
   * @property {ArcadeItem[]} problems
   * @property {true} [quick] a Quick play run
   * @property {number} [hits] Quick play
   * @property {number} [level] Quick play
   * @property {number} [bestCombo] Quick play
   * @property {string} [mock] the Full run this round belongs to
   * @property {string} [mockStage] its stage in that run
   * @property {Object<string, number>} [balloonLimits] Balloon: each color's hidden limit
   * @property {number} [balloonMax] Balloon, older rounds: the one hidden limit
   */
  /** @typedef {SessionBase & ArcadeFields} ArcadeSession */

  /** @typedef {ClassicSession | DrillSession | E80Session | ArcadeSession} Session one saved round; `mode` says which kind */

  /**
   * The saved file, and what a sync passes around.
   * @typedef {object} Data
   * @property {1} version
   * @property {Settings} settings
   * @property {number} epoch restore generation; the higher copy decides resetAt and deleted
   * @property {number} resetAt games started before this are gone
   * @property {string[]} deleted keys of deleted games ("tombstones")
   * @property {Session[]} sessions oldest first
   */

  // Auto and every theme in themes.js (a test keeps them equal). Saved settings
  // use these ids, so an id stays even if its theme is renamed.
  const THEMES = [
    'system',
    'light',
    'paper',
    'ash',
    'slate',
    'dark',
    'midnight',
    'forest',
    'ember',
    'rose',
    'lavender',
    'contrast-light',
    'solarized-light',
    'gruvbox-light',
    'catppuccin-latte',
    'rose-pine-dawn',
    'everforest-light',
    'one-light',
    'meadow',
    'glacier',
    'ayu-light',
    'kanagawa-lotus',
    'newsprint',
    'orchid',
    'sepia',
    'fog',
    'clay',
    'sage',
    'nord',
    'catppuccin-frappe',
    'everforest-dark',
    'dusk',
    'mauve',
    'wheat',
    'seafoam',
    'cacao',
    'moss',
    'graphite',
    'wine',
    'denim',
    'spruce',
    'contrast-dark',
    'solarized-dark',
    'gruvbox-dark',
    'dracula',
    'catppuccin-mocha',
    'rose-pine',
    'tokyo-night',
    'one-dark',
    'kanagawa',
    'night-owl',
    'lagoon',
    'plum',
  ];
  const LOCAL_ONLY = ['theme', 'keypad']; // per-device settings; never synced

  /** @returns {Settings} */
  function defaultSettings() {
    return {
      config: E.defaultConfig(),
      drillDuration: 120,
      theme: 'system',
      e80: { penalty: 1, allowSkip: false },
      goals: { classic: 70, e80: 70 }, // the score to hit consistently
      weeklyGoal: 3, // practice days a week to aim for; 0 = no weekly goal
      countdown: true, // 3-2-1 before a round
      keypad: 'auto', // on-screen number pad: auto (touch screens) | on | off
      updatedAt: 0,
    };
  }

  /**
   * @param {Partial<Settings> | null | undefined} s
   * @returns {Settings}
   */
  function normalizeSettings(s) {
    const next = { ...defaultSettings(), ...(s && typeof s === 'object' ? s : {}) };
    next.config = E.normalizeConfig(next.config);
    if (!THEMES.includes(next.theme)) next.theme = 'system';
    const dd = Math.round(Number(next.drillDuration));
    next.drillDuration = Number.isFinite(dd) && dd >= 10 && dd <= 3600 ? dd : 120;
    /** @type {Partial<Settings["e80"]>} */
    const e80 = next.e80 || {};
    next.e80 = { penalty: e80.penalty === 2 ? 2 : 1, allowSkip: e80.allowSkip === true };
    /** @type {Partial<Settings["goals"]>} */
    const g = next.goals || {};
    const goal = (v) => (Number.isFinite(Number(v)) && Number(v) >= 1 && Number(v) <= 999 ? Math.round(Number(v)) : 70);
    next.goals = { classic: goal(g.classic), e80: goal(g.e80) };
    const wg = Number(next.weeklyGoal);
    next.weeklyGoal = Number.isInteger(wg) && wg >= 0 && wg <= 7 ? wg : 3;
    next.countdown = next.countdown !== false;
    if (!['auto', 'on', 'off'].includes(next.keypad)) next.keypad = 'auto';
    next.updatedAt = Number.isFinite(next.updatedAt) ? next.updatedAt : 0;
    return next;
  }

  const isSession = (s) => s && typeof s === 'object' && Number.isFinite(s.at) && Array.isArray(s.problems);

  /** @returns {Data} */
  function fresh() {
    return { version: 1, settings: defaultSettings(), epoch: 0, resetAt: 0, deleted: [], sessions: [] };
  }

  /**
   * @param {any} d anything read from disk, a backup or the cloud
   * @returns {Data}
   */
  function normalize(d) {
    const src = d && typeof d === 'object' ? d : {};
    return {
      version: 1,
      settings: normalizeSettings(src.settings),
      epoch: Number.isInteger(src.epoch) && src.epoch > 0 ? src.epoch : 0,
      resetAt: Number.isFinite(src.resetAt) ? src.resetAt : 0,
      deleted: Array.isArray(src.deleted) ? src.deleted.filter((k) => typeof k === 'string') : [],
      sessions: Array.isArray(src.sessions) ? src.sessions.filter(isSession).sort((a, b) => a.at - b.at) : [],
    };
  }

  /** @param {Session} s */
  const sessionKey = (s) => s.id || `${s.mode}:${s.at}`;

  /** A new round's id: its start time in base 36 plus five random base-36 characters. */
  const newSessionId = (at, rng = Math.random) => at.toString(36) + rng().toString(36).slice(2, 7);

  /**
   * @param {Data} data
   * @param {Session} s
   * @returns {Session}
   */
  function addSession(data, s) {
    if (!isSession(s)) throw new Error('Malformed session');
    if (!data.sessions.some((x) => sessionKey(x) === sessionKey(s))) {
      data.sessions.push(s);
      data.sessions.sort((a, b) => a.at - b.at);
    }
    return s;
  }

  /** A theme flip is a per-device choice, so it doesn't count as a synced edit. */
  /**
   * @param {Settings} settings
   * @param {Partial<Settings>} patch
   * @returns {Settings}
   */
  function applySettings(settings, patch, now = Date.now()) {
    const next = normalizeSettings({ ...settings, ...patch });
    next.updatedAt = Object.keys(patch).some((k) => !LOCAL_ONLY.includes(k)) ? now : settings.updatedAt || 0;
    return next;
  }

  /**
   * Deletes specific games. Their ids are remembered ("tombstones") so a
   * synced device can't bring them back, since merging otherwise only adds.
   */
  /**
   * @param {Data} data
   * @param {string[]} keys
   * @returns {Data}
   */
  function deleteSessions(data, keys) {
    const gone = new Set(keys);
    data.sessions = data.sessions.filter((s) => !gone.has(sessionKey(s)));
    data.deleted = [...new Set([...(data.deleted || []), ...keys])];
    return data;
  }

  /**
   * Brings games back (undo a delete, or restore an old version). Bumps the
   * restore generation so every synced device accepts the result instead of
   * re-applying the old delete, and lifts tombstones/reset only as far as the
   * restored games need.
   */
  /**
   * @param {Data} data
   * @param {Session[]} sessions
   * @returns {Data}
   */
  function restoreSessions(data, sessions) {
    const valid = sessions.filter(isSession);
    const keys = new Set(valid.map(sessionKey));
    for (const s of valid) {
      if (!data.sessions.some((x) => sessionKey(x) === sessionKey(s))) data.sessions.push(s);
    }
    data.sessions.sort((a, b) => a.at - b.at);
    data.deleted = (data.deleted || []).filter((k) => !keys.has(k));
    const earliest = valid.reduce((m, s) => Math.min(m, s.at), Infinity);
    if (data.resetAt && earliest <= data.resetAt) data.resetAt = earliest - 1;
    data.epoch = (data.epoch || 0) + 1;
    return data;
  }

  /**
   * Forgets this device's games without recording any deletion, so nothing
   * is removed from an account; signing back in downloads them again.
   */
  function clearDevice(data) {
    const settings = data.settings;
    Object.assign(data, fresh(), { settings });
    return data;
  }

  /** Reset wipes games started before now, here and — once synced — everywhere. */
  function reset(data, now = Date.now()) {
    data.sessions = [];
    data.resetAt = now;
  }

  /**
   * Combines two copies. Games are only ever added, so the result is the union
   * by id (minus anything from before the latest reset). Settings come from
   * whichever copy changed them last, except per-device ones. On a tie the
   * remote copy wins, so a fresh device adopts the settings already in use.
   */
  /**
   * @param {any} local
   * @param {any} remote
   * @returns {Data}
   */
  function merge(local, remote) {
    const L = normalize(local);
    const R = normalize(remote);
    // A restore bumps `epoch`: the copy with the higher epoch decides what counts
    // as deleted, so an old "delete everything" on another device can't undo it.
    const epoch = Math.max(L.epoch, R.epoch);
    const rules = L.epoch === R.epoch ? null : L.epoch > R.epoch ? L : R;
    const resetAt = rules ? rules.resetAt : Math.max(L.resetAt, R.resetAt);
    const deleted = rules ? rules.deleted : [...new Set([...R.deleted, ...L.deleted])];
    const gone = new Set(deleted);
    const byKey = new Map();
    for (const s of [...R.sessions, ...L.sessions]) {
      if ((!resetAt || s.at > resetAt) && !gone.has(sessionKey(s))) byKey.set(sessionKey(s), s);
    }
    const remoteNewer = R.settings.updatedAt >= L.settings.updatedAt && remote && remote.settings;
    const settings = remoteNewer ? { ...R.settings } : { ...L.settings };
    for (const k of LOCAL_ONLY) settings[k] = L.settings[k];
    return {
      version: 1,
      settings,
      epoch,
      resetAt,
      deleted,
      sessions: [...byKey.values()].sort((a, b) => a.at - b.at),
    };
  }

  /** What goes to the shared file: everything except per-device settings. */
  function forUpload(d) {
    const settings = { ...d.settings };
    for (const k of LOCAL_ONLY) delete settings[k];
    return {
      version: 1,
      settings,
      epoch: d.epoch || 0,
      resetAt: d.resetAt || 0,
      deleted: d.deleted || [],
      sessions: d.sessions,
    };
  }

  /** Cheap equality for "does the shared copy already have all of this?". */
  function signature(d) {
    if (!d) return '';
    const settings = { ...(d.settings || {}) };
    for (const k of LOCAL_ONLY) delete settings[k];
    return JSON.stringify([
      d.epoch || 0,
      d.resetAt || 0,
      settings,
      (d.deleted || []).length,
      (d.sessions || []).map(sessionKey),
    ]);
  }

  /**
   * Whether merge(local, …) changed this device's copy, so a sync that brought
   * nothing new can skip rewriting it. Merging keeps local games over remote
   * ones and local per-device settings, and at one epoch tombstones only grow,
   * so the same games, rules and shared settings mean the same copy.
   */
  function changedBy(local, merged) {
    return signature(local) !== signature(merged);
  }

  /**
   * @param {Data} data
   * @returns {string}
   */
  function toCsv(data) {
    const head = [
      'game_started',
      'mode',
      'problem',
      'answer',
      'operation',
      'type',
      'seconds',
      'mistakes',
      'wrong_entries',
    ];
    const lines = [head.join(',')];
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    for (const s of data.sessions) {
      const started = new Date(s.at).toISOString();
      if (s.mode === 'e80') {
        for (const p of s.problems || []) {
          lines.push(
            [
              started,
              s.practice ? '80in8 practice' : '80in8',
              p.q,
              p.o[p.a],
              '80 in 8',
              X.typeInfo(p.t).name,
              (p.ms / 1000).toFixed(2),
              p.c === p.a ? 0 : 1,
              p.c == null ? '(skipped)' : p.c === p.a ? '' : p.o[p.c],
            ]
              .map(q)
              .join(','),
          );
        }
        continue;
      }
      if (s.mode === 'oa') {
        // Assessment modules store one summary line per question.
        for (const p of s.problems || []) {
          lines.push(
            [
              started,
              `${s.module}${s.practice ? ' learn' : ''}`,
              p.q,
              p.a,
              s.module,
              p.t,
              ((p.ms || 0) / 1000).toFixed(2),
              p.ok ? 0 : 1,
              p.g == null ? '(skipped)' : p.ok ? '' : p.g,
            ]
              .map(q)
              .join(','),
          );
        }
        continue;
      }
      for (const p of s.problems || []) {
        lines.push(
          [
            started,
            s.mode,
            E.textOf(p),
            E.answerOf(p),
            E.OP_NAME[p.op],
            E.categoryInfo(E.classify(p).cat).name,
            (p.ms / 1000).toFixed(2),
            p.errors || 0,
            (p.wrong || []).join(' '),
          ]
            .map(q)
            .join(','),
        );
      }
    }
    return lines.join('\r\n');
  }

  return {
    THEMES,
    LOCAL_ONLY,
    fresh,
    defaultSettings,
    normalizeSettings,
    normalize,
    sessionKey,
    newSessionId,
    addSession,
    deleteSessions,
    restoreSessions,
    clearDevice,
    applySettings,
    reset,
    merge,
    changedBy,
    forUpload,
    signature,
    toCsv,
  };
});
