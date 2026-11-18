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
  /** One standard normal draw (Box–Muller). */
  const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  /** Nearest-rank percentile of sorted values: the smallest with pc% at or below it. */
  const percentile = (sorted, pc) => sorted[Math.max(0, Math.ceil((pc / 100) * sorted.length) - 1)];

  /** Whether [lo, hi] (either order) holds the truth, whatever it scores. */
  function contains(lo, hi, truth) {
    return Number.isFinite(lo) && Number.isFinite(hi) && truth >= Math.min(lo, hi) && truth <= Math.max(lo, hi);
  }

  /** lower ÷ upper when [lo, hi] contains the truth; 0 otherwise. */
  function score(lo, hi, truth) {
    if (!contains(lo, hi, truth)) return 0;
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === hi) return 1;
    if (lo > 0) return lo / hi;
    if (hi < 0) return hi / lo;
    return 0; // a range through zero scores nothing
  }

  /** A percent to show: whole numbers from 10 up, one decimal below. */
  const pct = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

  /**
   * What a typed range would score if it holds the answer, and how wide it is:
   * ±spread% around its middle (lower ÷ upper = (1 − s) ÷ (1 + s)). Null until both bounds are numbers.
   */
  function preview(lo, hi) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (lo > hi) [lo, hi] = [hi, lo];
    const mid = (lo + hi) / 2;
    return {
      lo, hi, mid,
      potential: score(lo, hi, mid),
      spread: lo > 0 ? ((hi - lo) / (hi + lo)) * 100 : null,
      zero: lo <= 0 && hi >= 0,
    };
  }

  /** Where the truth fell against a range, with a worked line for after the answer shows. */
  function judge(lo, hi, truth) {
    if (lo > hi) [lo, hi] = [hi, lo];
    const got = score(lo, hi, truth);
    if (contains(lo, hi, truth)) {
      const at = hi > lo ? (truth - lo) / (hi - lo) : 0.5;
      const p = preview(lo, hi);
      const text = `The answer sat ${Math.round(at * 100)}% of the way into your range.${p.spread == null ? ' A range from 0 or below scores 0, though: start above 0.'
        : ` Your range was ±${pct(p.spread)}% around ${fmt(p.mid)}; for scale, ±10% scores 0.82 and ±25% scores 0.60.`}`;
      return { hit: true, at, score: got, text };
    }
    const above = truth > hi;
    const off = above ? (truth - hi) / Math.abs(hi || 1) : (lo - truth) / Math.abs(truth);
    const stretched = above ? score(lo, truth, truth) : score(truth, hi, truth);
    const text = `The answer is ${pct(off * 100)}% ${above ? 'above your upper' : 'below your lower'} bound. ${above ? 'Stretching the upper' : 'Lowering the lower'} bound to ${fmt(truth)} would have scored ${stretched.toFixed(2)}.`;
    return { hit: false, above, off, score: 0, stretched, text };
  }

  /** Round tick values across [a, b], about five of them. */
  function ticks(a, b) {
    const raw = (b - a) / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const out = [];
    for (let k = Math.ceil(a / step); k * step <= b + step * 1e-9; k++) out.push(Number((k * step).toPrecision(12)));
    return out;
  }
  const label = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 6 });

  /**
   * A number line with the typed range as a band and, once known, where the
   * truth fell: green inside the range, red outside. Returns SVG markup ('' with nothing to draw).
   */
  function lineSvg({ lo = null, hi = null, truth = null } = {}) {
    const range = Number.isFinite(lo) && Number.isFinite(hi);
    if (range && lo > hi) [lo, hi] = [hi, lo];
    const known = Number.isFinite(truth);
    const vals = [...(range ? [lo, hi] : []), ...(known ? [truth] : [])];
    if (!vals.length) return '';
    const a = Math.min(...vals);
    const b = Math.max(...vals);
    const span = b - a > 0 ? b - a : Math.abs(b) * 0.2 || 1;
    let d0 = a - span * 0.3;
    const d1 = b + span * 0.3;
    if (a >= 0 && d0 < 0) d0 = 0;
    const W = 560; const L = 14; const R = 14; const AX = 52;
    const X = (v) => L + ((v - d0) / (d1 - d0)) * (W - L - R);
    const x = (v) => X(v).toFixed(1);
    let out = `<line class="iv-axis" x1="${L}" x2="${W - R}" y1="${AX}" y2="${AX}"/>`;
    for (const t of ticks(d0, d1)) {
      if (t < d0 - 1e-9 || t > d1 + 1e-9) continue;
      out += `<line class="iv-tick" x1="${x(t)}" x2="${x(t)}" y1="${AX}" y2="${AX + 4}"/><text class="iv-tl" x="${x(t)}" y="${AX + 17}">${label(t)}</text>`;
    }
    const hit = range && known && contains(lo, hi, truth);
    if (range) {
      const x0 = X(lo);
      const x1 = Math.max(X(hi), x0 + 3); // a single point still shows
      out += `<rect class="iv-band${known ? (hit ? ' hit' : ' miss') : ''}" x="${x0.toFixed(1)}" y="22" width="${(x1 - x0).toFixed(1)}" height="18" rx="4"/>`;
      // Bound labels sit beside the band, or above it near the ends.
      const loSide = x0 > 84;
      const hiSide = x1 < W - 84;
      out += `<text class="iv-bl" x="${(loSide ? x0 - 6 : x0).toFixed(1)}" y="${loSide ? 35 : 15}" text-anchor="${loSide ? 'end' : 'start'}">${label(Number(fmt(lo)))}</text>`;
      out += `<text class="iv-bl" x="${(hiSide ? x1 + 6 : x1).toFixed(1)}" y="${hiSide ? 35 : 15}" text-anchor="${hiSide ? 'start' : 'end'}">${label(Number(fmt(hi)))}</text>`;
    }
    if (known) {
      const xt = X(truth);
      const anchor = xt < 60 ? 'start' : xt > W - 60 ? 'end' : 'middle';
      out += `<g class="iv-truth${range ? (hit ? ' hit' : ' miss') : ''}"><line x1="${xt.toFixed(1)}" x2="${xt.toFixed(1)}" y1="16" y2="${AX}"/><circle cx="${xt.toFixed(1)}" cy="${AX}" r="4.5"/>`
        + `<text x="${xt.toFixed(1)}" y="11" text-anchor="${anchor}">Answer ${label(Number(fmt(truth)))}</text></g>`;
    }
    const aria = `${range ? `Your range, ${fmt(lo)} to ${fmt(hi)}` : 'The answer'}${known ? `${range ? '; the answer' : ''} ${fmt(truth)}${range ? (hit ? ', inside it' : ', outside it') : ''}` : ''}`;
    return `<svg class="iv-line-svg" viewBox="0 0 ${W} 74" role="img" aria-label="${aria}">${out}</svg>`;
  }

  const SHAPES = ['circle', 'square', 'triangle'];
  const COLORS = ['red', 'blue', 'green'];

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
      // A count under 5 can't be ranged honestly under lower ÷ upper ([1, 4] scores 0.25), so ask for another kind.
      let cells;
      let shape;
      let color;
      let truth;
      do {
        cells = Array.from({ length: 100 }, () => ({ shape: pick(rng, SHAPES), color: pick(rng, COLORS) }));
        shape = pick(rng, SHAPES);
        color = pick(rng, COLORS);
        truth = cells.filter((c) => c.shape === shape && c.color === color).length;
      } while (truth < 5);
      return {
        topic: 'Counting',
        prompt: `How many ${color} ${shape}s are in the grid?`,
        visual: { type: 'shapes', cells }, truth, unit: '',
        explain: `There are ${truth}. With nine kinds of tile, about 100 ÷ 9 ≈ 11 is the starting guess; counting row by row, or one band and scaling up, narrows it.`,
      };
    },

    diceSum(rng) {
      const n = pick(rng, [64, 81, 100]);
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
        prompt: 'How long is the path, in meters? The scale bar is 10 m.',
        visual: { type: 'path', pts, bar }, truth, unit: 'm',
        explain: `It is ${fmt(truth)} m: ${segs} segments, about ${fmt(truth / segs)} m each. Lay the bar along a few segments and add them up.`,
      };
    },

    numbers(rng) {
      // Too many to add up in 45 seconds: judge the shape of the spread instead.
      const k = pick(rng, [100, 150, 200]);
      const shape = pick(rng, ['flat', 'bell', 'low', 'high']);
      const mu = int(rng, 35, 65);
      const sd = int(rng, 8, 18);
      const draw = {
        flat: () => int(rng, 10, 99),
        bell: () => Math.min(99, Math.max(1, Math.round(mu + sd * gauss(rng)))),
        low: () => 5 + Math.floor(90 * rng() ** 2),
        high: () => 94 - Math.floor(90 * rng() ** 2),
      }[shape];
      const values = Array.from({ length: k }, draw);
      const stat = pick(rng, ['average', 'sum', 'median', 'p10', 'p25', 'p75', 'p90', 'above']);
      const sum = values.reduce((s, v) => s + v, 0);
      const sorted = values.slice().sort((a, b) => a - b);
      // A count near 0 can't score under lower ÷ upper: keep 10–90% of the numbers above the cut.
      const over = (c) => values.filter((v) => v > c).length;
      const cuts = [20, 30, 40, 50, 60, 70, 80].filter((c) => over(c) >= 0.1 * k && over(c) <= 0.9 * k);
      const cut = cuts.length ? pick(rng, cuts) : sorted[Math.floor(k / 2)];
      const pc = { p10: 10, p25: 25, p75: 75, p90: 90 }[stat];
      const median = k % 2 ? sorted[(k - 1) / 2] : (sorted[k / 2 - 1] + sorted[k / 2]) / 2;
      const truth = stat === 'sum' ? sum : stat === 'average' ? sum / k : stat === 'median' ? median
        : stat === 'above' ? values.filter((v) => v > cut).length : percentile(sorted, pc);
      const ask = stat === 'above' ? `How many of these ${k} numbers are greater than ${cut}?`
        : pc ? `What is the ${pc}th percentile of these ${k} numbers (the value with ${pc}% of them at or below it)?`
          : `What is the ${stat} of these ${k} numbers?`;
      const how = stat === 'sum' ? `the average is ${fmt(sum / k)}, times ${k}`
        : stat === 'average' ? `the sum is ${sum}, divided by ${k}`
          : stat === 'above' ? `${fmt((truth / k) * 100)}% of them`
            : stat === 'median' ? `sorted, the middle two of ${k} average to it`
              : `sorted, it is number ${Math.ceil((pc / 100) * k)} of ${k}`;
      return {
        topic: 'Quick statistics',
        prompt: ask,
        visual: { type: 'numbers', values }, truth, unit: '',
        explain: `It is ${fmt(truth)}: ${how}. Sample a few rows to judge where the numbers bunch up, then scale; leave room either side because the sample is rough.`,
      };
    },

    coins(rng) {
      const rows = 12;
      const cols = 20;
      const p = pick(rng, [0.5, 0.5, 0.45, 0.55, 0.4, 0.6]);
      const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => rng() < p));
      const ask = pick(rng, ['heads', 'pairs', 'changes']);
      let truth = 0;
      for (const row of grid) {
        row.forEach((h, j) => {
          if (ask === 'heads') truth += h ? 1 : 0;
          else if (j > 0 && (ask === 'pairs' ? h && row[j - 1] : h !== row[j - 1])) truth++;
        });
      }
      const n = rows * cols;
      const pairs = rows * (cols - 1);
      const expect = ask === 'heads' ? `${n} × ½ = ${n / 2} for a fair coin`
        : ask === 'pairs' ? `${pairs} neighboring pairs × ¼ = ${pairs / 4} for a fair coin`
          : `${pairs} neighboring pairs × ½ = ${pairs / 2} for a fair coin`;
      return {
        topic: 'Counting',
        prompt: ask === 'heads' ? `${rows} rows of ${cols} coin tosses. How many are heads (H)?`
          : ask === 'pairs' ? `${rows} rows of ${cols} coin tosses. Within the rows, how many times is an H immediately followed by another H?`
            : `${rows} rows of ${cols} coin tosses. Within the rows, how many times does the toss differ from the one before it?`,
        visual: { type: 'coins', grid }, truth, unit: '',
        explain: `It is ${truth}. Expect about ${expect}, but this coin may not be fair: count two or three rows to check, then scale up.`,
      };
    },

    trend(rng) {
      // The truth is what actually happened, noise included, not the trend line.
      const n = 20;
      for (;;) {
        const ahead = pick(rng, [4, 6, 10]);
        const base = int(rng, 80, 240);
        const growth = rng() < 0.5;
        const rate = growth ? pick(rng, [-0.02, 0.02, 0.03, 0.04, 0.05]) : pick(rng, [-3, -2, 2, 3, 4, 6, 8]) * base / 100;
        const noise = base * pick(rng, [0.03, 0.05, 0.07]);
        const at = (t) => (growth ? base * (1 + rate) ** t : base + rate * t) + noise * gauss(rng);
        const values = Array.from({ length: n + ahead }, (_, t) => Math.round(at(t + 1)));
        if (values.some((v) => v < base * 0.3)) continue;
        const truth = values[n + ahead - 1];
        // Least squares on what's shown (on logs for the growth series).
        const ys = values.slice(0, n).map((v) => (growth ? Math.log(v) : v));
        const xm = (n + 1) / 2;
        const ym = ys.reduce((s, v) => s + v, 0) / n;
        const b = ys.reduce((s, y, i) => s + (i + 1 - xm) * (y - ym), 0) / ys.reduce((s, _, i) => s + (i + 1 - xm) ** 2, 0);
        const fit = ym + b * (n + ahead - xm);
        const projected = growth ? Math.exp(fit) : fit;
        return {
          topic: 'Trends',
          prompt: `Monthly sales for months 1 to ${n} are plotted. What were sales in month ${n + ahead}?`,
          visual: { type: 'trend', values: values.slice(0, n), ahead }, truth, unit: '',
          explain: `They were ${truth}. The ${growth ? 'growth' : 'straight-line'} trend points to about ${Math.round(projected)}, and months scatter about ±${Math.round(noise)} around it, so a range of roughly ±${Math.round(2 * noise)} around the trend holds the real figure most of the time.`,
        };
      }
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
    let t;
    do t = KINDS[name](rng); while (!(t.truth > 0)); // a true value of 0 can't be scored
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

  /** A saved round line's range ("[12.5, 20] → 0.62") and answer ("$1628.89", "42 m"), or null. */
  const NUM = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/;
  function parseLine(p) {
    const m = typeof p.g === 'string' && p.g.match(/^\[(-?[\d.e+]+), (-?[\d.e+]+)\]/);
    const t = typeof p.a === 'string' && p.a.replace(/,/g, '').match(NUM);
    if (!m || !t) return null;
    return { lo: Number(m[1]), hi: Number(m[2]), truth: Number(t[0]) };
  }

  /**
   * How well-judged a round's ranges were: hit rate, average score, which way
   * the misses fell (`low`: the answer was above the range; `high`: below it),
   * the topic missed most, and advice built from all of it.
   */
  function calibration(items) {
    const answered = items.filter((p) => p.g != null);
    if (!answered.length) return null;
    const hits = answered.filter((p) => p.ok).length;
    const hitRate = hits / answered.length;
    const avg = answered.reduce((t, p) => t + p.pts, 0) / answered.length;
    const avgHit = hits ? answered.filter((p) => p.ok).reduce((t, p) => t + p.pts, 0) / hits : 0;
    let low = 0;
    let high = 0;
    const missBy = {};
    for (const p of answered) {
      if (p.ok) continue;
      const r = parseLine(p);
      if (r && r.truth > r.hi) low++;
      else if (r && r.truth < r.lo) high++;
      if (p.t) missBy[p.t] = (missBy[p.t] || 0) + 1;
    }
    const worst = Object.entries(missBy).sort((x, y) => y[1] - x[1])[0];
    const weak = worst && worst[1] >= 2 ? worst[0] : null;
    let advice = hitRate < 0.7
      ? 'Too many misses: a miss scores 0, so widen your ranges, most of all on the estimation questions.'
      : avgHit < 0.6
        ? 'You rarely missed, but the ranges were wide. Tighten them; on exact questions a narrow range around your answer is worth the risk.'
        : 'Well judged: you contained the answer most of the time with fairly tight ranges.';
    if (low + high >= 2 && low >= 2 * high) advice += ` Your misses mostly fell short (the answer was above your range ${low} time${low === 1 ? '' : 's'}): lean your ranges higher.`;
    else if (low + high >= 2 && high >= 2 * low) advice += ` Your misses mostly overshot (the answer was below your range ${high} time${high === 1 ? '' : 's'}): lean your ranges lower.`;
    if (weak) advice += ` Most misses were ${weak} questions.`;
    return { hits, answered: answered.length, hitRate, avg, avgHit, low, high, weak, advice };
  }

  return { KINDS, NAMES, build, set, score, contains, fmt, calibration, preview, judge, lineSvg, parseLine };
});
