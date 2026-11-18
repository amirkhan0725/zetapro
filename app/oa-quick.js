// Quick play: a casual arcade run over any OA module's questions. Three lives, a
// combo multiplier for answers in a row, a speed bonus, and a clock that gets
// faster every few right answers. The questions are the real ones; only the
// scoring and pacing are a game. Test mode is untouched.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OAQuick = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIVES = 3;
  const SKIPS = 3;
  const LEVEL_EVERY = 5; // right answers per level
  const MAX_MULT = 5;
  // Seconds per question at level 1: about half the Test's per-question budget.
  const SECONDS = { bto: 40, nl: 40, ll: 60, iv: 40, ob: 90 };

  const levelOf = (hits) => 1 + Math.floor(hits / LEVEL_EVERY);

  /** Seconds for a question: 10% less per level, down to half. */
  const secondsFor = (module, level) => Math.round(SECONDS[module] * Math.max(0.5, 1 - 0.1 * (level - 1)));

  /** The multiplier for an answer that makes `streak` in a row: ×2 from the 3rd, ×3 from the 6th… */
  const multiplier = (streak) => Math.min(MAX_MULT, 1 + Math.floor(streak / 3));

  /**
   * What a marked answer means in the run. `r` is the module's own mark
   * ({ g, ok, pts }); `kind` its question kind. Intervals score by quality
   * (lower ÷ upper), so a range that holds the answer but scores 0 earns
   * nothing without costing a life.
   */
  function judge(r, kind, timedOut = false) {
    if (timedOut) return { hit: false, quality: 0, life: true, skip: false };
    if (r.g == null) return { hit: false, quality: 0, life: false, skip: true };
    if (kind === 'interval') {
      if (!r.ok) return { hit: false, quality: 0, life: true, skip: false };
      return { hit: r.pts > 0, quality: r.pts, life: false, skip: false };
    }
    return { hit: !!r.ok, quality: r.ok ? 1 : 0, life: !r.ok, skip: false };
  }

  /** Points for a hit: 100 for the answer, up to 50 for speed, times the combo. */
  function points(quality, msLeft, msTotal, streak) {
    const speed = msTotal > 0 ? Math.max(0, Math.min(1, msLeft / msTotal)) : 0;
    return Math.round((100 * quality + 50 * quality * speed) * multiplier(streak));
  }

  /** A fresh run's state. */
  const newRun = () => ({ score: 0, lives: LIVES, skips: SKIPS, streak: 0, bestStreak: 0, hits: 0, level: 1, answered: 0 });

  /**
   * Applies one answer to the run, returning the new state and what happened
   * (points earned, a life lost, a level reached) for the screen to show.
   */
  function step(run, verdict, msLeft = 0, msTotal = 0) {
    const next = { ...run };
    const out = { points: 0, lifeLost: false, levelUp: false, comboUp: false, over: false };
    if (verdict.skip) {
      next.skips--;
      next.streak = 0;
    } else {
      next.answered++;
      if (verdict.hit) {
        next.streak++;
        next.bestStreak = Math.max(next.bestStreak, next.streak);
        next.hits++;
        out.points = points(verdict.quality, msLeft, msTotal, next.streak);
        next.score += out.points;
        out.comboUp = multiplier(next.streak) > multiplier(run.streak);
        next.level = levelOf(next.hits);
        out.levelUp = next.level > run.level;
      } else {
        next.streak = 0;
        if (verdict.life) {
          next.lives--;
          out.lifeLost = true;
        }
      }
    }
    out.over = next.lives <= 0;
    return { run: next, out };
  }

  /** A light-hearted title for how far a run got. */
  function title(hits) {
    if (hits >= 20) return 'Unstoppable';
    if (hits >= 15) return 'Locked in';
    if (hits >= 10) return 'Sharp';
    if (hits >= 6) return 'On a roll';
    if (hits >= 3) return 'Getting going';
    return 'Warming up';
  }

  /** Finished Quick play runs of a module, oldest first. */
  const runs = (sessions, module) => sessions.filter((s) => s.mode === 'oa' && s.quick && s.module === module && !s.aborted);

  /** Best score, plays and best combo for a module's Quick play. */
  function summary(sessions, module) {
    const list = runs(sessions, module);
    if (!list.length) return { plays: 0 };
    return {
      plays: list.length,
      best: Math.max(...list.map((s) => s.score)),
      last: list[list.length - 1].score,
      bestCombo: Math.max(...list.map((s) => s.bestCombo || 0)),
      bestLevel: Math.max(...list.map((s) => s.level || 1)),
    };
  }

  return { LIVES, SKIPS, LEVEL_EVERY, MAX_MULT, SECONDS, levelOf, secondsFor, multiplier, judge, points, newRun, step, title, runs, summary };
});
