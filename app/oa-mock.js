// Full OA practice: every module once, in the invite's order, with breaks
// allowed between stages. Rounds taken in a run are ordinary test rounds that
// also carry the run's id (session.mock) and their stage (session.mockStage), so
// progress and the closing report are worked out from saved rounds: a run
// survives restarts and syncs like any other game. The report rates each module
// against Zetapro's own guide marks (Optiver publishes no cut-offs) and turns
// the round details into a short, ranked list of things to work on.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./oa.js'), require('./oa-zap.js'), require('./oa-iv.js'));
  else root.OAMock = factory(root.OA, root.OAZap, root.OAIntervals);
})(typeof self !== 'undefined' ? self : this, function (OA, Zap, IV) {
  'use strict';

  // Five timed modules, then each Zap-N game on its own.
  const STAGES = [
    ...['bto', 'nl', 'll', 'iv', 'ob'].map((id) => ({ key: id, module: id, game: null, name: OA.byId[id].name })),
    ...Zap.GAMES.map((g) => ({ key: `zap:${g.id}`, module: 'zap', game: g.id, name: g.name })),
  ];
  const stageByKey = Object.fromEntries(STAGES.map((st) => [st.key, st]));

  /** "30 questions · 25 min" for a module, the game's rules line for Zap-N. */
  function stageFormat(st) {
    if (st.game) return Zap.GAMES.find((g) => g.id === st.game).rules;
    const t = OA.byId[st.module].test;
    return `${t.questions} ${st.module === 'ob' ? 'boards' : 'questions'} · ${t.seconds / 60} min${t.perQuestion ? ` · ${t.perQuestion}s each` : ''}`;
  }

  /** Test time across all stages, in minutes (Balloon has no clock: about 3 minutes). */
  const totalMinutes = () => STAGES.reduce((t, st) => t + (st.game
    ? (Zap.GAMES.find((g) => g.id === st.game).seconds || 180) / 60
    : OA.byId[st.module].test.seconds / 60), 0);

  function newRun(now = Date.now(), rnd = Math.random) {
    return { id: `m${now.toString(36)}${Math.floor(rnd() * 36 ** 4).toString(36)}`, startedAt: now };
  }

  const counts = (s) => !s.practice && !s.aborted;

  /** Each stage with its finished round (or null), the next stage to take, and when the last one ended. */
  function progress(sessions, run) {
    const mine = sessions.filter((s) => s.mock === run.id && counts(s)).sort((a, b) => a.at - b.at);
    const stages = STAGES.map((st, i) => ({ ...st, i, session: mine.find((s) => s.mockStage === st.key) || null }));
    const next = stages.findIndex((st) => !st.session);
    const ends = mine.map((s) => s.at + (s.timeUsedMs || 0));
    return { run, stages, next, done: next === -1, taken: mine.length, lastEnd: ends.length ? Math.max(...ends) : null };
  }

  /** Every run that has at least one finished stage, newest first. */
  function runs(sessions) {
    const byId = new Map();
    for (const s of sessions) {
      if (!s.mock || !counts(s)) continue;
      const r = byId.get(s.mock) || { id: s.mock, startedAt: s.at };
      r.startedAt = Math.min(r.startedAt, s.at);
      byId.set(s.mock, r);
    }
    return [...byId.values()]
      .map((r) => {
        const p = progress(sessions, r);
        return { ...r, done: p.done, taken: p.stages.filter((st) => st.session).length, endedAt: p.lastEnd };
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  // ---- report ------------------------------------------------------------------

  // Share of the maximum score for [Strong, On track]. Zetapro's guide, not Optiver's.
  const GUIDE = { bto: [0.6, 0.35], nl: [0.6, 0.35], ll: [0.7, 0.5], iv: [0.55, 0.4], ob: [0.6, 0.35] };
  // Number Box: targets net of skips. Code Compare: score. Balloon: share of the best plan's expected points.
  const ZAP_GUIDE = { numberbox: [8, 4], codes: [25, 15], balloon: [0.85, 0.65] };
  const RATINGS = ['Needs work', 'On track', 'Strong'];
  const rate = (v, [strong, ok]) => (v >= strong ? 2 : v >= ok ? 1 : 0);

  // What to practise for a weak topic: module-specific first, then shared.
  const TIPS = {
    'bto:Expected value': 'Write EV as the sum of value × probability, and lean on linearity: the EV of a sum is the sum of the EVs, even when the parts depend on each other.',
    'bto:Geometric': 'Waiting for a chance-p event takes 1/p tries on average. For "which happens first", compare the two chances within one round.',
    'bto:Dice': 'Count on the 36-outcome (or 216-outcome) grid, and use 1 − P(none) for "at least one".',
    'bto:Counting': 'Decide whether order matters before counting (arrangements vs choices), and reach for the complement for "at least one".',
    'bto:Conditional': 'Turn Bayes into counts: imagine 1,000 cases, split them by the condition, and read off the share you need.',
    'bto:Random walks': 'For a fair walk from k between 0 and N, P(reach N first) = k/N and the expected number of steps is k(N − k).',
    'bto:Markov chains': 'Multiply along each path and add the paths; for the long run, solve π = πP with the shares adding to 1.',
    'bto:Coins': 'For runs and patterns, condition on the first toss and set up one equation for the expected wait.',
    'bto:Cards': 'Without replacement, every position is alike: use symmetry instead of tracking the order of draws.',
    'bto:Binomial': 'P(k of n) = C(n, k) pᵏ(1 − p)ⁿ⁻ᵏ. For "at least", add the few terms on the short side or use the complement.',
    'nl:Constant step': 'Write the differences under the sequence, then the differences of those: most patterns show by the second row.',
    'nl:Difference patterns': 'Write the differences under the sequence, then the differences of those: most patterns show by the second row.',
    'nl:Growing step': 'Write the differences under the sequence, then the differences of those: most patterns show by the second row.',
    'nl:Constant ratio': 'When terms grow fast, divide neighbours instead of subtracting.',
    'nl:Growing multiplier': 'When terms grow fast, divide neighbours: a ratio that itself grows by 1 each time is common.',
    'nl:Step multiplies': 'When the differences grow fast, divide the differences: a step that doubles or triples is common.',
    'nl:Multiply and add': 'Test ×a + b on two consecutive pairs: two equations pin down a and b.',
    'nl:Alternating steps': 'Check the odd and even positions as two separate sequences.',
    'nl:Alternating operations': 'Check whether the operation alternates (for example ×2 then +3) before looking for one rule.',
    'nl:Two interleaved sequences': 'Split odd and even positions; each half is usually simple.',
    'nl:Three-step cycles': 'Try a repeating cycle of three operations: compare terms 1→2, 4→5 and 7→8.',
    'nl:Fractions and decimals': 'Track the operations, not the values: halve-then-add cycles give decimals, so keep exact fractions.',
    'nl:Sum of previous terms': 'When differences go nowhere, test whether each term is built from the two (or three) before it.',
    'nl:Two-term recurrences': 'Test a(n) = p·a(n−1) + q·a(n−2): two consecutive triples give p and q.',
    'nl:Products of previous terms': 'If terms explode, check whether each is the product of the two before it.',
    'nl:Squares and cubes': 'Know squares to 30² and cubes to 12³ cold, and check for ±1 or ±n offsets from them.',
    'nl:Primes': 'Know the primes to 100 cold; sequences often use them directly or as the gaps.',
    'll:Subsets': 'Check containment first: a stricter event can never be likelier than the event it sits inside.',
    'll:Impossibility': 'Look for outcomes that cannot happen at all before computing anything: they always rank last.',
    'll:Binomial': 'The likeliest count is near n × p, and "all n" is pⁿ, which falls fast.',
    'll:Normal distribution': 'Know the z-table anchors (1 SD 84%, 1.5 SD 93%, 2 SD 97.7%) and compare tails by z, not by raw distance.',
    'll:Mean vs volatility': 'For a far-off bar compare z = (bar − mean) ÷ SD for each curve; the widest one usually clears a high bar.',
    'll:Markov chains': 'Two-step chances add the paths through each middle state; far-future chances are the long-run shares.',
    'll:Markov graph': 'Two-step chances add the paths through each middle square; "after 100 moves" is the long-run share, wherever it started.',
    'll:Near-ties': 'For close calls work both out with the complement rule; "they look equal" is the trap.',
    'll:Reading data': 'Count from the table, then use the subset order (both ⊂ one ⊂ at least one) as a check.',
    'iv:Probability & EV': 'On exact questions, compute first and keep the range tight (±5–10%): a narrow correct range scores close to 1.',
    'iv:Counting': 'Count a sample (two rows or one band), scale up, and widen by about ±15% for the sampling error.',
    'iv:Estimation': 'Use the scale bar as a ruler on two or three segments, then multiply; keep about ±20%.',
    'iv:Quick statistics': 'Sample 20–30 values to judge the centre and spread; for a percentile, find where that share of your sample sits.',
    'iv:Mental calculation': 'Anchor on something you know (rule of 72, nearby squares), adjust, and keep about ±5%.',
    'iv:Trends': 'Extend the trend through the last few points, then widen by about twice the month-to-month scatter.',
    'ob:Direct cross': 'Scan each item for a sell price above another card\'s buy price for the same amount: that pair is the trade.',
    'ob:Bundles': 'Price each bundle from the single cards (their buy prices to build it, sell prices to break it up) and compare.',
    'ob:Ratios': 'For two pack sizes, go to the least common multiple and compare the cost of getting there each way.',
    Dice: 'Count exact cases (36 for two dice) rather than going by feel: gaps can be a single point.',
    Coins: 'Count exact cases (1,024 sequences for ten tosses) or use symmetry; gaps can be a single point.',
    Cards: 'Use C(52, 5) counts or the complement; gaps can be a single point.',
    Counting: 'Work each chance out to the nearest point: here the gaps can be that small.',
  };
  const MODULE_TIP = {
    bto: 'Redo these in Learn mode and read each explanation.',
    nl: 'Do a Learn round and write the differences and ratios out before guessing.',
    ll: 'Work each probability to the nearest point before ranking.',
    iv: 'Practise these in Learn mode and compare your range with the answer each time.',
    ob: 'Practise these boards in Learn mode.',
  };
  const tipFor = (module, topic) => TIPS[`${module}:${topic}`] || TIPS[topic] || MODULE_TIP[module];

  const pct = (x) => `${Math.round(x * 100)}%`;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const secs = (ms) => `${Math.round(ms / 1000)} s`;

  /** Per topic: count, right, wrong, skipped, timed out, points and average time. */
  function topics(items) {
    const m = new Map();
    for (const p of items) {
      const r = m.get(p.t) || { topic: p.t, n: 0, right: 0, wrong: 0, skipped: 0, late: 0, pts: 0, ms: 0 };
      r.n++;
      if (p.ok) r.right++;
      else if (p.g == null) r.skipped++;
      else r.wrong++;
      if (p.late) r.late++;
      r.pts += p.pts || 0;
      r.ms += p.ms || 0;
      m.set(p.t, r);
    }
    return [...m.values()].map((r) => ({ ...r, avgMs: r.ms / r.n, avgPts: r.pts / r.n }));
  }

  function quizResult(st, s) {
    const m = OA.byId[st.module];
    const items = s.problems || [];
    const answered = items.filter((p) => p.g != null);
    const max = s.total;
    const frac = max ? Math.max(0, s.score) / max : 0;
    return {
      ...st, kind: 'quiz', session: s, score: s.score, max, frac, rating: rate(frac, GUIDE[st.module]),
      acc: OA.accuracy(items), right: s.right, wrong: s.wrong, skipped: s.skipped,
      late: items.filter((p) => p.late).length, unreached: Math.max(0, max - items.length),
      timeUsedMs: s.timeUsedMs || 0, limitMs: m.test.seconds * 1000, perQ: m.test.perQuestion,
      avgMs: answered.length ? answered.reduce((t, p) => t + (p.ms || 0), 0) / answered.length : null,
      topics: topics(items),
    };
  }

  function zapResult(st, s) {
    const items = s.problems || [];
    const base = { ...st, kind: 'zap', session: s, score: s.score, timeUsedMs: s.timeUsedMs || 0 };
    if (st.game === 'balloon') {
      const max = s.balloonMax || Zap.BALLOON_MAX;
      const best = Zap.GAMES.find((g) => g.id === 'balloon').balloons * Zap.expectedFor(max / 2, max);
      const stats = Zap.balloonStats(items.map((p) => ({ cashed: p.ok, pumps: Number(String(p.g).match(/\d+/)[0]) })), max);
      const eff = best ? Math.max(0, s.score) / best : 0;
      return { ...base, max, best, eff, stats, rating: rate(eff, ZAP_GUIDE.balloon), line: `${s.score} points · ${pct(eff)} of the best plan's expected ${Math.round(best)}` };
    }
    if (st.game === 'codes') {
      const wrongPicks = items.filter((p) => p.g != null && !p.ok).length;
      const slow = items.filter((p) => p.g == null).length;
      const okMs = items.filter((p) => p.ok).map((p) => p.ms || 0);
      const avgMs = okMs.length ? okMs.reduce((a, b) => a + b, 0) / okMs.length : null;
      return { ...base, wrongPicks, slow, avgMs, rating: rate(s.score, ZAP_GUIDE.codes), line: `Score ${s.score} · ${s.right} right · ${wrongPicks} wrong · ${slow} too slow` };
    }
    return { ...base, solved: s.right, skipped: s.wrong, rating: rate(s.score, ZAP_GUIDE.numberbox), line: `Score ${s.score} · ${s.right} solved · ${s.wrong} skipped` };
  }

  /** Ranked things to work on, biggest cost first. Weight ≈ points lost. */
  function findings(results) {
    const out = [];
    const add = (r, weight, title, detail, action) => out.push({ module: r.module, stage: r.key, name: r.module === 'zap' ? `Zap-N · ${r.name}` : r.name, weight, title, detail, action });
    for (const r of results.filter((x) => x.kind === 'quiz')) {
      for (const t of r.topics) {
        const weak = r.module === 'iv' ? t.n >= 2 && t.avgPts < 0.35 : t.n >= 2 && t.right / t.n <= 0.5;
        if (!weak) continue;
        const lost = r.module === 'iv' ? t.n - t.pts : t.n - t.right;
        const detail = r.module === 'iv'
          ? `Contained ${t.right} of ${t.n}, scoring ${t.avgPts.toFixed(2)} a question on average`
          : `${t.right} of ${t.n} right${t.wrong ? ` · ${t.wrong} wrong` : ''}${t.skipped ? ` · ${t.skipped} skipped` : ''} · ${secs(t.avgMs)} each`;
        add(r, lost, t.topic, detail, tipFor(r.module, t.topic));
      }
      const penalised = r.module === 'bto' || r.module === 'nl';
      if (penalised && r.wrong >= 3 && r.acc != null && r.acc < 0.6) {
        add(r, r.wrong * 0.8, 'Wrong answers are costing points',
          `${plural(r.wrong, 'wrong answer')} took ${plural(r.wrong, 'point')} off; ${pct(r.acc)} of the questions you answered were right`,
          'A wrong answer costs as much as a right one earns. Answer when you can narrow it to one or two options; otherwise skip for 0.');
      }
      if (penalised && r.skipped >= 5 && r.acc != null && r.acc >= 0.8) {
        add(r, r.skipped * 0.4, 'Too cautious with skips',
          `You skipped ${r.skipped} but got ${pct(r.acc)} of the ones you answered`,
          'At that hit rate an educated guess is worth more than a skip: answer once you can rule out most of the options.');
      }
      const lostToTime = r.late + r.unreached;
      if (lostToTime >= 2) {
        const parts = [r.late ? `${plural(r.late, 'question')} timed out` : '', r.unreached ? `${r.unreached} never reached` : ''].filter(Boolean);
        add(r, lostToTime, 'Ran out of time', parts.join(' · '),
          r.perQ ? `Budget about ${Math.round(r.perQ * 0.6)} s a question: if you aren't close by then, skip and move on.`
            : `That's about ${Math.round(r.limitMs / 1000 / r.max)} s a ${r.module === 'ob' ? 'board' : 'question'}: skip anything that runs well past it and come back if time allows.`);
      }
      if (r.unreached === 0 && r.timeUsedMs < r.limitMs * 0.6 && r.acc != null && r.acc < 0.6) {
        add(r, 2, 'Finished early with mistakes',
          `Done with ${Math.round((r.limitMs - r.timeUsedMs) / 60000)} min to spare at ${pct(r.acc)} accuracy`,
          'Spend the spare time checking: re-read what is asked and sanity-check the size of each answer.');
      }
      if (r.module === 'iv') {
        const c = IV.calibration(r.session.problems || []);
        if (c && c.hitRate < 0.7) {
          add(r, c.answered - c.hits, 'Ranges too narrow', `Contained the answer ${c.hits} of ${c.answered} times; every miss scores 0`,
            'A range twice as wide as needed still scores 0.5. Widen on the estimation questions until you would bet on it about 85% of the time.');
        } else if (c && c.hits && c.avgHit < 0.6) {
          add(r, (0.6 - c.avgHit) * c.hits * 2, 'Ranges too wide', `Contained ${c.hits} of ${c.answered}, but they scored only ${c.avgHit.toFixed(2)} on average`,
            'Tighten the exact questions to ±5–10% of your answer and keep the extra width for visual estimates.');
        }
      }
    }
    for (const r of results.filter((x) => x.kind === 'zap' && x.rating < 2)) {
      const w = r.rating === 0 ? 3 : 1.5;
      if (r.game === 'numberbox') {
        add(r, w, 'Number Box speed', `${plural(r.solved, 'target')} made in 3 minutes, ${r.skipped} skipped`,
          'Work back from the target: find a product of two numbers near it, then make up the gap with the other two. Skip after about 20 seconds.');
      } else if (r.game === 'codes') {
        if (r.wrongPicks >= 3) {
          add(r, w, 'Code Compare accuracy', `${plural(r.wrongPicks, 'wrong pick')} and ${r.slow} too slow`,
            'Compare in chunks of three or four characters, left to right, and watch the look-alikes: 0/O, 1/I, 5/S, 8/B, 2/Z.');
        } else {
          add(r, w, 'Code Compare speed', `Score ${r.score}${r.avgMs ? `, ${(r.avgMs / 1000).toFixed(2)} s per right answer` : ''}`,
            'Read the code once as two chunks, then check each option against the chunks instead of re-reading the code.');
        }
      } else {
        add(r, w, 'Balloon strategy', r.stats.advice, `Use the first few pops to judge the limit, then cash in at about half of it (${r.max / 2} pumps this game).`);
      }
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  /** What went well: strong modules and topics with at least 80% right. */
  function strengths(results) {
    const out = [];
    for (const r of results) {
      if (r.rating === 2) out.push(`${r.module === 'zap' ? `Zap-N · ${r.name}` : r.name}: ${r.kind === 'quiz' ? `${OA.formatScore(r.score)} of ${r.max}` : r.line}`);
    }
    // In the other modules, the two best-tested topics that went well.
    for (const r of results.filter((x) => x.kind === 'quiz' && x.rating < 2)) {
      r.topics.filter((t) => t.n >= 3 && t.right / t.n >= 0.8).sort((a, b) => b.n - a.n).slice(0, 2)
        .forEach((t) => out.push(`${r.name} · ${t.topic}: ${t.right} of ${t.n}`));
    }
    return out.slice(0, 6);
  }

  /** The full report for a run, or null if it has no finished stages. */
  function report(sessions, run) {
    const p = progress(sessions, run);
    const done = p.stages.filter((st) => st.session);
    if (!done.length) return null;
    const results = done.map((st) => (st.game ? zapResult(st, st.session) : quizResult(st, st.session)));
    // Zap-N reads as one module: its rating is the lower of its games' typical ratings.
    const modules = OA.MODULES.map((m) => {
      const rs = results.filter((r) => r.module === m.id);
      if (!rs.length) return { id: m.id, name: m.name, results: [], rating: null };
      const rating = m.id === 'zap' ? Math.floor(rs.reduce((t, r) => t + r.rating, 0) / rs.length) : rs[0].rating;
      return { id: m.id, name: m.name, results: rs, rating };
    });
    const activeMs = results.reduce((t, r) => t + r.timeUsedMs, 0);
    const startedAt = Math.min(...done.map((st) => st.session.at));
    const elapsedMs = p.lastEnd - startedAt;
    const tally = [0, 1, 2].map((k) => modules.filter((m) => m.rating === k).length);
    return {
      run, done: p.done, stagesDone: done.length, results, modules, tally,
      findings: findings(results).slice(0, 6), strengths: strengths(results),
      startedAt, endedAt: p.lastEnd, activeMs, breakMs: Math.max(0, elapsedMs - activeMs),
    };
  }

  return { STAGES, stageByKey, stageFormat, totalMinutes, newRun, progress, runs, report, findings, topics, tipFor, GUIDE, ZAP_GUIDE, RATINGS };
});
