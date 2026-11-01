// NumberLogic: generated number sequences. Each family builds its terms from
// one rule and words that rule as the explanation; wrong options come from
// rules that fit only part of the sequence. Test rounds ramp from easy to hard.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'));
  else root.OASeq = factory(root.OA);
})(typeof self !== 'undefined' ? self : this, function (OA) {
  'use strict';

  const { int, pick } = OA;
  const signed = (d) => (d < 0 ? `− ${-d}` : `+ ${d}`);
  const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71];

  /** Grows a sequence from `first` with step(prev, k, all) for k = 1, 2, … */
  function grow(first, count, step) {
    const t = [...first];
    while (t.length < count) t.push(step(t[t.length - 1], t.length, t));
    return t;
  }

  // Each family returns { terms, next, rule, mistakes }; `terms` are shown and
  // `next` is the answer. `level` 1–3 orders a test from easy to hard.
  const FAMILIES = {
    step: {
      level: 1, topic: 'Constant step',
      make(rng) {
        const d = pick(rng, [int(rng, 2, 9), -int(rng, 2, 9), int(rng, 11, 27)]);
        const t = grow([int(rng, d < 0 ? 40 : 1, d < 0 ? 90 : 40)], 7, (p) => p + d);
        const [last, next] = [t[5], t[6]];
        return { terms: t.slice(0, 6), next, rule: `Each term ${signed(d)}: ${last} ${signed(d)} = ${next}.`, mistakes: [next + d, next - 1, last * 2 - t[0]] };
      },
    },
    ratio: {
      level: 1, topic: 'Constant ratio',
      make(rng) {
        const r = pick(rng, [2, 2, 3, 3, 4, -2]);
        const t = grow([int(rng, 1, 6)], 6, (p) => p * r);
        const [prev, last, next] = [t[3], t[4], t[5]];
        return { terms: t.slice(0, 5), next, rule: `Each term × ${r}: ${last} × ${r} = ${next}.`, mistakes: [last + (last - prev), next + last, next - r] };
      },
    },
    growingStep: {
      level: 2, topic: 'Growing step',
      make(rng) {
        const c = pick(rng, [1, 2, 2, 3, 4]);
        const d0 = int(rng, 1, 6);
        const t = grow([int(rng, 1, 20)], 7, (p, k) => p + d0 + c * (k - 1));
        const step = d0 + c * 5;
        return {
          terms: t.slice(0, 6), next: t[6],
          rule: `The step grows by ${c} each time (${d0}, ${d0 + c}, ${d0 + 2 * c}, …), so the next step is ${step}: ${t[5]} + ${step} = ${t[6]}.`,
          mistakes: [t[5] + step - c, t[6] + c, t[5] * 2 - t[4] + 2 * c],
        };
      },
    },
    powers: {
      level: 2, topic: 'Squares and cubes',
      make(rng) {
        const cube = rng() < 0.3;
        const s = int(rng, 1, cube ? 3 : 6);
        const k = pick(rng, [0, 0, 1, -1, 2, -2, 3]);
        const f = (n) => (cube ? n ** 3 : n ** 2) + k;
        const t = Array.from({ length: 6 }, (_, i) => f(s + i));
        const n = s + 5;
        const name = cube ? 'cubes' : 'squares';
        return {
          terms: t.slice(0, 5), next: t[5],
          rule: `${k ? `The ${name} ${signed(k)}` : `The ${name}`}: ${n}${cube ? '³' : '²'}${k ? ` ${signed(k)}` : ''} = ${t[5]}.`,
          mistakes: [t[4] + (t[4] - t[3]), t[5] + 1, (cube ? (n + 1) ** 3 : (n + 1) ** 2) + k],
        };
      },
    },
    primes: {
      level: 2, topic: 'Primes',
      make(rng) {
        const i = int(rng, 0, 8);
        const k = pick(rng, [0, 0, 1, -1, 2]);
        const twice = rng() < 0.3;
        const f = (p) => (twice ? 2 * p : p) + k;
        const t = PRIMES.slice(i, i + 6).map(f);
        const p = PRIMES[i + 5];
        return {
          terms: t.slice(0, 5), next: t[5],
          rule: `${twice ? 'Twice the primes' : 'The primes'}${k ? ` ${signed(k)}` : ''}: the next prime is ${p}, giving ${t[5]}.`,
          mistakes: [t[4] + (t[4] - t[3]), t[5] + (twice ? 2 : 1), f(p + 2)],
        };
      },
    },
    sumOfPrevious: {
      level: 2, topic: 'Sum of previous terms',
      make(rng) {
        const three = rng() < 0.3;
        const first = three ? [int(rng, 0, 2), int(rng, 1, 3), int(rng, 1, 4)] : [int(rng, 1, 5), int(rng, 1, 7)];
        const t = grow(first, 7, (p, k, all) => all[k - 1] + all[k - 2] + (three ? all[k - 3] : 0));
        return {
          terms: t.slice(0, 6), next: t[6],
          rule: three ? `Each term is the sum of the previous three: ${t[3]} + ${t[4]} + ${t[5]} = ${t[6]}.`
            : `Each term is the sum of the previous two: ${t[4]} + ${t[5]} = ${t[6]}.`,
          mistakes: [t[5] * 2, three ? t[4] + t[5] : t[5] + t[3], t[6] + 1],
        };
      },
    },
    multiplyAdd: {
      level: 2, topic: 'Multiply and add',
      make(rng) {
        const m = pick(rng, [2, 2, 3]);
        const c = pick(rng, [1, -1, 2, -2, 3]);
        const t = grow([int(rng, 2, 5)], 7, (p) => p * m + c);
        if (t.some((v, i) => i && v <= t[i - 1])) return FAMILIES.multiplyAdd.make(rng);
        return {
          terms: t.slice(0, 6), next: t[6],
          rule: `Each term × ${m} ${signed(c)}: ${t[5]} × ${m} ${signed(c)} = ${t[6]}.`,
          mistakes: [t[5] * m, t[5] * m - c, t[5] + (t[5] - t[4]) * m],
        };
      },
    },
    alternatingOps: {
      level: 3, topic: 'Alternating operations',
      make(rng) {
        const a = int(rng, 1, 9);
        const b = pick(rng, [2, 3]);
        const addFirst = rng() < 0.5;
        const op = (k) => ((k % 2 === 1) === addFirst ? 'add' : 'mul');
        const t = grow([int(rng, 1, 6)], 8, (p, k) => (op(k) === 'add' ? p + a : p * b));
        const last = op(7) === 'add' ? `+ ${a}` : `× ${b}`;
        return {
          terms: t.slice(0, 7), next: t[7],
          rule: `Alternate + ${a} and × ${b}. The next operation is ${last}: ${t[6]} ${last} = ${t[7]}.`,
          mistakes: [op(7) === 'add' ? t[6] * b : t[6] + a, t[6] + (t[6] - t[5]), t[7] + a],
        };
      },
    },
    interleaved: {
      level: 3, topic: 'Two interleaved sequences',
      make(rng) {
        const d1 = pick(rng, [int(rng, 2, 9), -int(rng, 2, 5)]);
        const geo = rng() < 0.4;
        const d2 = geo ? pick(rng, [2, 3]) : int(rng, 3, 12);
        let a = int(rng, 10, 40);
        let b = int(rng, 1, 5);
        const t = [];
        for (let i = 0; i < 8; i++) {
          if (i % 2 === 0) {
            t.push(a);
            a += d1;
          } else {
            t.push(b);
            b = geo ? b * d2 : b + d2;
          }
        }
        return {
          terms: t.slice(0, 7), next: t[7],
          rule: `Two sequences take turns. The 2nd, 4th and 6th terms go ${t[1]}, ${t[3]}, ${t[5]} (${geo ? `× ${d2}` : `+ ${d2}`} each time), so the 8th is ${t[7]}.`,
          mistakes: [t[6] + d1, t[5] + (t[5] - t[3]) * (geo ? 1 : 2), t[7] + (geo ? t[5] : d2)],
        };
      },
    },
    growingMultiplier: {
      level: 3, topic: 'Growing multiplier',
      make(rng) {
        const s = int(rng, 1, 3);
        const t = grow([int(rng, 1, 4)], 6, (p, k) => p * (s + k - 1));
        const m = s + 4;
        return {
          terms: t.slice(0, 5), next: t[5],
          rule: `Multiply by ${s}, then ${s + 1}, then ${s + 2}, …; the next multiplier is ${m}: ${t[4]} × ${m} = ${t[5]}.`,
          mistakes: [t[4] * (m - 1), t[4] * (m + 1), t[4] + (t[4] - t[3]) * 2],
        };
      },
    },
    alternatingSteps: {
      level: 3, topic: 'Alternating steps',
      make(rng) {
        const base = int(rng, 1, 3);
        const t = grow([int(rng, 10, 30)], 7, (p, k) => p + (k % 2 ? 1 : -1) * base * k);
        const step = (6 % 2 ? 1 : -1) * base * 6;
        return {
          terms: t.slice(0, 6), next: t[6],
          rule: `The steps are +${base}, −${base * 2}, +${base * 3}, … (growing, alternating sign); the next step is ${step < 0 ? '−' : '+'}${Math.abs(step)}: ${t[6]}.`,
          mistakes: [t[5] - step, t[4], t[6] - (step < 0 ? base : -base)],
        };
      },
    },
    stepMultiplies: {
      level: 3, topic: 'Step multiplies',
      make(rng) {
        const r = pick(rng, [2, 3]);
        const d = int(rng, 1, 3);
        const t = grow([int(rng, 1, 15)], 7, (p, k) => p + d * r ** (k - 1));
        const step = d * r ** 5;
        return {
          terms: t.slice(0, 6), next: t[6],
          rule: `The steps (${d}, ${d * r}, ${d * r * r}, …) multiply by ${r}; the next step is ${step}: ${t[5]} + ${step} = ${t[6]}.`,
          mistakes: [t[5] + step / r * 2, t[5] * r, t[6] + d],
        };
      },
    },
  };

  const NAMES = Object.keys(FAMILIES);

  /** Five whole-number options: the answer, wrong-rule values, then near misses. */
  function intOptions(rng, answer, mistakes) {
    const picked = [answer];
    const ok = (v) => Number.isInteger(v) && !picked.includes(v);
    for (const m of OA.shuffle(rng, mistakes)) if (picked.length < 5 && ok(m)) picked.push(m);
    const spread = Math.max(2, Math.round(Math.abs(answer) * 0.08));
    for (const off of OA.shuffle(rng, [1, -1, 2, -2, spread, -spread, 2 * spread, -2 * spread, 3, -3, 5, -5])) {
      if (picked.length < 5 && ok(answer + off)) picked.push(answer + off);
    }
    const sorted = picked.sort((x, y) => x - y);
    return { options: sorted.map(String), correct: sorted.indexOf(answer) };
  }

  function build(rng, name) {
    const f = FAMILIES[name];
    const s = f.make(rng);
    const o = intOptions(rng, s.next, s.mistakes);
    return {
      kind: 'choice', template: name, topic: f.topic, level: f.level, terms: s.terms, big: true,
      prompt: `${s.terms.join(', ')}, ?`, explain: s.rule,
      options: o.options, correct: o.correct, answer: String(s.next),
    };
  }

  /** `n` questions: about 30% easy, 35% medium, then hard, varying the family. */
  function set(rng, n) {
    const out = [];
    const used = new Map();
    for (let i = 0; i < n; i++) {
      const level = n === 1 ? pick(rng, [1, 2, 2, 3]) : i < n * 0.3 ? 1 : i < n * 0.65 ? 2 : 3;
      const pool = NAMES.filter((k) => FAMILIES[k].level === level);
      // The least-used family at this level, ties broken at random.
      const least = Math.min(...pool.map((k) => used.get(k) || 0));
      const name = pick(rng, pool.filter((k) => (used.get(k) || 0) === least));
      used.set(name, (used.get(name) || 0) + 1);
      out.push(build(rng, name));
    }
    return out;
  }

  return { FAMILIES, NAMES, build, set, intOptions };
});
