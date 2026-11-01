// Zap-N: short neuro-assessment style games. The logic here is pure and
// tested; oa-ui.js runs the games.
//   Number Box   - combine four numbers with + − × ÷ (each once) to hit a target
//   Code Compare - pick the exact copy of a code among near-misses, faster and faster
//   Balloon      - pump for points or cash in before it pops (risk taking)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'));
  else root.OAZap = factory(root.OA);
})(typeof self !== 'undefined' ? self : this, function (OA) {
  'use strict';

  const { int, pick, shuffle } = OA;

  const GAMES = [
    { id: 'numberbox', name: 'Number Box', about: 'Use all four numbers once each, with + − × ÷, to make the target.', seconds: 180, rules: '+1 per target, −1 per skip. 3 minutes.' },
    { id: 'codes', name: 'Code Compare', about: 'Pick the exact copy of the code. The time per code shrinks as you go.', seconds: 60, rules: '+1 right, −1 wrong or too slow. 60 seconds.' },
    { id: 'balloon', name: 'Balloon', about: 'Each pump adds 5 points to the balloon; cash in before it pops or lose them.', balloons: 20, rules: '20 balloons. Points you cash in are yours.' },
  ];

  // ---- Number Box --------------------------------------------------------------

  /** a op b over whole numbers; null when the result isn't a whole number. */
  function apply(a, op, b) {
    if (op === '+') return a + b;
    if (op === '−') return a - b;
    if (op === '×') return a * b;
    if (op === '÷') return b !== 0 && a % b === 0 ? a / b : null;
    return null;
  }

  /** Can `nums` make `target` using every number once? Returns one way, or null. */
  function solve(nums, target) {
    const go = (pool) => {
      if (pool.length === 1) return pool[0].v === target ? pool[0].e : null;
      for (let i = 0; i < pool.length; i++) {
        for (let j = 0; j < pool.length; j++) {
          if (i === j) continue;
          const rest = pool.filter((_, k) => k !== i && k !== j);
          for (const op of ['+', '−', '×', '÷']) {
            if ((op === '+' || op === '×') && i > j) continue; // commutative: try each pair once
            const v = apply(pool[i].v, op, pool[j].v);
            if (v == null || v < 0) continue;
            const found = go([...rest, { v, e: `(${pool[i].e} ${op} ${pool[j].e})` }]);
            if (found) return found;
          }
        }
      }
      return null;
    };
    const way = go(nums.map((v) => ({ v, e: String(v) })));
    return way && way.replace(/^\((.*)\)$/, '$1');
  }

  /** Four numbers and a target built from them, so it's always solvable. */
  function numberBox(rng) {
    for (;;) {
      const nums = Array.from({ length: 4 }, () => int(rng, 1, 12));
      let pool = nums.map((v) => ({ v, e: String(v) }));
      while (pool.length > 1) {
        const [i, j] = shuffle(rng, pool.map((_, k) => k)).slice(0, 2);
        const [a, b] = pool[i].v >= pool[j].v ? [pool[i], pool[j]] : [pool[j], pool[i]];
        const op = pick(rng, ['+', '+', '−', '×', '×', '÷']);
        let v = apply(a.v, op, b.v);
        let used = op;
        if (v == null || (op === '×' && v > 300) || (op === '−' && v === 0)) {
          v = a.v + b.v;
          used = '+';
        }
        pool = [...pool.filter((_, k) => k !== i && k !== j), { v, e: `(${a.e} ${used} ${b.e})` }];
      }
      const target = pool[0].v;
      if (target < 10 || target > 200 || nums.includes(target)) continue;
      return { nums, target, solution: pool[0].e.replace(/^\((.*)\)$/, '$1') };
    }
  }

  // ---- Code Compare ------------------------------------------------------------------

  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const LOOKALIKE = { O: '0', 0: 'O', I: '1', 1: 'I', S: '5', 5: 'S', B: '8', 8: 'B', Z: '2', 2: 'Z', G: '6', 6: 'G', D: 'O', Q: 'O', U: 'V', V: 'U', M: 'N', N: 'M', E: 'F', F: 'E' };

  /** A code and four options: the exact copy plus three near-misses. */
  function codes(rng, len = 7) {
    const code = Array.from({ length: len }, () => pick(rng, CHARS.split(''))).join('');
    const variants = [
      () => { // one look-alike swap
        const spots = code.split('').map((c, i) => (LOOKALIKE[c] ? i : -1)).filter((i) => i >= 0);
        if (!spots.length) return null;
        const i = pick(rng, spots);
        return code.slice(0, i) + LOOKALIKE[code[i]] + code.slice(i + 1);
      },
      () => { // two neighbours swapped
        const i = int(rng, 0, len - 2);
        return code[i] === code[i + 1] ? null : code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      },
      () => { // one character changed
        const i = int(rng, 0, len - 1);
        const c = pick(rng, CHARS.split('').filter((x) => x !== code[i]));
        return code.slice(0, i) + c + code.slice(i + 1);
      },
    ];
    const opts = new Set([code]);
    while (opts.size < 4) {
      const v = pick(rng, variants)();
      if (v && v !== code) opts.add(v);
    }
    const options = shuffle(rng, [...opts]);
    return { code, options, correct: options.indexOf(code) };
  }

  /** Seconds allowed for the next code after `streak` right answers in a row. */
  const codeTime = (streak) => Math.max(1.5, 6 * 0.93 ** streak);

  // ---- Balloon -----------------------------------------------------------------------

  const BALLOON_MAX = 64; // pops on a pump drawn evenly from 1…64
  const PUMP_POINTS = 5;
  const popAt = (rng) => int(rng, 1, BALLOON_MAX);
  /** Expected points from always stopping after k pumps: k × 5 × P(survive k). */
  const expectedFor = (k) => k * PUMP_POINTS * (1 - k / BALLOON_MAX);

  function balloonStats(rounds) {
    const cashed = rounds.filter((r) => r.cashed);
    const avgPumps = cashed.length ? cashed.reduce((t, r) => t + r.pumps, 0) / cashed.length : 0;
    const best = BALLOON_MAX / 2;
    const advice = !cashed.length ? 'Every balloon popped: cash in earlier.'
      : avgPumps < best * 0.7 ? `You cashed in after ${avgPumps.toFixed(0)} pumps on average. Pops were spread evenly up to ${BALLOON_MAX}, so pumping to about ${best} would earn more.`
        : avgPumps > best * 1.3 ? `You pushed to ${avgPumps.toFixed(0)} pumps on average and lost too many balloons. Around ${best} is the sweet spot.`
          : `Close to the best plan: with pops spread evenly up to ${BALLOON_MAX}, stopping near ${best} pumps maximises points.`;
    return { cashed: cashed.length, popped: rounds.length - cashed.length, avgPumps, best, advice };
  }

  return { GAMES, apply, solve, numberBox, codes, codeTime, BALLOON_MAX, PUMP_POINTS, popAt, expectedFor, balloonStats };
});
