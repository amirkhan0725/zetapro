// Problem generation, answer checking and problem classification.
// Loaded as a plain <script> in the renderer and with require() in tests/main.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPS = ['add', 'sub', 'mul', 'div'];
  const SYMBOL = { add: '+', sub: '–', mul: '×', div: '÷' };
  const OP_NAME = { add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division' };
  const DURATIONS = [30, 60, 120, 300, 600];
  const FACTORS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // Zetamac's defaults: (2–100) + (2–100), (2–12) × (2–100), 120 seconds.
  // Ranges are [leftMin, leftMax, rightMin, rightMax].
  const DEFAULT_CONFIG = Object.freeze({
    ops: Object.freeze({ add: true, sub: true, mul: true, div: true }),
    add: Object.freeze([2, 100, 2, 100]),
    mul: Object.freeze([2, 12, 2, 100]),
    duration: 120,
  });

  function defaultConfig() {
    const d = DEFAULT_CONFIG;
    return { ops: { ...d.ops }, add: d.add.slice(), mul: d.mul.slice(), duration: d.duration };
  }

  // Stats fingerprint every saved round's settings, so this avoids copying the defaults.
  function normalizeConfig(c) {
    if (!c || typeof c !== 'object') return defaultConfig();
    const d = DEFAULT_CONFIG;
    const out = { ops: {}, add: null, mul: null, duration: d.duration };
    for (const op of OPS) {
      out.ops[op] = c.ops && typeof c.ops[op] === 'boolean' ? c.ops[op] : d.ops[op];
    }
    if (!OPS.some((op) => out.ops[op])) out.ops.add = true;
    for (const k of ['add', 'mul']) {
      const src = Array.isArray(c[k]) && c[k].length === 4 ? c[k] : d[k];
      const v = src.map((x, i) => {
        const n = Math.round(Number(x));
        return Number.isFinite(n) ? Math.min(9999, Math.max(0, n)) : d[k][i];
      });
      if (v[0] > v[1]) [v[0], v[1]] = [v[1], v[0]];
      if (v[2] > v[3]) [v[2], v[3]] = [v[3], v[2]];
      out[k] = v;
    }
    const dur = Math.round(Number(c.duration));
    if (Number.isFinite(dur) && dur >= 10 && dur <= 3600) out.duration = dur;
    return out;
  }

  /** Identifies settings whose scores are comparable with each other. */
  function fingerprint(c) {
    const n = normalizeConfig(c);
    const ops = OPS.filter((o) => n.ops[o]);
    return [
      ops.join(','),
      n.ops.add || n.ops.sub ? n.add.join('-') : '',
      n.ops.mul || n.ops.div ? n.mul.join('-') : '',
      n.duration,
    ].join('|');
  }

  const DEFAULT_FINGERPRINT = fingerprint(DEFAULT_CONFIG);

  function isDefaultConfig(c) {
    return fingerprint(c) === DEFAULT_FINGERPRINT;
  }

  function describeConfig(c) {
    const n = normalizeConfig(c);
    if (isDefaultConfig(n)) return `Standard ${n.duration}s`;
    const ops = OPS.filter((o) => n.ops[o])
      .map((o) => SYMBOL[o])
      .join(' ');
    return `${n.duration}s · ${ops}`;
  }

  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  function answerOf(p) {
    switch (p.op) {
      case 'add':
        return p.a + p.b;
      case 'sub':
        return p.a - p.b;
      case 'mul':
        return p.a * p.b;
      case 'div':
        return p.a / p.b;
      default:
        return NaN;
    }
  }

  const textOf = (p) => `${p.a} ${SYMBOL[p.op]} ${p.b}`;
  const keyOf = (p) => `${p.op}:${p.a}:${p.b}`;

  // Subtraction and division are addition and multiplication run backwards,
  // exactly as Zetamac builds them.
  function randomProblem(op, config, rng) {
    if (op === 'add' || op === 'sub') {
      const [l1, h1, l2, h2] = config.add;
      const x = randInt(rng, l1, h1);
      const y = randInt(rng, l2, h2);
      return op === 'add' ? { op, a: x, b: y } : { op, a: x + y, b: x };
    }
    const [l1, h1, l2, h2] = config.mul;
    let x = randInt(rng, l1, h1);
    const y = randInt(rng, l2, h2);
    if (op === 'mul') return { op, a: x, b: y };
    if (x === 0) x = h1 > 0 ? randInt(rng, Math.max(1, l1), h1) : 1; // no ÷ 0
    return { op, a: x * y, b: x };
  }

  // ---- classification -------------------------------------------------------

  /** Carry flags per column (ones first) when adding x + y. */
  function carryPattern(x, y) {
    const out = [];
    let c = 0;
    while (x > 0 || y > 0) {
      const s = (x % 10) + (y % 10) + c;
      c = s >= 10 ? 1 : 0;
      out.push(c === 1);
      x = Math.floor(x / 10);
      y = Math.floor(y / 10);
    }
    return out;
  }

  /** carryPattern's verdict, counted without building the pattern. */
  function carryKind(x, y) {
    let c = 0;
    let n = 0;
    let ones = false;
    for (let col = 0; x > 0 || y > 0; col++) {
      const s = (x % 10) + (y % 10) + c;
      c = s >= 10 ? 1 : 0;
      if (c === 1) {
        n++;
        if (col === 0) ones = true;
      }
      x = Math.floor(x / 10);
      y = Math.floor(y / 10);
    }
    if (n === 0) return 'none';
    if (n >= 2) return 'multi';
    return ones ? 'ones' : 'tens';
  }

  // Keys are built once and shared, so the stats can count big histories by
  // key without hashing a fresh string for every problem.
  const CARRY_KEYS = {
    add: { none: 'add.none', ones: 'add.ones', tens: 'add.tens', multi: 'add.multi' },
    sub: { none: 'sub.none', ones: 'sub.ones', tens: 'sub.tens', multi: 'sub.multi' },
  };
  const keyTable = (prefix) => Array.from({ length: 13 }, (_, f) => `${prefix}${f}`);
  const FACTOR_KEYS = {
    'mul.t.': keyTable('mul.t.'),
    'mul.x.': keyTable('mul.x.'),
    'div.t.': keyTable('div.t.'),
    'div.x.': keyTable('div.x.'),
  };
  const factorKey = (prefix, f) =>
    Number.isInteger(f) && f >= 0 && f <= 12 ? FACTOR_KEYS[prefix][f] : `${prefix}${f}`;

  /**
   * Sorts a problem into a coarse category (`cat`, used for ranking and drills)
   * and, for × and ÷, a factor-map cell (`cell`). Borrows in m − s = d are
   * exactly the carries in s + d = m, so subtraction reuses the carry logic.
   */
  function classify(p) {
    switch (p.op) {
      case 'add':
        return { cat: CARRY_KEYS.add[carryKind(p.a, p.b)], cell: null, factor: null };
      case 'sub':
        return { cat: CARRY_KEYS.sub[carryKind(p.b, p.a - p.b)], cell: null, factor: null };
      case 'mul': {
        if (p.a <= 12 && p.b <= 12) return { cat: 'mul.table', cell: factorKey('mul.t.', p.a), factor: p.a };
        const f = Math.min(p.a, p.b);
        if (f > 12) return { cat: 'mul.big', cell: null, factor: null };
        const key = factorKey('mul.x.', f);
        return { cat: key, cell: key, factor: f };
      }
      case 'div': {
        const d = p.b;
        const q = p.a / p.b;
        if (d <= 12 && q <= 12) return { cat: 'div.table', cell: factorKey('div.t.', d), factor: d };
        if (d > 12) return { cat: 'div.big', cell: null, factor: null };
        const key = factorKey('div.x.', d);
        return { cat: key, cell: key, factor: d };
      }
      default:
        return { cat: 'unknown', cell: null, factor: null };
    }
  }

  const CARRY_NAMES = {
    add: {
      none: ['No carrying', '23 + 45'],
      ones: ['Carry from the ones', '38 + 47'],
      tens: ['Carry into the hundreds', '72 + 51'],
      multi: ['Double carry', '67 + 58'],
    },
    sub: {
      none: ['No borrowing', '87 – 34'],
      ones: ['Borrow from the tens', '82 – 37'],
      tens: ['Borrow from the hundreds', '135 – 72'],
      multi: ['Double borrow', '132 – 67'],
    },
  };

  /**
   * Human name + example for any category or cell key. `name` stands on its
   * own; `short` assumes the operation is already shown (e.g. under a heading).
   */
  function categoryInfo(key) {
    const [op, kind, f] = key.split('.');
    let name = key;
    let short = null;
    let example = '';
    if (op === 'add' || op === 'sub') {
      const entry = CARRY_NAMES[op][kind];
      if (entry) {
        [short, example] = entry;
        name = `${OP_NAME[op]}, ${short.charAt(0).toLowerCase()}${short.slice(1)}`;
      }
    } else if (op === 'mul') {
      if (kind === 'table') {
        name = 'Times tables (to 12 × 12)';
        example = '7 × 8';
      } else if (kind === 'big') {
        name = 'Large × large';
        example = '23 × 47';
      } else if (kind === 'x') {
        name = `${f} × 2-digit`;
        example = `${f} × 86`;
      } else if (kind === 't') {
        name = `${f} × table facts`;
        example = `${f} × 8`;
      }
    } else if (op === 'div') {
      if (kind === 'table') {
        name = 'Division tables';
        example = '56 ÷ 7';
      } else if (kind === 'big') {
        name = 'Large divisors';
        example = '1081 ÷ 23';
      } else if (kind === 'x') {
        name = `÷ ${f}, 2-digit answer`;
        example = `${f * 86} ÷ ${f}`;
      } else if (kind === 't') {
        name = `÷ ${f} table facts`;
        example = `${f * 8} ÷ ${f}`;
      }
    }
    return { key, op, name, short: short || name, example, symbol: SYMBOL[op] || '?', opName: OP_NAME[op] || op };
  }

  /** Every drillable category, grouped by operation, in display order. */
  function allCategories() {
    return {
      add: ['add.none', 'add.ones', 'add.tens', 'add.multi'],
      sub: ['sub.none', 'sub.ones', 'sub.tens', 'sub.multi'],
      mul: ['mul.table', ...FACTORS.map((f) => `mul.x.${f}`)],
      div: ['div.table', ...FACTORS.map((f) => `div.x.${f}`)],
    };
  }

  function matchesKey(p, key) {
    if (key === p.op) return true;
    const c = classify(p);
    return c.cat === key || c.cell === key;
  }

  // ---- generators -----------------------------------------------------------

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function weightedPick(weights, rng) {
    const total = weights.reduce((s, w) => s + w.w, 0);
    let r = rng() * total;
    for (const w of weights) {
      r -= w.w;
      if (r < 0) return w.key;
    }
    return weights[weights.length - 1].key;
  }

  // ---- one drill type, built directly ----------------------------------------
  // Drills draw random problems in the player's ranges and keep the first of
  // the right type. A type those ranges make only rarely (7 × table facts with
  // a 2–3000 multiplier) can miss thousands of times in a row, so then it is
  // built directly instead, still in the player's ranges and with every
  // problem of the type equally likely, exactly as the random draws would be.

  // The problem randomProblem builds from its two draws x and y.
  function fromDraws(op, x, y) {
    if (op === 'add') return { op, a: x, b: y };
    if (op === 'sub') return { op, a: x + y, b: x };
    if (op === 'mul') return { op, a: x, b: y };
    return { op, a: x * y, b: x };
  }

  const span = (lo, hi) => (hi >= lo ? hi - lo + 1 : 0);

  /** Every problem of a type as rectangles of draws: x in [x0, x1], y in [y0, y1]. */
  function boxesOf(op, kind, f, cfg) {
    const [, , l2, h2] = cfg.mul;
    let [l1, h1] = cfg.mul;
    // ÷ never divides by 0: randomProblem redraws a 0 divisor from 1 up (1 if that's all there is).
    if (op === 'div') [l1, h1] = h1 === 0 ? [1, 1] : [Math.max(1, l1), h1];
    const box = (x0, x1, y0, y1) => ({
      x0: Math.max(l1, x0),
      x1: Math.min(h1, x1),
      y0: Math.max(l2, y0),
      y1: Math.min(h2, y1),
    });
    const BIG = Infinity;
    if (op === 'mul') {
      // classify: both ≤ 12 is a table fact (cell by the left number);
      // otherwise the smaller number is the factor, and over 12 is "big".
      if (kind === 'table') return [box(0, 12, 0, 12)];
      if (kind === 't') return [box(f, f, 0, 12)];
      if (kind === 'x') return [box(f, f, 13, BIG), box(13, BIG, f, f)];
      if (kind === 'big') return [box(13, BIG, 13, BIG)];
      return [box(0, BIG, 0, BIG)];
    }
    // ÷: x is the divisor and y the answer; classify goes by the divisor.
    if (kind === 'table') return [box(0, 12, 0, 12)];
    if (kind === 't') return [box(f, f, 0, 12)];
    if (kind === 'x') return [box(f, f, 13, BIG)];
    if (kind === 'big') return [box(13, BIG, 0, BIG)];
    return [box(0, BIG, 0, BIG)];
  }

  const ENUM_MAX = 2e6; // + and − ranges up to this many pairs are searched one by one

  /**
   * Builds problems of one drill type straight from the player's ranges:
   * { size, draw(rng) }, or null when those ranges can't make the type at all.
   * (For + and − over more than ENUM_MAX pairs, null means 50,000 random draws
   * found none: with ranges that wide, every carry type turns up far more often.)
   */
  function typeSampler(key, config) {
    const cfg = normalizeConfig(config);
    const [op, kind, fs] = key.split('.');
    if (!OPS.includes(op)) return null;
    if (op === 'mul' || op === 'div') {
      const boxes = boxesOf(op, kind, Number(fs), cfg)
        .map((b) => ({ ...b, n: span(b.x0, b.x1) * span(b.y0, b.y1) }))
        .filter((b) => b.n > 0);
      const size = boxes.reduce((s, b) => s + b.n, 0);
      if (!size) return null;
      return {
        size,
        draw(rng) {
          let r = rng() * size;
          let b = boxes[boxes.length - 1];
          for (const c of boxes) {
            r -= c.n;
            if (r < 0) {
              b = c;
              break;
            }
          }
          return fromDraws(op, randInt(rng, b.x0, b.x1), randInt(rng, b.y0, b.y1));
        },
      };
    }
    // + and −: m − s = d borrows exactly where s + d = m carries, so both
    // types are a set of draws (x, y), searched one by one when that's small.
    const [l1, h1, l2, h2] = cfg.add;
    const fits = (x, y) => matchesKey(fromDraws(op, x, y), key);
    if (span(l1, h1) * span(l2, h2) > ENUM_MAX) {
      const probe = seededRng(0x5eed);
      for (let i = 0; i < 50000; i++) {
        if (fits(randInt(probe, l1, h1), randInt(probe, l2, h2))) {
          return {
            size: Infinity,
            draw(rng) {
              for (;;) {
                const x = randInt(rng, l1, h1);
                const y = randInt(rng, l2, h2);
                if (fits(x, y)) return fromDraws(op, x, y);
              }
            },
          };
        }
      }
      return null;
    }
    const xs = [];
    const ys = [];
    for (let x = l1; x <= h1; x++) {
      for (let y = l2; y <= h2; y++) {
        if (fits(x, y)) {
          xs.push(x);
          ys.push(y);
        }
      }
    }
    if (!xs.length) return null;
    return {
      size: xs.length,
      draw(rng) {
        const i = Math.floor(rng() * xs.length);
        return fromDraws(op, xs[i], ys[i]);
      },
    };
  }

  /** The drill types (keys) the player's ranges can't make at all. */
  function unmakeable(keys, config) {
    const cfg = normalizeConfig(config);
    const probe = seededRng(1);
    return keys.filter((key) => {
      const op = key.split('.')[0];
      if (!OPS.includes(op)) return false;
      // Most types turn up within a few random draws; only a miss gets searched.
      for (let i = 0; i < 2000; i++) if (matchesKey(randomProblem(op, cfg, probe), key)) return false;
      return !typeSampler(key, cfg);
    });
  }

  /**
   * What makes a problem hard within its type, as a short key that past
   * answers can be grouped by: the ones digits for + and −, the fact itself
   * for a table fact, and for a larger × or ÷ its factor and the ones digit of
   * the other number (7 × …8 for 7 × 48 or 7 × 98).
   */
  function patternOf(p) {
    if (p.op === 'add') return `add:${Math.min(p.a % 10, p.b % 10)}+${Math.max(p.a % 10, p.b % 10)}`;
    if (p.op === 'sub') return `sub:${p.a % 10}-${p.b % 10}`;
    if (p.op === 'mul') {
      if (p.a <= 12 && p.b <= 12) return `mul:${Math.min(p.a, p.b)}x${Math.max(p.a, p.b)}`;
      const f = Math.min(p.a, p.b);
      return f > 12 ? 'mul:big' : `mul:${f}x…${Math.max(p.a, p.b) % 10}`;
    }
    if (p.op === 'div') {
      const q = p.a / p.b;
      if (p.b <= 12 && q <= 12) return `div:${p.a}/${p.b}`;
      return p.b > 12 ? 'div:big' : `div:…${q % 10}/${p.b}`;
    }
    return 'other';
  }

  // With plan.focus, this share of a weights plan's problems is the pick of
  // FOCUS_DRAWS of the type, leaning toward the patterns the player is slow
  // on; the rest stay plain random picks, so a drill never narrows to a few.
  const FOCUS_SHARE = 0.7;
  const FOCUS_DRAWS = 8;

  /**
   * plan.kind:
   *   'classic' — Zetamac: uniform over the enabled operations.
   *   'weights' — plan.weights = [{key, w}]: pick a category, then a problem in it.
   *               With plan.slips = [{op, a, b}], every plan.every-th problem (4 if
   *               unset; the 2nd, 6th, 10th…) is the next of these instead, in order, cycling.
   *               With plan.focus = {pattern: weight} (Stats.focusWeights), most
   *               problems lean toward the heavier patterns (patternOf).
   *   'list'    — plan.problems = [{op, a, b}]: cycle through these exact problems.
   */
  function createGenerator(plan, config, rng = Math.random) {
    const cfg = normalizeConfig(config);
    const enabled = OPS.filter((o) => cfg.ops[o]);
    let last = null;
    let queue = [];
    let served = 0; // problems so far, for mixing slips into a weights plan
    let slip = 0; // the next of plan.slips
    const same = (p, q) => q && p.op === q.op && p.a === q.a && p.b === q.b;
    const built = new Map(); // drill type → typeSampler, once random draws have missed it

    // Rejection sampling keeps targeted problems inside the player's own ranges.
    // A type those ranges make only rarely is built directly from then on; one
    // they can't make at all falls back to Zetamac's default ranges.
    function fromKey(key) {
      const op = key.split('.')[0];
      if (!built.has(key)) {
        for (let i = 0; i < 3000; i++) {
          const p = randomProblem(op, cfg, rng);
          if (matchesKey(p, key) && !same(p, last)) return p;
        }
        built.set(key, typeSampler(key, cfg));
      }
      const s = built.get(key);
      if (s) {
        let p = s.draw(rng);
        for (let i = 0; i < 20 && same(p, last); i++) p = s.draw(rng);
        return p;
      }
      for (let i = 0; i < 3000; i++) {
        const p = randomProblem(op, DEFAULT_CONFIG, rng);
        if (matchesKey(p, key) && !same(p, last)) return p;
      }
      return randomProblem(op, cfg, rng);
    }

    function pick(key) {
      const focus = plan.focus;
      if (!focus || rng() >= FOCUS_SHARE) return fromKey(key);
      const drawn = [];
      let total = 0;
      for (let i = 0; i < FOCUS_DRAWS; i++) {
        const p = fromKey(key);
        const w = focus[patternOf(p)] || 1;
        drawn.push({ p, w });
        total += w;
      }
      let r = rng() * total;
      for (const d of drawn) {
        r -= d.w;
        if (r < 0) return d.p;
      }
      return drawn[drawn.length - 1].p;
    }

    return function next() {
      let p;
      if (plan && plan.kind === 'list' && plan.problems && plan.problems.length) {
        if (!queue.length) {
          queue = shuffle(
            plan.problems.map((q) => ({ op: q.op, a: q.a, b: q.b })),
            rng,
          );
          if (queue.length > 1 && same(queue[0], last)) queue.push(queue.shift());
        }
        p = queue.shift();
      } else if (plan && plan.kind === 'weights' && plan.weights && plan.weights.length) {
        const slips = plan.slips || [];
        const every = plan.every || 4;
        if (slips.length && served % every === 1) {
          const q = slips[slip++ % slips.length];
          p = { op: q.op, a: q.a, b: q.b };
          if (same(p, last) && slips.length > 1) {
            const r = slips[slip++ % slips.length];
            p = { op: r.op, a: r.a, b: r.b };
          }
        } else p = pick(weightedPick(plan.weights, rng));
      } else {
        for (let i = 0; i < 20; i++) {
          p = randomProblem(enabled[randInt(rng, 0, enabled.length - 1)], cfg, rng);
          if (!same(p, last)) break;
        }
      }
      last = p;
      served++;
      return p;
    };
  }

  // ---- daily challenge -------------------------------------------------------

  /** mulberry32: a tiny seeded PRNG, so the same seed gives the same problems on every device. */
  function seededRng(seed) {
    let t = seed >>> 0;
    return function rng() {
      t = (t + 0x6d2b79f5) >>> 0;
      let x = Math.imul(t ^ (t >>> 15), t | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The local calendar day as 'YYYY-MM-DD': the daily set changes at local midnight. */
  function dayKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  const DAY = 864e5; // milliseconds in a day
  const DAILY_FIRST_DAY = '2026-10-27'; // Daily #1
  const DAILY_FIRST = Date.parse(DAILY_FIRST_DAY); // midnight UTC

  function dailyNumber(day) {
    const [y, m, d] = day.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - DAILY_FIRST) / DAY) + 1;
  }

  /** Today's set: Zetamac's default settings, seeded by the date, identical for everyone. */
  function dailyGenerator(day) {
    let h = 2166136261; // FNV-1a over the day string
    for (const ch of `zetapro-daily-${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return createGenerator({ kind: 'classic' }, DEFAULT_CONFIG, seededRng(h));
  }

  // ---- answering ------------------------------------------------------------

  const MAX_WRONG = 6;

  /**
   * Tracks one problem being answered, Zetamac-style: the answer is accepted
   * the instant it is typed correctly. A mistake is counted the moment the
   * typed digits stop being a prefix of the answer; backspacing to a valid
   * prefix ends that mistake, so the next wrong digit counts as a new one.
   * `wrong` keeps the longest thing typed during each mistake.
   */
  function createAttempt(p) {
    const target = String(answerOf(p));
    const rec = { op: p.op, a: p.a, b: p.b, ms: 0, errors: 0, wrong: [] };
    let inMistake = false;
    let slot = -1; // index in rec.wrong holding the current mistake, -1 if not kept

    function startMistake(val) {
      inMistake = true;
      rec.errors++;
      slot = -1;
      if (rec.wrong.length < MAX_WRONG) {
        rec.wrong.push(val);
        slot = rec.wrong.length - 1;
      }
    }

    return {
      rec,
      target,
      input(raw) {
        const val = String(raw).replace(/^0+(?=\d)/, '');
        if (val === target) return 'correct';
        if (val === '' || target.startsWith(val)) {
          inMistake = false;
          return 'pending';
        }
        if (!inMistake) startMistake(val);
        else if (slot >= 0 && val.length > rec.wrong[slot].length) rec.wrong[slot] = val;
        return 'wrong';
      },
      /** Enter pressed: an incomplete or wrong entry counts as a miss and clears. */
      submit(raw) {
        const val = String(raw).replace(/^0+(?=\d)/, '');
        if (val === '') return 'empty';
        if (val === target) return 'correct';
        if (!inMistake) startMistake(val);
        inMistake = false;
        return 'cleared';
      },
    };
  }

  // ---- mistakes -------------------------------------------------------------

  function adjacentSwap(w, t) {
    if (w.length !== t.length) return false;
    const diff = [];
    for (let i = 0; i < w.length; i++) if (w[i] !== t[i]) diff.push(i);
    return diff.length === 2 && diff[1] === diff[0] + 1 && w[diff[0]] === t[diff[1]] && w[diff[1]] === t[diff[0]];
  }

  const MISTAKE_INFO = {
    early: ['Wrong start, caught early', 'The first digits were already wrong and you fixed them before finishing.'],
    off1: ['Off by one', 'Answer was 1 away — often a miscounted step at the end.'],
    ones: ['Ones digit wrong', 'Tens were right, the last digit was not.'],
    place: ['Carry / borrow slip', 'Off by exactly 10, 100 or 1000 — a dropped or extra carry or borrow.'],
    swap: ['Swapped digits', 'Right digits, two of them in the wrong order — usually a typing slip.'],
    group: ['Off by one group', 'Off by exactly one of the factors, e.g. 7 × 8 → 49: a neighboring fact.'],
    long: ['Extra digits', 'Typed more digits than the answer has.'],
    other: ['Other', 'Wrong in some other way.'],
  };

  // Numeric relationships are checked first so that e.g. 93 for 103 reads as
  // a carry slip even though it is one digit short.
  function mistakeKind(p, wrongStr) {
    const target = String(answerOf(p));
    const w = Number(wrongStr);
    const t = Number(target);
    const d = Math.abs(w - t);
    if (d === 1) return 'off1';
    if (d === 10 || d === 100 || d === 1000) return 'place';
    if (p.op === 'mul' && (d === p.a || d === p.b)) return 'group';
    if (wrongStr.length < target.length) return 'early';
    if (wrongStr.length > target.length) return 'long';
    if (adjacentSwap(wrongStr, target)) return 'swap';
    if (d < 10 && Math.floor(w / 10) === Math.floor(t / 10)) return 'ones';
    return 'other';
  }

  return {
    OPS,
    SYMBOL,
    OP_NAME,
    DURATIONS,
    FACTORS,
    DEFAULT_CONFIG,
    MISTAKE_INFO,
    defaultConfig,
    normalizeConfig,
    fingerprint,
    isDefaultConfig,
    describeConfig,
    answerOf,
    textOf,
    keyOf,
    randomProblem,
    carryPattern,
    carryKind,
    classify,
    categoryInfo,
    allCategories,
    matchesKey,
    typeSampler,
    unmakeable,
    patternOf,
    createGenerator,
    createAttempt,
    mistakeKind,
    shuffle,
    seededRng,
    dayKey,
    dailyNumber,
    dailyGenerator,
    DAY,
    DAILY_FIRST_DAY,
  };
});
