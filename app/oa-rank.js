// Likelihood-list: rank three outcomes from most to least likely. Every
// scenario computes each outcome's exact probability and can simulate them,
// so the tests check the ranking against a Monte Carlo run. Scenarios cover the
// usual traps: subsets (a stricter event can't be likelier), impossibility,
// variance versus mean, and famous near-ties.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'));
  else root.OARank = factory(root.OA);
})(typeof self !== 'undefined' ? self : this, function (OA) {
  'use strict';

  const { int, pick, shuffle, choose, binom, normCdf, pct } = OA;
  const roll = (rng) => 1 + Math.floor(rng() * 6);
  const LETTERS = ['A', 'B', 'C'];
  /** One standard normal draw (Box–Muller). */
  const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

  /** Three events from `pool` with clearly different chances. */
  function pickDistinct(rng, pool, gap = 0.01) {
    for (let tries = 0; tries < 200; tries++) {
      const three = shuffle(rng, pool).slice(0, 3);
      const p = three.map((e) => e.p).sort((a, b) => b - a);
      if (p[0] - p[1] >= gap && p[1] - p[2] >= gap) return three;
    }
    throw new Error('no distinct triple');
  }

  // Each scenario returns { topic, prompt, context?, events: [{ text, p, why, test? }],
  // note?, sim? }. sim(rng) returns one boolean per event, or null to discard.
  const SCENARIOS = {
    twoDice(rng) {
      const pool = [
        ['the total is 7', (a, b) => a + b === 7],
        ['the dice show doubles', (a, b) => a === b],
        ['the total is at least 10', (a, b) => a + b >= 10],
        ['at least one die shows a 6', (a, b) => a === 6 || b === 6],
        ['both dice are odd', (a, b) => a % 2 === 1 && b % 2 === 1],
        ['the total is a prime number', (a, b) => [2, 3, 5, 7, 11].includes(a + b)],
        ['the product is even', (a, b) => (a * b) % 2 === 0],
        ['the dice differ by 3 or more', (a, b) => Math.abs(a - b) >= 3],
        ['the total is 2 or 12', (a, b) => a + b === 2 || a + b === 12],
      ].map(([text, f]) => {
        let n = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (f(a, b)) n++;
        return { text, f, p: n / 36, why: `${n}/36` };
      });
      const ev = pickDistinct(rng, pool);
      return {
        topic: 'Dice', prompt: 'Two fair dice are rolled.', events: ev,
        sim: (r) => {
          const a = roll(r);
          const b = roll(r);
          return ev.map((e) => e.f(a, b));
        },
      };
    },

    coins(rng) {
      const n = 10;
      const runOf = (m, k) => {
        let run = 0;
        for (let i = 0; i < n; i++) {
          run = (m >> i) & 1 ? run + 1 : 0;
          if (run >= k) return true;
        }
        return false;
      };
      const heads = (m) => { let c = 0; for (let i = 0; i < n; i++) c += (m >> i) & 1; return c; };
      const half = (m, lo) => { let c = 0; for (let i = lo; i < lo + n / 2; i++) c += (m >> i) & 1; return c; };
      const pool = [
        ['exactly 5 heads', (m) => heads(m) === 5],
        ['at least 7 heads', (m) => heads(m) >= 7],
        ['a run of 4 or more heads in a row', (m) => runOf(m, 4)],
        ['more heads in the first five tosses than the last five', (m) => half(m, 0) > half(m, 5)],
        ['no two heads in a row', (m) => !runOf(m, 2)],
        ['the first and last tosses match', (m) => (m & 1) === ((m >> (n - 1)) & 1)],
        ['exactly 4 or exactly 6 heads', (m) => heads(m) === 4 || heads(m) === 6],
      ].map(([text, f]) => {
        let c = 0;
        for (let m = 0; m < 1 << n; m++) if (f(m)) c++;
        return { text, f, p: c / 1024, why: `${c} of the 1,024 sequences` };
      });
      const ev = pickDistinct(rng, pool);
      return {
        topic: 'Coins', prompt: 'A fair coin is tossed 10 times.', events: ev,
        sim: (r) => {
          let m = 0;
          for (let i = 0; i < n; i++) if (r() < 0.5) m |= 1 << i;
          return ev.map((e) => e.f(m));
        },
      };
    },

    subsets(rng) {
      // A stricter event can never be likelier than the event it's part of.
      const skins = [
        {
          prompt: 'Team A is the favourite in tomorrow\'s football match against Team B.',
          model: { win: 0.55, draw: 0.25, big: 0.3 },
          texts: ['Team A wins by 3 or more goals', 'Team A wins', 'Team A wins or draws'],
          sample: (r, m) => { const u = r(); const win = u < m.win; return [win && r() < m.big, win, u < m.win + m.draw]; },
        },
        {
          prompt: 'Player A is slightly favoured in a best-of-three-sets tennis match against Player B.',
          model: { win: 0.6, straight: 0.5 },
          texts: ['Player A wins in straight sets', 'Player A wins the match', 'Player A wins at least one set'],
          sample: (r, m) => {
            const win = r() < m.win;
            const straight = r() < m.straight;
            return [win && straight, win, win || !straight];
          },
        },
        {
          prompt: 'A stock has been trading calmly; tomorrow it could rise, fall or close unchanged.',
          model: { up: 0.47, flat: 0.08, big: 0.25 },
          texts: ['The stock closes more than 2% higher', 'The stock closes higher', 'The stock does not close lower'],
          sample: (r, m) => { const u = r(); const up = u < m.up; return [up && r() < m.big, up, u < m.up + m.flat]; },
        },
        {
          prompt: 'Two fair dice are rolled.',
          model: null,
          texts: ['the total is at least 8 and the dice show doubles', 'the total is at least 8', 'the total is at least 8, or the dice show doubles'],
          sample: (r) => { const a = roll(r); const b = roll(r); const hi = a + b >= 8; return [hi && a === b, hi, hi || a === b]; },
        },
      ];
      const s = pick(rng, skins);
      const m = s.model;
      const p = m == null ? [3 / 36, 15 / 36, 18 / 36]
        : m.straight != null ? [m.win * m.straight, m.win, 1 - (1 - m.win) * m.straight]
          : m.flat != null ? [m.up * m.big, m.up, m.up + m.flat] : [m.win * m.big, m.win, m.win + m.draw];
      return {
        topic: 'Subsets',
        // The story versions use made-up odds for the tests; only the logic is shown.
        illustrative: m != null,
        prompt: s.prompt,
        events: s.texts.map((text, i) => ({ text, p: p[i], why: i === 0 ? 'the strictest' : i === 1 ? 'in between' : 'the broadest' })),
        note: `No numbers needed: "${s.texts[0]}" can only happen if "${s.texts[1]}" does, and "${s.texts[2]}" includes every way "${s.texts[1]}" can happen. Each event contains the one before it.`,
        sim: (r) => s.sample(r, m),
      };
    },

    shooter(rng) {
      const p = pick(rng, [0.7, 0.75, 0.8, 0.9]);
      const mode = Math.floor(11 * p);
      const made = int(rng, 40, 46);
      const impossible = rng() < 0.5;
      const ev = [
        { text: `makes exactly ${mode} of the next 10`, p: binom(10, mode, p), why: `C(10, ${mode}) × ${p}^${mode} × ${(1 - p).toFixed(2)}^${10 - mode}` },
        { text: 'makes all of the next 10', p: p ** 10, why: `${p}^10` },
      ];
      if (impossible) {
        const target = Math.ceil(((made + 51) / 100) * 100);
        ev.push({ text: `finishes the 100 shots having made at least ${target}%`, p: 0, why: `needs ${target} makes but only ${made + 50} are possible` });
      } else {
        let lo = 0;
        for (let k = 0; k <= 5; k++) lo += binom(10, k, p);
        ev.push({ text: 'makes 5 or fewer of the next 10', p: lo, why: 'Σ binomial terms for 0–5 makes' });
      }
      return {
        topic: impossible ? 'Impossibility' : 'Binomial',
        prompt: `A basketball player makes ${pct(p)} of free throws, each shot independent. ${impossible ? `In a 100-shot session they have made ${made} of the first 50.` : 'They are about to take 10 shots.'}`,
        events: ev.map((e) => ({ ...e, text: `The player ${e.text}` })),
        note: impossible ? 'Check for impossible outcomes first: they always rank last.' : '',
        sim: (r) => {
          let k = 0;
          for (let i = 0; i < 10; i++) if (r() < p) k++;
          let rest = 0;
          for (let i = 0; i < 50; i++) if (r() < p) rest++;
          const target = Math.ceil(((made + 51) / 100) * 100);
          return [k === mode, k === 10, impossible ? made + rest >= target : k <= 5];
        },
      };
    },

    heights(rng) {
      const mu = pick(rng, [165, 170, 175, 178]);
      const sd = pick(rng, [6, 7, 8]);
      const tall = mu + Math.round(1.5 * sd);
      const half = Math.round(sd / 2);
      const short = mu - Math.round(2 * sd);
      const z = (x) => (x - mu) / sd;
      const pool = [
        { text: `taller than ${tall} cm`, p: 1 - normCdf(z(tall)), why: `z = ${z(tall).toFixed(2)}`, f: (x) => x > tall },
        { text: `between ${mu - half} and ${mu + half} cm`, p: normCdf(z(mu + half)) - normCdf(z(mu - half)), why: `within ±${(half / sd).toFixed(2)} SD of the mean`, f: (x) => x > mu - half && x < mu + half },
        { text: `shorter than ${short} cm`, p: normCdf(z(short)), why: `z = ${z(short).toFixed(2)}`, f: (x) => x < short },
        { text: `taller than ${mu} cm`, p: 0.5, why: 'half the distribution', f: (x) => x > mu },
      ];
      const ev = pickDistinct(rng, pool);
      return {
        topic: 'Normal distribution',
        prompt: `Adult heights in a population are normally distributed with mean ${mu} cm and standard deviation ${sd} cm. One person is picked at random.`,
        events: ev.map((e) => ({ ...e, text: `They are ${e.text}` })),
        sim: (r) => { const x = mu + sd * gauss(r); return ev.map((e) => e.f(x)); },
      };
    },

    funds(rng) {
      // Over a short horizon, volatility can matter more than the average.
      const T = pick(rng, [15, 20, 25]);
      for (let tries = 0; tries < 100; tries++) {
        const funds = [
          { name: 'Fund A', mu: int(rng, 6, 10), sd: int(rng, 3, 6) },
          { name: 'Fund B', mu: int(rng, 2, 5), sd: int(rng, 18, 28) },
          { name: 'Fund C', mu: int(rng, 8, 12), sd: int(rng, 9, 14) },
        ];
        const ev = funds.map((f) => ({ text: `${f.name} returns more than ${T}% next year`, p: 1 - normCdf((T - f.mu) / f.sd), why: `z = (${T} − ${f.mu}) / ${f.sd} = ${((T - f.mu) / f.sd).toFixed(2)}`, f }));
        const p = ev.map((e) => e.p).sort((a, b) => b - a);
        // Read off a chart, so a little more room than the computed questions.
        if (p[0] - p[1] < 0.03 || p[1] - p[2] < 0.03) continue;
        return {
          topic: 'Mean vs volatility',
          prompt: `Three funds' yearly returns are normally distributed, with the densities plotted below. The dashed line marks ${T}%.`,
          context: { type: 'density', unit: '%', lo: -40, hi: 60, mark: T, curves: funds.map((f) => ({ label: f.name, mu: f.mu, sd: f.sd })) },
          events: ev,
          note: `Read each curve's centre (the average) and width (the volatility): ${funds.map((f) => `${f.name} ${f.mu}% ± ${f.sd}%`).join(', ')}. A high bar is usually cleared by the most volatile fund, even with the lowest average.`,
          sim: (r) => funds.map((f) => f.mu + f.sd * gauss(r) > T),
        };
      }
      return SCENARIOS.funds(rng);
    },

    weather(rng) {
      const ss = pick(rng, [0.7, 0.8, 0.9]);
      const rr = pick(rng, [0.4, 0.5, 0.6]);
      const two = ss * ss + (1 - ss) * (1 - rr);
      const longRun = (1 - rr) / ((1 - ss) + (1 - rr));
      const pool = [
        { text: 'It is sunny tomorrow', p: ss, why: `${ss}`, f: (d) => d[1] },
        { text: 'It is sunny in two days', p: two, why: `${ss}² + ${(1 - ss).toFixed(1)} × ${(1 - rr).toFixed(1)}`, f: (d) => d[2] },
        { text: 'It is rainy in two days', p: 1 - two, why: `1 − P(sunny in two days)`, f: (d) => !d[2] },
        { text: 'It is sunny on a day a year from now', p: longRun, why: `the long-run share: ${(1 - rr).toFixed(1)} / (${(1 - ss).toFixed(1)} + ${(1 - rr).toFixed(1)})`, f: (d) => d[60] },
        { text: 'It rains on both of the next two days', p: (1 - ss) * rr, why: `${(1 - ss).toFixed(1)} × ${rr}`, f: (d) => !d[1] && !d[2] },
      ];
      const ev = pickDistinct(rng, pool);
      return {
        topic: 'Markov chains',
        prompt: 'Weather follows a simple pattern: it is either sunny or rainy, and tomorrow depends only on today. Today is sunny.',
        context: { type: 'table', head: ['Today', 'Sunny tomorrow', 'Rainy tomorrow'], rows: [['Sunny', pct(ss), pct(1 - ss)], ['Rainy', pct(1 - rr), pct(rr)]] },
        events: ev,
        sim: (r) => {
          const d = [true];
          for (let i = 1; i <= 60; i++) d.push(d[i - 1] ? r() < ss : r() >= rr);
          return ev.map((e) => e.f(d));
        },
      };
    },

    hands(rng) {
      const total = choose(52, 5);
      const pool = [
        { text: 'contains at least one ace', p: 1 - choose(48, 5) / total, why: '1 − C(48, 5)/C(52, 5)', f: (h) => h.some((c) => c.rank === 0) },
        { text: 'contains exactly one pair', p: 1098240 / total, why: '13 × C(4, 2) × C(12, 3) × 4³ / C(52, 5)', f: (h) => counts(h).join() === '2,1,1,1' },
        { text: 'contains at least one heart', p: 1 - choose(39, 5) / total, why: '1 − C(39, 5)/C(52, 5)', f: (h) => h.some((c) => c.suit === 0) },
        { text: 'is all one suit', p: (4 * choose(13, 5)) / total, why: '4 × C(13, 5)/C(52, 5)', f: (h) => h.every((c) => c.suit === h[0].suit) },
        { text: 'contains no jack, queen or king', p: choose(40, 5) / total, why: 'C(40, 5)/C(52, 5)', f: (h) => h.every((c) => c.rank < 10) },
        { text: 'contains two pair', p: 123552 / total, why: 'C(13, 2) × C(4, 2)² × 44 / C(52, 5)', f: (h) => counts(h).join() === '2,2,1' },
        { text: 'is all red', p: choose(26, 5) / total, why: 'C(26, 5)/C(52, 5)', f: (h) => h.every((c) => c.suit < 2) },
      ];
      function counts(h) {
        const m = new Map();
        for (const c of h) m.set(c.rank, (m.get(c.rank) || 0) + 1);
        return [...m.values()].sort((a, b) => b - a);
      }
      const ev = pickDistinct(rng, pool);
      return {
        topic: 'Cards',
        prompt: 'Five cards are dealt from a well-shuffled 52-card deck. The hand…',
        events: ev.map((e) => ({ ...e, text: `The hand ${e.text}` })),
        sim: (r) => {
          const deck = Array.from({ length: 52 }, (_, i) => i);
          for (let i = 0; i < 5; i++) {
            const j = i + Math.floor(r() * (52 - i));
            [deck[i], deck[j]] = [deck[j], deck[i]];
          }
          const h = deck.slice(0, 5).map((c) => ({ rank: c % 13, suit: Math.floor(c / 13) }));
          return ev.map((e) => e.f(h));
        },
      };
    },

    scores(rng) {
      const T = 70;
      for (let tries = 0; tries < 200; tries++) {
        const s = Array.from({ length: 20 }, () => [int(rng, 40, 99), int(rng, 40, 99)]);
        const m = s.filter(([a]) => a > T).length;
        const both = s.filter(([a, b]) => a > T && b > T).length;
        const any = s.filter(([a, b]) => a > T || b > T).length;
        if (!(both < m && m < any) || both === 0) continue;
        return {
          topic: 'Reading data',
          prompt: `Twenty students' Maths and English scores are below. One student is picked at random.`,
          context: { type: 'scores', head: ['Maths', 'English'], pairs: s },
          events: [
            { text: `They scored over ${T} in Maths`, p: m / 20, why: `${m} of 20` },
            { text: `They scored over ${T} in both subjects`, p: both / 20, why: `${both} of 20` },
            { text: `They scored over ${T} in at least one subject`, p: any / 20, why: `${any} of 20` },
          ],
          note: `"Both" is part of "Maths", which is part of "at least one", so the order holds without counting.`,
          sim: (r) => {
            const [a, b] = s[Math.floor(r() * 20)];
            return [a > T, a > T && b > T, a > T || b > T];
          },
        };
      }
      return SCENARIOS.scores(rng);
    },

    classics(rng) {
      const atLeast = (n, k, p) => {
        let t = 0;
        for (let j = k; j <= n; j++) t += binom(n, j, p);
        return t;
      };
      const sets = [
        [
          { text: 'At least one 6 in 4 rolls of one die', p: 1 - (5 / 6) ** 4, why: '1 − (5/6)^4', n: 4, k: 1, pairs: false },
          { text: 'At least one double six in 24 rolls of two dice', p: 1 - (35 / 36) ** 24, why: '1 − (35/36)^24', n: 24, k: 1, pairs: true },
          { text: 'At least one 6 in 6 rolls of one die', p: 1 - (5 / 6) ** 6, why: '1 − (5/6)^6', n: 6, k: 1, pairs: false },
        ],
        [
          { text: 'At least one 6 when 6 dice are rolled', p: atLeast(6, 1, 1 / 6), why: '1 − (5/6)^6', n: 6, k: 1, pairs: false },
          { text: 'At least two 6s when 12 dice are rolled', p: atLeast(12, 2, 1 / 6), why: '1 − P(0 or 1 six in 12)', n: 12, k: 2, pairs: false },
          { text: 'At least three 6s when 18 dice are rolled', p: atLeast(18, 3, 1 / 6), why: '1 − P(0, 1 or 2 sixes in 18)', n: 18, k: 3, pairs: false },
        ],
      ];
      const ev = pick(rng, sets);
      return {
        topic: 'Near-ties',
        prompt: 'Fair dice throughout.',
        events: ev,
        note: 'Famous near-ties (de Méré, Newton–Pepys): intuition says "equal", the complement rule says otherwise.',
        sim: (r) => ev.map((e) => {
          let hits = 0;
          for (let i = 0; i < e.n; i++) if (e.pairs ? roll(r) === 6 && roll(r) === 6 : roll(r) === 6) hits++;
          return hits >= e.k;
        }),
      };
    },

    birthdays(rng) {
      const n = pick(rng, [20, 23, 30]);
      const m = pick(rng, [5, 6]);
      let diff = 1;
      for (let i = 0; i < n; i++) diff *= (365 - i) / 365;
      let months = 1;
      for (let i = 0; i < m; i++) months *= (12 - i) / 12;
      const ev = [
        { text: `In a group of ${n}, two people share a birthday`, p: 1 - diff, why: `1 − (365 × 364 × … × ${366 - n}) / 365^${n}`, kind: 'share', size: n },
        { text: `In a group of ${n}, someone shares your birthday`, p: 1 - (364 / 365) ** (n - 1), why: `1 − (364/365)^${n - 1}`, kind: 'mine', size: n },
        { text: `In a group of ${m}, two people share a birth month`, p: 1 - months, why: `1 − (12 × 11 × … × ${13 - m}) / 12^${m}`, kind: 'month', size: m },
      ];
      return {
        topic: 'Counting',
        prompt: 'Assume birthdays are spread evenly over 365 days and 12 months.',
        events: ev,
        note: 'Any pair matching is far likelier than a match with one particular person.',
        sim: (r) => ev.map((e) => {
          const days = e.kind === 'month' ? 12 : 365;
          const seen = new Set();
          const mine = Math.floor(r() * days);
          for (let i = 0; i < (e.kind === 'mine' ? e.size - 1 : e.size); i++) {
            const b = Math.floor(r() * days);
            if (e.kind === 'mine' ? b === mine : seen.has(b)) return true;
            seen.add(b);
          }
          return false;
        }),
      };
    },

    network(rng) {
      // A three-square chain drawn as a graph: read the arrows, then add up paths.
      const N = ['X', 'Y', 'Z'];
      const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((t, v, k) => t + v * B[k][j], 0)));
      for (let tries = 0; tries < 500; tries++) {
        // Each square gets two or three arrows (a loop means staying put), in tenths.
        const P = N.map(() => {
          const to = shuffle(rng, [0, 1, 2]).slice(0, rng() < 0.55 ? 2 : 3);
          const tenths = to.map(() => 1);
          for (let left = 10 - to.length; left > 0; left--) tenths[Math.floor(rng() * to.length)]++;
          const row = [0, 0, 0];
          to.forEach((j, k) => { row[j] = tenths[k] / 10; });
          return row;
        });
        const pow = [null, P];
        for (let k = 2; k <= 100; k++) pow.push(mul(pow[k - 1], P));
        // Irreducible and aperiodic: the far-future rows agree and every square keeps a share.
        const far = pow[100];
        if (far.some((row, i) => row.some((v, j) => v < 0.05 || Math.abs(v - far[0][j]) > 1e-6 || Math.abs(v - pow[99][i][j]) > 1e-6))) continue;
        const via = (j) => [0, 1, 2].filter((k) => P[0][k] && P[k][j]).map((k) => `${P[0][k]}×${P[k][j]}`).join(' + ') || 'no two-move path';
        // Chance of landing on Z at some point in the first three moves.
        let off = [1, 0];
        for (let k = 0; k < 3; k++) off = [off[0] * P[0][0] + off[1] * P[1][0], off[0] * P[0][1] + off[1] * P[1][1]];
        const pool = [
          { text: 'The token is on Y after 2 moves', p: pow[2][0][1], why: via(1), f: (w) => w[2] === 1 },
          { text: 'The token is on Z after 2 moves', p: pow[2][0][2], why: via(2), f: (w) => w[2] === 2 },
          { text: 'The token is back on X after 2 moves', p: pow[2][0][0], why: via(0), f: (w) => w[2] === 0 },
          { text: 'The token is on Y after 3 moves', p: pow[3][0][1], why: 'row X of P³', f: (w) => w[3] === 1 },
          { text: 'The token is on Z after 3 moves', p: pow[3][0][2], why: 'row X of P³', f: (w) => w[3] === 2 },
          { text: 'The token lands on Z at some point in its first 3 moves', p: 1 - off[0] - off[1], why: '1 − P(it avoids Z for 3 moves)', f: (w) => w.slice(1, 4).includes(2) },
          { text: 'The token is on Y after 100 moves', p: far[0][1], why: 'the long-run share: solve π = πP', f: (w) => w[100] === 1 },
          { text: 'The token is on Z after 100 moves', p: far[0][2], why: 'the long-run share: solve π = πP', f: (w) => w[100] === 2 },
          { text: 'The token stays on X for both of the first 2 moves', p: P[0][0] ** 2, why: P[0][0] ? `${P[0][0]}²` : 'X has no loop', f: (w) => w[1] === 0 && w[2] === 0 },
        ];
        let ev;
        try { ev = pickDistinct(rng, pool); } catch { continue; }
        return {
          topic: 'Markov graph',
          prompt: 'A token moves between squares X, Y and Z. Each move it follows one arrow out of its square, with the chances shown; a loop means it stays. It starts on X.',
          context: { type: 'graph', nodes: N, P, start: 0 },
          events: ev,
          note: `Two-move chances add up the paths through each middle square; after 100 moves only the long-run share matters, wherever it started. Rows: ${N.map((n, i) => `${n} → ${N.map((m, j) => `${m} ${P[i][j]}`).join(', ')}`).join('; ')}.`,
          sim: (r) => {
            const w = [0];
            for (let i = 1; i <= 100; i++) {
              const row = P[w[i - 1]];
              let u = r();
              let j = 0;
              while (j < 2 && (row[j] === 0 || u >= row[j])) { u -= row[j]; j++; }
              while (row[j] === 0) j--; // rounding at the top end
              w.push(j);
            }
            return ev.map((e) => e.f(w));
          },
        };
      }
      return SCENARIOS.network(rng);
    },
  };

  const NAMES = Object.keys(SCENARIOS);

  /** A question ready to show: the events in random order, labelled A–C. */
  function build(rng, name) {
    let s = SCENARIOS[name](rng);
    // Close calls on purpose, as on the test, but never closer than 1 point.
    for (let tries = 0; tries < 30; tries++) {
      const p = s.events.map((e) => e.p).sort((a, b) => b - a);
      if (p[0] - p[1] >= 0.01 && p[1] - p[2] >= 0.01) break;
      s = SCENARIOS[name](rng);
    }
    const order = shuffle(rng, [0, 1, 2]);
    const events = order.map((i) => s.events[i]);
    const ranked = [0, 1, 2].sort((a, b) => events[b].p - events[a].p);
    const label = (i) => `${LETTERS[i]}`;
    const answer = ranked.map(label).join(' > ');
    const detail = ranked.map((i) => (s.illustrative ? `${label(i)} (${events[i].why})` : `${label(i)} ${pct(events[i].p)} (${events[i].why})`)).join('; ');
    return {
      kind: 'rank', template: name, topic: s.topic, prompt: s.prompt, context: s.context || null, hideProbs: !!s.illustrative,
      items: events.map((e) => e.text), probs: events.map((e) => e.p), correct: ranked, answer,
      summary: `${s.prompt} ${events.map((e, i) => `${label(i)}: ${e.text}.`).join(' ')}`,
      explain: `${s.note ? `${s.note} ` : ''}${detail}.`,
      sim: s.sim ? (r) => { const v = s.sim(r); return v && order.map((i) => v[i]); } : null,
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

  return { SCENARIOS, NAMES, LETTERS, build, set };
});
