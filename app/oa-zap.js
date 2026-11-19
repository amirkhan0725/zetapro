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
    {
      id: 'numberbox',
      name: 'Number Box',
      about: 'Use all four numbers once each, with + − × ÷, to make the target.',
      seconds: 180,
      rules: '+1 per target, −1 per skip. 3 minutes.',
    },
    {
      id: 'codes',
      name: 'Code Compare',
      about: 'Pick the exact copy of an 8-character code. The time per code shrinks as you go.',
      seconds: 60,
      rules: '+1 right, −1 wrong or too slow. 60 seconds.',
    },
    {
      id: 'balloon',
      name: 'Balloon',
      about:
        'Each pump adds 5 points to the balloon; cash in before it pops or lose them. Each color stretches a different distance, and which is which changes every game.',
      balloons: 15,
      rules: '15 balloons in three colors. The first two pumps are always safe.',
    },
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

  /** Can `nums` make `target` using every number once (with `ops`)? Returns one way, or null. */
  function solve(nums, target, ops = ['+', '−', '×', '÷']) {
    const go = (pool) => {
      if (pool.length === 1) return pool[0].v === target ? pool[0].e : null;
      for (let i = 0; i < pool.length; i++) {
        for (let j = 0; j < pool.length; j++) {
          if (i === j) continue;
          const rest = pool.filter((_, k) => k !== i && k !== j);
          for (const op of ops) {
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
      const nums = Array.from({ length: 4 }, () => int(rng, 2, 12)); // no 1s: "× 1" would dodge the × rule
      let pool = nums.map((v) => ({ v, e: String(v) }));
      while (pool.length > 1) {
        const [i, j] = shuffle(
          rng,
          pool.map((_, k) => k),
        ).slice(0, 2);
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
      // Adding and subtracting alone is too easy: every puzzle needs × or ÷.
      if (solve(nums, target, ['+', '−'])) continue;
      return { nums, target, solution: pool[0].e.replace(/^\((.*)\)$/, '$1') };
    }
  }

  // ---- Code Compare ------------------------------------------------------------------

  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const LOOKALIKE = {
    O: '0',
    0: 'O',
    I: '1',
    1: 'I',
    S: '5',
    5: 'S',
    B: '8',
    8: 'B',
    Z: '2',
    2: 'Z',
    G: '6',
    6: 'G',
    D: 'O',
    Q: 'O',
    U: 'V',
    V: 'U',
    M: 'N',
    N: 'M',
    E: 'F',
    F: 'E',
  };

  /** A code and four options: the exact copy plus three near-misses. */
  function codes(rng, len = 8) {
    const code = Array.from({ length: len }, () => pick(rng, CHARS.split(''))).join('');
    const variants = [
      () => {
        // one look-alike swap
        const spots = code
          .split('')
          .map((c, i) => (LOOKALIKE[c] ? i : -1))
          .filter((i) => i >= 0);
        if (!spots.length) return null;
        const i = pick(rng, spots);
        return code.slice(0, i) + LOOKALIKE[code[i]] + code.slice(i + 1);
      },
      () => {
        // two neighbors swapped
        const i = int(rng, 0, len - 2);
        return code[i] === code[i + 1] ? null : code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      },
      () => {
        // one character changed
        const i = int(rng, 0, len - 1);
        const c = pick(
          rng,
          CHARS.split('').filter((x) => x !== code[i]),
        );
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
  const codeTime = (streak) => Math.max(1.2, 4.5 * 0.93 ** streak);

  /** Positions (0-based) where two codes differ, for showing a miss. */
  function codeDiff(a, b) {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
    return out;
  }

  /** A saved Code Compare game's best run: longest streak and the time per code it reached. */
  function codeRun(problems) {
    let streak = 0;
    let best = 0;
    for (const p of problems) {
      streak = p.ok ? streak + 1 : 0;
      best = Math.max(best, streak);
    }
    return { bestStreak: best, reached: codeTime(best) };
  }

  // ---- Balloon -----------------------------------------------------------------------

  // A game's balloons come in three colors, each hiding its own limit: a shuffle of
  // these, so a color means something different every game. The first two pumps are
  // always safe; after that a balloon pops on a pump drawn evenly from 3…limit, which
  // makes half the limit (4, 8 or 16 pumps) the best stop. Early pops are the only clue.
  const BALLOON_MAXES = [8, 16, 32];
  const BALLOON_COLORS = [
    { id: 'teal', name: 'Teal' },
    { id: 'amber', name: 'Amber' },
    { id: 'violet', name: 'Violet' },
  ];
  const BALLOON_SAFE = 2;
  const BALLOON_MAX = 64; // games saved before balloons had colors: one limit, pops from pump 1
  const PUMP_POINTS = 5;
  /** A game's plan: the limit each color hides, and the shuffled order the colors come in. */
  function balloonPlan(rng, balloons) {
    const maxes = shuffle(rng, [...BALLOON_MAXES]);
    const limits = {};
    BALLOON_COLORS.forEach((c, i) => {
      limits[c.id] = maxes[i];
    });
    const order = shuffle(
      rng,
      Array.from({ length: balloons }, (_, i) => BALLOON_COLORS[i % BALLOON_COLORS.length].id),
    );
    return { limits, order };
  }
  const popAt = (rng, max) => int(rng, BALLOON_SAFE + 1, max);
  /** Expected points from always stopping after k pumps: k × 5 × P(survive k). `safe` pumps never pop (0 in old games). */
  const expectedFor = (k, max = BALLOON_MAX, safe = 0) => k * PUMP_POINTS * (k <= safe ? 1 : (max - k) / (max - safe));
  /** The most a perfect plan expects from these rounds: each stopped at half its own limit. */
  const balloonBest = (rounds) => rounds.reduce((t, r) => t + expectedFor(r.max / 2, r.max, BALLOON_SAFE), 0);

  /** Per-color results for a game whose rounds carry their color and limit. */
  function balloonTiers(rounds) {
    return BALLOON_COLORS.map((c) => {
      const rs = rounds.filter((r) => r.color === c.id);
      if (!rs.length) return null;
      const max = rs[0].max;
      const best = max / 2;
      const cashed = rs.filter((r) => r.cashed);
      const avgPumps = cashed.length ? cashed.reduce((t, r) => t + r.pumps, 0) / cashed.length : 0;
      const verdict = !cashed.length || avgPumps > best * 1.3 ? 'late' : avgPumps < best * 0.7 ? 'early' : 'close';
      // Pops are drawn evenly from pump 3 to the limit, so on average a balloon of this color pops at their midpoint.
      const avgPop = (BALLOON_SAFE + 1 + max) / 2;
      return {
        ...c,
        max,
        best,
        avgPop,
        balloons: rs.length,
        cashed: cashed.length,
        popped: rs.length - cashed.length,
        avgPumps,
        verdict,
      };
    })
      .filter(Boolean)
      .sort((a, b) => b.max - a.max);
  }

  function balloonStats(rounds, max = BALLOON_MAX) {
    const cashed = rounds.filter((r) => r.cashed);
    const avgPumps = cashed.length ? cashed.reduce((t, r) => t + r.pumps, 0) / cashed.length : 0;
    if (rounds.some((r) => r.max)) {
      const tiers = balloonTiers(rounds);
      const advice = tiers
        .map((t) =>
          t.verdict === 'close'
            ? `${t.name}: close to the best stop of ${t.best} pumps.`
            : t.verdict === 'early'
              ? `${t.name} pops after ${t.avgPop} pumps on average, so stopping near ${t.best} would earn more than your ${t.avgPumps.toFixed(0)}.`
              : `${t.name} pops after only ${t.avgPop} pumps on average: stop near ${t.best}${t.cashed ? `, not ${t.avgPumps.toFixed(0)}` : ''}.`,
        )
        .join(' ');
      return { cashed: cashed.length, popped: rounds.length - cashed.length, avgPumps, tiers, advice };
    }
    const best = max / 2;
    const advice = !cashed.length
      ? `Every balloon popped: cash in earlier. This game's balloons popped evenly up to ${max} pumps.`
      : avgPumps < best * 0.7
        ? `You cashed in after ${avgPumps.toFixed(0)} pumps on average. This game's pops were spread evenly up to ${max}, so pumping to about ${best} would earn more.`
        : avgPumps > best * 1.3
          ? `You pushed to ${avgPumps.toFixed(0)} pumps on average and lost too many balloons. This game's pops were spread evenly up to ${max}: around ${best} is the sweet spot.`
          : `Close to the best plan: with pops spread evenly up to ${max} this game, stopping near ${best} pumps maximizes points.`;
    return { cashed: cashed.length, popped: rounds.length - cashed.length, avgPumps, best, max, advice };
  }

  /** A saved Balloon game's rounds, read back from its items: pumps, cashed or not, and (games before 1.11.4 only) where it would have popped. */
  function balloonRounds(problems) {
    const num = (s) => {
      const m = /\d+/.exec(s || '');
      return m ? Number(m[0]) : null;
    };
    return problems.map((p) => ({
      cashed: !!p.ok,
      pumps: num(p.g) || 0,
      popAt: num(p.a),
      pts: p.pts || 0,
      ...(p.c ? { color: p.c, max: p.m } : {}),
    }));
  }

  /** How full a balloon looks after `pumps` (0…1). It never reaches 1, so its size says nothing about the hidden limit. */
  const balloonFill = (pumps) => 1 - Math.exp(-pumps / 14);

  return {
    GAMES,
    apply,
    solve,
    numberBox,
    codes,
    codeTime,
    codeDiff,
    codeRun,
    BALLOON_MAXES,
    BALLOON_COLORS,
    BALLOON_SAFE,
    BALLOON_MAX,
    PUMP_POINTS,
    balloonPlan,
    popAt,
    expectedFor,
    balloonBest,
    balloonStats,
    balloonRounds,
    balloonFill,
  };
});
