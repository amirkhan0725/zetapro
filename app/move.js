// Zetapro moved from amirkhan0725.github.io/zetapro to zetapro.app. The old
// address keeps serving the app, because installed copies and older Windows
// builds rely on it. There, this file always sends the page on to zetapro.app:
//   - with no saved games, straight to the same page there;
//   - with games, to zetapro.app/web/#zp-games=<the backup, gzipped>, which
//     adds them after asking. The link's #part never leaves the browser.
//   - if the games are too big for a link (or the browser can't compress), it
//     stays and shows a banner whose "Move my games" opens zetapro.app in a new
//     tab and hands the games over with postMessage instead.
// On zetapro.app it is the receiving half (#zp-games=… or ?move=1). Each
// postMessage side only accepts messages from the other's exact origin and
// window, and the new side always asks before adding anything. Elsewhere (the Windows app, zetapro.app itself) it
// does nothing. The pure parts are tested in test/move.test.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.ZetaproMove = api;
    if (root.document) api.mount(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NEW_ORIGIN = 'https://zetapro.app';
  const OLD_ORIGIN = 'https://amirkhan0725.github.io';
  const OLD_PATH = '/zetapro/';
  const READY = 'zetapro-move-ready';
  const GAMES = 'zetapro-move-games';
  const DONE = 'zetapro-move-done';
  // How long the old tab waits for zetapro.app before offering a backup file instead.
  const WAIT_MS = 60000;
  // Games carried in the link: #zp-games=<base64url of the gzipped backup>.
  const LINK = '#zp-games=';
  // Longest link to send; browsers take about 2 MB, Firefox less.
  const MAX_LINK = 900000;

  /** This page's side of the move: 'old', 'new' (asked to receive) or null. */
  function role(loc, platform) {
    if (platform === 'desktop') return null;
    if (loc.origin === OLD_ORIGIN && loc.pathname.startsWith(OLD_PATH)) return 'old';
    if (loc.origin === NEW_ORIGIN && loc.hash.startsWith(LINK)) return 'link';
    if (loc.origin === NEW_ORIGIN && new URLSearchParams(loc.search).get('move') === '1') return 'new';
    return null;
  }

  /** The same page on zetapro.app, where the app is at /web/: /zetapro/app/#x becomes https://zetapro.app/web/#x. */
  function newAddress(loc) {
    const rest = loc.pathname.slice(OLD_PATH.length).replace(/^app(\/|$)/, 'web$1');
    return `${NEW_ORIGIN}/${rest}${loc.search}${loc.hash}`;
  }

  /** A backup as link text: JSON, gzipped, base64url. Null when it can't or it's too long. */
  async function pack(backup, max = MAX_LINK) {
    if (typeof CompressionStream === 'undefined') return null;
    const gz = new Blob([JSON.stringify(backup)]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const text = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return text.length <= max ? text : null;
  }

  /** The backup back from pack()'s text. */
  async function unpack(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(json).text());
  }

  /**
   * The old side. Answers the new tab's "ready" with the games (once) and
   * reports its "done". Anything not from that tab at zetapro.app is ignored.
   */
  function sender({ win, target, getBackup, onDone }) {
    let sent = false;
    async function onMessage(e) {
      if (e.origin !== NEW_ORIGIN || e.source !== target || !e.data) return;
      if (e.data.type === READY && !sent) {
        sent = true;
        target.postMessage({ type: GAMES, backup: await getBackup() }, NEW_ORIGIN);
      } else if (e.data.type === DONE) {
        stop();
        onDone(Math.max(0, Number(e.data.added) || 0));
      }
    }
    function stop() { win.removeEventListener('message', onMessage); }
    win.addEventListener('message', onMessage);
    return { stop };
  }

  /**
   * The new side. Tells the old tab it's ready, adds the games it's sent
   * (addGames asks first) and reports how many were added.
   */
  function receiver({ win, opener, addGames }) {
    async function onMessage(e) {
      if (e.origin !== OLD_ORIGIN || e.source !== opener || !e.data || e.data.type !== GAMES) return;
      stop();
      let added = 0;
      try {
        added = await addGames(e.data.backup);
      } finally {
        opener.postMessage({ type: DONE, added }, OLD_ORIGIN);
      }
    }
    function stop() { win.removeEventListener('message', onMessage); }
    win.addEventListener('message', onMessage);
    opener.postMessage({ type: READY }, OLD_ORIGIN);
    return { stop };
  }

  // ---- on the page ------------------------------------------------------------

  function banner(win, QS) {
    const doc = win.document;
    // The move matters more than a one-time "what's new" note in the same corner.
    for (const old of doc.querySelectorAll('.announce')) old.remove();
    const el = doc.createElement('div');
    el.className = 'announce move-note';
    el.setAttribute('role', 'status');
    const say = (title, text, buttons) => {
      el.innerHTML = `<span class="announce-text"><b>${title}</b><span>${text}</span></span>${buttons}`;
    };
    const intro = () => say('Zetapro has moved to zetapro.app',
      'Bring the games saved in this browser along. It takes a second.',
      '<button class="btn primary small" data-move="go">Move my games</button><button class="btn ghost small" data-move="close">Not now</button>');
    const fallback = (why) => say(why,
      'Export a backup here, then open zetapro.app and import it under Manage data.',
      `<button class="btn primary small" data-move="export">Export backup</button><a class="btn small" href="${NEW_ORIGIN}/web/" target="_blank" rel="noopener">Open zetapro.app</a>`);
    intro();
    doc.body.append(el);

    let pending = null;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-move]');
      if (!b) return;
      const act = b.dataset.move;
      if (act === 'close') return el.remove();
      if (act === 'export') return QS.exportBackup();
      if (act !== 'go') return;
      const tab = win.open(`${NEW_ORIGIN}/web/?move=1`, '_blank');
      if (!tab) return fallback("Your browser blocked the new tab");
      if (pending) pending.stop();
      say('Moving your games…', 'Confirm in the zetapro.app tab.',
        '<button class="btn ghost small" data-move="export">Export a backup instead</button>');
      const timer = win.setTimeout(() => {
        if (pending) pending.stop();
        fallback("Couldn't reach zetapro.app from here");
      }, WAIT_MS);
      pending = sender({
        win,
        target: tab,
        getBackup: QS.backup,
        onDone: (added) => {
          win.clearTimeout(timer);
          if (added) {
            say(`Moved ${added} game${added === 1 ? '' : 's'} to zetapro.app`,
              'Use zetapro.app from now on, and add it to your home screen if you like.',
              `<a class="btn primary small" href="${NEW_ORIGIN}/web/">Open zetapro.app</a>`);
          } else {
            say('No games were added at zetapro.app', 'They may already be there, or the move was canceled.',
              '<button class="btn primary small" data-move="go">Try again</button><button class="btn ghost small" data-move="close">Close</button>');
          }
        },
      });
    });
  }

  let which = null;
  let booted = false;

  /** Runs as the script loads, before the app boots. */
  function mount(win) {
    which = role(win.location, win.zm && win.zm.platform);
    // Neither side should open with the first-run welcome.
    if (which) win.__zmNoWelcome = true;
    if (win.QS && win.QS.S && win.QS.S.booted) boot(win);
  }

  /** Called by app.js once the saved games are loaded. Returns 'leaving' when it sends the page away. */
  function boot(win = self) {
    if (booted || !which) return null;
    booted = true;
    const QS = win.QS;
    if (which === 'old') {
      if (!QS.S.data.sessions.length) {
        win.location.replace(newAddress(win.location));
        return 'leaving';
      }
      // Carry the games in the link; only if they don't fit, stay and offer Move my games.
      QS.backup().then((backup) => pack(backup)).catch(() => null).then((text) => {
        if (text) win.location.replace(`${NEW_ORIGIN}/web/${LINK}${text}`);
        else banner(win, QS);
      });
      return 'leaving';
    }
    if (which === 'link') {
      const text = win.location.hash.slice(LINK.length);
      // Off the address bar first, so a reload or a shared link doesn't carry the games.
      win.history.replaceState(null, '', win.location.pathname + win.location.search);
      unpack(text)
        .then((backup) => QS.addGames(backup, { place: 'your old Zetapro', source: 'your old Zetapro address' }))
        .catch(() => QS.toast("Couldn't read the games from your old address. Open it again, or import a backup under Manage data."));
      return 'link';
    }
    // The new side: drop ?move=1 so a reload doesn't ask again.
    win.history.replaceState(null, '', win.location.pathname + win.location.hash);
    if (!win.opener) {
      QS.toast('To move your games, press "Move my games" at the old address, or import a backup under Manage data.');
      return 'new';
    }
    receiver({
      win,
      opener: win.opener,
      addGames: (backup) => QS.addGames(backup, { place: 'your old Zetapro', source: 'your old Zetapro address' }),
    });
    return 'new';
  }

  return { role, newAddress, pack, unpack, sender, receiver, mount, boot, NEW_ORIGIN, OLD_ORIGIN, READY, GAMES, DONE, LINK };
});
