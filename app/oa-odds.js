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
  /** Ways two dice make a total of s. */
  const ways2 = (s) => (s < 2 || s > 12 ? 0 : 6 - Math.abs(s - 7));
  /** a…b inclusive. */
  const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  /** "2, 3 or 12". */
  const orList = (xs) => (xs.length === 1 ? String(xs[0]) : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
  /** A worked solution: one step per line (Learn mode shows each on its own line). */
  const lines = (...xs) => xs.filter(Boolean).join('\n');
  const big = (n) => Math.round(n).toLocaleString('en-US');
  /** Deals `k` cards from a fresh deck: rank 0–12 (0 = ace), suit 0–3 (0 = hearts). */
  function deal(rng, k) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rng() * (52 - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.slice(0, k).map((c) => ({ rank: c % 13, suit: Math.floor(c / 13) }));
  }

  // Each template returns { topic, prompt, value, kind, explain, mistakes, sim },
  // and an expectation also its outcome's smallest and largest values as `range`,
  // so no option is one the answer can't take.
  // A mistake is a value a common slip gives, or [value, why] where `why` names
  // the slip ("adding the chances instead of using the complement"), so Learn
  // mode can say which slip a wrong pick came from.
  // `explain` is a worked solution, one step per line. `scene` (optional) is a
  // small picture of the setup: dice, coins, cards, an urn or a walk.
  // sim(rng) runs the experiment once: 1/0 for an event, a number for an
  // expectation, or null when a conditioning event didn't happen.
  const TEMPLATES = {
    diceTotal(rng) {
      const atLeast = rng() < 0.5;
      const k = atLeast ? int(rng, 8, 11) : int(rng, 3, 11);
      const hit = (s) => (atLeast ? s >= k : s === k);
      const good = pairs().filter(([a, b]) => hit(a + b));
      const ways = good.length;
      const unordered = good.filter(([a, b]) => a <= b).length;
      const what = atLeast ? `at least ${k}` : `exactly ${k}`;
      return {
        topic: 'Dice', kind: 'prob', value: ways / 36,
        prompt: `Two fair dice are rolled. What is the probability that the total is ${what}?`,
        explain: lines(
          'Two dice give 6 × 6 = 36 equally likely ordered outcomes (2+6 and 6+2 are different).',
          atLeast
            ? `Ways for each total: ${span(k, 12).map((s) => `${s} → ${ways2(s)}`).join(', ')}. That makes ${ways}.`
            : `They are ${good.map(([a, b]) => `${a}+${b}`).join(', ')}: ${ways} in all.`,
          `${ways}/36 = ${pct(ways / 36)}.`,
        ),
        mistakes: [
          [atLeast ? (13 - k) / 11 : 1 / 11, 'treating the 11 totals from 2 to 12 as equally likely'],
          [unordered / 36, 'counting 2+6 and 6+2 as one outcome'],
          [unordered / 21, 'treating the 21 unordered pairs as equally likely'],
        ],
        scene: { type: 'dice', n: 2 },
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
        explain: lines(
          `"At least one" is easiest through the complement: no die shows ${face}.`,
          `Each die misses with probability ${two ? '4/6' : '5/6'}, so all ${n} miss with (${two ? '4/6' : '5/6'})^${n} = ${pct(1 - value)}.`,
          `1 − ${pct(1 - value)} = ${pct(value)}.`,
        ),
        mistakes: [
          [Math.min(0.99, n * p), `adding ${two ? '1/3' : '1/6'} once per die instead of using the complement`],
          [p ** n, `the chance that every die shows ${face}`],
          [1 - p ** n, 'complementing the wrong event (not all of them, instead of none of them)'],
        ],
        scene: { type: 'dice', n },
        sim: (r) => (Array.from({ length: n }, () => roll(r)).some((v) => v >= (two ? 5 : 6)) ? 1 : 0),
      };
    },

    coins(rng) {
      const n = int(rng, 4, 10);
      const atLeast = rng() < 0.4;
      const k = atLeast ? int(rng, Math.ceil(n / 2) + 1, n - 1) : int(rng, 1, n - 1);
      let ways = 0;
      for (let j = k; j <= (atLeast ? n : k); j++) ways += choose(n, j);
      const total = 2 ** n;
      const what = atLeast ? `at least ${k} heads` : `exactly ${k} heads`;
      return {
        topic: 'Coins', kind: 'prob', value: ways / total,
        prompt: `A fair coin is tossed ${n} times. What is the probability of ${what}?`,
        explain: lines(
          `All 2^${n} = ${total} sequences of heads and tails are equally likely.`,
          atLeast
            ? `Those with ${k} or more heads: ${span(k, n).map((j) => `C(${n}, ${j})`).join(' + ')} = ${span(k, n).map((j) => choose(n, j)).join(' + ')} = ${ways}.`
            : `Choose which ${k} of the ${n} tosses are heads: C(${n}, ${k}) = ${ways} sequences.`,
          `${ways}/${total} = ${pct(ways / total)}.`,
        ),
        mistakes: atLeast
          ? [
            [(n - k + 1) / (n + 1), `treating the ${n + 1} possible head counts as equally likely`],
            [choose(n, k) / total, `counting exactly ${k} heads, not ${k} or more`],
            [1 - ways / total, `the chance of fewer than ${k} heads, the complement`],
          ]
          : [
            [1 / (n + 1), `treating the ${n + 1} possible head counts as equally likely`],
            [1 / total, `counting one sequence and forgetting the C(${n}, ${k}) orders`],
            choose(n, k) / n ** 2,
          ],
        scene: { type: 'coins', n },
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
          value: 12 / 51,
          explain: lines('The first card can be anything.', 'Of the 51 cards left, 12 share its suit.', `12/51 = ${pct(12 / 51)}.`),
          mistakes: [[1 / 4, '1/4, as if the first card went back in the deck'], [13 / 52 * 12 / 51, 'the chance both are one named suit, not any matching suit']],
          k: 2, test: (h) => h[0].suit === h[1].suit,
        },
        {
          prompt: 'Two cards are dealt from a well-shuffled 52-card deck. What is the probability that both are hearts?',
          value: (13 / 52) * (12 / 51),
          explain: lines('First card a heart: 13/52.', 'Then 12 hearts remain among 51 cards: 12/51.', `13/52 × 12/51 = ${pct((13 / 52) * (12 / 51))}.`),
          mistakes: [[1 / 16, '1/4 × 1/4, as if the first card went back in the deck'], [13 / 52, 'the chance for one card only']],
          k: 2, test: (h) => h[0].suit === 0 && h[1].suit === 0,
        },
        {
          prompt: 'Two cards are dealt from a well-shuffled 52-card deck. What is the probability that they form a pair (same rank)?',
          value: 3 / 51,
          explain: lines('The first card can be anything.', 'Of the 51 cards left, 3 share its rank.', `3/51 = ${pct(3 / 51)}.`),
          mistakes: [[1 / 13, '1/13, as if the first card went back in the deck'], [4 / 52 * 3 / 51, 'the chance of a pair of one named rank, not any rank']],
          k: 2, test: (h) => h[0].rank === h[1].rank,
        },
        {
          prompt: 'Two cards are dealt from a well-shuffled 52-card deck. What is the probability that the first is red and the second is black?',
          value: (26 / 52) * (26 / 51),
          explain: lines('First card red: 26/52.', 'All 26 black cards are still among the 51 left: 26/51.', `26/52 × 26/51 = ${pct((26 / 52) * (26 / 51))}.`),
          mistakes: [[1 / 4, '1/2 × 1/2, as if the first card went back in the deck'], [(2 * 26 * 26) / (52 * 51), 'one of each color in either order, though the order is fixed here']],
          k: 2, test: (h) => h[0].suit < 2 && h[1].suit >= 2,
        },
      ];
      const k = int(rng, 2, 5);
      const ace = 1 - choose(48, k) / choose(52, k);
      variants.push({
        prompt: `${k} cards are dealt from a well-shuffled 52-card deck. What is the probability that at least one is an ace?`,
        value: ace,
        explain: lines(
          `Use the complement: none of the ${k} cards is an ace.`,
          `${span(0, k - 1).map((i) => `${48 - i}/${52 - i}`).join(' × ')} = ${pct(1 - ace)}.`,
          `1 − ${pct(1 - ace)} = ${pct(ace)}.`,
        ),
        mistakes: [[k / 13, `adding 1/13 once per card instead of using the complement`], 1 - (12 / 13) ** k * 0.9],
        k, test: (h) => h.some((c) => c.rank === 0),
      });
      const v = pick(rng, variants);
      return {
        topic: 'Cards', kind: 'prob', value: v.value, prompt: v.prompt, explain: v.explain, mistakes: v.mistakes,
        scene: { type: 'cards', n: v.k },
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
          ? lines(`First red: ${red}/${n}.`, `Then ${red - 1} reds are left among ${n - 1} balls: ${red - 1}/${n - 1}.`, `${red}/${n} × ${red - 1}/${n - 1} = ${pct(value)}.`)
          : lines(`Red then blue: ${red}/${n} × ${blue}/${n - 1}. Blue then red: ${blue}/${n} × ${red}/${n - 1}, the same.`, `Add both orders: 2 × ${red * blue}/${n * (n - 1)} = ${pct(value)}.`),
        mistakes: both
          ? [[(red / n) ** 2, 'drawing with replacement'], [red / n, 'the chance for one draw only']]
          : [[2 * (red / n) * (blue / n), 'drawing with replacement'], [(red * blue) / (n * (n - 1)), 'counting red then blue only, forgetting blue then red']],
        scene: { type: 'urn', red, blue },
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
      // Natural frequencies: every count is a whole number out of 100,000.
      const N = 100000;
      const ill = Math.round(prev * N);
      const tp = Math.round(ill * sens);
      const fp = Math.round((N - ill) * fpr);
      return {
        topic: 'Conditional', kind: 'prob', value,
        prompt: `A condition affects ${pct(prev)} of people. A test detects it ${pct(sens)} of the time when present, and gives a false positive ${pct(fpr)} of the time when absent. Someone tests positive. What is the probability they have the condition?`,
        explain: lines(
          `Picture ${big(N)} people: ${big(ill)} have the condition and ${big(N - ill)} don't.`,
          `${pct(sens)} of the ${big(ill)} test positive: ${big(tp)} true positives.`,
          `${pct(fpr)} of the ${big(N - ill)} test positive: ${big(fp)} false positives.`,
          `Of the ${big(tp + fp)} positives, ${big(tp)} have it: ${pct(value)}.`,
        ),
        mistakes: [
          [sens, 'the detection rate, P(positive | condition), which is not P(condition | positive)'],
          [1 - fpr, 'one minus the false-positive rate'],
          [prev * sens, 'the share of everyone who has it and tests positive, without dividing by all positives'],
        ],
        sim: (r) => {
          const sick = r() < prev;
          const pos = sick ? r() < sens : r() < fpr;
          return pos ? (sick ? 1 : 0) : null;
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
        explain: lines(
          'Use the complement: everyone different.',
          `Person 2 misses person 1 with ${days - 1}/${days}, person 3 misses both with ${days - 2}/${days}, and so on down to ${days - k + 1}/${days}.`,
          `Multiplied: P(all different) = ${pct(none)}.`,
          `1 − ${pct(none)} = ${pct(value)}.`,
        ),
        mistakes: [
          [Math.min(0.99, (k * (k - 1)) / 2 / days), `adding 1/${days} for each of the ${(k * (k - 1)) / 2} pairs, which counts overlaps twice`],
          [Math.min(0.99, k / days), `${k}/${days}, the chance that someone matches one fixed ${months ? 'month' : 'day'}`],
        ],
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
      const D = 6 ** n;
      const terms = span(1, 6).map((j) => (max ? D - (j - 1) ** n : (7 - j) ** n));
      const S = terms.reduce((s, v) => s + v, 0);
      const value = S / D;
      const word = max ? 'highest' : 'lowest';
      return {
        topic: 'Expected value', kind: 'num', value, range: [1, 6],
        prompt: `${n} fair dice are rolled. What is the expected value of the ${word} number shown?`,
        explain: lines(
          'For a whole number from 1 to 6, E[X] = P(X ≥ 1) + P(X ≥ 2) + … + P(X ≥ 6).',
          max ? `The highest is at least j unless every die is below j: 1 − ((j − 1)/6)^${n}.` : `The lowest is at least j only if every die is: ((7 − j)/6)^${n}.`,
          `In ${D}ths: ${terms.join(' + ')} = ${S}.`,
          `E = ${S}/${D} = ${num(value)}.`,
        ),
        mistakes: [
          [3.5, 'the average of a single die'],
          [max ? 6 * n / (n + 1) : 6 / (n + 1), `the formula for numbers spread evenly from 0 to 6, not whole numbers 1 to 6`],
          max ? 5 : 2,
        ],
        scene: { type: 'dice', n },
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
      const ks = span(1, pattern.length).filter((k) => pattern.slice(0, k) === pattern.slice(-k));
      const value = ks.reduce((s, k) => s + A ** k, 0);
      const prompt = coin
        ? `A fair coin is tossed until the sequence ${pattern} first appears. What is the expected number of tosses?`
        : pattern.length === 1 ? 'A fair die is rolled until the first 6. What is the expected number of rolls?'
          : `A fair die is rolled until ${pattern === '66' ? 'two 6s in a row appear' : 'a 6 is immediately followed by a 1'}. What is the expected number of rolls?`;
      const note = {
        HH: 'HH takes longer than HT: a T after the first H sends you all the way back to the start.',
        HT: 'HT is quick: once you have an H, any extra H keeps you one step away.',
        66: 'Same idea as HH: a miss after the first 6 sends you back to the start.',
      }[pattern];
      return {
        topic: 'Expected value', kind: 'num', value, range: [pattern.length, Infinity],
        prompt,
        explain: pattern.length === 1
          ? lines('Each roll is a 6 with probability 1/6, independently.', 'The wait for the first success has mean 1/p = 6.')
          : lines(
            `Add ${A}^k for every k where the first k ${coin ? 'tosses' : 'rolls'} of the pattern match its last k (where it overlaps itself).`,
            `Here k = ${ks.join(' and ')}: ${ks.map((k) => `${A}^${k}`).join(' + ')} = ${value}.`,
            note,
          ),
        mistakes: [
          [A ** pattern.length, `${A}^${pattern.length}, which ignores how the pattern overlaps itself`],
          coin ? (pattern === 'HT' ? 6 : 4) : 36,
          A * pattern.length,
        ],
        scene: coin ? { type: 'coins', seq: pattern } : { type: 'dice', faces: pattern.split('').map(Number) },
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
        topic: 'Expected value', kind: 'num', value, range: [d, Infinity],
        prompt: `A fair ${d}-sided die is rolled until every face has appeared at least once. What is the expected number of rolls?`,
        explain: lines(
          `With i faces seen, a roll shows a new face with probability (${d} − i)/${d}, so the next new face takes ${d}/(${d} − i) rolls on average.`,
          `Add the waits: ${span(0, d - 1).map((i) => `${d}/${d - i}`).join(' + ')}.`,
          `That is ${d} × (1 + 1/2 + … + 1/${d}) = ${num(value)}.`,
        ),
        mistakes: [d * d / 2, d * 2, [d * Math.log(d), `${d} × ln ${d}, the large-die shortcut, which runs short for small dice`]],
        scene: { type: 'dice', n: 1, sides: d },
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
      const ratio = q / p;
      const value = fair ? a / N : (1 - ratio ** a) / (1 - ratio ** N);
      return {
        topic: 'Random walks', kind: 'prob', value,
        prompt: `You have $${a} and bet $1 at a time, winning each bet with probability ${pct(p)}. You stop at $0 or $${N}. What is the probability you reach $${N}?`,
        explain: fair
          ? lines(`A fair game keeps your expected money where it started: $${a}.`, `So P(reach $${N}) × ${N} + P(broke) × 0 = ${a}, giving ${a}/${N} = ${pct(value)}.`)
          : lines(
            `With r = q/p = ${num(q, 2)}/${num(p, 2)} = ${num(ratio, 3)}, the chance of reaching $${N} from $${a} is (1 − r^${a}) / (1 − r^${N}).`,
            `(1 − ${num(ratio ** a, 4)}) / (1 − ${num(ratio ** N, 4)}) = ${pct(value)}.`,
            `Compare a fair game's ${a}/${N} = ${pct(a / N)}: a small edge ${p < 0.5 ? 'against you' : 'in your favor'} compounds over many bets.`,
          ),
        mistakes: fair
          ? [[1 - a / N, 'the chance of going broke instead'], [p, 'the chance of winning a single bet'], 0.5]
          : [[a / N, `${a}/${N}, the answer only for a fair game`], [p, 'the chance of winning a single bet'], [1 - value, 'the chance of going broke instead']],
        scene: { type: 'walk', a, N },
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
        topic: 'Expected value', kind: 'num', value, range: [1, d],
        prompt: `You roll a fair ${d}-sided die and are paid the number shown in dollars. You may reroll up to ${rerolls === 1 ? 'once' : 'twice'}, but must keep your last roll. With the best strategy, what is your expected payout?`,
        explain: lines(
          `Work backward. With no rerolls left, a roll is worth its average: (1 + ${d})/2 = ${num(V[0])}.`,
          ...span(1, rerolls).map((j) => `With ${j} reroll${j > 1 ? 's' : ''} left, keep any roll above ${num(V[j - 1])} and reroll the rest: the average of max(roll, ${num(V[j - 1])}) is ${num(V[j])}.`),
        ),
        mistakes: [[V[0], 'a single roll’s average, as if you never rerolled'], V[0] + rerolls, d * 0.75],
        scene: { type: 'dice', n: 1, sides: d },
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
      const rule = 'D(n) counts the ways nobody matches: D(1) = 0, D(2) = 1, D(n) = (n − 1)(D(n − 1) + D(n − 2)).';
      return {
        topic: 'Counting', kind: 'prob', value,
        prompt: `${n} people put their hats in a box and each takes one at random. What is the probability that ${exactlyOne ? 'exactly one person' : 'nobody'} gets their own hat?`,
        explain: exactlyOne
          ? lines(`Pick the one person who matches: ${n} ways.`, `The other ${n - 1} must all miss: D(${n - 1}) = ${D[n - 1]} ways. ${rule}`, `${n} × ${D[n - 1]} out of ${n}! = ${fact}: ${pct(value)}.`)
          : lines(rule, `D(${n}) = ${D[n]} of the ${n}! = ${fact} ways to hand out the hats.`, `${D[n]}/${fact} = ${pct(value)}, close to 1/e ≈ 36.8% once n passes 4.`),
        mistakes: [
          exactlyOne
            ? [(1 - 1 / n) ** (n - 1), 'treating each person’s match as independent of the others']
            : [(1 - 1 / n) ** n, 'treating each person’s match as independent of the others'],
          [1 / n, 'the chance that one given person gets their own hat'],
          Math.exp(-1) * (exactlyOne ? 0.6 : 1.4),
        ],
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
      const each = 1 - (5 / 6) ** n;
      const value = 6 * each;
      return {
        topic: 'Expected value', kind: 'num', value, range: [1, Math.min(6, n)],
        prompt: `A fair die is rolled ${n} times. What is the expected number of different faces that appear?`,
        explain: lines(
          'Count face by face and add (linearity of expectation).',
          `A given face shows up at least once with probability 1 − (5/6)^${n} = ${num(each, 4)}.`,
          `Six faces: 6 × ${num(each, 4)} = ${num(value)}.`,
        ),
        mistakes: [
          [Math.min(6, n), 'assuming no face repeats'],
          Math.min(6, n * 5 / 6),
          [6 * (1 - (1 / 6) ** n), `using (1/6)^${n} where (5/6)^${n} belongs`],
        ],
        scene: { type: 'dice', n: 1 },
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
        explain: lines(
          `Keep only the ${given} of the 36 outcomes where ${c[0]}; they stay equally likely.`,
          `In ${both} of them, ${e[0]}.`,
          `${both}/${given} = ${pct(value)}.`,
        ),
        mistakes: [[plain, 'the chance without the condition'], [both / 36, `dividing by all 36 outcomes instead of the ${given} that meet the condition`]],
        scene: { type: 'dice', n: 2 },
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
        topic: 'Expected value', kind: 'num', value, range: [-cost, pay - cost],
        prompt: `A game costs $${cost} to play: ${what} $${pay}, anything else pays nothing. What is your expected profit per game?`,
        explain: lines(
          `You win with probability 1/6${doubles ? ' (6 doubles out of 36 rolls)' : ''}, so the average payout is ${pay}/6 = ${num(pay / 6)}.`,
          `The $${cost} is paid every game, win or lose.`,
          `${num(pay / 6)} − ${cost} = ${num(value)}.`,
        ),
        mistakes: [
          [p * pay, 'the average payout, forgetting the cost to play'],
          [p * (pay - cost), 'taking off the cost only when you win'],
          [p * pay - (5 / 6) * cost, 'taking off the cost only when you lose'],
        ],
        scene: { type: 'dice', n: doubles ? 2 : 1 },
        sim: (r) => {
          const win = doubles ? roll(r) === roll(r) : roll(r) === 6;
          return (win ? pay : 0) - cost;
        },
      };
    },
  };

  // ---- harder families (calibrated to reports of the real test) -----------------

  Object.assign(TEMPLATES, {
    threeDice(rng) {
      const atLeast = rng() < 0.5;
      const k = atLeast ? int(rng, 12, 16) : int(rng, 6, 15);
      const hit = (s) => (atLeast ? s >= k : s === k);
      const per = {};
      let ways = 0;
      let unordered = 0;
      for (let a = 1; a <= 6; a++) {
        for (let b = 1; b <= 6; b++) {
          for (let c = 1; c <= 6; c++) {
            per[a + b + c] = (per[a + b + c] || 0) + 1;
            if (!hit(a + b + c)) continue;
            ways++;
            if (a <= b && b <= c) unordered++;
          }
        }
      }
      const what = atLeast ? `at least ${k}` : `exactly ${k}`;
      return {
        topic: 'Dice', kind: 'prob', value: ways / 216,
        prompt: `Three fair dice are rolled. What is the probability that the total is ${what}?`,
        explain: lines(
          'Three dice give 6³ = 216 equally likely ordered outcomes.',
          atLeast
            ? `Ways for each total: ${span(k, 18).map((s) => `${s} → ${per[s]}`).join(', ')}. That makes ${ways}.`
            : `Count ordered rolls (1+2+3 counts in all 6 orders): a total of ${k} comes up ${ways} ways.`,
          `${ways}/216 = ${pct(ways / 216)}.`,
        ),
        mistakes: [
          [atLeast ? (19 - k) / 16 : 1 / 16, 'treating the 16 totals from 3 to 18 as equally likely'],
          [unordered / 56, 'treating the 56 unordered rolls as equally likely'],
          (ways + 6) / 216,
        ],
        scene: { type: 'dice', n: 3 },
        sim: (r) => (hit(roll(r) + roll(r) + roll(r)) ? 1 : 0),
      };
    },

    takeTurns(rng) {
      const v = pick(rng, [
        { p: 1 / 6, pf: '1/6', qf: '5/6', act: 'rolling a fair die', win: 'rolls a 6', scene: { type: 'dice', n: 1 } },
        { p: 1 / 3, pf: '1/3', qf: '2/3', act: 'rolling a fair die', win: 'rolls a 5 or a 6', scene: { type: 'dice', n: 1 } },
        { p: 1 / 2, pf: '1/2', qf: '1/2', act: 'tossing a fair coin', win: 'tosses heads', scene: { type: 'coins', n: 1 } },
        { p: 1 / 4, pf: '1/4', qf: '3/4', act: 'drawing a card from a full deck (replacing it each time)', win: 'draws a heart', scene: { type: 'cards', n: 1 } },
      ]);
      const players = pick(rng, [2, 2, 3]);
      const pos = players === 2 ? pick(rng, [1, 2]) : pick(rng, [1, 2, 3]);
      const q = 1 - v.p;
      const firstRound = v.p * q ** (pos - 1);
      const value = firstRound / (1 - q ** players);
      return {
        topic: 'Conditional', kind: 'prob', value,
        prompt: `${players} players take turns ${v.act}, player 1 first. The first who ${v.win} wins. What is the probability that player ${pos} wins?`,
        explain: lines(
          pos === 1 ? `Player 1 wins on the first turn with probability ${v.pf}.`
            : `Player ${pos} wins in the first round if ${pos === 2 ? 'player 1 misses' : 'players 1 and 2 both miss'} and then they hit: (${v.qf})^${pos - 1} × ${v.pf} = ${num(firstRound, 4)}.`,
          `If a whole round passes with no winner, probability (${v.qf})^${players} = ${num(q ** players, 4)}, the game starts over.`,
          `So P = ${num(firstRound, 4)} / (1 − ${num(q ** players, 4)}) = ${pct(value)}.`,
        ),
        mistakes: [
          [1 / players, 'assuming every player has the same chance, though going earlier helps'],
          [v.p, 'the chance of winning on a single turn'],
          [firstRound, 'winning in the first round only, forgetting the game can go around again'],
        ],
        scene: v.scene,
        sim: (r) => {
          for (let t = 0; t < 10000; t++) if (r() < v.p) return t % players === pos - 1 ? 1 : 0;
          return 0;
        },
      };
    },

    biasedBinomial(rng) {
      const p = pick(rng, [0.3, 0.4, 0.6, 0.7]);
      const n = int(rng, 3, 8);
      const atLeast = rng() < 0.4;
      const k = atLeast ? int(rng, Math.ceil(n / 2), n - 1) : int(rng, 1, n - 1);
      let value = 0;
      for (let j = k; j <= (atLeast ? n : k); j++) value += OA.binom(n, j, p);
      const one = p ** k * (1 - p) ** (n - k);
      return {
        topic: 'Binomial', kind: 'prob', value,
        prompt: `A player wins each game with probability ${p}, independently. What is the probability of winning ${atLeast ? `at least ${k}` : `exactly ${k}`} of ${n} games?`,
        explain: atLeast
          ? lines(
            `Exactly j wins has probability C(${n}, j) × ${p}^j × ${num(1 - p, 1)}^(${n} − j).`,
            `Add j = ${k} to ${n}: ${span(k, n).map((j) => pct(OA.binom(n, j, p))).join(' + ')}.`,
            `Total: ${pct(value)}.`,
          )
          : lines(
            `One particular order of ${k} wins and ${n - k} losses: ${p}^${k} × ${num(1 - p, 1)}^${n - k} = ${num(one, 4)}.`,
            `There are C(${n}, ${k}) = ${choose(n, k)} such orders.`,
            `${choose(n, k)} × ${num(one, 4)} = ${pct(value)}.`,
          ),
        mistakes: atLeast
          ? [k / n, [p ** k, `${p}^${k}, forgetting the losses and the different orders`], [OA.binom(n, k, p), `exactly ${k} wins, not ${k} or more`]]
          : [k / n, [one, `one order only, forgetting the C(${n}, ${k}) orders`], [OA.binom(n, k, 0.5), 'the chance for a fair 50/50 player']],
        sim: (r) => {
          let w = 0;
          for (let i = 0; i < n; i++) if (r() < p) w++;
          return (atLeast ? w >= k : w === k) ? 1 : 0;
        },
      };
    },

    firstOfKind(rng) {
      const [name, m, isTarget, plural] = pick(rng, [
        ['ace', 4, (c) => c % 13 === 0, 'aces'],
        ['heart', 13, (c) => Math.floor(c / 13) === 0, 'hearts'],
        ['king or queen', 8, (c) => c % 13 >= 11, 'kings and queens'],
        ['red card', 26, (c) => Math.floor(c / 13) < 2, 'red cards'],
      ]);
      const value = 53 / (m + 1);
      return {
        topic: 'Expected value', kind: 'num', value, range: [1, 53 - m],
        prompt: `Cards are turned over one at a time from a shuffled 52-card deck. On average, how many cards are turned over up to and including the first ${name}?`,
        explain: lines(
          `The ${m} ${plural} split the other ${52 - m} cards into ${m + 1} gaps: before the first, between each, and after the last.`,
          `By symmetry each gap holds ${52 - m}/${m + 1} cards on average, and the first gap is what comes before the first one.`,
          `Count the card itself: 1 + ${52 - m}/${m + 1} = 53/${m + 1} = ${num(value)}.`,
        ),
        mistakes: [
          [52 / m, `52/${m}, the wait if each card were put back`],
          [52 / (m + 1), 'the cards before the first one, forgetting to count that card itself'],
          52 / m + 1,
        ],
        scene: { type: 'cards', deck: true },
        sim: (r) => {
          const deck = Array.from({ length: 52 }, (_, i) => i);
          for (let i = 0; i < 52; i++) {
            const j = i + Math.floor(r() * (52 - i));
            [deck[i], deck[j]] = [deck[j], deck[i]];
            if (isTarget(deck[i])) return i + 1;
          }
          return 52;
        },
      };
    },

    uniforms(rng) {
      const v = pick(rng, ['sum', 'gap', 'stick', 'semicircle', 'max']);
      if (v === 'sum') {
        const x = pick(rng, [0.5, 0.6, 0.8, 1.2, 1.4, 1.5]);
        const value = x <= 1 ? x * x / 2 : 1 - (2 - x) ** 2 / 2;
        return {
          topic: 'Geometric', kind: 'prob', value,
          prompt: `Two numbers are picked independently and uniformly between 0 and 1. What is the probability that their sum is less than ${x}?`,
          explain: lines(
            'The pair is a random point in the unit square, so a probability is an area.',
            x <= 1
              ? `Below the line x + y = ${x} is a triangle with legs ${x}: area ${x}²/2 = ${pct(value)}.`
              : `Everything except the corner triangle above the line, with legs ${num(2 - x, 1)}: 1 − ${num(2 - x, 1)}²/2 = ${pct(value)}.`,
          ),
          mistakes: [x / 2, [x * x, 'forgetting the ½ in the triangle’s area'], Math.min(0.99, x - 0.25)],
          sim: (r) => (r() + r() < x ? 1 : 0),
        };
      }
      if (v === 'gap') {
        const d = pick(rng, [0.1, 0.2, 0.25, 0.3, 0.5]);
        const value = 1 - (1 - d) ** 2;
        return {
          topic: 'Geometric', kind: 'prob', value,
          prompt: `Two numbers are picked independently and uniformly between 0 and 1. What is the probability that they are within ${d} of each other?`,
          explain: lines(
            'The pair is a random point in the unit square, so a probability is an area.',
            `They are further apart than ${d} in two corner triangles with legs ${num(1 - d, 2)}; together these make (1 − ${d})² = ${num((1 - d) ** 2, 4)}.`,
            `1 − ${num((1 - d) ** 2, 4)} = ${pct(value)}.`,
          ),
          mistakes: [d, [2 * d, `2 × ${d}, a band of width ${num(2 * d, 2)} that ignores the cut-off corners`], d * d],
          sim: (r) => (Math.abs(r() - r()) < d ? 1 : 0),
        };
      }
      if (v === 'stick') {
        return {
          topic: 'Geometric', kind: 'prob', value: 0.25,
          prompt: 'A stick is broken at two points chosen uniformly at random. What is the probability that the three pieces can form a triangle?',
          explain: lines(
            'Three pieces form a triangle exactly when none is longer than half the stick.',
            'With break points x < y the pieces are x, y − x and 1 − y; requiring each to be under ½ leaves a small triangle.',
            'Across both orders of x and y that region is a quarter of the unit square: 25%.',
          ),
          mistakes: [0.5, 1 / 3, 0.125],
          sim: (r) => {
            const [a, b] = [r(), r()].sort((x, y) => x - y);
            return Math.max(a, b - a, 1 - b) < 0.5 ? 1 : 0;
          },
        };
      }
      if (v === 'semicircle') {
        const n = pick(rng, [3, 3, 4]);
        const value = n / 2 ** (n - 1);
        return {
          topic: 'Geometric', kind: 'prob', value,
          prompt: `${n} points are placed uniformly at random on a circle. What is the probability that they all lie within some semicircle?`,
          explain: lines(
            `Fix one point. The other ${n - 1} all fall in the half circle clockwise from it with probability (1/2)^${n - 1}.`,
            `Only one point can lead the group like that, so the ${n} events never overlap.`,
            `${n} × (1/2)^${n - 1} = ${pct(value)}.`,
          ),
          mistakes: [0.5, 1 / n, 1 - value / 2, [0.5 ** (n - 1), 'the chance for one fixed leading point only']],
          sim: (r) => {
            const a = Array.from({ length: n }, () => r()).sort((x, y) => x - y);
            const gaps = a.map((x, i) => (i ? x - a[i - 1] : x + 1 - a[n - 1]));
            return Math.max(...gaps) >= 0.5 ? 1 : 0;
          },
        };
      }
      const n = int(rng, 2, 6);
      return {
        topic: 'Geometric', kind: 'num', value: n / (n + 1), range: [0, 1],
        prompt: `${n} numbers are picked independently and uniformly between 0 and 1. What is the expected value of the largest?`,
        explain: lines(
          `The largest is at most x only if all ${n} are: P(max ≤ x) = x^${n}.`,
          `So its density is ${n}x^${n - 1}, and E = ∫ x · ${n}x^${n - 1} dx from 0 to 1 = ${n}/${n + 1}.`,
          `${n}/${n + 1} = ${num(n / (n + 1), 3)}.`,
        ),
        mistakes: [[0.5, 'the average of a single number'], 1 - 1 / n, (n - 1) / n],
        sim: (r) => Math.max(...Array.from({ length: n }, () => r())),
      };
    },

    diceDuel(rng) {
      const v = pick(rng, [
        { text: 'You and an opponent each roll a fair die. You win only if your number is strictly higher.', mine: [6], theirs: [6], best: false, reroll: false },
        { text: 'You roll two fair dice and keep the higher; your opponent rolls one fair die. You win only if your number is strictly higher.', mine: [6, 6], theirs: [6], best: true, reroll: false },
        { text: 'You roll a fair 8-sided die and your opponent a fair 6-sided die. You win only if your number is strictly higher.', mine: [8], theirs: [6], best: false, reroll: false },
        { text: 'You roll a fair 8-sided die and your opponent a fair 6-sided die; ties are rolled again. You win if your number is higher.', mine: [8], theirs: [6], best: false, reroll: true },
      ]);
      let win = 0;
      let tie = 0;
      let total = 0;
      const each = (dice, f, acc = []) => (dice.length ? Array.from({ length: dice[0] }, (_, i) => each(dice.slice(1), f, [...acc, i + 1])) : f(acc));
      each([...v.mine, ...v.theirs], (vals) => {
        const m = Math.max(...vals.slice(0, v.mine.length));
        const t = vals[vals.length - 1];
        total++;
        if (m > t) win++;
        else if (m === t) tie++;
      });
      const value = v.reroll ? win / (total - tie) : win / total;
      return {
        topic: 'Dice', kind: 'prob', value,
        prompt: `${v.text} What is the probability that you win?`,
        explain: lines(
          `List the ${total} equally likely outcomes${v.best ? ' (your two dice, then theirs)' : ''}.`,
          `You're strictly higher in ${win}, tied in ${tie} and lower in ${total - win - tie}.`,
          v.reroll ? `Ties are replayed, so only the ${total - tie} decisive outcomes count: ${win}/${total - tie} = ${pct(value)}.`
            : `A tie is not a win: ${win}/${total} = ${pct(value)}.`,
        ),
        mistakes: [
          [0.5, 'assuming an even game'],
          [win / total + tie / total / 2, 'counting half of the ties as wins'],
          v.reroll ? [win / total, 'forgetting that ties are rolled again'] : [(win + tie) / total, 'counting ties as wins'],
        ],
        scene: { type: 'dice', sides: v.mine, vs: v.theirs },
        sim: (r) => {
          for (let k = 0; k < 1000; k++) {
            const m = Math.max(...v.mine.map((d) => roll(r, d)));
            const t = roll(r, v.theirs[0]);
            if (m > t) return 1;
            if (m < t || !v.reroll) return 0;
          }
          return 0;
        },
      };
    },

    doubling(rng) {
      const k = int(rng, 3, 7);
      const fair = rng() < 0.5;
      const p = fair ? 0.5 : 18 / 37;
      const q = 1 - p;
      const bank = 2 ** k - 1;
      const value = (1 - q ** k) - q ** k * bank;
      return {
        topic: 'Expected value', kind: 'num', value, grid: false, range: [-bank, 1],
        prompt: `You bet $1 on ${fair ? 'a fair coin flip' : 'red at roulette (wins 18 times in 37)'}. After each loss you double your bet; you stop at your first win, or after ${k} losses in a row (down $${bank}). What is your expected profit?`,
        explain: lines(
          `Any win leaves you exactly $1 up, so you end $1 up unless all ${k} bets lose.`,
          `All ${k} lose with probability ${fair ? '(1/2)' : '(19/37)'}^${k} = ${num(q ** k, 4)}, and then you're down ${span(0, k - 1).map((i) => `$${2 ** i}`).join(' + ')} = $${bank}.`,
          `${num(1 - q ** k, 4)} × 1 − ${num(q ** k, 4)} × ${bank} = ${num(value, 3)}.`,
          `Doubling can't turn ${fair ? 'a fair game' : 'a losing game'} into a winning one.`,
        ),
        mistakes: [[1, 'assuming you always end $1 up'], [1 - q ** k, 'the chance of ending ahead, not the average profit'], fair ? 0.5 : 0],
        sim: (r) => {
          let bet = 1;
          let lost = 0;
          for (let i = 0; i < k; i++) {
            if (r() < p) return 1;
            lost += bet;
            bet *= 2;
          }
          return -lost;
        },
      };
    },

    runs(rng) {
      const n = int(rng, 6, 20);
      const v = pick(rng, ['runs', 'HH', 'HT']);
      const value = v === 'runs' ? 1 + (n - 1) / 2 : (n - 1) / 4;
      const what = v === 'runs' ? 'runs (maximal blocks of the same face, e.g. HHTH has 3)' : v === 'HH' ? 'times heads is immediately followed by heads (overlaps count)' : 'times heads is immediately followed by tails';
      return {
        topic: 'Expected value', kind: 'num', value, range: v === 'runs' ? [1, n] : [0, v === 'HH' ? n - 1 : Math.floor(n / 2)],
        prompt: `A fair coin is tossed ${n} times. What is the expected number of ${what}?`,
        explain: v === 'runs'
          ? lines('A new run starts at toss 1, and at every later toss that differs from the one before it.', `Each of the ${n - 1} later tosses differs with probability 1/2.`, `By linearity: 1 + ${n - 1}/2 = ${num(value)}.`)
          : lines(`There are ${n - 1} neighboring pairs of tosses.`, `Each pair is ${v} with probability 1/2 × 1/2 = 1/4, even when pairs overlap.`, `By linearity: ${n - 1}/4 = ${num(value)}.`),
        mistakes: v === 'runs'
          ? [n / 2, (n + 1) / 2 + 1, n / 3]
          : [[n / 4, `${n}/4, though there are only ${n - 1} neighboring pairs`], (n - 2) / 4, [(n - 1) / 2, 'using 1/2 for each pair instead of 1/4']],
        scene: { type: 'coins', n },
        sim: (r) => {
          const t = Array.from({ length: n }, () => (r() < 0.5 ? 'H' : 'T'));
          let c = v === 'runs' ? 1 : 0;
          for (let i = 1; i < n; i++) {
            if (v === 'runs' && t[i] !== t[i - 1]) c++;
            if (v !== 'runs' && t[i - 1] === 'H' && t[i] === (v === 'HH' ? 'H' : 'T')) c++;
          }
          return c;
        },
      };
    },

    pigeonhole(rng) {
      const boxes = int(rng, 8, 20);
      const per = int(rng, 3, 6);
      const balls = boxes * per + 1;
      return {
        topic: 'Counting', kind: 'prob', value: 1,
        prompt: `${balls} balls are dropped at random into ${boxes} boxes. What is the probability that some box ends up with more than ${per} balls?`,
        explain: lines(
          `${boxes} boxes with at most ${per} each hold only ${boxes} × ${per} = ${boxes * per} balls.`,
          `Ball number ${balls} has to push some box over (the pigeonhole principle), however they land.`,
          'So it is certain: 100%.',
        ),
        mistakes: [1 - 1 / boxes, 0.5, per / boxes],
        sim: (r) => {
          const c = new Array(boxes).fill(0);
          for (let i = 0; i < balls; i++) c[Math.floor(r() * boxes)]++;
          return Math.max(...c) > per ? 1 : 0;
        },
      };
    },

    markov(rng) {
      const ss = pick(rng, [0.6, 0.7, 0.8, 0.9]);
      const rr = pick(rng, [0.3, 0.4, 0.5, 0.6]);
      const days = pick(rng, [2, 3]);
      let s = 1; // P(sunny) today
      const steps = [];
      for (let d = 1; d <= days; d++) {
        const was = s;
        s = s * ss + (1 - s) * (1 - rr);
        if (d > 1) steps.push(`Day ${d}: ${num(was, 4)} × ${ss} + ${num(1 - was, 4)} × ${num(1 - rr, 1)} = ${num(s, 4)}.`);
      }
      return {
        topic: 'Markov chains', kind: 'prob', value: s,
        prompt: `Each day is sunny or rainy. After a sunny day the next is sunny with probability ${ss}; after a rainy day the next is rainy with probability ${rr}. Today is sunny. What is the probability it is sunny ${days} days from now?`,
        explain: lines(
          `Each day: P(sunny next) = P(sunny) × ${ss} + P(rainy) × ${num(1 - rr, 1)} (a rainy day turns sunny with 1 − ${rr}).`,
          `Day 1: ${ss}.`,
          ...steps,
          `So ${pct(s)}.`,
        ),
        mistakes: [
          [ss ** days, 'staying sunny every day, forgetting the paths through a rainy day'],
          [ss, 'the one-day chance'],
          [(1 - rr) / ((1 - ss) + (1 - rr)), 'the long-run share of sunny days'],
        ],
        sim: (r) => {
          let sunny = true;
          for (let d = 0; d < days; d++) sunny = sunny ? r() < ss : r() >= rr;
          return sunny ? 1 : 0;
        },
      };
    },

    trickCoin(rng) {
      // Bayes with evidence you can see: a run of heads from a coin that might be two-headed.
      const fair = int(rng, 2, 9);
      const trick = int(rng, 1, 3);
      const k = int(rng, 2, 5);
      const nextHead = rng() < 0.4;
      const n = fair + trick;
      const like = 0.5 ** k;
      const post = trick / (trick + fair * like);
      const value = nextHead ? post + (1 - post) / 2 : post;
      return {
        topic: 'Conditional', kind: 'prob', value,
        prompt: `A bag holds ${fair} fair coins and ${trick} two-headed coin${trick > 1 ? 's' : ''}. You pick one at random and toss it ${k} times: heads every time. What is the probability that ${nextHead ? 'the next toss is heads too' : 'it is a two-headed coin'}?`,
        explain: lines(
          `Before tossing: ${trick} of the ${n} coins ${trick === 1 ? 'is' : 'are'} two-headed.`,
          `${k} heads in a row: certain with a two-headed coin, (1/2)^${k} = 1/${2 ** k} with a fair one.`,
          `Weigh each kind by its count: ${trick} × 1 against ${fair} × 1/${2 ** k}, so P(two-headed) = ${trick} / (${trick} + ${fair}/${2 ** k}) = ${pct(post)}.`,
          nextHead && `Next toss: ${pct(post)} × 1 + ${pct(1 - post)} × 1/2 = ${pct(value)}.`,
        ),
        mistakes: nextHead
          ? [[0.5, 'assuming tosses have no memory, which holds only for a coin known to be fair'], [post, 'the chance the coin is two-headed, not the chance of heads'], [(trick + fair / 2) / n, 'ignoring the heads you saw']]
          : [[trick / n, 'ignoring the heads you saw'], [1 - like, `1 − (1/2)^${k}, how unlikely the run is for a fair coin, which is not the answer`], [trick / (trick + fair / 2), 'updating for one head only']],
        scene: { type: 'coins', seq: 'H'.repeat(k) },
        sim: (r) => {
          const two = r() * n < trick;
          for (let i = 0; i < k; i++) if (!two && r() >= 0.5) return null;
          if (!nextHead) return two ? 1 : 0;
          return two || r() < 0.5 ? 1 : 0;
        },
      };
    },

    pointGame(rng) {
      // A dice game with a "point": instant wins and losses on the first roll,
      // otherwise a race between the point and a 7.
      const v = pick(rng, [
        { W: [7, 11], L: [2, 3, 12] },
        { W: [7], L: [2, 3, 12] },
        { W: [7, 11], L: [2, 12] },
        { W: [7, 11, 12], L: [2, 3] },
      ]);
      const points = span(2, 12).filter((s) => !v.W.includes(s) && !v.L.includes(s));
      const first = v.W.reduce((t, s) => t + ways2(s), 0);
      const make = (s) => ways2(s) / (ways2(s) + 6);
      const viaPoint = points.reduce((t, s) => t + (ways2(s) / 36) * make(s), 0);
      const value = first / 36 + viaPoint;
      const byWays = [...new Set(points.map(ways2))].sort((a, b) => a - b)
        .map((w) => `${points.filter((s) => ways2(s) === w).join(' or ')}: ${w}/${w + 6}`);
      return {
        topic: 'Dice', kind: 'prob', value,
        prompt: `You roll two fair dice. A first total of ${orList(v.W)} wins at once, and ${orList(v.L)} loses at once. Any other total becomes your point: you keep rolling until the point comes up again (you win) or a 7 does (you lose). What is the probability that you win?`,
        explain: lines(
          `First-roll wins: ${v.W.map(ways2).join(' + ')} = ${first} of 36 outcomes, ${pct(first / 36)}.`,
          `Once you have a point, only the point or a 7 matters, so you make it with ways(point) / (ways(point) + 6). ${byWays.join(', ')}.`,
          `Add P(that point) × P(make it) over the points: ${pct(viaPoint)}.`,
          `Total: ${pct(first / 36)} + ${pct(viaPoint)} = ${pct(value)}.`,
        ),
        mistakes: [
          [first / 36, 'counting only the first-roll wins'],
          [first / 36 + points.reduce((t, s) => t + ways2(s), 0) / 72, 'treating each point as a coin flip, though a 7 is more likely than any point'],
          [first / 36 + points.reduce((t, s) => t + (ways2(s) / 36) ** 2, 0), 'making the point on the very next roll only'],
        ],
        scene: { type: 'dice', n: 2 },
        sim: (r) => {
          const s = roll(r) + roll(r);
          if (v.W.includes(s)) return 1;
          if (v.L.includes(s)) return 0;
          for (let t = 0; t < 10000; t++) {
            const x = roll(r) + roll(r);
            if (x === s) return 1;
            if (x === 7) return 0;
          }
          return 0;
        },
      };
    },
  });

  const NAMES = Object.keys(TEMPLATES);

  /**
   * A full question ready to show: the template's facts plus five options. As in
   * the real test, most options are a grid of round values and you pick the
   * closest; the rest list the exact answer among near-miss slips.
   */
  function build(rng, name) {
    const t = TEMPLATES[name](rng);
    const ms = (t.mistakes || []).map((m) => (Array.isArray(m) ? m : [m, null]));
    const g = t.grid !== false && rng() < 0.7 ? OA.gridOptions(rng, t.value, { kind: t.kind, range: t.range }) : null;
    const opts = g || OA.options(rng, t.value, { kind: t.kind, mistakes: ms.map(([v]) => v), range: t.range });
    return {
      kind: 'choice', template: name, topic: t.topic, prompt: t.prompt,
      explain: g ? `${t.explain}\nThe closest option is ${opts.options[opts.correct]}.` : t.explain,
      options: opts.options, values: opts.values, value: t.value, correct: opts.correct, answer: opts.options[opts.correct],
      // For the screen only (never saved): the exact value, the named slips, a picture.
      grid: !!g,
      exact: t.kind === 'prob' ? pct(t.value) : num(t.value, 3),
      slips: ms.filter(([v, why]) => why && Number.isFinite(v)).map(([v, why]) => ({ v, why, kind: t.kind })),
      ...(t.scene ? { scene: t.scene } : {}),
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

  // ---- Learn mode: which slip a wrong pick came from ------------------------------

  /**
   * A sentence naming the common slip behind wrong option `a`, or '' when it
   * isn't one. A listed slip value matches exactly; on a "pick the closest" grid
   * a slip counts when the pick is the grid value nearest to it.
   */
  function slipNote(q, a) {
    if (a == null || a < 0 || a === q.correct || !q.slips || !q.slips.length) return '';
    const picked = q.values[a];
    const fmt = (s) => (s.kind === 'prob' ? pct(s.v) : num(s.v));
    if (!q.grid) {
      const s = q.slips.find((x) => Math.abs(x.v - picked) < 1e-9);
      return s ? `${q.options[a]} is a common slip: ${s.why}.` : '';
    }
    const step = Math.abs(q.values[1] - q.values[0]);
    const near = (v) => q.values.reduce((b, w, i) => (Math.abs(w - v) < Math.abs(q.values[b] - v) ? i : b), 0);
    const hits = q.slips.filter((s) => near(s.v) === a && Math.abs(s.v - picked) <= step * 0.6)
      .sort((x, y) => Math.abs(x.v - picked) - Math.abs(y.v - picked));
    if (!hits.length) return '';
    const s = hits[0];
    return Math.abs(s.v - picked) < 1e-9 || fmt(s) === q.options[a] ? `${q.options[a]} is a common slip: ${s.why}.`
      : `${q.options[a]} is nearest ${fmt(s)}, a common slip: ${s.why}.`;
  }

  // ---- pictures of the setup -------------------------------------------------------

  const PIPS = {
    1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]],
    5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
  };
  const svg = (w, h, label, body) => `<svg class="bto-scene" viewBox="0 0 ${w} ${h}" width="${Math.round(w * 1.2)}" height="${Math.round(h * 1.2)}" role="img" aria-label="${label}">${body}</svg>`;
  const txt = (x, y, s, cls) => `<text class="${cls}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${s}</text>`;

  /** One die: pips for a known face, "?" for a plain unrolled d6, else its size ("d8"; "d6" beside other sizes). */
  function die(x, y, sides, face, named) {
    const s = 40;
    let out = `<rect class="bto-die" x="${x}" y="${y}" width="${s}" height="${s}" rx="8"/>`;
    if (sides === 6 && face) out += PIPS[face].map(([a, b]) => `<circle class="bto-pip" cx="${x + a * 10}" cy="${y + b * 10}" r="3.6"/>`).join('');
    else out += txt(x + s / 2, y + s / 2 + 1, sides === 6 && !named ? '?' : `d${sides}`, sides === 6 && !named ? 'bto-q' : 'bto-dlabel');
    return out;
  }

  /**
   * A small inline SVG of a question's setup, or '' for none. Only labels the
   * template chose go in, so the markup needs no escaping.
   */
  function sceneSvg(sc) {
    if (!sc) return '';
    if (sc.type === 'dice') {
      const mine = sc.faces ? sc.faces.map(() => 6) : sc.sides && Array.isArray(sc.sides) ? sc.sides : Array.from({ length: sc.n || 1 }, () => sc.sides || 6);
      const theirs = sc.vs || [];
      const gapVs = theirs.length ? 44 : 0;
      const w = (mine.length + theirs.length) * 50 - 10 + gapVs;
      const named = [...mine, ...theirs].some((d) => d !== 6);
      let x = 0;
      let body = mine.map((d, i) => { const o = die(x, 6, d, sc.faces && sc.faces[i], named); x += 50; return o; }).join('');
      if (theirs.length) {
        body += txt(x + 12, 26, 'vs', 'bto-vs');
        x += gapVs;
        body += theirs.map((d) => { const o = die(x, 6, d, null, named); x += 50; return o; }).join('');
      }
      const name = (d) => (d === 6 ? 'six-sided' : `${d}-sided`);
      const label = sc.faces ? `Dice showing ${sc.faces.join(' then ')}`
        : theirs.length ? `Your ${mine.length > 1 ? `${mine.length} ${name(mine[0])} dice` : `${name(mine[0])} die`} against their ${name(theirs[0])} die`
          : `${mine.length} ${name(mine[0])} ${mine.length > 1 ? 'dice' : 'die'}`;
      return svg(Math.max(w, 40), 52, label, body);
    }
    if (sc.type === 'coins') {
      const faces = sc.seq ? sc.seq.split('') : Array.from({ length: Math.min(sc.n, 8) }, () => '?');
      const more = !sc.seq && sc.n > 8;
      const w = faces.length * 40 - 6 + (more ? 46 : 0);
      let body = faces.map((f, i) => `<circle class="bto-coin${f === 'H' ? ' h' : f === 'T' ? ' t' : ''}" cx="${i * 40 + 17}" cy="26" r="17"/>${txt(i * 40 + 17, 27, f, 'bto-cl')}`).join('');
      if (more) body += txt(faces.length * 40 + 18, 27, `×${sc.n}`, 'bto-more');
      const label = sc.seq ? `Coins showing ${faces.join(' ')}` : `${sc.n} coin${sc.n > 1 ? 's' : ''}`;
      return svg(w, 52, label, body);
    }
    if (sc.type === 'cards') {
      if (sc.deck) {
        const body = [8, 4, 0].map((o) => `<rect class="bto-card" x="${o}" y="${o}" width="34" height="46" rx="4"/>`).join('')
          + `<rect class="bto-back" x="4" y="4" width="26" height="38" rx="2"/>${txt(17, 23, '52', 'bto-cardn')}`;
        return svg(44, 56, 'A shuffled 52-card deck', body);
      }
      const n = sc.n;
      const w = (n - 1) * 22 + 46;
      const body = Array.from({ length: n }, (_, i) => {
        const x = i * 22 + 6;
        const rot = (i - (n - 1) / 2) * 7;
        return `<g transform="rotate(${rot} ${x + 17} 54)"><rect class="bto-card" x="${x}" y="6" width="34" height="46" rx="4"/><rect class="bto-back" x="${x + 4}" y="10" width="26" height="38" rx="2"/></g>`;
      }).join('');
      return svg(w, 58, `${n} card${n > 1 ? 's' : ''} dealt face down`, body);
    }
    if (sc.type === 'urn') {
      const balls = [];
      // Mix the colors evenly through the jar rather than stacking them in blocks.
      let r = 0;
      let b = 0;
      while (r + b < sc.red + sc.blue) {
        if (b >= sc.blue || (r < sc.red && r * sc.blue <= b * sc.red)) { balls.push('red'); r++; } else { balls.push('blue'); b++; }
      }
      const per = 6;
      const body = '<path class="bto-urn" d="M14 6 h72 M20 6 v8 q-14 8 -14 26 v20 q0 10 10 10 h68 q10 0 10 -10 v-20 q0 -18 -14 -26 v-8"/>'
        + balls.map((c, i) => {
          const row = Math.floor(i / per);
          const col = i % per;
          return `<circle class="bto-ball ${c}" cx="${21 + col * 11.6 + (row % 2) * 5}" cy="${62 - row * 11}" r="5.2"/>`;
        }).join('');
      return svg(100, 74, `An urn with ${sc.red} red and ${sc.blue} blue balls`, body);
    }
    if (sc.type === 'walk') {
      const x0 = 18;
      const x1 = 262;
      const at = (v) => x0 + ((x1 - x0) * v) / sc.N;
      const ticks = span(0, sc.N).map((v) => `<line class="bto-tick" x1="${at(v)}" y1="30" x2="${at(v)}" y2="${v === 0 || v === sc.N ? 22 : 34}"/>`).join('');
      const body = `<line class="bto-line" x1="${x0}" y1="30" x2="${x1}" y2="30"/>${ticks}`
        + `${txt(at(0), 46, '$0', 'bto-end')}${txt(at(sc.N), 46, `$${sc.N}`, 'bto-end')}`
        + `<circle class="bto-you" cx="${at(sc.a)}" cy="30" r="6.5"/>${txt(at(sc.a), 12, `$${sc.a}`, 'bto-youl')}`;
      return svg(280, 54, `A walk from $${sc.a} that stops at $0 or $${sc.N}`, body);
    }
    return '';
  }

  return { TEMPLATES, NAMES, build, set, slipNote, sceneSvg };
});
