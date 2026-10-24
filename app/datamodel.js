// The saved-data shape and the rules for changing and merging it. Shared by the
// desktop store (Node), the phone's browser store, and cross-device sync, so
// every copy of the data follows exactly the same rules.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./e80.js'));
  else root.DataModel = factory(root.Engine, root.E80);
})(typeof self !== 'undefined' ? self : this, function (E, X) {
  'use strict';

  const THEMES = ['system', 'light', 'dark'];
  const LOCAL_ONLY = ['theme']; // per-device settings; never synced

  function defaultSettings() {
    return {
      config: E.defaultConfig(),
      drillDuration: 120,
      theme: 'system',
      e80: { penalty: 1, allowSkip: false },
      goals: { classic: 70, e80: 70 }, // the score to hit consistently
      updatedAt: 0,
    };
  }

  function normalizeSettings(s) {
    const next = { ...defaultSettings(), ...(s && typeof s === 'object' ? s : {}) };
    next.config = E.normalizeConfig(next.config);
    if (!THEMES.includes(next.theme)) next.theme = 'system';
    const dd = Math.round(Number(next.drillDuration));
    next.drillDuration = Number.isFinite(dd) && dd >= 10 && dd <= 3600 ? dd : 120;
    const e80 = next.e80 || {};
    next.e80 = { penalty: e80.penalty === 2 ? 2 : 1, allowSkip: e80.allowSkip === true };
    const g = next.goals || {};
    const goal = (v) => (Number.isFinite(Number(v)) && Number(v) >= 1 && Number(v) <= 999 ? Math.round(Number(v)) : 70);
    next.goals = { classic: goal(g.classic), e80: goal(g.e80) };
    next.updatedAt = Number.isFinite(next.updatedAt) ? next.updatedAt : 0;
    return next;
  }

  const isSession = (s) => s && typeof s === 'object' && Number.isFinite(s.at) && Array.isArray(s.problems);

  function fresh() {
    return { version: 1, settings: defaultSettings(), resetAt: 0, deleted: [], sessions: [] };
  }

  function normalize(d) {
    const src = d && typeof d === 'object' ? d : {};
    return {
      version: 1,
      settings: normalizeSettings(src.settings),
      resetAt: Number.isFinite(src.resetAt) ? src.resetAt : 0,
      deleted: Array.isArray(src.deleted) ? src.deleted.filter((k) => typeof k === 'string') : [],
      sessions: Array.isArray(src.sessions) ? src.sessions.filter(isSession).sort((a, b) => a.at - b.at) : [],
    };
  }

  const sessionKey = (s) => s.id || `${s.mode}:${s.at}`;

  function addSession(data, s) {
    if (!isSession(s)) throw new Error('Malformed session');
    if (!data.sessions.some((x) => sessionKey(x) === sessionKey(s))) {
      data.sessions.push(s);
      data.sessions.sort((a, b) => a.at - b.at);
    }
    return s;
  }

  /** A theme flip is a per-device choice, so it doesn't count as a synced edit. */
  function applySettings(settings, patch, now = Date.now()) {
    const next = normalizeSettings({ ...settings, ...patch });
    next.updatedAt = Object.keys(patch).some((k) => !LOCAL_ONLY.includes(k)) ? now : settings.updatedAt || 0;
    return next;
  }

  /**
   * Deletes specific games. Their ids are remembered ("tombstones") so a
   * synced device can't bring them back, since merging otherwise only adds.
   */
  function deleteSessions(data, keys) {
    const gone = new Set(keys);
    data.sessions = data.sessions.filter((s) => !gone.has(sessionKey(s)));
    data.deleted = [...new Set([...(data.deleted || []), ...keys])];
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
  function merge(local, remote) {
    const L = normalize(local);
    const R = normalize(remote);
    const resetAt = Math.max(L.resetAt, R.resetAt);
    const deleted = [...new Set([...R.deleted, ...L.deleted])];
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
      resetAt,
      deleted,
      sessions: [...byKey.values()].sort((a, b) => a.at - b.at),
    };
  }

  /** What goes to the shared file: everything except per-device settings. */
  function forUpload(d) {
    const settings = { ...d.settings };
    for (const k of LOCAL_ONLY) delete settings[k];
    return { version: 1, settings, resetAt: d.resetAt || 0, deleted: d.deleted || [], sessions: d.sessions };
  }

  /** Cheap equality for "does the shared copy already have all of this?". */
  function signature(d) {
    if (!d) return '';
    const settings = { ...(d.settings || {}) };
    for (const k of LOCAL_ONLY) delete settings[k];
    return JSON.stringify([d.resetAt || 0, settings, (d.deleted || []).length, (d.sessions || []).map(sessionKey)]);
  }

  function toCsv(data) {
    const head = ['game_started', 'mode', 'problem', 'answer', 'operation', 'type', 'seconds', 'mistakes', 'wrong_entries'];
    const lines = [head.join(',')];
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    for (const s of data.sessions) {
      const started = new Date(s.at).toISOString();
      if (s.mode === 'e80') {
        for (const p of s.problems || []) {
          lines.push([
            started, s.practice ? '80in8 practice' : '80in8', p.q, p.o[p.a], '80 in 8', X.typeInfo(p.t).name,
            (p.ms / 1000).toFixed(2), p.c === p.a ? 0 : 1, p.c == null ? '(skipped)' : p.c === p.a ? '' : p.o[p.c],
          ].map(q).join(','));
        }
        continue;
      }
      for (const p of s.problems || []) {
        lines.push([
          started, s.mode, E.textOf(p), E.answerOf(p), E.OP_NAME[p.op],
          E.categoryInfo(E.classify(p).cat).name, (p.ms / 1000).toFixed(2), p.errors || 0,
          (p.wrong || []).join(' '),
        ].map(q).join(','));
      }
    }
    return lines.join('\r\n');
  }

  return {
    LOCAL_ONLY, fresh, defaultSettings, normalizeSettings, normalize, sessionKey,
    addSession, deleteSessions, applySettings, reset, merge, forUpload, signature, toCsv,
  };
});
