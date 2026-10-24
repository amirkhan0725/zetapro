// Turns saved games into "where am I losing time" answers.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Stats = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const DAY = 864e5;
  const CAP_MS = 30000; // one stall (phone, distraction) shouldn't swamp a category
  const MIN_N = 4;      // fewer samples than this and a category is flagged as thin

  const RANGES = [
    { key: 'last10', label: 'Last 10 games' },
    { key: 'd7', label: '7 days' },
    { key: 'd30', label: '30 days' },
    { key: 'all', label: 'All time' },
  ];

  function selectSessions(sessions, { range = 'd30', drills = true, now = Date.now() } = {}) {
    // 80-in-8 rounds have their own page and stats.
    let s = sessions.filter((x) => x.mode !== 'e80' && (drills || x.mode !== 'drill'));
    if (range === 'last10') s = s.slice(-10);
    else if (range === 'd7') s = s.filter((x) => x.at >= now - 7 * DAY);
    else if (range === 'd30') s = s.filter((x) => x.at >= now - 30 * DAY);
    return s;
  }

  function isValid(p) {
    return p && E.OPS.includes(p.op) && Number.isFinite(p.a) && Number.isFinite(p.b) && Number.isFinite(p.ms);
  }

  /** Completed problems, each tagged with its classification. */
  function flatten(sessions) {
    const out = [];
    for (const s of sessions) {
      for (const p of s.problems || []) {
        if (!isValid(p)) continue;
        out.push({
          op: p.op, a: p.a, b: p.b,
          ms: Math.min(p.ms, CAP_MS),
          errors: p.errors || 0,
          wrong: Array.isArray(p.wrong) ? p.wrong : [],
          at: s.at,
          mode: s.mode,
          cls: E.classify(p),
        });
      }
    }
    return out;
  }

  function median(sorted) {
    if (!sorted.length) return 0;
    const m = sorted.length >> 1;
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  }

  function agg(list) {
    const n = list.length;
    if (!n) return { n: 0, errN: 0, errRate: 0, accuracy: 0, meanMs: 0, medianMs: 0 };
    const times = list.map((p) => p.ms).sort((x, y) => x - y);
    const errN = list.reduce((s, p) => s + (p.errors > 0 ? 1 : 0), 0);
    const sum = times.reduce((s, t) => s + t, 0);
    return {
      n,
      errN,
      errRate: errN / n,
      accuracy: 1 - errN / n,
      meanMs: sum / n,
      medianMs: median(times),
    };
  }

  function groupBy(list, fn) {
    const m = new Map();
    for (const x of list) {
      const k = fn(x);
      if (k == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  }

  // "Cost" of a type = its average time, inflated by its miss rate, relative to
  // the same figure for all problems. 1.0× is your average problem; 2.0× means
  // this type eats twice the time an average one does.
  const weighted = (a) => a.meanMs * (1 + a.errRate);

  function categories(problems) {
    const overall = agg(problems);
    const base = weighted(overall) || 1;
    const rows = [];
    for (const [key, list] of groupBy(problems, (p) => p.cls.cat)) {
      const a = agg(list);
      rows.push({ ...E.categoryInfo(key), ...a, cost: weighted(a) / base, lowData: a.n < MIN_N });
    }
    rows.sort((x, y) => (x.lowData - y.lowData) || (y.cost - x.cost));
    return { overall, rows };
  }

  function byOp(problems) {
    const g = groupBy(problems, (p) => p.op);
    return E.OPS.filter((op) => g.has(op)).map((op) => ({ op, symbol: E.SYMBOL[op], name: E.OP_NAME[op], ...agg(g.get(op)) }));
  }

  const MAP_COLS = [
    { key: 'mul.t', label: '× tables', hint: 'up to 12 × 12' },
    { key: 'mul.x', label: '× 2-digit', hint: 'e.g. 7 × 86' },
    { key: 'div.t', label: '÷ tables', hint: 'answer ≤ 12' },
    { key: 'div.x', label: '÷ 2-digit', hint: 'e.g. 602 ÷ 7' },
  ];

  /** Factor (2–12) × problem shape grid for multiplication and division. */
  function factorMap(problems) {
    const cells = {};
    for (const [key, list] of groupBy(problems, (p) => p.cls.cell)) cells[key] = agg(list);
    const factors = E.FACTORS.slice();
    for (const key of Object.keys(cells)) {
      const f = Number(key.split('.')[2]);
      if (!factors.includes(f)) factors.push(f);
    }
    factors.sort((x, y) => x - y);
    return { cols: MAP_COLS, factors, cells };
  }

  function mistakes(problems) {
    const counts = {};
    let total = 0;
    for (const p of problems) {
      for (const w of p.wrong) {
        const kind = E.mistakeKind(p, w);
        if (!counts[kind]) counts[kind] = { kind, count: 0, examples: [] };
        counts[kind].count++;
        counts[kind].examples.push({ text: E.textOf(p), answer: E.answerOf(p), wrong: w, at: p.at });
        total++;
      }
    }
    const rows = Object.values(counts).map((r) => {
      const [label, help] = E.MISTAKE_INFO[r.kind];
      r.examples.sort((x, y) => y.at - x.at);
      return { ...r, label, help, share: r.count / total, examples: r.examples.slice(0, 3) };
    });
    rows.sort((x, y) => y.count - x.count);
    return { total, rows };
  }

  /**
   * Specific problems worth rehearsing: any you got wrong, plus any that took
   * at least twice your usual time for that type (and 1.5× your overall median).
   */
  function trouble(problems, limit = 15) {
    const overall = agg(problems);
    const catMedian = {};
    for (const [key, list] of groupBy(problems, (p) => p.cls.cat)) {
      catMedian[key] = list.length >= MIN_N ? agg(list).medianMs : overall.medianMs;
    }
    const byKey = new Map();
    for (const p of problems) {
      const k = E.keyOf(p);
      if (!byKey.has(k)) {
        byKey.set(k, { key: k, op: p.op, a: p.a, b: p.b, text: E.textOf(p), answer: E.answerOf(p),
          cat: p.cls.cat, seen: 0, missed: 0, slow: 0, totalMs: 0, wrong: [], lastAt: 0 });
      }
      const t = byKey.get(k);
      t.seen++;
      t.totalMs += p.ms;
      t.lastAt = Math.max(t.lastAt, p.at);
      if (p.errors > 0) t.missed++;
      if (p.ms >= Math.max(2 * catMedian[p.cls.cat], 1.5 * overall.medianMs)) t.slow++;
      for (const w of p.wrong) if (!t.wrong.includes(w) && t.wrong.length < 4) t.wrong.push(w);
    }
    const rows = [...byKey.values()]
      .filter((t) => t.missed + t.slow > 0)
      .map((t) => ({ ...t, meanMs: t.totalMs / t.seen, score: t.missed * 3 + t.slow }));
    rows.sort((x, y) => (y.score - x.score) || (y.meanMs - x.meanMs) || (y.lastAt - x.lastAt));
    return { count: rows.length, rows: rows.slice(0, limit), all: rows };
  }

  function classicGames(sessions, fp) {
    return sessions.filter((s) => s.mode === 'classic' && !s.aborted && (!fp || E.fingerprint(s.config) === fp));
  }

  function scoreSummary(sessions, fp) {
    const games = classicGames(sessions, fp);
    const scores = games.map((g) => g.score);
    const last10 = scores.slice(-10);
    return {
      games: games.length,
      best: scores.length ? Math.max(...scores) : null,
      recentAvg: last10.length ? last10.reduce((s, x) => s + x, 0) / last10.length : null,
      history: games.map((g, i) => ({ i: i + 1, at: g.at, score: g.score })),
    };
  }

  /**
   * Smart drill: your costliest well-sampled types among the enabled
   * operations, weighted by cost² so the worst ones come up most.
   */
  function smartDrill(problems, config, top = 6) {
    const cfg = E.normalizeConfig(config);
    const { rows } = categories(problems);
    const picked = rows.filter((r) => !r.lowData && cfg.ops[r.op] && r.key !== 'mul.big' && r.key !== 'div.big').slice(0, top);
    if (picked.length < 2) return null;
    return {
      rows: picked,
      weights: picked.map((r) => ({ key: r.key, w: r.cost * r.cost })),
    };
  }

  return {
    RANGES, CAP_MS, MIN_N,
    selectSessions, flatten, agg, categories, byOp, factorMap, mistakes, trouble,
    classicGames, scoreSummary, smartDrill, median,
  };
});
