// Progress you can see: skill levels per operation and problem type, worked
// out from saved rounds alone, so they follow a player to every device with
// no extra data to sync.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Progress = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const DAY = 864e5;

  // ---- skill levels -----------------------------------------------------------
  // A level is a speed you can check: your average time on the most recent
  // problems of a kind, turned into the Classic score it would make in 120
  // seconds ("pace"). Level 6 is a pace of 60–69. Only Zetamac's standard
  // ranges count, so a level means the same thing for everyone.

  const WINDOW = { op: 40, type: 20 }; // recent problems a level is measured over
  const MIN_N = 10;                    // problems before a level shows
  const CAP_MS = 10000;                // one stall counts as 10 s at most

  const within = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  /** Inside Zetamac's default ranges: (2–100) + (2–100), (2–12) × (2–100), and their reverses. */
  function isStandard(p) {
    switch (p.op) {
      case 'add': return within(p.a, 2, 100) && within(p.b, 2, 100);
      case 'sub': return within(p.b, 2, 100) && within(p.a - p.b, 2, 100);
      case 'mul': return within(Math.min(p.a, p.b), 2, 12) && within(Math.max(p.a, p.b), 2, 100);
      case 'div': return within(p.b, 2, 12) && within(p.a / p.b, 2, 100);
      default: return false;
    }
  }

  /** The Classic score a round of nothing but these problems would make. */
  const paceOf = (meanMs) => 120000 / meanMs;
  const levelOf = (pace) => Math.max(1, Math.floor(pace / 10));

  /**
   * Levels for every operation ('add') and type ('mul.x.7') from Classic and
   * drill rounds, oldest first. Per key: n problems seen, the current pace and
   * level over the last WINDOW problems (once there are MIN_N), `next` (0–1, the
   * way to the next level), `best`, the highest level held over a full window,
   * with `bestAt`, and `start`, the pace of the first full window and when.
   * Pass sessions sorted by time, as the store keeps them.
   */
  function skills(sessions) {
    const track = new Map();
    const feed = (key, kind, ms, at) => {
      let t = track.get(key);
      if (!t) track.set(key, (t = { key, kind, n: 0, recent: [], sum: 0, best: null, bestAt: null, start: null }));
      t.n++;
      t.recent.push(ms);
      t.sum += ms;
      if (t.recent.length > WINDOW[kind]) t.sum -= t.recent.shift();
      // Only a full window can set a best, so a lucky first few don't count.
      if (t.recent.length === WINDOW[kind]) {
        const pace = paceOf(t.sum / t.recent.length);
        const level = levelOf(pace);
        if (!t.start) t.start = { pace, at };
        if (t.best == null || level > t.best) {
          t.best = level;
          t.bestAt = at;
        }
      }
    };
    for (const s of sessions) {
      if (s.mode !== 'classic' && s.mode !== 'drill') continue;
      for (const p of s.problems || []) {
        if (!Number.isFinite(p.ms) || p.ms <= 0 || !isStandard(p)) continue;
        const ms = Math.min(p.ms, CAP_MS);
        feed(p.op, 'op', ms, s.at);
        feed(E.classify(p).cat, 'type', ms, s.at);
      }
    }
    const out = new Map();
    for (const t of track.values()) {
      const ready = t.recent.length >= MIN_N;
      const pace = ready ? paceOf(t.sum / t.recent.length) : null;
      const level = ready ? levelOf(pace) : null;
      out.set(t.key, {
        key: t.key, kind: t.kind, n: t.n, pace, level,
        next: ready ? Math.min(1, Math.max(0, (pace - level * 10) / 10)) : 0,
        full: t.recent.length >= WINDOW[t.kind],
        best: t.best, bestAt: t.bestAt, start: t.start,
      });
    }
    return out;
  }

  /** Levels as they stood at a moment: only rounds started before `at`. */
  const skillsAt = (sessions, at) => skills(sessions.filter((s) => s.at < at));

  /**
   * Keys whose best level rose from `before` to `after` (a new high, not a
   * return to an old one), operations first, then by the size of the rise.
   * A first full window only sets a baseline, so it isn't a level-up.
   */
  function levelUps(before, after) {
    const ups = [];
    for (const [key, a] of after) {
      const b = before.get(key);
      if (b && b.best != null && a.best != null && a.best > b.best) ups.push({ key, kind: a.kind, from: b.best, to: a.best });
    }
    return ups.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'op' ? -1 : 1) || (y.to - y.from) - (x.to - x.from) || y.to - x.to);
  }

  /** Operation levels that showed for the first time (a player's starting levels). */
  function firstLevels(before, after) {
    return E.OPS.filter((op) => after.get(op) && after.get(op).level != null && !(before.get(op) && before.get(op).level != null))
      .map((op) => ({ key: op, level: after.get(op).level }));
  }

  /**
   * Types with a level, nearest the next one first: the levels within reach.
   * Full windows only, unless no type has one yet.
   */
  function withinReach(levels, limit = 3) {
    const leveled = [...levels.values()].filter((r) => r.kind === 'type' && r.level != null);
    const full = leveled.filter((r) => r.full);
    return (full.length ? full : leveled).sort((a, b) => b.next - a.next || b.n - a.n).slice(0, limit);
  }

  // ---- next up -------------------------------------------------------------------

  const NEAR = 0.7; // "within reach": at least this far toward the next level

  /**
   * The one round the Play page suggests, in order: spaced reviews due today
   * (once a day: after a review drill the next suggestion moves on), then the
   * smart drill of your costliest types (with whichever of them is nearest its
   * next level), then a type within reach of its next level. Null with
   * nothing to go on yet. `smart` is Stats.smartDrill's result.
   */
  function nextUp({ due = 0, reviewedToday = false, smart = null, levels = new Map() } = {}) {
    if (due && !reviewedToday) return { kind: 'review', due };
    if (smart) {
      const near = smart.rows.map((r) => levels.get(r.key))
        .filter((l) => l && l.level != null && l.next >= NEAR)
        .sort((a, b) => b.next - a.next)[0] || null;
      return { kind: 'smart', rows: smart.rows, near };
    }
    const reach = withinReach(levels, 1)[0];
    if (reach && reach.next >= NEAR) return { kind: 'level', row: reach };
    return due ? { kind: 'review', due } : null;
  }

  /** "60+": a round of 10 or more that passes a multiple of ten for the first time. */
  function milestone(score, prevBest) {
    const mark = Math.floor(score / 10) * 10;
    return prevBest != null && mark >= 10 && prevBest < mark ? mark : null;
  }

  // ---- the week ----------------------------------------------------------------
  // A weekly goal of practice days, Monday to Sunday (local time, like the
  // calendar and the weekly leaderboards). It's counted as "met in N of the last
  // 8 weeks", so a missed day or week never "breaks" anything; it just doesn't count.

  const PAST_WEEKS = 8;

  /** Midnight on the Monday of the week holding `date`, local time. */
  function weekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  const addDays = (date, n) => {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  };

  /** Days with practice in the 7 days from `start` (up to and including `until`). */
  function daysIn(byDay, start, until = addDays(start, 6)) {
    let n = 0;
    for (let d = new Date(start); d <= until; d = addDays(d, 1)) if (byDay.has(E.dayKey(d))) n++;
    return n;
  }

  /**
   * This week against a goal of `goal` practice days (0 = no goal), from
   * Stats.practiceByDay. `past` counts earlier weeks that met the goal, among
   * the last 8 since the first day practised, so a new player isn't marked
   * down for weeks before they started.
   */
  function weekGoal(byDay, goal, now = new Date()) {
    const start = weekStart(now);
    const days = daysIn(byDay, start, now);
    const first = [...byDay.keys()].sort()[0] || null;
    let weeks = 0;
    let met = 0;
    for (let w = 1; w <= PAST_WEEKS && first; w++) {
      const from = addDays(start, -7 * w);
      if (E.dayKey(addDays(from, 6)) < first) break;
      weeks++;
      if (goal && daysIn(byDay, from) >= goal) met++;
    }
    return { goal, days, met: goal > 0 && days >= goal, left: Math.max(0, goal - days), past: { weeks, met } };
  }

  /** Minutes a round took: the clock it ran for, or its answers' time if it was quit. */
  function roundMs(s) {
    if (s.mode === 'classic' || s.mode === 'drill') {
      return s.aborted ? (s.problems || []).reduce((t, p) => t + (Number(p.ms) || 0), 0) : (Number(s.duration) || 0) * 1000;
    }
    return Number(s.timeUsedMs) || 0;
  }

  /**
   * Last week (Monday to Sunday before the current one) in a few facts: days
   * practised, finished rounds, minutes, the best standard Classic score and
   * whether it was a new best, the best 80 in 8 net at −1, OA tests, and the
   * level-ups it brought. Null if nothing was practised.
   */
  function lastWeek(sessions, now = new Date()) {
    const to = weekStart(now).getTime();
    const from = addDays(new Date(to), -7).getTime();
    const week = sessions.filter((s) => s.at >= from && s.at < to);
    const done = week.filter((s) => !s.aborted);
    if (!done.length) return null;
    const days = new Set(done.map((s) => E.dayKey(new Date(s.at)))).size;
    const std = (s) => s.mode === 'classic' && !s.aborted && E.isDefaultConfig(s.config);
    const classic = done.filter(std);
    const best = classic.length ? Math.max(...classic.map((s) => s.score)) : null;
    const before = sessions.filter((s) => s.at < from && std(s)).map((s) => s.score);
    const e80 = done.filter((s) => s.mode === 'e80' && !s.practice && s.settings && s.settings.penalty === 1);
    return {
      from, to, days,
      rounds: done.length,
      minutes: Math.round(week.reduce((t, s) => t + roundMs(s), 0) / 60000),
      classicBest: best,
      newBest: best != null && before.length > 0 && best > Math.max(...before),
      e80Best: e80.length ? Math.max(...e80.map((s) => s.score)) : null,
      oaTests: done.filter((s) => s.mode === 'oa' && !s.practice).length,
      levelUps: levelUps(skillsAt(sessions, from), skillsAt(sessions, to)),
    };
  }

  return {
    DAY, WINDOW, MIN_N, CAP_MS, PAST_WEEKS, NEAR,
    isStandard, paceOf, levelOf, skills, skillsAt, levelUps, firstLevels, withinReach, nextUp, milestone,
    weekStart, weekGoal, lastWeek,
  };
});
