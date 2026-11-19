// Which Monday starts a week, for the three places that need to know: the weekly goal
// (a Date), the leaderboard's weekly boards (a 'YYYY-MM-DD' key) and the practice
// calendar (its first column). Weeks run Monday to Sunday in the player's local time.
// The three differ a little in what they start from and return, so each keeps its own
// name; test/helpers-pin.test.js checks that they agree on the date, daylight saving included.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ZetaproWeeks = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  /** Days from the Monday of `d`'s week to `d`: 0 on a Monday, 6 on a Sunday. */
  const sinceMonday = (d) => (d.getDay() + 6) % 7;

  /** Midnight on the Monday of the week holding `date`, as a Date (the weekly goal). */
  function mondayStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - sinceMonday(d));
    return d;
  }

  /**
   * The Monday that starts the local week holding `at` (milliseconds), as 'YYYY-MM-DD' (the leaderboard).
   * Worked out from noon, so a daylight-saving change can never move the answer to another day.
   */
  function mondayKey(at) {
    const d = new Date(at);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - sinceMonday(d));
    return E.dayKey(d);
  }

  /** Midnight on the Monday `weeks - 1` weeks before the week holding `now`: the first day of a `weeks`-week calendar. */
  function calendarStart(now, weeks) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = new Date(today);
    d.setDate(d.getDate() - sinceMonday(today) - (weeks - 1) * 7);
    return d;
  }

  return { mondayStart, mondayKey, calendarStart };
});
