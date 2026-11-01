// Optiver online-assessment practice beyond 80 in 8: the module list, shared
// maths and formatting, answer options, scoring and per-module records.
// Each module's questions live in its own file (oa-odds.js, …) and its screens
// in oa-ui.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Formats follow Optiver's invite where it says something (total times) and
  // candidate reports otherwise (question counts, per-question limits).
  const MODULES = [
    {
      id: 'bto', name: 'Beat the Odds', generic: 'Probability',
      about: 'Probability and expected-value questions: dice, coins, cards, conditional probability, random walks. Pick the closest of five answers.',
      test: { questions: 30, seconds: 25 * 60, perQuestion: 90 },
      rules: 'Pick the closest option. +1 right, −1 wrong, 0 for a skip. 90 seconds a question, 25 minutes in all, no going back.',
    },
    {
      id: 'nl', name: 'NumberLogic', generic: 'Number sequences',
      about: 'Find the rule behind a sequence and pick the next number from five options. Ramps up to recurrences, product chains and fraction cycles.',
      test: { questions: 26, seconds: 25 * 60, perQuestion: null, revisit: true },
      rules: '+1 right, −1 wrong, 0 for a skip. 25 minutes; skipped questions can be revisited.',
    },
    {
      id: 'll', name: 'Likelihood-list', generic: 'Likelihood ranking',
      about: 'Rank three outcomes from most to least likely, from tables, distribution charts and state graphs. Close calls, a point or two apart.',
      test: { questions: 15, seconds: 25 * 60, perQuestion: 90 },
      rules: '1 point only for the exact order. 90 seconds a question.',
    },
    {
      id: 'iv', name: 'Intervals', generic: 'Estimation intervals',
      about: 'Give a lower and upper bound. Contain the answer and score lower ÷ upper; miss it and score 0. Big grids, percentiles and noisy trends.',
      test: { questions: 18, seconds: 15 * 60, perQuestion: 45 },
      rules: 'Score lower ÷ upper when the answer is inside your range, 0 otherwise, so a range starting at 0 scores 0. 45 seconds a question.',
    },
    {
      id: 'ob', name: 'Orderbooks', generic: 'Order-book arbitrage',
      about: 'Combine buys and sells across 6–8 cards of items and bundles so every item nets to zero at a profit.',
      test: { questions: 20, seconds: 8 * 60, perQuestion: null },
      rules: '1 point per board with a valid profitable combination. 8 minutes for 20 boards.',
    },
    {
      id: 'zap', name: 'Zap-N', generic: 'Speed and memory games',
      about: 'Short neuro-assessment games for arithmetic, attention and risk.',
      test: null,
      rules: 'One or more short games, each scored on its own.',
    },
  ];
  const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]));

  const moduleName = (id) => (byId[id] ? byId[id].name : id);

  // ---- random helpers ------------------------------------------------------

  const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- maths ---------------------------------------------------------------

  function choose(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - Math.min(k, n - k) + i)) / i;
    return Math.round(r);
  }
  const binom = (n, k, p) => choose(n, k) * p ** k * (1 - p) ** (n - k);

  /** Standard normal CDF (Abramowitz–Stegun 7.1.26, error below 1e-7). */
  function normCdf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  // ---- formatting ----------------------------------------------------------

  /** 0.1667 → "16.7%"; small values keep two decimals. */
  function pct(p) {
    const v = p * 100;
    return `${v < 1 && v > 0 ? v.toFixed(2) : v.toFixed(1)}%`;
  }
  const num = (v, dp = 2) => (Number.isInteger(v) ? String(v) : v.toFixed(dp));

  // ---- answer options ------------------------------------------------------

  /**
   * Five options, one of them the true value, spaced so the true one is clearly
   * the closest. `mistakes` are values from common slips, tried first; the rest
   * are spread around the answer. kind 'prob' keeps options in [0, 1].
   */
  function options(rng, value, { kind = 'prob', mistakes = [], count = 5 } = {}) {
    const fmt = kind === 'prob' ? pct : (v) => num(v);
    const lo = kind === 'prob' ? 0.0005 : -Infinity;
    const hi = kind === 'prob' ? 0.9995 : Infinity;
    // Tight on purpose: the real test's wrong options sit close to the answer.
    const minGap = Math.max(Math.abs(value) * 0.08, kind === 'prob' ? 0.008 : 0.1);
    const picked = [value];
    const fits = (v) => Number.isFinite(v) && v >= lo && v <= hi
      && picked.every((w) => Math.abs(w - v) >= minGap) && !picked.some((w) => fmt(w) === fmt(v));
    for (const m of shuffle(rng, mistakes)) if (picked.length < count && fits(m)) picked.push(m);
    const factors = shuffle(rng, [0.5, 0.65, 0.78, 1.25, 1.45, 1.7, 2, 0.4, 2.4]);
    for (const f of factors) if (picked.length < count && fits(value * f)) picked.push(value * f);
    // Near 0 or 1 the multiples run out; step additively instead.
    for (let step = 1; picked.length < count && step < 40; step++) {
      for (const s of [1, -1]) {
        const v = value + s * step * minGap * 1.3;
        if (picked.length < count && fits(v)) picked.push(v);
      }
    }
    const sorted = picked.slice().sort((a, b) => a - b);
    return { options: sorted.map(fmt), values: sorted, correct: sorted.indexOf(value) };
  }

  /**
   * "Pick the closest": five evenly spaced round values (e.g. 25%, 30%, … 45%)
   * where the true value usually isn't listed. The step is chosen so the answer
   * sits clearly nearer one option than its neighbours (within 30% of a step).
   * Returns null when no step works, so the caller can fall back to options().
   */
  function gridOptions(rng, value, { kind = 'prob' } = {}) {
    const v = kind === 'prob' ? value * 100 : value; // percentage points for probabilities
    const mag = Math.abs(v);
    const steps = kind === 'prob' ? [0.5, 1, 2, 2.5, 5, 10] : [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 250, 500];
    for (const step of steps.filter((s) => s >= mag * 0.06 && s <= Math.max(mag * 0.3, steps[0]))) {
      const pos = v / step;
      const frac = pos - Math.floor(pos);
      if (frac > 0.3 && frac < 0.7) continue; // too near the midpoint between two options
      const near = Math.round(pos);
      let j = Math.floor(rng() * 5); // where the closest option sits among the five
      if (kind === 'prob') j = Math.max(Math.min(j, near), 4 - Math.floor(100 / step - near)); // keep 0–100%
      else if (value >= 0) j = Math.min(j, near); // keep non-negative answers non-negative
      const grid = Array.from({ length: 5 }, (_, i) => (near + i - j) * step);
      if (kind === 'prob' && (grid[0] < 0 || grid[4] > 100)) continue;
      const fmt = (x) => `${Math.round(x * 100) / 100}${kind === 'prob' ? '%' : ''}`;
      const options = grid.map(fmt);
      if (new Set(options).size < 5) continue;
      return { options, values: grid.map((x) => (kind === 'prob' ? x / 100 : x)), correct: j, grid: true };
    }
    return null;
  }

  // ---- scoring and records -------------------------------------------------

  const formatScore = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  /** Every saved round of one module (and Zap-N game), oldest first, Learn included. */
  const rounds = (sessions, id, game = null) => sessions
    .filter((s) => s.mode === 'oa' && s.module === id && (!game || s.game === game))
    .sort((a, b) => a.at - b.at);

  /** Test rounds of one module (and Zap-N game): best, last and average score. */
  function summary(sessions, id, game = null) {
    const tests = rounds(sessions, id, game).filter((s) => !s.practice && !s.aborted);
    if (!tests.length) return { tests: 0 };
    const scores = tests.map((s) => s.score);
    const recent = scores.slice(-5);
    return {
      tests: tests.length,
      best: Math.max(...scores),
      last: scores[scores.length - 1],
      avg: recent.reduce((t, v) => t + v, 0) / recent.length,
      total: tests[tests.length - 1].total,
    };
  }

  /** Score per test round, for charts. */
  const history = (sessions, id, game = null) => rounds(sessions, id, game)
    .filter((s) => !s.practice && !s.aborted)
    .map((s, i) => ({ i: i + 1, at: s.at, score: s.score, total: s.total, timeMs: s.timeUsedMs || 0, acc: accuracy(s.problems || []) }));

  /** Right ÷ (right + wrong) over items; skips don't count either way. */
  function accuracy(items) {
    const right = items.filter((p) => p.ok).length;
    const wrong = items.filter((p) => p.g != null && !p.ok).length;
    return right + wrong ? right / (right + wrong) : null;
  }

  /** Per topic: answered, right, skipped and average time, weakest first. */
  function byTopic(items) {
    const m = new Map();
    for (const p of items) {
      const r = m.get(p.t) || { topic: p.t, n: 0, right: 0, skipped: 0, ms: 0 };
      r.n++;
      if (p.ok) r.right++;
      if (p.g == null) r.skipped++;
      r.ms += p.ms || 0;
      m.set(p.t, r);
    }
    return [...m.values()]
      .map((r) => ({ ...r, avgMs: r.ms / r.n }))
      .sort((a, b) => a.right / a.n - b.right / b.n || b.n - a.n);
  }

  /** Totals across every assessment round (Zap-N games kept out of accuracy). */
  function overview(sessions) {
    const all = sessions.filter((s) => s.mode === 'oa');
    const quiz = all.filter((s) => s.module !== 'zap').flatMap((s) => s.problems || []);
    return {
      rounds: all.length,
      tests: all.filter((s) => !s.practice && !s.aborted).length,
      learn: all.filter((s) => s.practice).length,
      answered: quiz.filter((p) => p.g != null).length,
      accuracy: accuracy(quiz),
      timeMs: all.reduce((t, s) => t + (s.timeUsedMs || 0), 0),
    };
  }

  return {
    MODULES, byId, moduleName, int, pick, shuffle, choose, binom, normCdf, pct, num,
    options, gridOptions, formatScore, rounds, summary, history, accuracy, byTopic, overview,
  };
});
