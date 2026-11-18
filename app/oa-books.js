// Orderbooks: boards of cards for items and bundles, each quoting a price you
// can buy at and a price you can sell at. Find trades that leave every item
// flat and the cash positive. Every normal card is quoted around a hidden fair
// value (sell below it, buy above it), so no mix of normal cards can profit;
// one planted mispricing can: a direct cross, a bundle against its parts, a
// ratio trade between two pack sizes, or a chain that routes an item through
// another bundle. Each board is searched exhaustively so the planted trade is
// the only flat, profitable set that uses as few trades as it does.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'));
  else root.OABooks = factory(root.OA);
})(typeof self !== 'undefined' ? self : this, function (OA) {
  'use strict';

  const { int, pick, shuffle } = OA;
  const ITEMS = ['Oil', 'Gold', 'Copper', 'Wheat', 'Silver', 'Coffee'];
  const LETTERS = 'ABCDEFGH';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  const fairOf = (legs, fv) => Object.entries(legs).reduce((t, [k, q]) => t + q * fv[k], 0);
  /** A normally quoted card: you sell below fair value and buy above it. */
  function quote(rng, legs, fv) {
    const fair = fairOf(legs, fv);
    const size = Object.values(legs).reduce((t, q) => t + q, 0);
    return { legs, bid: fair - int(rng, 1, 1 + size), ask: fair + int(rng, 1, 1 + size) };
  }
  const describe = (legs) => Object.entries(legs).map(([k, q]) => `${q} ${k}`).join(' + ');
  /** Signed money: "+44", "−41" (a true minus sign), "0". */
  const money = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

  /** Cash from trading `n` of a card: buying pays its buy price, selling takes its sell price. */
  const flow = (card, n) => (n > 0 ? -n * card.ask : n < 0 ? -n * card.bid : 0);

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
      cash += flow(c, n);
    });
    const flat = Object.values(nets).every((v) => v === 0);
    return { nets, cash, flat, traded, valid: traded && flat && cash > 0 };
  }

  /**
   * Every flat, profitable set of trades using at most `maxTrades` in all
   * (|n| summed over the cards), stopping after `limit`. Exhaustive: each card
   * is tried at every size from −maxTrades to +maxTrades the budget allows.
   */
  function search(board, maxTrades, limit = Infinity) {
    const items = board.items;
    const legs = board.cards.map((c) => items.map((k) => c.legs[k] || 0));
    const nets = items.map(() => 0);
    const pos = board.cards.map(() => 0);
    const found = [];
    const walk = (j, left, cash) => {
      if (found.length >= limit) return;
      if (j === board.cards.length) {
        if (left < maxTrades && cash > 0 && nets.every((v) => v === 0)) found.push({ pos: pos.map((n) => n || 0), cash }); // no -0s
        return;
      }
      const c = board.cards[j];
      for (let v = -left; v <= left; v++) {
        pos[j] = v;
        for (let k = 0; k < items.length; k++) nets[k] += v * legs[j][k];
        walk(j + 1, left - Math.abs(v), cash + flow(c, v));
        for (let k = 0; k < items.length; k++) nets[k] -= v * legs[j][k];
      }
      pos[j] = 0;
    };
    walk(0, maxTrades, 0);
    return found;
  }

  /** The trades in a set, card by card: letter, size, price and the cash each brings. */
  function steps(board, pos) {
    return board.cards.map((card, i) => ({ i, letter: LETTERS[i], n: pos[i] || 0, card }))
      .filter((s) => s.n)
      .map((s) => ({ ...s, price: s.n > 0 ? s.card.ask : s.card.bid, cash: flow(s.card, s.n) }));
  }

  /** A worked line per trade: "Buy B (2 Oil) at 41: −41". */
  const walkthrough = (board, pos) => steps(board, pos).map((s) => `${s.n > 0 ? 'Buy' : 'Sell'} ${Math.abs(s.n) > 1 ? `${Math.abs(s.n)} × ` : ''}${s.letter} (${describe(s.card.legs)}) at ${s.price}: ${money(s.cash)}`);

  const TYPES = {
    // Two cards for the same thing, one quoted through the other.
    cross(rng, fv, items) {
      const k = items[0];
      const legs = { [k]: pick(rng, [1, 1, 2]) };
      const normal = quote(rng, legs, fv);
      const profit = int(rng, 1, 3);
      const cheap = rng() < 0.5;
      const odd = cheap
        ? { legs, ask: normal.bid - profit, bid: normal.bid - profit - int(rng, 1, 3) }
        : { legs, bid: normal.ask + profit, ask: normal.ask + profit + int(rng, 1, 3) };
      const [buy, sell] = cheap ? [odd, normal] : [normal, odd];
      return {
        planted: [normal, odd],
        solution: [[buy, 1], [sell, -1]],
        profit,
        why: `Two cards quote ${describe(legs)}, and one will sell it to you (${buy.ask}) for less than the other will pay (${sell.bid}). Buy low on one, sell high on the other.`,
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
      const profit = int(rng, 1, 3);
      const rich = rng() < 0.5;
      let bundle;
      let solution;
      let why;
      if (rich) {
        const cost = a * sx.ask + b * sy.ask;
        bundle = { legs, bid: cost + profit, ask: cost + profit + int(rng, 1, 3) };
        solution = [[sx, a], [sy, b], [bundle, -1]];
        why = `The bundle (${describe(legs)}) sells for ${bundle.bid}, but its parts cost only ${a} × ${sx.ask} + ${b} × ${sy.ask} = ${cost} to buy. Build it from the parts and sell the bundle.`;
      } else {
        const value = a * sx.bid + b * sy.bid;
        bundle = { legs, ask: value - profit, bid: value - profit - int(rng, 1, 3) };
        solution = [[bundle, 1], [sx, -a], [sy, -b]];
        why = `The bundle (${describe(legs)}) costs ${bundle.ask}, but its parts sell for ${a} × ${sx.bid} + ${b} × ${sy.bid} = ${value}. Buy the bundle and sell it off in parts.`;
      }
      return { planted: [sx, sy, bundle], solution, profit, why };
    },

    // Two pack sizes of one item: trade them in the ratio that cancels out.
    ratio(rng, fv, items) {
      const k = items[0];
      const [m, n] = pick(rng, [[2, 3], [3, 4], [2, 5], [3, 5], [4, 6]]);
      const g = gcd(m, n);
      const [buyM, sellN] = [n / g, m / g]; // buy n/g packs of m, sell m/g packs of n
      const small = quote(rng, { [k]: m }, fv);
      const profit = int(rng, 1, 3);
      const bid = Math.ceil((small.ask * buyM + profit) / sellN);
      const big = { legs: { [k]: n }, bid, ask: bid + int(rng, 1, 3) };
      const real = bid * sellN - small.ask * buyM;
      return {
        planted: [small, big],
        solution: [[small, buyM], [big, -sellN]],
        profit: real,
        why: `Packs of ${m} and of ${n} ${k} price it differently per unit. ${buyM} packs of ${m} and ${sellN} of ${n} are both ${buyM * m} ${k}, so buy ${buyM} packs of ${m} at ${small.ask} each (${small.ask * buyM}) and sell ${sellN} packs of ${n} at ${bid} each (${bid * sellN}).`,
      };
    },

    // No card trades x alone: route it through another bundle and settle the leftovers.
    chain(rng, fv, items) {
      const [x, y, z] = items;
      const via = quote(rng, { [x]: 1, [y]: 1 }, fv);
      const sy = quote(rng, { [y]: 1 }, fv);
      const sz = quote(rng, { [z]: 1 }, fv);
      const legs = { [x]: 1, [z]: 1 };
      const profit = int(rng, 1, 3);
      const rich = rng() < 0.5;
      let odd;
      let solution;
      let why;
      if (rich) {
        // Buy x + y, sell the y, buy a z: you hold x + z for less than the bundle pays.
        const cost = via.ask - sy.bid + sz.ask;
        odd = { legs, bid: cost + profit, ask: cost + profit + int(rng, 1, 3) };
        solution = [[via, 1], [sy, -1], [sz, 1], [odd, -1]];
        why = `Only two cards hold ${x}, both bundles. Buying ${describe(via.legs)} (${via.ask}), selling its ${y} (${sy.bid}) and buying a ${z} (${sz.ask}) builds ${describe(legs)} for ${cost}, and that bundle sells for ${odd.bid}.`;
      } else {
        // Buy x + z, sell the z, buy a y: you hold x + y, which sells for more.
        const value = via.bid - sy.ask + sz.bid;
        odd = { legs, ask: value - profit, bid: value - profit - int(rng, 1, 3) };
        solution = [[odd, 1], [sz, -1], [sy, 1], [via, -1]];
        why = `Only two cards hold ${x}, both bundles. Buy ${describe(legs)} at ${odd.ask}, sell its ${z} (${sz.bid}) and buy a ${y} (${sy.ask}): now you hold ${describe(via.legs)}, which sells for ${via.bid}, worth ${value} in all.`;
      }
      return { planted: [via, sy, sz, odd], solution, profit, why, avoid: x };
    },
  };

  const TYPE_NAMES = Object.keys(TYPES);
  const TOPIC = { cross: 'Direct cross', bundle: 'Bundles', ratio: 'Ratios', chain: 'Bundles' }; // a chain prices a bundle through another one

  function build(rng, type) {
    for (;;) {
      // Six to eight cards a board, three to five of them decoys; bigger boards (and chains) add an item.
      const total = int(rng, 6, 8);
      const items = shuffle(rng, ITEMS).slice(0, total >= 7 || type === 'chain' ? 4 : 3);
      const fv = Object.fromEntries(items.map((k) => [k, int(rng, 15, 60)]));
      const t = TYPES[type](rng, fv, items);
      if (t.planted.some((c) => !(c.bid > 0 && c.ask > c.bid))) continue;
      // Decoys: normally quoted cards for the other items, pack sizes and bundles.
      const pool = items.filter((k) => k !== t.avoid);
      const decoys = [];
      const want = Math.min(5, Math.max(3, total - t.planted.length));
      while (decoys.length < want) {
        const k = pick(rng, pool);
        const legs = rng() < 0.4 ? { [k]: int(rng, 1, 2), [pick(rng, pool.filter((j) => j !== k))]: 1 } : { [k]: int(rng, 1, 3) };
        decoys.push(quote(rng, legs, fv));
      }
      const cards = shuffle(rng, [...t.planted, ...decoys]);
      const solution = cards.map((c) => {
        const s = t.solution.find(([card]) => card === c);
        return s ? s[1] : 0;
      });
      const board = { items: items.filter((k) => cards.some((c) => c.legs[k])), cards: cards.map((c) => ({ legs: c.legs, bid: c.bid, ask: c.ask })) };
      // One intended answer: no other flat, profitable set as short as the planted one.
      const size = solution.reduce((s, n) => s + Math.abs(n), 0);
      if (search(board, size, 2).length !== 1) continue;
      const list = steps(board, solution).map((s) => `${s.n > 0 ? 'buy' : 'sell'} ${Math.abs(s.n)} × ${s.letter}`).join(', ');
      return {
        kind: 'board', template: type, topic: TOPIC[type], board, solution, profit: t.profit,
        planted: cards.map((c) => t.planted.includes(c)),
        prompt: 'Find a set of trades that leaves every item flat and makes money.',
        summary: `Board: ${board.cards.map((c, i) => `${LETTERS[i]} ${describe(c.legs)} (sell ${c.bid} / buy ${c.ask})`).join('; ')}`,
        answer: `${list} (+${t.profit})`,
        explain: `${t.why} Step by step: ${walkthrough(board, solution).join('; ')}. Every item nets to 0 and the cash is +${t.profit}. Any other flat, profitable set also counts.`,
      };
    }
  }

  /** Test boards ramp up: crosses first, then bundles, ratios, and chains last. */
  function set(rng, n) {
    const at = (i) => (i < n * 0.3 ? 'cross' : i < n * 0.6 ? 'bundle' : i < n * 0.85 ? 'ratio' : 'chain');
    return Array.from({ length: n }, (_, i) => build(rng, n === 1 ? pick(rng, TYPE_NAMES) : at(i)));
  }

  return { TYPES, TYPE_NAMES, LETTERS, build, set, check, describe, search, steps, walkthrough, flow, money };
});
