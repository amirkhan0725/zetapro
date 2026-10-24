// "80 in 8": Optiver-style multiple-choice mental maths. Question generation,
// answer options, scoring and per-type stats. All arithmetic is done on exact
// fractions so decimal answers never pick up floating-point error.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.E80 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const QUESTIONS = 80;
  const SECONDS = 480;
  const PASS_LINE = 55; // most-repeated reported pass line; Optiver has never published one
  const MIN_N = 4;

  // ---- exact rationals ------------------------------------------------------

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  }

  function R(n, d = 1) {
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return { n: n / g, d: d / g };
  }

  const add = (x, y) => R(x.n * y.d + y.n * x.d, x.d * y.d);
  const sub = (x, y) => R(x.n * y.d - y.n * x.d, x.d * y.d);
  const mul = (x, y) => R(x.n * y.n, x.d * y.d);
  const div = (x, y) => R(x.n * y.d, x.d * y.n);
  const eq = (x, y) => x.n === y.n && x.d === y.d;
  const dec = (k, p) => R(k, 10 ** p); // k / 10^p, e.g. dec(35, 2) = 0.35
  const frac = (n, d) => R(n, d);

  /** Decimal places needed to write r exactly, or Infinity if it doesn't terminate. */
  function places(r) {
    let d = r.d;
    while (d % 2 === 0) d /= 2;
    while (d % 5 === 0) d /= 5;
    if (d !== 1) return Infinity;
    let p = 0;
    while ((10 ** p) % r.d !== 0) p++;
    return p;
  }

  const groupInt = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function fmtNum(r) {
    const p = places(r);
    if (!Number.isFinite(p)) return fmtFrac(r);
    const scaled = Math.round((r.n * 10 ** p) / r.d);
    const s = String(Math.abs(scaled)).padStart(p + 1, '0');
    const whole = p ? s.slice(0, -p) : s;
    return (scaled < 0 ? '−' : '') + groupInt(whole) + (p ? `.${s.slice(-p)}` : '');
  }

  function fmtFrac(r) {
    return r.d === 1 ? groupInt(String(r.n)) : `${r.n}/${r.d}`;
  }

  // ---- question types -------------------------------------------------------

  const TYPES = {
    'int.addsub': ['Whole numbers, + and −', '373 + 57'],
    'int.mul': ['Whole numbers, ×', '48 × 25'],
    'int.div': ['Whole numbers, ÷', '1,248 ÷ 16'],
    'dec.addsub': ['Decimals, + and −', '1,000 − 386.25'],
    'dec.mul': ['Decimals, ×', '0.35 × 480'],
    'dec.div': ['Decimals, ÷', '14.4 ÷ 0.6'],
    'frac.addsub': ['Fractions, + and −', '3/4 + 5/6'],
    'frac.mul': ['Fractions, ×', '7/8 × 312'],
    'frac.div': ['Fractions, ÷', '3/4 ÷ 3/8'],
    'miss.addsub': ['Missing number, + and −', '? + 47 = 112'],
    'miss.muldiv': ['Missing number, × and ÷', '66 × ? = 138.6'],
  };
  const TYPE_KEYS = Object.keys(TYPES);

  // The real mix is unpublished; reports say mostly whole numbers and decimals
  // with fractions and missing-number items sprinkled in.
  const DEFAULT_MIX = {
    'int.addsub': 1.1, 'int.mul': 1.2, 'int.div': 1,
    'dec.addsub': 1, 'dec.mul': 1.2, 'dec.div': 1,
    'frac.addsub': 0.7, 'frac.mul': 0.8, 'frac.div': 0.5,
    'miss.addsub': 0.6, 'miss.muldiv': 0.9,
  };

  function typeInfo(key) {
    const t = TYPES[key] || [key, ''];
    return { key, name: t[0], example: t[1] };
  }

  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const DENOMS = [2, 3, 4, 5, 6, 8, 9, 10, 12];
  const properFrac = (rng, d) => frac(randInt(rng, 1, d - 1), d);
  const fracText = (r) => `${r.n}/${r.d}`;

  // Each generator returns { text, answer, kind, slips }. kind 'frac' shows
  // fractional answers as n/d; slips are wrong answers a hurried person gives.
  const GEN = {
    'int.addsub'(rng) {
      if (rng() < 0.5) {
        const a = randInt(rng, 120, 989);
        const b = randInt(rng, 13, 899);
        return { text: `${fmtNum(R(a))} + ${fmtNum(R(b))}`, answer: R(a + b), slips: [R(a + b - 10), R(a + b + 10), R(a + b + 100)] };
      }
      const a = rng() < 0.3 ? pick(rng, [500, 1000, 1500, 2000]) : randInt(rng, 300, 1999);
      const b = randInt(rng, 27, a - 25);
      return { text: `${fmtNum(R(a))} − ${fmtNum(R(b))}`, answer: R(a - b), slips: [R(a - b + 10), R(a - b - 10), R(a - b + 100)] };
    },
    'int.mul'(rng) {
      const v = rng();
      let a;
      let b;
      if (v < 0.5) { a = randInt(rng, 12, 99); b = randInt(rng, 11, 99); }
      else if (v < 0.8) { a = randInt(rng, 101, 999); b = randInt(rng, 3, 9); }
      else { a = randInt(rng, 12, 199); b = pick(rng, [15, 25, 50, 75, 125]); }
      const ans = a * b;
      return { text: `${fmtNum(R(a))} × ${b}`, answer: R(ans), slips: [R(ans + a), R(ans - a), R(ans + b), R(ans - b)] };
    },
    'int.div'(rng) {
      const d = randInt(rng, 3, 25);
      const q = randInt(rng, 12, 160);
      return { text: `${fmtNum(R(q * d))} ÷ ${d}`, answer: R(q), slips: [R(q + 1), R(q - 1), R(q + 10)] };
    },
    'dec.addsub'(rng) {
      const v = rng();
      if (v < 0.3) {
        // Round number minus a 2-dp decimal below it, e.g. 1,000 − 386.25.
        const whole = pick(rng, [10, 100, 1000]);
        const b = dec(randInt(rng, whole * 10 + 1, whole * 100 - 1), 2);
        return { text: `${fmtNum(R(whole))} − ${fmtNum(b)}`, answer: sub(R(whole), b), slips: [sub(R(whole - 1), b), sub(R(whole + 1), b)] };
      }
      const a = dec(randInt(rng, 101, 9999), 2);
      const b = dec(randInt(rng, 11, 999), pick(rng, [1, 2]));
      if (v < 0.65) return { text: `${fmtNum(a)} + ${fmtNum(b)}`, answer: add(a, b), slips: [add(add(a, b), R(1)), sub(add(a, b), R(1))] };
      const [hi, lo] = a.n / a.d >= b.n / b.d ? [a, b] : [b, a];
      if (eq(hi, lo)) return GEN['dec.addsub'](rng);
      return { text: `${fmtNum(hi)} − ${fmtNum(lo)}`, answer: sub(hi, lo), slips: [add(sub(hi, lo), R(1)), sub(sub(hi, lo), R(1, 10))] };
    },
    'dec.mul'(rng) {
      const v = rng();
      let a;
      let b;
      if (v < 0.35) { a = dec(randInt(rng, 1, 19) * 5, 2); b = R(randInt(rng, 2, 49) * 20); }
      else if (v < 0.6) { a = dec(randInt(rng, 11, 99), 1); b = R(randInt(rng, 3, 40)); }
      else if (v < 0.8) { a = dec(randInt(rng, 2, 9), 1); b = dec(randInt(rng, 12, 99), 1); }
      else { a = dec(randInt(rng, 101, 999), 2); b = R(randInt(rng, 2, 9)); }
      const ans = mul(a, b);
      return { text: `${fmtNum(a)} × ${fmtNum(b)}`, answer: ans, slips: [mul(ans, R(10)), mul(ans, R(1, 10))] };
    },
    'dec.div'(rng) {
      const q = rng() < 0.6 ? R(randInt(rng, 3, 120)) : dec(randInt(rng, 12, 250), 1);
      let d = randInt(rng, 2, 19);
      if (d === 10) d = 12;
      const b = rng() < 0.65 ? dec(d, 1) : R(randInt(rng, 2, 12));
      const a = mul(q, b);
      return { text: `${fmtNum(a)} ÷ ${fmtNum(b)}`, answer: q, slips: [mul(q, R(10)), mul(q, R(1, 10))] };
    },
    'frac.addsub'(rng) {
      const x = properFrac(rng, pick(rng, DENOMS));
      let y = properFrac(rng, pick(rng, DENOMS));
      if (eq(x, y)) y = properFrac(rng, 12);
      if (rng() < 0.55 || eq(x, y)) {
        return { text: `${fracText(x)} + ${fracText(y)}`, answer: add(x, y), kind: 'frac', slips: [R(x.n + y.n, x.d + y.d)] };
      }
      const [hi, lo] = x.n / x.d > y.n / y.d ? [x, y] : [y, x];
      return { text: `${fracText(hi)} − ${fracText(lo)}`, answer: sub(hi, lo), kind: 'frac', slips: [R(Math.abs(hi.n - lo.n) || 1, Math.abs(hi.d - lo.d) || hi.d)] };
    },
    'frac.mul'(rng) {
      if (rng() < 0.6) {
        const d = randInt(rng, 3, 12);
        const f = properFrac(rng, d);
        const n = f.d * randInt(rng, 4, 60);
        return { text: `${fracText(f)} × ${fmtNum(R(n))}`, answer: mul(f, R(n)), slips: [R(n / f.d), mul(R(n / f.d), R(f.n + 1))] };
      }
      const x = properFrac(rng, pick(rng, DENOMS));
      const y = properFrac(rng, pick(rng, DENOMS));
      return { text: `${fracText(x)} × ${fracText(y)}`, answer: mul(x, y), kind: 'frac', slips: [div(x, y)] };
    },
    'frac.div'(rng) {
      if (rng() < 0.5) {
        const f = properFrac(rng, randInt(rng, 2, 9));
        const n = f.n * randInt(rng, 2, 20);
        return { text: `${n} ÷ ${fracText(f)}`, answer: div(R(n), f), slips: [mul(R(n), f), div(R(n), R(f.d))] };
      }
      const x = properFrac(rng, pick(rng, DENOMS));
      let y = properFrac(rng, pick(rng, DENOMS));
      if (eq(x, y)) y = frac(1, 3);
      return { text: `${fracText(x)} ÷ ${fracText(y)}`, answer: div(x, y), kind: 'frac', slips: [mul(x, y), div(y, x)] };
    },
    'miss.addsub'(rng) {
      const useDec = rng() < 0.4;
      const a = useDec ? dec(randInt(rng, 11, 999), 1) : R(randInt(rng, 12, 499));
      const b = useDec ? dec(randInt(rng, 11, 999), 1) : R(randInt(rng, 12, 499));
      const v = rng();
      if (v < 0.4) return { text: `? + ${fmtNum(b)} = ${fmtNum(add(a, b))}`, answer: a, slips: [add(add(a, b), b)] };
      if (v < 0.7) return { text: `${fmtNum(add(a, b))} − ? = ${fmtNum(a)}`, answer: b, slips: [add(add(a, b), a)] };
      return { text: `? − ${fmtNum(b)} = ${fmtNum(a)}`, answer: add(a, b), slips: [sub(a, b).n > 0 ? sub(a, b) : add(a, R(1))] };
    },
    'miss.muldiv'(rng) {
      const v = rng();
      if (v < 0.4) {
        const a = R(randInt(rng, 3, 99));
        const x = rng() < 0.6 ? dec(randInt(rng, 11, 99), 1) : R(randInt(rng, 3, 40));
        return { text: `${fmtNum(a)} × ? = ${fmtNum(mul(a, x))}`, answer: x, slips: [mul(x, R(10)), mul(x, R(1, 10))] };
      }
      if (v < 0.75) {
        const q = dec(randInt(rng, 12, 250), pick(rng, [0, 1]));
        const b = R(randInt(rng, 2, 25));
        return { text: `? ÷ ${fmtNum(b)} = ${fmtNum(q)}`, answer: mul(q, b), slips: [div(q, b), mul(mul(q, b), R(10))] };
      }
      const b = R(randInt(rng, 3, 25));
      const q = R(randInt(rng, 6, 80));
      return { text: `${fmtNum(mul(q, b))} ÷ ? = ${fmtNum(q)}`, answer: b, slips: [add(b, R(1)), sub(b, R(1))] };
    },
  };

  // ---- answer options -------------------------------------------------------

  function swapLastTwo(r) {
    const p = places(r);
    if (!Number.isFinite(p)) return null;
    const k = Math.round((r.n * 10 ** p) / r.d);
    const s = String(k);
    if (s.length < 2 || s[s.length - 1] === s[s.length - 2]) return null;
    return R(Number(s.slice(0, -2) + s[s.length - 1] + s[s.length - 2]), 10 ** p);
  }

  /** Near misses first, a decimal-point slip occasionally, like a real distractor set. */
  function candidates(q, rng) {
    const a = q.answer;
    const near = [];
    const far = [];
    if (q.kind === 'frac') {
      near.push(R(a.n + 1, a.d), R(a.n - 1, a.d), R(a.n, a.d + 1), R(a.n + a.d, a.d * 2), ...q.slips);
      if (a.n !== a.d) far.push(R(a.d, a.n));
    } else {
      const p = places(a);
      const unit = R(1, 10 ** p);
      near.push(add(a, unit), sub(a, unit), add(a, mul(unit, R(10))), sub(a, mul(unit, R(10))), ...q.slips);
      if (p > 0) near.push(add(a, R(1)), sub(a, R(1)));
      const sw = swapLastTwo(a);
      if (sw) near.push(sw);
      far.push(mul(a, R(10)), mul(a, R(1, 10)));
    }
    // Numeric options must be terminating decimals no fussier than the answer.
    const maxPlaces = q.kind === 'frac' ? Infinity : Math.max(places(a), 1) + 1;
    const usable = (r) => r && r.n > 0 && (q.kind === 'frac' || places(r) <= maxPlaces);
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    return { near: shuffle(near.filter(usable)), far: shuffle(far.filter(usable)) };
  }

  function buildOptions(q, rng) {
    const { near, far } = candidates(q, rng);
    const chosen = [q.answer];
    const take = (r) => {
      if (chosen.length < 4 && !chosen.some((c) => eq(c, r))) chosen.push(r);
    };
    if (far.length && rng() < 0.3) take(far[0]);
    near.forEach(take);
    far.forEach(take);
    // Last resort for tiny answers: walk upward until there are four.
    for (let k = 2; chosen.length < 4; k++) take(add(q.answer, R(k)));

    const show = q.kind === 'frac' ? fmtFrac : fmtNum;
    // Fraction answers sometimes appear unreduced (e.g. 38/24), as candidates report.
    const scale = q.kind === 'frac' && q.answer.d > 1 && rng() < 0.3 ? pick(rng, [2, 3]) : 1;
    const text = (r) => (scale > 1 && r.d > 1 ? `${r.n * scale}/${r.d * scale}` : show(r));

    const order = chosen.map((r, i) => ({ r, i }));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return {
      options: order.map((o) => text(o.r)),
      correct: order.findIndex((o) => o.i === 0),
    };
  }

  function makeQuestion(type, rng) {
    const raw = GEN[type](rng);
    const kind = raw.kind === 'frac' && raw.answer.d !== 1 ? 'frac' : 'num';
    const q = { type, text: raw.text, answer: raw.answer, kind, slips: raw.slips || [] };
    const { options, correct } = buildOptions(q, rng);
    return { type, text: q.text, options, correct };
  }

  /** plan: { weights: {type: w} } — defaults to the standard mix. */
  function createGenerator(plan, rng = Math.random) {
    const weights = Object.entries((plan && plan.weights) || DEFAULT_MIX).filter(([k, w]) => GEN[k] && w > 0);
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let last = null;
    return function next() {
      let q;
      for (let tries = 0; tries < 10; tries++) {
        let r = rng() * total;
        let type = weights[weights.length - 1][0];
        for (const [k, w] of weights) {
          r -= w;
          if (r < 0) { type = k; break; }
        }
        q = makeQuestion(type, rng);
        if (!last || q.text !== last.text) break;
      }
      last = q;
      return q;
    };
  }

  // ---- scoring & stats ------------------------------------------------------

  function score(records, penalty) {
    let right = 0;
    let wrong = 0;
    let skipped = 0;
    for (const r of records) {
      if (r.c == null) skipped++;
      else if (r.c === r.a) right++;
      else wrong++;
    }
    return { right, wrong, skipped, answered: right + wrong, net: right - penalty * wrong };
  }

  const isAttempt = (s) => s.mode === 'e80' && !s.practice && !s.aborted;

  /** Real attempts; with `penalty`, only those scored the same way (−1 vs −2). */
  function summary(sessions, penalty) {
    const games = sessions.filter((s) => isAttempt(s) && (!penalty || (s.settings && s.settings.penalty) === penalty));
    const nets = games.map((g) => g.score);
    const last10 = nets.slice(-10);
    return {
      games: games.length,
      best: nets.length ? Math.max(...nets) : null,
      recentAvg: last10.length ? last10.reduce((s, x) => s + x, 0) / last10.length : null,
      history: games.map((g, i) => ({ i: i + 1, at: g.at, score: g.score })),
    };
  }

  function flatten(sessions) {
    const out = [];
    for (const s of sessions) {
      if (s.mode !== 'e80') continue;
      for (const p of s.problems || []) {
        if (!TYPES[p.t] || !Number.isFinite(p.ms)) continue;
        out.push({ ...p, at: s.at, practice: !!s.practice, ok: p.c === p.a, skipped: p.c == null });
      }
    }
    return out;
  }

  function byType(problems) {
    const groups = new Map();
    for (const p of problems) {
      if (!groups.has(p.t)) groups.set(p.t, []);
      groups.get(p.t).push(p);
    }
    const stat = (list) => {
      const n = list.length;
      const ok = list.filter((p) => p.ok).length;
      const meanMs = list.reduce((s, p) => s + Math.min(p.ms, 30000), 0) / (n || 1);
      return { n, ok, wrong: list.filter((p) => !p.ok && !p.skipped).length, skipped: list.filter((p) => p.skipped).length, accuracy: n ? ok / n : 0, meanMs };
    };
    const all = stat(problems);
    const base = all.meanMs * (2 - all.accuracy) || 1;
    const rows = [...groups.entries()].map(([key, list]) => {
      const s = stat(list);
      return { ...typeInfo(key), ...s, cost: (s.meanMs * (2 - s.accuracy)) / base, lowData: s.n < MIN_N };
    });
    rows.sort((x, y) => (x.lowData - y.lowData) || (y.cost - x.cost));
    return { all, rows };
  }

  /** Practice plan built from the costliest well-sampled types. */
  function weakPlan(problems, top = 4) {
    const rows = byType(problems).rows.filter((r) => !r.lowData).slice(0, top);
    if (rows.length < 2) return null;
    return { rows, weights: Object.fromEntries(rows.map((r) => [r.key, r.cost * r.cost])) };
  }

  return {
    QUESTIONS, SECONDS, PASS_LINE, TYPES, TYPE_KEYS, DEFAULT_MIX,
    R, add, sub, mul, div, eq, places, fmtNum, fmtFrac,
    typeInfo, makeQuestion, createGenerator, score, summary, flatten, byType, weakPlan, isAttempt,
  };
});
