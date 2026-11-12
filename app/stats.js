// Turns saved games into "where am I losing time" answers.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Stats = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const DAY = 864e5;
  const CAP_MS = 30000; // one stall (phone, distraction) shouldn't swamp a category
  const MIN_N = 4;      // fewer samples than this and a category is flagged as thin
  const SLIP_DAYS = 14;  // a miss or slow answer stays a recent slip for this many calendar days
  const CLEAR_AFTER = 2; // clean answers in a row that take a problem off the slip list
  const SLIP_CAP = 20;   // at most this many slips go into a smart drill
  const SLOW_WINDOW = 30 * DAY; // an answer is judged slow against your times over the 30 days up to it

  const RANGES = [
    { key: 'last10', label: 'Last 10 games' },
    { key: 'd7', label: '7 days' },
    { key: 'd30', label: '30 days' },
    { key: 'all', label: 'All time' },
  ];

  function selectSessions(sessions, { range = 'd30', drills = true, now = Date.now() } = {}) {
    // 80 in 8 and the other assessment modules have their own pages and stats.
    let s = sessions.filter((x) => x.mode !== 'e80' && x.mode !== 'oa' && (drills || x.mode !== 'drill'));
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

  // Sorting every list of times was the slow part of the Stats page on a big
  // history. Whole-millisecond times within the cap (all the app records) are
  // counted into a histogram instead, which gives the same median and, being
  // whole numbers, the same sum. Anything else is still sorted.
  const HIST_MIN = 256; // shorter lists sort faster than a histogram fills

  function sortedTimeStats(list) {
    const times = list.map((p) => p.ms).sort((x, y) => x - y);
    return { sum: times.reduce((s, t) => s + t, 0), median: median(times) };
  }

  /** The value at index k of the sorted times, from their histogram. */
  function histValue(counts, k) {
    let seen = 0;
    for (let v = 0; v < counts.length; v++) {
      seen += counts[v];
      if (seen > k) return v;
    }
    return NaN;
  }

  /** Sum and median of a list's `ms`, exactly as sorting the times gives them. */
  function timeStats(list) {
    const n = list.length;
    const times = new Float64Array(n);
    let whole = n >= HIST_MIN;
    for (let i = 0; i < n; i++) {
      const t = list[i].ms;
      // NaN, −0 and non-numbers sort and add differently: keep the old way for them.
      if (typeof t !== 'number' || t !== t || (t === 0 && 1 / t < 0)) return sortedTimeStats(list);
      times[i] = t;
      if (whole && !(t >= 0 && t <= CAP_MS && Math.floor(t) === t)) whole = false;
    }
    let sum = 0;
    if (whole) {
      const counts = new Uint32Array(CAP_MS + 1);
      for (let i = 0; i < n; i++) {
        counts[times[i]]++;
        sum += times[i];
      }
      const m = n >> 1;
      return { sum, median: n % 2 ? histValue(counts, m) : (histValue(counts, m - 1) + histValue(counts, m)) / 2 };
    }
    times.sort();
    for (let i = 0; i < n; i++) sum += times[i];
    return { sum, median: median(times) };
  }

  function agg(list) {
    const n = list.length;
    if (!n) return { n: 0, errN: 0, errRate: 0, accuracy: 0, meanMs: 0, medianMs: 0 };
    let errN = 0;
    for (const p of list) if (p.errors > 0) errN++;
    const { sum, median: medianMs } = timeStats(list);
    return {
      n,
      errN,
      errRate: errN / n,
      accuracy: 1 - errN / n,
      meanMs: sum / n,
      medianMs,
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

  const OP_INDEX = { add: 0, sub: 1, mul: 2, div: 3 };

  /**
   * The same identity as E.keyOf ('mul:7:86'), as a number when a and b are
   * whole and small, so the deck doesn't hash a fresh string per problem.
   */
  function problemId(p) {
    const { a, b } = p;
    const op = OP_INDEX[p.op];
    return op !== undefined && a >= 0 && b >= 0 && a < 2 ** 31 && b < 16384 && Math.floor(a) === a && Math.floor(b) === b
      ? (a * 16384 + b) * 4 + op
      : E.keyOf(p);
  }

  /** Days since an epoch for a local calendar day, so day gaps ignore clock changes. */
  function dayNumber(at) {
    const d = new Date(at);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }

  // The medians behind "slow" slide along with the answers. A window keeps
  // its times as counts per rank (a time's place among the distinct times in
  // `problems`), so adding or dropping a time is an increment. A cursor stays
  // on the last median it found, and the median moves little from one round to
  // the next, so finding it again is a short step from there.

  function counter(size) {
    return { n: 0, counts: new Uint32Array(size), cur: 0, below: 0, stamp: -1, slowAt: 0 };
  }

  function count(c, r, d) {
    c.n += d;
    c.counts[r] += d;
    if (r < c.cur) c.below += d; // `below`: how many sit under the cursor
  }

  /** The rank of a counter's kth smallest time (from 0), with the cursor moved there. */
  function kth(c, k) {
    const counts = c.counts;
    let r = c.cur;
    let below = c.below;
    while (below > k) below -= counts[--r];
    while (below + counts[r] <= k) below += counts[r++];
    c.cur = r;
    c.below = below;
    return r;
  }

  /** The median of a counter's times, exactly as sorting them gives it. */
  function counterMedian(c, vals) {
    const m = c.n >> 1;
    if (c.n % 2) return vals[kth(c, m)];
    const lo = vals[kth(c, m - 1)];
    return (lo + vals[kth(c, m)]) / 2;
  }

  /**
   * Which answers were slow when they were given: at least twice that type's
   * median over the 30 days up to the answer's round (or the overall median,
   * if the type had fewer than MIN_N answers then), and 1.5× the overall median
   * then. Rounds give a problem its time, so answers in one round share a
   * window. As 1s in a Uint8Array, by index in `problems`.
   */
  function slowFlags(problems) {
    const n = problems.length;
    // One pass over the problems into flat arrays: time, round time and type (an index, −1 for none).
    let ms = new Float64Array(n);
    let at = new Float64Array(n);
    let cat = new Int32Array(n);
    const ixOf = new Map();
    let sorted = true;
    let whole = true; // every time a whole ms within the cap, as the app records them
    for (let i = 0; i < n; i++) {
      const p = problems[i];
      const t = p.ms;
      ms[i] = t;
      at[i] = p.at;
      if (i && at[i] < at[i - 1]) sorted = false;
      if (whole && !(t >= 0 && t <= CAP_MS && Math.floor(t) === t)) whole = false;
      const key = p.cls.cat;
      let ix = -1;
      if (key != null) {
        ix = ixOf.get(key);
        if (ix === undefined) ixOf.set(key, (ix = ixOf.size));
      }
      cat[i] = ix;
    }
    // Oldest first: the store keeps rounds that way, and anything else is sorted (stably).
    let order = null;
    if (!sorted) {
      order = Array.from(at.keys()).sort((x, y) => at[x] - at[y]);
      const pick = (a) => a.map((_, k) => a[order[k]]);
      [ms, at, cat] = [pick(ms), pick(at), pick(cat)];
    }
    // Each time's rank among the distinct times: from a table for whole ms, else by sorting.
    const rank = new Int32Array(n);
    const vals = [];
    if (whole) {
      const rankOf = new Int32Array(CAP_MS + 1);
      for (let k = 0; k < n; k++) rankOf[ms[k]] = 1;
      for (let t = 0; t <= CAP_MS; t++) if (rankOf[t]) rankOf[t] = vals.push(t) - 1;
      for (let k = 0; k < n; k++) rank[k] = rankOf[ms[k]];
    } else {
      for (const t of ms.slice().sort()) if (!vals.length || t !== vals[vals.length - 1]) vals.push(t);
      for (let k = 0; k < n; k++) {
        let lo = 0;
        let hi = vals.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (vals[mid] < ms[k]) lo = mid + 1;
          else hi = mid;
        }
        rank[k] = lo;
      }
    }

    const slow = new Uint8Array(n);
    const overall = counter(vals.length);
    const cats = Array.from({ length: ixOf.size }, () => counter(vals.length));
    let lo = 0; // the oldest answer still in the window
    let round = 0;
    for (let s = 0; s < n;) {
      // Add this round (all answers at its time), then drop those over 30 days older.
      let e = s;
      do {
        if (cat[e] >= 0) count(cats[cat[e]], rank[e], 1);
        count(overall, rank[e], 1);
      } while (++e < n && at[e] === at[s]);
      for (const from = at[s] - SLOW_WINDOW; lo < s && at[lo] < from; lo++) {
        if (cat[lo] >= 0) count(cats[cat[lo]], rank[lo], -1);
        count(overall, rank[lo], -1);
      }
      const overallMedian = counterMedian(overall, vals);
      round++;
      for (; s < e; s++) {
        if (cat[s] < 0) continue;
        const c = cats[cat[s]];
        if (c.stamp !== round) {
          c.stamp = round;
          c.slowAt = Math.max(2 * (c.n >= MIN_N ? counterMedian(c, vals) : overallMedian), 1.5 * overallMedian);
        }
        if (ms[s] >= c.slowAt) slow[s] = 1;
      }
    }
    if (!order) return slow;
    const out = new Uint8Array(n);
    for (let k = 0; k < n; k++) out[order[k]] = slow[k];
    return out;
  }

  /**
   * Every problem in `problems` that slipped at least once, with its tally:
   * times seen, missed and slow, when it last slipped, and how many clean
   * answers have followed in a row. A slip is a wrong entry, or an answer that
   * took at least twice your usual time for that type (and 1.5× your overall
   * median). "Usual" is as it was then: your median over the 30 days up to
   * that answer, so getting faster doesn't turn old answers slow.
   */
  function tally(problems) {
    const slow = slowFlags(problems);
    const byKey = new Map();
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      const id = problemId(p);
      let t = byKey.get(id);
      if (!t) {
        t = { key: E.keyOf(p), op: p.op, a: p.a, b: p.b, text: E.textOf(p), answer: E.answerOf(p),
          cat: p.cls.cat, seen: 0, missed: 0, slow: 0, totalMs: 0, wrong: [], lastAt: 0, slips: [], clean: 0 };
        byKey.set(id, t);
      }
      t.seen++;
      t.totalMs += p.ms;
      t.lastAt = Math.max(t.lastAt, p.at);
      const isSlow = slow[i] === 1;
      if (p.errors > 0) t.missed++;
      if (isSlow) t.slow++;
      // Problems arrive oldest first: a slip restarts the run of clean answers.
      if (p.errors > 0 || isSlow) {
        t.slips.push({ at: p.at, missed: p.errors > 0 });
        t.clean = 0;
      } else t.clean++;
      for (const w of p.wrong) if (!t.wrong.includes(w) && t.wrong.length < 4) t.wrong.push(w);
    }
    const out = [];
    for (const t of byKey.values()) if (t.slips.length) out.push({ ...t, meanMs: t.totalMs / t.seen });
    return out;
  }

  /**
   * Recent slips, which Smart drill mixes back in: problems missed or slow in
   * the last SLIP_DAYS calendar days (today included), until they're answered
   * clean CLEAR_AFTER times in a row after the last slip, in any mode. Worst
   * first: a miss in the window weighs three slow answers, then the latest slip
   * leads. `rows` holds at most `limit`; `count` is how many there are.
   */
  function slips(problems, now = Date.now(), limit = SLIP_CAP) {
    const first = dayNumber(now) - (SLIP_DAYS - 1);
    // "Slow" looks back 30 days from each answer, so that much before the window is enough.
    const from = now - (SLIP_DAYS + 31) * DAY;
    const rows = [];
    for (const t of tally(problems.filter((p) => p.at >= from))) {
      if (t.clean >= CLEAR_AFTER) continue;
      const last = t.slips[t.slips.length - 1];
      if (dayNumber(last.at) < first) continue;
      const recent = t.slips.filter((s) => dayNumber(s.at) >= first);
      const missed = recent.filter((s) => s.missed).length;
      rows.push({ ...t, lastSlipAt: last.at, score: missed * 3 + (recent.length - missed) });
    }
    rows.sort((x, y) => (y.score - x.score) || (y.lastSlipAt - x.lastSlipAt) || (y.meanMs - x.meanMs));
    return { count: rows.length, rows: rows.slice(0, limit), all: rows };
  }

  /**
   * The problems you've missed most, for Stats: every problem missed or slow in
   * `problems`, most misses first, then most slow answers. No schedule and
   * nothing due: a ranking of what's gone wrong.
   */
  function mostMissed(problems, limit = 15) {
    const rows = tally(problems);
    rows.sort((x, y) => (y.missed - x.missed) || (y.slow - x.slow) || (y.meanMs - x.meanMs) || (y.lastAt - x.lastAt));
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

  // ---- practice calendar ---------------------------------------------------

  /** Finished rounds per local day ('YYYY-MM-DD' → count), every mode. */
  function practiceByDay(sessions) {
    const out = new Map();
    for (const s of sessions) {
      if (s.aborted) continue;
      const k = E.dayKey(new Date(s.at));
      out.set(k, (out.get(k) || 0) + 1);
    }
    return out;
  }

  /** Days in a row with practice, ending today (or yesterday, while today is still open). */
  function practiceStreak(byDay, now = new Date()) {
    const d = new Date(now);
    if (!byDay.has(E.dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (byDay.has(E.dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /** How many of the last `days` days, today included, had practice. */
  function daysPractised(byDay, days, now = new Date()) {
    const d = new Date(now);
    let n = 0;
    for (let i = 0; i < days; i++) {
      if (byDay.has(E.dayKey(d))) n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /** `weeks` columns of Monday-to-Sunday days, newest last; days after today are null. */
  function calendarWeeks(byDay, weeks, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = new Date(today);
    d.setDate(d.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
    const cols = [];
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const day = E.dayKey(d);
        col.push(d > today ? null : { day, n: byDay.get(day) || 0 });
        d.setDate(d.getDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  }

  return {
    RANGES, CAP_MS, MIN_N, SLIP_DAYS, CLEAR_AFTER, SLIP_CAP, dayNumber,
    selectSessions, flatten, agg, categories, byOp, factorMap, mistakes, slips, mostMissed,
    classicGames, scoreSummary, smartDrill, median,
    practiceByDay, practiceStreak, daysPractised, calendarWeeks,
  };
});
