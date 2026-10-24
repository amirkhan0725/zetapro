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
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  function normalizeConfig(c) {
    const d = defaultConfig();
    if (!c || typeof c !== 'object') return d;
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

  function isDefaultConfig(c) {
    return fingerprint(c) === fingerprint(DEFAULT_CONFIG);
  }

  function describeConfig(c) {
    const n = normalizeConfig(c);
    if (isDefaultConfig(n)) return `Standard ${n.duration}s`;
    const ops = OPS.filter((o) => n.ops[o]).map((o) => SYMBOL[o]).join(' ');
    return `${n.duration}s · ${ops}`;
  }

  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  function answerOf(p) {
    switch (p.op) {
      case 'add': return p.a + p.b;
      case 'sub': return p.a - p.b;
      case 'mul': return p.a * p.b;
      case 'div': return p.a / p.b;
      default: return NaN;
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

  function carryKind(x, y) {
    const pat = carryPattern(x, y);
    const n = pat.filter(Boolean).length;
    if (n === 0) return 'none';
    if (n >= 2) return 'multi';
    return pat[0] ? 'ones' : 'tens';
  }

  /**
   * Sorts a problem into a coarse category (`cat`, used for ranking and drills)
   * and, for × and ÷, a factor-map cell (`cell`). Borrows in m − s = d are
   * exactly the carries in s + d = m, so subtraction reuses the carry logic.
   */
  function classify(p) {
    switch (p.op) {
      case 'add':
        return { cat: `add.${carryKind(p.a, p.b)}`, cell: null, factor: null };
      case 'sub':
        return { cat: `sub.${carryKind(p.b, p.a - p.b)}`, cell: null, factor: null };
      case 'mul': {
        if (p.a <= 12 && p.b <= 12) return { cat: 'mul.table', cell: `mul.t.${p.a}`, factor: p.a };
        const f = Math.min(p.a, p.b);
        if (f > 12) return { cat: 'mul.big', cell: null, factor: null };
        return { cat: `mul.x.${f}`, cell: `mul.x.${f}`, factor: f };
      }
      case 'div': {
        const d = p.b;
        const q = p.a / p.b;
        if (d <= 12 && q <= 12) return { cat: 'div.table', cell: `div.t.${d}`, factor: d };
        if (d > 12) return { cat: 'div.big', cell: null, factor: null };
        return { cat: `div.x.${d}`, cell: `div.x.${d}`, factor: d };
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
      if (kind === 'table') { name = 'Times tables (to 12 × 12)'; example = '7 × 8'; }
      else if (kind === 'big') { name = 'Large × large'; example = '23 × 47'; }
      else if (kind === 'x') { name = `${f} × 2-digit`; example = `${f} × 86`; }
      else if (kind === 't') { name = `${f} × table facts`; example = `${f} × 8`; }
    } else if (op === 'div') {
      if (kind === 'table') { name = 'Division tables'; example = '56 ÷ 7'; }
      else if (kind === 'big') { name = 'Large divisors'; example = '1081 ÷ 23'; }
      else if (kind === 'x') { name = `÷ ${f}, 2-digit answer`; example = `${f * 86} ÷ ${f}`; }
      else if (kind === 't') { name = `÷ ${f} table facts`; example = `${f * 8} ÷ ${f}`; }
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

  /**
   * plan.kind:
   *   'classic' — Zetamac: uniform over the enabled operations.
   *   'weights' — plan.weights = [{key, w}]: pick a category, then a problem in it.
   *   'list'    — plan.problems = [{op, a, b}]: cycle through these exact problems.
   */
  function createGenerator(plan, config, rng = Math.random) {
    const cfg = normalizeConfig(config);
    const enabled = OPS.filter((o) => cfg.ops[o]);
    let last = null;
    let queue = [];
    const same = (p, q) => q && p.op === q.op && p.a === q.a && p.b === q.b;

    // Rejection sampling keeps targeted problems inside the player's own ranges;
    // it falls back to Zetamac's default ranges if those can't produce the type.
    function fromKey(key) {
      const op = key.split('.')[0];
      for (let i = 0; i < 6000; i++) {
        const p = randomProblem(op, i < 3000 ? cfg : DEFAULT_CONFIG, rng);
        if (matchesKey(p, key) && !same(p, last)) return p;
      }
      return randomProblem(op, cfg, rng);
    }

    return function next() {
      let p;
      if (plan && plan.kind === 'list' && plan.problems && plan.problems.length) {
        if (!queue.length) {
          queue = shuffle(plan.problems.map((q) => ({ op: q.op, a: q.a, b: q.b })), rng);
          if (queue.length > 1 && same(queue[0], last)) queue.push(queue.shift());
        }
        p = queue.shift();
      } else if (plan && plan.kind === 'weights' && plan.weights && plan.weights.length) {
        p = fromKey(weightedPick(plan.weights, rng));
      } else {
        for (let i = 0; i < 20; i++) {
          p = randomProblem(enabled[randInt(rng, 0, enabled.length - 1)], cfg, rng);
          if (!same(p, last)) break;
        }
      }
      last = p;
      return p;
    };
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
    group: ['Off by one group', 'Off by exactly one of the factors, e.g. 7 × 8 → 49: a neighbouring fact.'],
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
    OPS, SYMBOL, OP_NAME, DURATIONS, FACTORS, DEFAULT_CONFIG, MISTAKE_INFO,
    defaultConfig, normalizeConfig, fingerprint, isDefaultConfig, describeConfig,
    answerOf, textOf, keyOf, randomProblem, carryPattern, carryKind, classify,
    categoryInfo, allCategories, matchesKey, createGenerator, createAttempt,
    mistakeKind, shuffle,
  };
});
