// Orderbooks: boards of cards for items and bundles, each quoting a price you
// can buy at and a price you can sell at. Find trades that leave every item
// flat and the cash positive. Every normal card is quoted around a hidden fair
// value (sell below it, buy above it), so no mix of normal cards can profit;
// one planted mispricing can: a direct cross, a bundle against its parts, or a
// ratio trade between two pack sizes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'));
  else root.OABooks = factory(root.OA);
})(typeof self !== 'undefined' ? self : this, function (OA) {
  'use strict';

  const { int, pick, shuffle } = OA;
  const ITEMS = ['Oil', 'Gold', 'Copper', 'Wheat', 'Silver', 'Coffee'];
  const LETTERS = 'ABCDEF';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  const fairOf = (legs, fv) => Object.entries(legs).reduce((t, [k, q]) => t + q * fv[k], 0);
  /** A normally quoted card: you sell below fair value and buy above it. */
  function quote(rng, legs, fv) {
    const fair = fairOf(legs, fv);
    const size = Object.values(legs).reduce((t, q) => t + q, 0);
    return { legs, bid: fair - int(rng, 1, 1 + size), ask: fair + int(rng, 1, 1 + size) };
  }
  const describe = (legs) => Object.entries(legs).map(([k, q]) => `${q} ${k}`).join(' + ');

  /** Net item positions and cash for staged trades (+n = bought n, −n = sold n). */
  function check(board, pos) {
    const nets = Object.fromEntries(board.items.map((k) => [k, 0]));
    let cash = 0;
    let traded = false;
    board.cards.forEach((c, i) => {
      const n = pos[i] || 0;
      if (!n) return;
      traded = true;
      for (const [k, q] of Object.entries(c.legs)) nets[k] += n * q;
      cash += n > 0 ? -n * c.ask : -n * c.bid;
    });
    const flat = Object.values(nets).every((v) => v === 0);
    return { nets, cash, flat, traded, valid: traded && flat && cash > 0 };
  }

  const TYPES = {
    // Two cards for the same thing, one quoted through the other.
    cross(rng, fv, items) {
      const k = items[0];
      const legs = { [k]: pick(rng, [1, 1, 2]) };
      const normal = quote(rng, legs, fv);
      const profit = int(rng, 1, 4);
      const cheap = rng() < 0.5;
      const odd = cheap
        ? { legs, ask: normal.bid - profit, bid: normal.bid - profit - int(rng, 1, 3) }
        : { legs, bid: normal.ask + profit, ask: normal.ask + profit + int(rng, 1, 3) };
      const [buy, sell] = cheap ? [odd, normal] : [normal, odd];
      return {
        planted: [normal, odd],
        solution: [[buy, 1], [sell, -1]],
        profit,
        how: `buy ${describe(legs)} at ${buy.ask} and sell it at ${sell.bid}: +${profit}`,
      };
    },

    // A bundle priced away from the sum of its parts.
    bundle(rng, fv, items) {
      const [x, y] = items;
      const a = int(rng, 1, 2);
      const b = int(rng, 1, 3);
      const sx = quote(rng, { [x]: 1 }, fv);
      const sy = quote(rng, { [y]: 1 }, fv);
      const legs = { [x]: a, [y]: b };
      const profit = int(rng, 1, 4);
      const rich = rng() < 0.5;
      let bundle;
      let solution;
      let how;
      if (rich) {
        const cost = a * sx.ask + b * sy.ask;
        bundle = { legs, bid: cost + profit, ask: cost + profit + int(rng, 1, 3) };
        solution = [[sx, a], [sy, b], [bundle, -1]];
        how = `buy ${a} ${x} at ${sx.ask} and ${b} ${y} at ${sy.ask} (${cost}), sell the bundle at ${bundle.bid}: +${profit}`;
      } else {
        const value = a * sx.bid + b * sy.bid;
        bundle = { legs, ask: value - profit, bid: value - profit - int(rng, 1, 3) };
        solution = [[bundle, 1], [sx, -a], [sy, -b]];
        how = `buy the bundle at ${bundle.ask}, sell ${a} ${x} at ${sx.bid} and ${b} ${y} at ${sy.bid} (${value}): +${profit}`;
      }
      return { planted: [sx, sy, bundle], solution, profit, how };
    },

    // Two pack sizes of one item: trade them in the ratio that cancels out.
    ratio(rng, fv, items) {
      const k = items[0];
      const [m, n] = pick(rng, [[2, 3], [3, 4], [2, 5], [3, 5], [4, 6]]);
      const g = gcd(m, n);
      const [buyM, sellN] = [n / g, m / g]; // buy n/g packs of m, sell m/g packs of n
      const small = quote(rng, { [k]: m }, fv);
      const profit = int(rng, 1, 4);
      const bid = Math.ceil((small.ask * buyM + profit) / sellN);
      const big = { legs: { [k]: n }, bid, ask: bid + int(rng, 1, 3) };
      const real = bid * sellN - small.ask * buyM;
      return {
        planted: [small, big],
        solution: [[small, buyM], [big, -sellN]],
        profit: real,
        how: `buy ${buyM} × (${m} ${k}) at ${small.ask} and sell ${sellN} × (${n} ${k}) at ${bid}: ${buyM * m} ${k} each way, +${real}`,
      };
    },
  };

  const TYPE_NAMES = Object.keys(TYPES);
  const TOPIC = { cross: 'Direct cross', bundle: 'Bundles', ratio: 'Ratios' };

  function build(rng, type) {
    const items = shuffle(rng, ITEMS).slice(0, 3);
    const fv = Object.fromEntries(items.map((k) => [k, int(rng, 15, 60)]));
    const t = TYPES[type](rng, fv, items);
    // Decoys: normally quoted cards for the other items and pack sizes.
    const decoys = [];
    const want = int(rng, 2, 3);
    while (decoys.length < want) {
      const k = pick(rng, items);
      const legs = rng() < 0.3 ? { [k]: 1, [pick(rng, items.filter((j) => j !== k))]: 1 } : { [k]: int(rng, 1, 3) };
      decoys.push(quote(rng, legs, fv));
    }
    const cards = shuffle(rng, [...t.planted, ...decoys]);
    const solution = cards.map((c) => {
      const s = t.solution.find(([card]) => card === c);
      return s ? s[1] : 0;
    });
    const board = { items: items.filter((k) => cards.some((c) => c.legs[k])), cards: cards.map((c) => ({ legs: c.legs, bid: c.bid, ask: c.ask })) };
    const steps = cards.map((c, i) => [LETTERS[i], solution[i]]).filter(([, n]) => n).map(([l, n]) => `${n > 0 ? 'buy' : 'sell'} ${Math.abs(n)} × ${l}`).join(', ');
    return {
      kind: 'board', template: type, topic: TOPIC[type], board, solution, profit: t.profit,
      planted: cards.map((c) => t.planted.includes(c)),
      prompt: 'Find a set of trades that leaves every item flat and makes money.',
      summary: `Board: ${board.cards.map((c, i) => `${LETTERS[i]} ${describe(c.legs)} (sell ${c.bid} / buy ${c.ask})`).join('; ')}`,
      answer: `${steps} (+${t.profit})`,
      explain: `One way: ${t.how}. Any other flat, profitable combination also counts.`,
    };
  }

  /** Test boards ramp up: crosses first, then bundles, then ratios. */
  function set(rng, n) {
    return Array.from({ length: n }, (_, i) => build(rng, n === 1 ? pick(rng, TYPE_NAMES) : i < n * 0.35 ? 'cross' : i < n * 0.7 ? 'bundle' : 'ratio'));
  }

  return { TYPES, TYPE_NAMES, LETTERS, build, set, check, describe };
});
