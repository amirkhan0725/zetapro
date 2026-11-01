// Beat the Odds: generated probability and expected-value questions. Every
// template computes its answer exactly and can also simulate the experiment,
// so the tests check each formula against a Monte Carlo run.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'));
  else root.OAOdds = factory(root.OA);
})(typeof self !== 'undefined' ? self : this, function (OA) {
  'use strict';

  const { int, pick, choose, pct, num } = OA;
  const roll = (rng, d = 6) => 1 + Math.floor(rng() * d);
  const pairs = () => {
    const out = [];
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) out.push([a, b]);
    return out;
  };
  /** Deals `k` cards from a fresh deck: rank 0–12 (0 = ace), suit 0–3 (0 = hearts). */
  function deal(rng, k) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rng() * (52 - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.slice(0, k).map((c) => ({ rank: c % 13, suit: Math.floor(c / 13) }));
  }

  // Each template returns { topic, prompt, value, kind, explain, mistakes, sim }.
  // sim(rng) runs the experiment once: 1/0 for an event, a number for an
  // expectation, or null when a conditioning event didn't happen.
  const TEMPLATES = {
    diceTotal(rng) {
      const atLeast = rng() < 0.5;
      const k = atLeast ? int(rng, 8, 11) : int(rng, 3, 11);
      const hit = (s) => (atLeast ? s >= k : s === k);
      const ways = pairs().filter(([a, b]) => hit(a + b)).length;
      const what = atLeast ? `at least ${k}` : `exactly ${k}`;
      return {
        topic: 'Dice', kind: 'prob', value: ways / 36,
        prompt: `Two fair dice are rolled. What is the probability that the total is ${what}?`,
        explain: `${ways} of the 36 equally likely outcomes give a total of ${what}: ${ways}/36 = ${pct(ways / 36)}.`,
        mistakes: [atLeast ? (13 - k) / 11 : 1 / 11, ways / 30],
        sim: (r) => (hit(roll(r) + roll(r)) ? 1 : 0),
      };
    },

    atLeastOne(rng) {
      const n = int(rng, 2, 6);
      const two = rng() < 0.35;
      const p = two ? 1 / 3 : 1 / 6;
      const face = two ? 'a 5 or a 6' : 'a 6';
      const value = 1 - (1 - p) ** n;
      return {
        topic: 'Dice', kind: 'prob', value,
        prompt: `${n} fair dice are rolled. What is the probability that at least one of them shows ${face}?`,
        explain: `Use the complement: P(no die shows ${face}) = (${two ? '4/6' : '5/6'})^${n} = ${pct(1 - value)}, so the answer is 1 − that = ${pct(value)}.`,
        mistakes: [Math.min(0.99, n * p), p ** n, 1 - p ** n],
        sim: (r) => (Array.from({ length: n }, () => roll(r)).some((v) => v >= (two ? 5 : 6)) ? 1 : 0),
      };
    },

    coins(rng) {
      const n = int(rng, 4, 10);
      const atLeast = rng() < 0.4;
      const k = atLeast ? int(rng, Math.ceil(n / 2) + 1, n - 1) : int(rng, 1, n - 1);
      let ways = 0;
      for (let j = atLeast ? k : k; j <= (atLeast ? n : k); j++) ways += choose(n, j);
      const total = 2 ** n;
      const what = atLeast ? `at least ${k} heads` : `exactly ${k} heads`;
      return {
        topic: 'Coins', kind: 'prob', value: ways / total,
        prompt: `A fair coin is tossed ${n} times. What is the probability of ${what}?`,
        explain: atLeast
          ? `Add C(${n}, j) for j = ${k}…${n}: ${ways} of the 2^${n} = ${total} sequences, so ${ways}/${total} = ${pct(ways / total)}.`
          : `C(${n}, ${k}) = ${ways} of the 2^${n} = ${total} sequences have ${k} heads: ${ways}/${total} = ${pct(ways / total)}.`,
        mistakes: [atLeast ? (n - k + 1) / (n + 1) : 1 / (n + 1), k / n / 2, choose(n, k) / n ** 2],
        sim: (r) => {
          let h = 0;
          for (let i = 0; i < n; i++) if (r() < 0.5) h++;
          return (atLeast ? h >= k : h === k) ? 1 : 0;
        },
      };
    },

    cards(rng) {
      const variants = [
        {
          prompt: 'Two cards are dealt from a well-shuffled 52-card deck. What is the probability that they are the same suit?',
          value: 12 / 51, explain: 'Whatever the first card, 12 of the remaining 51 match its suit: 12/51 = ' + pct(12 / 51) + '.',
          mistakes: [1 / 4, 13 / 52 * 12 / 51], k: 2, test: (h) => h[0].suit === h[1].suit,
        },
        {
          prompt: 'Two cards are dealt from a well-shuffled 52-card deck. What is the probability that both are hearts?',
          value: (13 / 52) * (12 / 51), explain: `13/52 × 12/51 = ${pct((13 / 52) * (12 / 51))} (no replacement).`,
          mistakes: [1 / 16, 13 / 52], k: 2, test: (h) => h[0].suit === 0 && h[1].suit === 0,
        },
        {
          prompt: 'Two cards are dealt from a well-shuffled 52-card deck. What is the probability that they form a pair (same rank)?',
          value: 3 / 51, explain: 'Whatever the first card, 3 of the remaining 51 share its rank: 3/51 = ' + pct(3 / 51) + '.',
          mistakes: [1 / 13, 4 / 52 * 3 / 51], k: 2, test: (h) => h[0].rank === h[1].rank,
        },
        {
          prompt: 'Two cards are dealt from a well-shuffled 52-card deck. What is the probability that the first is red and the second is black?',
          value: (26 / 52) * (26 / 51), explain: `26/52 × 26/51 = ${pct((26 / 52) * (26 / 51))}.`,
          mistakes: [1 / 4, 1 / 2], k: 2, test: (h) => h[0].suit < 2 && h[1].suit >= 2,
        },
      ];
      const k = int(rng, 2, 5);
      const ace = 1 - choose(48, k) / choose(52, k);
      variants.push({
        prompt: `${k} cards are dealt from a well-shuffled 52-card deck. What is the probability that at least one is an ace?`,
        value: ace, explain: `Complement: P(no ace) = C(48, ${k}) / C(52, ${k}) = ${pct(1 - ace)}, so 1 − that = ${pct(ace)}.`,
        mistakes: [k / 13, 1 - (12 / 13) ** k * 0.9], k, test: (h) => h.some((c) => c.rank === 0),
      });
      const v = pick(rng, variants);
      return {
        topic: 'Cards', kind: 'prob', value: v.value, prompt: v.prompt, explain: v.explain, mistakes: v.mistakes,
        sim: (r) => (v.test(deal(r, v.k)) ? 1 : 0),
      };
    },

    urn(rng) {
      const red = int(rng, 3, 8);
      const blue = int(rng, 3, 8);
      const n = red + blue;
      const both = rng() < 0.5;
      const value = both ? (red * (red - 1)) / (n * (n - 1)) : (2 * red * blue) / (n * (n - 1));
      return {
        topic: 'Counting', kind: 'prob', value,
        prompt: `An urn holds ${red} red and ${blue} blue balls. Two are drawn without replacement. What is the probability that ${both ? 'both are red' : 'one is red and one is blue'}?`,
        explain: both
          ? `${red}/${n} × ${red - 1}/${n - 1} = ${pct(value)}.`
          : `Red then blue or blue then red: 2 × ${red}/${n} × ${blue}/${n - 1} = ${pct(value)}.`,
        mistakes: both ? [(red / n) ** 2, red / n] : [2 * (red / n) * (blue / n), (red * blue) / (n * (n - 1))],
        sim: (r) => {
          const first = r() * n < red;
          const left = first ? red - 1 : red;
          const second = r() * (n - 1) < left;
          return (both ? first && second : first !== second) ? 1 : 0;
        },
      };
    },

    bayes(rng) {
      const prev = pick(rng, [0.005, 0.01, 0.02, 0.05, 0.1]);
      const sens = pick(rng, [0.9, 0.95, 0.99]);
      const fpr = pick(rng, [0.01, 0.02, 0.05, 0.1]);
      const value = (prev * sens) / (prev * sens + (1 - prev) * fpr);
      return {
        topic: 'Conditional', kind: 'prob', value,
        prompt: `A condition affects ${pct(prev)} of people. A test detects it ${pct(sens)} of the time when present, and gives a false positive ${pct(fpr)} of the time when absent. Someone tests positive. What is the probability they have the condition?`,
        explain: `P(pos) = ${prev} × ${sens} + ${1 - prev} × ${fpr}. The true-positive share is ${num(prev * sens, 4)} ÷ ${num(prev * sens + (1 - prev) * fpr, 4)} = ${pct(value)}.`,
        mistakes: [sens, 1 - fpr, prev * sens],
        sim: (r) => {
          const ill = r() < prev;
          const pos = ill ? r() < sens : r() < fpr;
          return pos ? (ill ? 1 : 0) : null;
        },
      };
    },

    birthday(rng) {
      const months = rng() < 0.35;
      const days = months ? 12 : 365;
      const k = months ? int(rng, 3, 6) : pick(rng, [5, 10, 15, 20, 23, 25, 30, 40]);
      let none = 1;
      for (let i = 0; i < k; i++) none *= (days - i) / days;
      const value = 1 - none;
      const unit = months ? 'birth month (12 equally likely months)' : 'birthday (365 equally likely days)';
      return {
        topic: 'Counting', kind: 'prob', value,
        prompt: `There are ${k} people in a room. What is the probability that at least two share a ${unit}?`,
        explain: `P(all different) = ${days}/${days} × ${days - 1}/${days} × … × ${days - k + 1}/${days} = ${pct(none)}, so the answer is ${pct(value)}.`,
        mistakes: [Math.min(0.99, (k * (k - 1)) / 2 / days), Math.min(0.99, k / days)],
        sim: (r) => {
          const seen = new Set();
          for (let i = 0; i < k; i++) {
            const b = Math.floor(r() * days);
            if (seen.has(b)) return 1;
            seen.add(b);
          }
          return 0;
        },
      };
    },

    maxMin(rng) {
      const n = pick(rng, [2, 2, 3]);
      const max = rng() < 0.6;
      let value = 0;
      for (let j = 1; j <= 6; j++) value += max ? 1 - ((j - 1) / 6) ** n : ((7 - j) / 6) ** n;
      return {
        topic: 'Expected value', kind: 'num', value,
        prompt: `${n} fair dice are rolled. What is the expected value of the ${max ? 'highest' : 'lowest'} number shown?`,
        explain: `E = Σ P(${max ? 'max' : 'min'} ≥ j) for j = 1…6 = ${max ? `Σ [1 − ((j−1)/6)^${n}]` : `Σ ((7−j)/6)^${n}`} = ${num(value)}.`,
        mistakes: [3.5, max ? 6 * n / (n + 1) : 6 / (n + 1), max ? 5 : 2],
        sim: (r) => {
          const v = Array.from({ length: n }, () => roll(r));
          return max ? Math.max(...v) : Math.min(...v);
        },
      };
    },

    waiting(rng) {
      // Expected waits for a pattern (Conway): Σ A^k over every k where the
      // pattern's first k symbols equal its last k.
      const coin = rng() < 0.6;
      const pattern = coin ? pick(rng, ['HH', 'HT', 'HHH', 'HTH', 'HHT']) : pick(rng, ['6', '66', '61']);
      const A = coin ? 2 : 6;
      let value = 0;
      for (let k = 1; k <= pattern.length; k++) if (pattern.slice(0, k) === pattern.slice(-k)) value += A ** k;
      const shown = coin ? pattern.split('').join('') : pattern.split('').join(' then ');
      const prompt = coin
        ? `A fair coin is tossed until the sequence ${shown} first appears. What is the expected number of tosses?`
        : pattern.length === 1 ? 'A fair die is rolled until the first 6. What is the expected number of rolls?'
          : `A fair die is rolled until ${pattern === '66' ? 'two 6s in a row appear' : 'a 6 is immediately followed by a 1'}. What is the expected number of rolls?`;
      return {
        topic: 'Expected value', kind: 'num', value,
        prompt,
        explain: pattern.length === 1
          ? 'A geometric wait with p = 1/6 has mean 1/p = 6.'
          : `Overlaps matter: add ${A}^k for every k where the first k symbols of ${pattern} equal the last k, giving ${value}.`,
        mistakes: [A ** pattern.length, coin ? (pattern === 'HT' ? 6 : 4) : 36, A * pattern.length],
        sim: (r) => {
          let tail = '';
          for (let t = 1; t < 20000; t++) {
            tail = (tail + (coin ? (r() < 0.5 ? 'H' : 'T') : String(roll(r)))).slice(-pattern.length);
            if (tail === pattern) return t;
          }
          return 20000;
        },
      };
    },

    coupon(rng) {
      const d = pick(rng, [4, 6, 8]);
      let value = 0;
      for (let i = 1; i <= d; i++) value += d / i;
      return {
        topic: 'Expected value', kind: 'num', value,
        prompt: `A fair ${d}-sided die is rolled until every face has appeared at least once. What is the expected number of rolls?`,
        explain: `Once i faces are seen, the next new face takes ${d}/(${d}−i) rolls on average. Summing: ${d} × (1 + 1/2 + … + 1/${d}) = ${num(value)}.`,
        mistakes: [d * d / 2, d * 2, d * Math.log(d)],
        sim: (r) => {
          const seen = new Set();
          let t = 0;
          while (seen.size < d) {
            seen.add(roll(r, d));
            t++;
          }
          return t;
        },
      };
    },

    ruin(rng) {
      const N = int(rng, 6, 12);
      const a = int(rng, 2, N - 2);
      const fair = rng() < 0.5;
      const p = fair ? 0.5 : pick(rng, [0.4, 0.45, 0.55, 0.6]);
      const q = 1 - p;
      const value = fair ? a / N : (1 - (q / p) ** a) / (1 - (q / p) ** N);
      return {
        topic: 'Random walks', kind: 'prob', value,
        prompt: `You have $${a} and bet $1 at a time, winning each bet with probability ${pct(p)}. You stop at $0 or $${N}. What is the probability you reach $${N}?`,
        explain: fair
          ? `For a fair game the chance of reaching N before 0 is a/N = ${a}/${N} = ${pct(value)}.`
          : `Gambler's ruin with r = q/p = ${num(q / p, 3)}: (1 − r^${a}) / (1 − r^${N}) = ${pct(value)}.`,
        mistakes: [fair ? 1 - a / N : a / N, p, fair ? 0.5 : 1 - value],
        sim: (r) => {
          let x = a;
          while (x > 0 && x < N) x += r() < p ? 1 : -1;
          return x === N ? 1 : 0;
        },
      };
    },

    reroll(rng) {
      const d = pick(rng, [6, 6, 8, 10, 12, 20]);
      const rerolls = pick(rng, [1, 1, 2]);
      // V[j]: expected payout about to roll with j rerolls still to come.
      const V = [(d + 1) / 2];
      for (let j = 1; j <= rerolls; j++) {
        let s = 0;
        for (let f = 1; f <= d; f++) s += Math.max(f, V[j - 1]);
        V.push(s / d);
      }
      const value = V[rerolls];
      return {
        topic: 'Expected value', kind: 'num', value,
        prompt: `You roll a fair ${d}-sided die and are paid the number shown in dollars. You may reroll up to ${rerolls === 1 ? 'once' : 'twice'}, but must keep your last roll. With the best strategy, what is your expected payout?`,
        explain: `Without rerolls a roll is worth ${num(V[0])}. Keep a roll only if it beats the value of rolling again${rerolls === 2 ? ` (${num(V[0])}, then ${num(V[1])} with one reroll left)` : ` (${num(V[0])})`}. Averaging max(roll, continue value) gives ${num(value)}.`,
        mistakes: [V[0], V[0] + rerolls, d * 0.75],
        sim: (r) => {
          let left = rerolls;
          let f = roll(r, d);
          while (left > 0 && f < V[left - 1]) {
            left--;
            f = roll(r, d);
          }
          return f;
        },
      };
    },

    hats(rng) {
      const n = int(rng, 3, 8);
      const D = [1, 0];
      for (let i = 2; i <= n; i++) D.push((i - 1) * (D[i - 1] + D[i - 2]));
      let fact = 1;
      for (let i = 2; i <= n; i++) fact *= i;
      const exactlyOne = rng() < 0.35;
      const value = exactlyOne ? (n * D[n - 1]) / fact : D[n] / fact;
      return {
        topic: 'Counting', kind: 'prob', value,
        prompt: `${n} people put their hats in a box and each takes one at random. What is the probability that ${exactlyOne ? 'exactly one person' : 'nobody'} gets their own hat?`,
        explain: exactlyOne
          ? `Choose who matches (${n} ways), then derange the other ${n - 1}: ${n} × D(${n - 1}) / ${n}! = ${n} × ${D[n - 1]} / ${fact} = ${pct(value)}.`
          : `Derangements: D(${n}) = ${D[n]} of the ${n}! = ${fact} orderings leave nobody with their own hat: ${pct(value)}.`,
        mistakes: [(1 - 1 / n) ** n, 1 / n, Math.exp(-1) * (exactlyOne ? 0.6 : 1.4)],
        sim: (r) => {
          const perm = Array.from({ length: n }, (_, i) => i);
          for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
          }
          const fixed = perm.filter((v, i) => v === i).length;
          return (exactlyOne ? fixed === 1 : fixed === 0) ? 1 : 0;
        },
      };
    },

    distinct(rng) {
      const n = int(rng, 3, 10);
      const value = 6 * (1 - (5 / 6) ** n);
      return {
        topic: 'Expected value', kind: 'num', value,
        prompt: `A fair die is rolled ${n} times. What is the expected number of different faces that appear?`,
        explain: `Linearity: each face appears with probability 1 − (5/6)^${n}, so E = 6 × (1 − (5/6)^${n}) = ${num(value)}.`,
        mistakes: [Math.min(6, n), Math.min(6, n * 5 / 6), 6 * (1 - (1 / 6) ** n)],
        sim: (r) => new Set(Array.from({ length: n }, () => roll(r))).size,
      };
    },

    conditional(rng) {
      const conds = [
        ['at least one die shows a 6', (a, b) => a === 6 || b === 6],
        ['the total is 8', (a, b) => a + b === 8],
        ['the first die is even', (a) => a % 2 === 0],
        ['the dice show different numbers', (a, b) => a !== b],
        ['the total is at least 9', (a, b) => a + b >= 9],
      ];
      const events = [
        ['both dice show 6', (a, b) => a === 6 && b === 6],
        ['the total is at least 10', (a, b) => a + b >= 10],
        ['at least one die shows a 3', (a, b) => a === 3 || b === 3],
        ['the total is even', (a, b) => (a + b) % 2 === 0],
        ['at least one die shows a 5', (a, b) => a === 5 || b === 5],
      ];
      let c;
      let e;
      let given;
      let both;
      for (let tries = 0; tries < 50; tries++) {
        c = pick(rng, conds);
        e = pick(rng, events);
        given = pairs().filter(([a, b]) => c[1](a, b)).length;
        both = pairs().filter(([a, b]) => c[1](a, b) && e[1](a, b)).length;
        if (both > 0 && both < given) break;
      }
      const value = both / given;
      const plain = pairs().filter(([a, b]) => e[1](a, b)).length / 36;
      return {
        topic: 'Conditional', kind: 'prob', value,
        prompt: `Two fair dice are rolled. Given that ${c[0]}, what is the probability that ${e[0]}?`,
        explain: `${given} of the 36 outcomes have ${c[0]}; ${both} of those also have ${e[0]}: ${both}/${given} = ${pct(value)}.`,
        mistakes: [plain, both / 36],
        sim: (r) => {
          const a = roll(r);
          const b = roll(r);
          if (!c[1](a, b)) return null;
          return e[1](a, b) ? 1 : 0;
        },
      };
    },

    bet(rng) {
      const cost = int(rng, 1, 5);
      const doubles = rng() < 0.4;
      const pay = doubles ? int(rng, 6, 15) * 2 : int(rng, 4, 12) * 2;
      const p = 1 / 6; // a 6 on one die, or doubles on two
      const value = p * pay - cost;
      const what = doubles ? 'roll two dice; doubles pay' : 'roll one die; a 6 pays';
      return {
        topic: 'Expected value', kind: 'num', value,
        prompt: `A game costs $${cost} to play: ${what} $${pay}, anything else pays nothing. What is your expected profit per game?`,
        explain: `${doubles ? 'Doubles come up 6/36 = 1/6 of the time' : 'A 6 comes up 1/6 of the time'}: ${pay}/6 − ${cost} = ${num(value)}.`,
        mistakes: [p * pay, p * (pay - cost), p * pay - (5 / 6) * cost],
        sim: (r) => {
          const win = doubles ? roll(r) === roll(r) : roll(r) === 6;
          return (win ? pay : 0) - cost;
        },
      };
    },
  };

  const NAMES = Object.keys(TEMPLATES);

  /** A full question ready to show: the template's facts plus five options. */
  function build(rng, name) {
    const t = TEMPLATES[name](rng);
    const opts = OA.options(rng, t.value, { kind: t.kind, mistakes: t.mistakes });
    return {
      kind: 'choice', template: name, topic: t.topic, prompt: t.prompt, explain: t.explain,
      options: opts.options, correct: opts.correct, answer: opts.options[opts.correct],
    };
  }

  /** `n` questions cycling through every template in a shuffled order. */
  function set(rng, n) {
    const out = [];
    let order = [];
    while (out.length < n) {
      if (!order.length) order = OA.shuffle(rng, NAMES);
      out.push(build(rng, order.pop()));
    }
    return out;
  }

  return { TEMPLATES, NAMES, build, set };
});
