// First run: a welcome card, then an optional six-step tour that dims the page
// around one element at a time with a small popover beside it. The steps, the
// first-run decision, the keys and the popover placement are plain functions
// (test/tour.test.js); mount() draws them over the page. "Take the tour" in the
// account menu runs it again.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.ZetaproTour = api;
    if (root.document) api.mount(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** localStorage: set once someone has picked anything on the welcome or seen the tour. */
  const FLAG = 'zetapro-onboarded';

  // targets: the first visible match is highlighted (the tabs sit in a bottom bar on phones).
  const STEPS = [
    { id: 'start', targets: ['#startBtn'], title: 'Classic', text: 'Your two-minute arithmetic sprint.' },
    { id: 'today', targets: ['#todayCard'], title: 'Today', text: 'The Daily Challenge, and what to practice next.' },
    { id: 'oa', targets: ['.tab[data-view="oa"]'], title: 'Arcade', text: 'Probability, estimation and quick-reasoning games.' },
    { id: 'stats', targets: ['.tab[data-view="stats"]'], title: 'Stats', text: "Where you lose time, and how you're improving." },
    { id: 'lb', targets: ['.tab[data-view="lb"]'], title: 'Leaderboard', text: 'Daily and all-time rankings. Sign in to post your bests.' },
    { id: 'account', targets: ['#acctBtn'], title: 'Account', text: 'Sign in to sync across devices. Themes are here too.' },
  ];

  /**
   * Whether to greet someone: a first run on this device, with no saved rounds,
   * no account and no earlier pick. `suppressed` is automation's opt-out.
   */
  function shouldWelcome({ rounds = 0, signedIn = false, onboarded = false, suppressed = false } = {}) {
    return !suppressed && !onboarded && !signedIn && rounds === 0;
  }

  /** An account has synced on this device before (cloud.js keeps a book per user). */
  const wasSignedIn = (keys) => (keys || []).some((k) => /^zetapro-cloud-./.test(k));

  /** The step after `i` for 'next' or 'back', or -1 once the last step is done. */
  function nextIndex(i, action, n) {
    if (action === 'back') return Math.max(0, i - 1);
    if (action === 'next') return i + 1 >= n ? -1 : i + 1;
    return i;
  }

  /** Tour keys: Esc skips, Enter and → / ↓ go on, ← / ↑ go back. */
  function keyAction(key) {
    if (key === 'Escape') return 'skip';
    if (key === 'Enter' || key === 'ArrowRight' || key === 'ArrowDown') return 'next';
    if (key === 'ArrowLeft' || key === 'ArrowUp') return 'back';
    return null;
  }

  /** The first selector `find` turns into an element, or null. */
  function pickTarget(selectors, find) {
    for (const sel of selectors) {
      const el = find(sel);
      if (el) return el;
    }
    return null;
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  /**
   * Where the popover goes for a target rect {top, left, width, height}: below it
   * if it fits, else above, else on the roomier side, kept inside the window.
   * side is 'below', 'above' or 'over' (it couldn't avoid the target); arrow is
   * the arrow's x within the popover, pointing at the target's center.
   */
  function place(t, pop, view, { gap = 12, margin = 12 } = {}) {
    const below = view.h - (t.top + t.height) - gap - margin;
    const above = t.top - gap - margin;
    let side = below >= pop.h ? 'below' : above >= pop.h ? 'above' : below >= above ? 'below' : 'above';
    const want = side === 'below' ? t.top + t.height + gap : t.top - gap - pop.h;
    const top = clamp(want, margin, view.h - pop.h - margin);
    if (top !== want) side = 'over';
    const cx = t.left + t.width / 2;
    const left = clamp(cx - pop.w / 2, margin, view.w - pop.w - margin);
    return { top: Math.round(top), left: Math.round(left), side, arrow: Math.round(clamp(cx - left, 18, pop.w - 18)) };
  }

  const api = { FLAG, STEPS, shouldWelcome, wasSignedIn, nextIndex, keyAction, pickTarget, place };

  // ---- on the page ------------------------------------------------------------

  api.mount = function mount(win) {
    const doc = win.document;
    const PAD = 6; // spotlight margin around the target
    let ui = null; // { kind: 'welcome', el, card, returnTo } | { kind: 'tour', block, spot, pop, i, target, returnTo, scrollY }

    // A blocked store reads as onboarded, so the welcome doesn't come back every launch.
    const onboarded = () => { try { return win.localStorage.getItem(FLAG) === '1'; } catch { return true; } };
    const markOnboarded = () => { try { win.localStorage.setItem(FLAG, '1'); } catch { /* storage blocked */ } };
    const storageKeys = () => { try { return Object.keys(win.localStorage); } catch { return []; } };
    const signedIn = () => {
      const cloud = win.QS && win.QS.S && win.QS.S.cloud;
      return !!(cloud && cloud.signedIn()) || wasSignedIn(storageKeys());
    };
    const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0
      && win.getComputedStyle(el).visibility !== 'hidden';

    // ---- keys and focus: nothing reaches the page while either is open --------

    function trapTab(e, box) {
      const items = [...box.querySelectorAll('button:not([disabled])')];
      e.preventDefault();
      if (!items.length) return;
      const at = items.indexOf(doc.activeElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at < 0 || at === items.length - 1 ? 0 : at + 1);
      items[next].focus();
    }

    function onKey(e) {
      if (!ui) return;
      e.stopPropagation();
      if (e.key === 'Tab') return trapTab(e, ui.kind === 'welcome' ? ui.card : ui.pop);
      if (ui.kind === 'welcome') {
        if (e.key === 'Escape') { e.preventDefault(); choose('skip'); }
        else if (e.key === 'Enter' && e.target === ui.card) { e.preventDefault(); choose('tour'); }
        return;
      }
      const act = keyAction(e.key);
      // A focused Back or Skip button answers its own Enter.
      if (!act || (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('.tour-pop button'))) return;
      e.preventDefault();
      if (e.repeat) return; // a held key doesn't race through the steps
      if (act === 'skip') finish();
      else go(nextIndex(ui.i, act, STEPS.length));
    }

    // Back where it was before (the account button when the menu item has gone).
    function restoreFocus(el) {
      if (el && el !== doc.body && visible(el)) el.focus({ preventScroll: true });
    }

    /** Closes the welcome or the tour without marking anything. */
    function close({ keepFocus = false } = {}) {
      if (!ui) return;
      const was = ui;
      ui = null;
      win.removeEventListener('keydown', onKey, true);
      if (was.kind === 'welcome') was.el.remove();
      else {
        win.removeEventListener('resize', onResize);
        win.removeEventListener('scroll', onScroll, true);
        was.block.remove(); was.spot.remove(); was.pop.remove();
        win.scrollTo(0, was.scrollY);
      }
      if (!keepFocus) restoreFocus(was.returnTo);
    }

    // ---- the welcome ----------------------------------------------------------

    function welcome() {
      close();
      const returnTo = doc.activeElement;
      const el = doc.createElement('div');
      el.className = 'welcome';
      el.innerHTML = `<div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcomeTitle" aria-describedby="welcomeText" tabindex="-1">
          <h1 id="welcomeTitle">Welcome to Zetapro</h1>
          <p id="welcomeText">Mental math practice that shows where you lose time.</p>
          <div class="welcome-actions">
            <button class="btn primary big" data-welcome="tour">Take the tour</button>
            <button class="btn big" data-welcome="signin">I have an account, sign in</button>
          </div>
          <button class="btn ghost small welcome-skip" data-welcome="skip">Skip</button>
        </div>`;
      const card = el.firstElementChild;
      const logo = doc.querySelector('.brand .logo');
      if (logo) {
        const big = logo.cloneNode(true);
        big.setAttribute('width', '56');
        big.setAttribute('height', '56');
        big.classList.add('welcome-logo');
        card.prepend(big);
      }
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-welcome]');
        if (b) choose(b.dataset.welcome);
      });
      doc.body.append(el);
      ui = { kind: 'welcome', el, card, returnTo };
      win.addEventListener('keydown', onKey, true);
      card.focus({ preventScroll: true });
    }

    function choose(what) {
      if (!ui || ui.kind !== 'welcome') return;
      markOnboarded();
      const returnTo = ui.returnTo;
      if (what === 'tour') {
        close({ keepFocus: true });
        start({ returnTo });
      } else {
        close();
        if (what === 'signin' && win.QS && win.QS.openAccount) win.QS.openAccount();
      }
    }

    /** Shows the welcome if this is a first run (see shouldWelcome). */
    function maybeWelcome() {
      const Q = win.QS;
      if (!Q || !Q.S || !Q.S.data || ui) return false;
      const yes = shouldWelcome({
        rounds: Q.S.data.sessions.length,
        signedIn: signedIn(),
        onboarded: onboarded(),
        suppressed: !!win.__zmNoWelcome,
      });
      if (yes) welcome();
      return yes;
    }

    // ---- the tour -------------------------------------------------------------

    function start({ returnTo } = {}) {
      close();
      const Q = win.QS;
      if (Q && Q.S && Q.S.view !== 'play') Q.show('play');
      const block = doc.createElement('div');
      block.className = 'tour-block';
      const spot = doc.createElement('div');
      spot.className = 'tour-spot';
      spot.setAttribute('aria-hidden', 'true');
      const pop = doc.createElement('div');
      pop.className = 'tour-pop';
      pop.tabIndex = -1;
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-modal', 'true');
      pop.setAttribute('aria-labelledby', 'tourTitle');
      pop.setAttribute('aria-describedby', 'tourText');
      pop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tour]');
        if (!b || !ui) return;
        if (b.dataset.tour === 'skip') finish();
        else go(nextIndex(ui.i, b.dataset.tour, STEPS.length));
      });
      doc.body.append(block, spot, pop);
      ui = { kind: 'tour', block, spot, pop, i: 0, target: null, returnTo: returnTo || doc.activeElement, scrollY: win.scrollY };
      win.addEventListener('keydown', onKey, true);
      win.addEventListener('resize', onResize);
      win.addEventListener('scroll', onScroll, true);
      go(0);
      // Glide between steps, but not from nowhere onto the first.
      setTimeout(() => spot.classList.add('glide'), 50);
    }

    function go(i) {
      if (!ui || ui.kind !== 'tour') return;
      if (i < 0) return finish();
      ui.i = i;
      const s = STEPS[i];
      const last = i === STEPS.length - 1;
      ui.pop.innerHTML = `<span class="tour-arrow" aria-hidden="true"></span>
        <div class="tour-count">${i + 1} of ${STEPS.length}</div>
        <h2 id="tourTitle">${s.title}</h2>
        <p id="tourText">${s.text}</p>
        <div class="tour-foot">
          <button class="btn ghost small tour-skip" data-tour="skip">Skip</button>
          <button class="btn small" data-tour="back"${i ? '' : ' disabled'}>Back</button>
          <button class="btn primary small" data-tour="next">${last ? 'Done' : 'Next'}</button>
        </div>`;
      layout(true);
      ui.pop.focus({ preventScroll: true });
    }

    function finish() {
      markOnboarded();
      close();
    }

    /** Spotlights the step's target and puts the popover beside it. */
    function layout(scroll) {
      if (!ui || ui.kind !== 'tour') return;
      const s = STEPS[ui.i];
      const el = pickTarget(s.targets, (sel) => { const e = doc.querySelector(sel); return visible(e) ? e : null; });
      ui.target = el;
      const vw = doc.documentElement.clientWidth;
      const vh = win.innerHeight;
      // Off screen (a phone's Today card, say): bring it to the middle. The top bar
      // and the phone tab bar never scroll, so their buttons are always in view.
      if (el && scroll && !el.closest('.topbar')) {
        const r = el.getBoundingClientRect();
        if (r.top < 72 || r.bottom > vh - 88) el.scrollIntoView({ block: 'center' });
      }
      const box = { w: ui.pop.offsetWidth, h: ui.pop.offsetHeight };
      let pos;
      if (el) {
        const r = el.getBoundingClientRect();
        const t = { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
        Object.assign(ui.spot.style, { top: `${t.top}px`, left: `${t.left}px`, width: `${t.width}px`, height: `${t.height}px` });
        ui.spot.hidden = false;
        pos = place(t, box, { w: vw, h: vh });
      } else {
        // Nothing to point at: dim everything and center the popover.
        ui.spot.hidden = true;
        pos = { top: Math.round((vh - box.h) / 2), left: Math.round((vw - box.w) / 2), side: 'over', arrow: 0 };
      }
      ui.block.classList.toggle('dim', !el);
      Object.assign(ui.pop.style, { top: `${pos.top}px`, left: `${pos.left}px` });
      ui.pop.dataset.side = pos.side;
      ui.pop.style.setProperty('--arrow-x', `${pos.arrow}px`);
    }
    const onResize = () => layout(true);
    const onScroll = () => layout(false);

    // ---- wiring ---------------------------------------------------------------

    const menuItem = doc.getElementById('tourBtn');
    if (menuItem) menuItem.addEventListener('click', () => start({ returnTo: doc.getElementById('acctBtn') }));

    /** Called once app.js has drawn the first screen. */
    function boot() { maybeWelcome(); }

    const state = () => (!ui ? null : ui.kind === 'welcome' ? { kind: 'welcome' }
      : { kind: 'tour', step: ui.i, id: STEPS[ui.i].id, target: ui.target });

    Object.assign(api, { boot, maybeWelcome, welcome, start, close, state });
    // app.js may have finished booting before this file loaded.
    if (win.QS && win.QS.S && win.QS.S.booted) boot();
  };

  return api;
});
