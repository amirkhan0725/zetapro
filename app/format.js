// Small text formatters the screens share: HTML escaping, durations, percentages, and
// m:ss clocks. Where two screens always formatted the same thing a little differently,
// both formats are kept, under names that say how they differ.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZetaproFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Text made safe to put inside HTML, in element content or in a quoted attribute. */
  const esc = (v) =>
    String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** 3456 ms → "3.5s" (Classic, drills, Stats). */
  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  /** 3456 ms → "3 s" (whole seconds, as the Full run's report writes them). */
  const secsWhole = (ms) => `${Math.round(ms / 1000)} s`;

  /** 0.666 → "67%": a 0–1 fraction as a whole percent. */
  const pct = (x) => `${Math.round(x * 100)}%`;
  /** 0.1667 → "16.7%"; a value under 1% keeps two decimals (Arcade probabilities). */
  function pctTenths(p) {
    const v = p * 100;
    return `${v < 1 && v > 0 ? v.toFixed(2) : v.toFixed(1)}%`;
  }
  /** 12.5 → "13", 3.14 → "3.1": a percentage already times 100, as a bare number (Intervals feedback). */
  const pctNumber = (v) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

  /** Milliseconds as m:ss, to the nearest second (Classic, 80 in 8). */
  const clockRound = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  /** Milliseconds as m:ss, rounded up, so a clock never reads 0:00 while time is left (Arcade). */
  const clockCeil = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return { esc, secs, secsWhole, pct, pctTenths, pctNumber, clockRound, clockCeil };
});
