// Intervals: give a lower and upper bound. A range that contains the true
// value scores lower ÷ upper (a tight, correct range scores near 1); a miss
// scores 0. Questions mix exact probability/EV (reusing Beat the Odds),
// counting from a picture, measuring against a scale bar, quick statistics on a
// set of numbers, and mental calculation.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'), require('./oa-odds.js'));
  else root.OAIntervals = factory(root.OA, root.OAOdds);
})(typeof self !== 'undefined' ? self : this, function (OA, Odds) {
  'use strict';

  const { int, pick, shuffle } = OA;

  /** Up to two decimals, trailing zeros dropped: 16.6667 → "16.67", 42 → "42". */
  const fmt = (v) => String(Math.round(v * 100) / 100);

  /** lower ÷ upper when [lo, hi] contains the truth; 0 otherwise. */
  function score(lo, hi, truth) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
    if (lo > hi) [lo, hi] = [hi, lo];
    if (truth < lo || truth > hi) return 0;
    if (lo === hi) return 1;
    if (lo > 0) return lo / hi;
    if (hi < 0) return hi / lo;
    return 0; // a range through zero scores nothing
  }

  const SHAPES = ['circle', 'square', 'triangle'];
  const COLOURS = ['red', 'blue', 'green'];

  const KINDS = {
    exact(rng) {
      let t;
      let name;
      do {
        name = pick(rng, Odds.NAMES.filter((n) => n !== 'bet'));
        t = Odds.TEMPLATES[name](rng);
      } while (!(t.value > 0));
      const prob = t.kind === 'prob';
      return {
        topic: 'Probability & EV',
        prompt: `${t.prompt}${prob ? ' Answer in percent (0–100).' : ''}`,
        truth: prob ? t.value * 100 : t.value, unit: prob ? '%' : '',
        explain: t.explain,
      };
    },

    shapes(rng) {
      const cells = Array.from({ length: 100 }, () => ({ shape: pick(rng, SHAPES), colour: pick(rng, COLOURS) }));
      const shape = pick(rng, SHAPES);
      const colour = pick(rng, COLOURS);
      const truth = cells.filter((c) => c.shape === shape && c.colour === colour).length;
      return {
        topic: 'Counting',
        prompt: `How many ${colour} ${shape}s are in the grid?`,
        visual: { type: 'shapes', cells }, truth, unit: '',
        explain: `There are ${truth}. With nine kinds of tile, about 100 ÷ 9 ≈ 11 is the starting guess; counting row by row, or one band and scaling up, narrows it.`,
      };
    },

    diceSum(rng) {
      const n = pick(rng, [36, 49, 64]);
      const faces = Array.from({ length: n }, () => int(rng, 1, 6));
      const truth = faces.reduce((s, v) => s + v, 0);
      return {
        topic: 'Counting',
        prompt: `What is the total of all ${n} dice?`,
        visual: { type: 'dice', faces, cols: Math.sqrt(n) }, truth, unit: '',
        explain: `The total is ${truth}. Expect about ${n} × 3.5 = ${n * 3.5}, give or take ${Math.round(1.7 * Math.sqrt(n) * 2)} (two standard deviations), then shift for the high or low faces you see.`,
      };
    },

    path(rng) {
      // A random walk in a 100 × 60 box; the scale bar is 10 m long.
      const bar = int(rng, 14, 22);
      const pts = [[int(rng, 5, 20), int(rng, 10, 50)]];
      const segs = int(rng, 5, 8);
      while (pts.length <= segs) {
        const [x, y] = pts[pts.length - 1];
        const nx = Math.min(95, Math.max(5, x + int(rng, -10, 28)));
        const ny = Math.min(55, Math.max(5, y + int(rng, -25, 25)));
        if (Math.hypot(nx - x, ny - y) > 6) pts.push([nx, ny]);
      }
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const truth = (len / bar) * 10;
      return {
        topic: 'Estimation',
        prompt: 'How long is the path, in metres? The scale bar is 10 m.',
        visual: { type: 'path', pts, bar }, truth, unit: 'm',
        explain: `It is ${fmt(truth)} m: ${segs} segments, about ${fmt(truth / segs)} m each. Lay the bar along a few segments and add them up.`,
      };
    },

    numbers(rng) {
      const k = pick(rng, [20, 25, 30]);
      const values = Array.from({ length: k }, () => int(rng, 10, 99));
      const stat = pick(rng, ['average', 'sum', 'median']);
      const sum = values.reduce((s, v) => s + v, 0);
      const sorted = values.slice().sort((a, b) => a - b);
      const median = k % 2 ? sorted[(k - 1) / 2] : (sorted[k / 2 - 1] + sorted[k / 2]) / 2;
      const truth = stat === 'sum' ? sum : stat === 'average' ? sum / k : median;
      const how = stat === 'median'
        ? `sorted, the middle ${k % 2 ? 'value is' : 'two values average to'} ${fmt(median)}`
        : `the sum is ${sum}${stat === 'average' ? `, divided by ${k} gives ${fmt(truth)}` : ''}`;
      return {
        topic: 'Quick statistics',
        prompt: `What is the ${stat} of these ${k} numbers?`,
        visual: { type: 'numbers', values }, truth, unit: '',
        explain: `It is ${fmt(truth)}: ${how}. Rounding each number to the nearest ten and adjusting at the end is the fast way.`,
      };
    },

    calc(rng) {
      const v = pick(rng, ['growth', 'root', 'speed', 'fraction']);
      if (v === 'growth') {
        const r = pick(rng, [5, 7, 8, 10, 12]);
        const n = pick(rng, [5, 10, 15, 20]);
        const truth = 1000 * (1 + r / 100) ** n;
        return {
          topic: 'Mental calculation', truth, unit: '$',
          prompt: `$1,000 grows at ${r}% a year, compounded yearly. What is it worth after ${n} years?`,
          explain: `1000 × ${1 + r / 100}^${n} = ${fmt(truth)}. The rule of 72 helps: at ${r}% money doubles about every ${fmt(72 / r)} years.`,
        };
      }
      if (v === 'root') {
        let x;
        do x = int(rng, 200, 4000); while (Number.isInteger(Math.sqrt(x)));
        const truth = Math.sqrt(x);
        const lo = Math.floor(truth);
        return {
          topic: 'Mental calculation', truth, unit: '',
          prompt: `What is the square root of ${x}?`,
          explain: `√${x} = ${fmt(truth)}: it lies between ${lo} (${lo * lo}) and ${lo + 1} (${(lo + 1) ** 2}), about ${fmt(truth - lo)} of the way along.`,
        };
      }
      if (v === 'speed') {
        const a = pick(rng, [30, 40, 50, 60]);
        const b = pick(rng, [60, 80, 90, 100, 120].filter((x) => x !== a));
        const truth = (2 * a * b) / (a + b);
        return {
          topic: 'Mental calculation', truth, unit: 'km/h',
          prompt: `A car drives 120 km at ${a} km/h, then 120 km back at ${b} km/h. What is its average speed for the round trip?`,
          explain: `Average speed is total distance ÷ total time = 240 ÷ (120/${a} + 120/${b}) = ${fmt(truth)} km/h, not the simple average ${(a + b) / 2}.`,
        };
      }
      const p = int(rng, 3, 17);
      const q = pick(rng, [7, 11, 13, 17, 19, 23].filter((d) => d > p));
      const truth = (p / q) * 100;
      return {
        topic: 'Mental calculation', truth, unit: '%',
        prompt: `What is ${p}/${q} as a percentage?`,
        explain: `${p} ÷ ${q} = ${fmt(truth / 100)}, so ${fmt(truth)}%.`,
      };
    },
  };

  const NAMES = Object.keys(KINDS);

  function build(rng, name) {
    const t = KINDS[name](rng);
    const answer = t.unit === '$' ? `$${fmt(t.truth)}` : t.unit === '%' ? `${fmt(t.truth)}%` : `${fmt(t.truth)}${t.unit ? ` ${t.unit}` : ''}`;
    return {
      kind: 'interval', template: name, topic: t.topic, prompt: t.prompt, visual: t.visual || null,
      truth: t.truth, unit: t.unit, answer, explain: t.explain,
    };
  }

  function set(rng, n) {
    const out = [];
    let order = [];
    while (out.length < n) {
      if (!order.length) order = shuffle(rng, NAMES);
      out.push(build(rng, order.pop()));
    }
    return out;
  }

  /** How well-judged a round's ranges were: hit rate, average score, advice. */
  function calibration(items) {
    const answered = items.filter((p) => p.g != null);
    if (!answered.length) return null;
    const hits = answered.filter((p) => p.ok).length;
    const hitRate = hits / answered.length;
    const avg = answered.reduce((t, p) => t + p.pts, 0) / answered.length;
    const avgHit = hits ? answered.filter((p) => p.ok).reduce((t, p) => t + p.pts, 0) / hits : 0;
    const advice = hitRate < 0.7
      ? 'Too many misses: a miss scores 0, so widen your ranges, most of all on the estimation questions.'
      : avgHit < 0.6
        ? 'You rarely missed, but the ranges were wide. Tighten them; on exact questions a narrow range around your answer is worth the risk.'
        : 'Well judged: you contained the answer most of the time with fairly tight ranges.';
    return { hits, answered: answered.length, hitRate, avg, avgHit, advice };
  }

  return { KINDS, NAMES, build, set, score, fmt, calibration };
});
