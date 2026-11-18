// Challenges and share images.
//
// Challenge links: a standard Classic round (Zetamac's defaults, 120 s) is drawn
// from a random seed that's saved with the round. "Challenge a friend" copies
// zetapro.app/web/#ch=<seed>.<score>[.<name>]; opening it offers the exact same
// problems in the same order, and the results compare the two scores. The score
// in a link is whatever the sender's app put there: it's for fun, like the
// leaderboards, and nothing is posted anywhere.
//
// Share images: a 1200 × 675 card (X's large-image size) of a Classic result,
// drawn on a canvas. The pure parts here are tested in test/share.test.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZetaproShare = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const PREFIX = '#ch=';
  const MAX_NAME = 24;
  const MAX_SEED = 0xffffffff;

  /** A fresh 32-bit seed for a round that could become a challenge. */
  const newSeed = (rng = Math.random) => Math.floor(rng() * (MAX_SEED + 1)) >>> 0;

  /** Only standard Classic rounds become challenges, so both players face the same thing. */
  const challengeable = (E, config, duration) => duration === 120 && E.isDefaultConfig({ ...config, duration });

  /** Printable, short, no control characters: names arrive from links. */
  function cleanName(name) {
    if (typeof name !== 'string') return null;
    const s = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
    return s || null;
  }

  function encodeChallenge({ seed, score, name }) {
    const n = cleanName(name);
    return `${(seed >>> 0).toString(36)}.${Math.max(0, Math.round(score))}${n ? `.${encodeURIComponent(n)}` : ''}`;
  }

  /** The challenge in a location hash, or null if there's none or it's malformed. */
  function parseChallenge(hash) {
    if (typeof hash !== 'string' || !hash.startsWith(PREFIX)) return null;
    const [s, sc, ...rest] = hash.slice(PREFIX.length).split('.');
    if (!/^[0-9a-z]{1,7}$/.test(s || '') || !/^\d{1,4}$/.test(sc || '')) return null;
    const seed = parseInt(s, 36);
    const score = Number(sc);
    if (!(seed >= 0 && seed <= MAX_SEED) || score > 999) return null;
    let name = null;
    if (rest.length) {
      try { name = cleanName(decodeURIComponent(rest.join('.'))); } catch { name = null; }
    }
    return { seed, score, name };
  }

  const challengeUrl = (site, c) => `${site}web/${PREFIX}${encodeChallenge(c)}`;

  function challengeText(score, url) {
    return `I got ${score} on this Zetapro round. Same problems for you, 120 seconds. Can you beat it?\n${url}`;
  }

  /** "won by 3", "lost by 2", "tied". */
  function verdict(mine, theirs) {
    if (mine === theirs) return { kind: 'tied', text: 'tied' };
    const d = Math.abs(mine - theirs);
    return mine > theirs ? { kind: 'won', text: `won by ${d}` } : { kind: 'lost', text: `lost by ${d}` };
  }

  // ---- the share image -------------------------------------------------------

  const W = 1200;
  const H = 675;
  const COLORS = { bg: '#0b0e13', ink: '#f4f1ea', muted: '#8d96a3', accent: '#4a94f0', line: '#1d2430', won: '#4cc38a', lost: '#f08a6a' };
  const SANS = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';
  const SERIF = '"Cambria Math", Cambria, Georgia, "Times New Roman", serif';
  const GLYPHS = [['+', 930, 120, 84], ['×', 1090, 190, 70], ['÷', 1010, 300, 64], ['π', 1120, 420, 76], ['√', 950, 470, 70], ['∑', 1080, 590, 64], ['7', 860, 590, 60]];

  /**
   * info: { title, score, scoreNote, stats: [[label, value]...] (up to 3),
   *         vs: { name, score, kind, text } | null }
   */
  function drawCard(canvas, info) {
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, W, H);
    // Faint drifting math symbols on the right, as on the app's Play page.
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const [g, x, y, size] of GLYPHS) {
      c.font = `${size}px ${SERIF}`;
      c.fillStyle = COLORS.accent;
      c.globalAlpha = 0.22;
      c.fillText(g, x, y);
    }
    c.globalAlpha = 1;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';

    // Brand: an accent tile with ζ, then the name.
    c.fillStyle = COLORS.accent;
    roundRect(c, 72, 64, 52, 52, 12);
    c.fill();
    c.fillStyle = COLORS.bg;
    c.font = `600 40px ${SERIF}`;
    c.textAlign = 'center';
    c.fillText('ζ', 98, 104);
    c.textAlign = 'left';
    c.fillStyle = COLORS.ink;
    c.font = `600 34px ${SANS}`;
    c.fillText('Zetapro', 142, 102);

    c.fillStyle = COLORS.muted;
    c.font = `500 32px ${SANS}`;
    c.fillText(info.title, 72, 186);

    c.fillStyle = COLORS.ink;
    c.font = `700 210px ${SANS}`;
    c.fillText(String(info.score), 64, 368);
    const scoreW = c.measureText(String(info.score)).width;
    c.fillStyle = COLORS.muted;
    c.font = `500 30px ${SANS}`;
    c.fillText(info.scoreNote, 64 + scoreW + 24, 366);

    let y = 380;
    if (info.vs) {
      c.font = `600 34px ${SANS}`;
      c.fillStyle = info.vs.kind === 'won' ? COLORS.won : info.vs.kind === 'lost' ? COLORS.lost : COLORS.ink;
      c.fillText(`vs ${info.vs.name || 'a friend'}'s ${info.vs.score}: ${info.vs.text}`, 72, y + 44);
      y += 50;
    }

    // Stats row.
    const stats = (info.stats || []).slice(0, 3);
    const cols = [[72, 250], [342, 200], [562, W - 72 - 562]];
    stats.forEach(([label, value], i) => {
      const [x, colW] = cols[i];
      c.fillStyle = COLORS.muted;
      c.font = `500 24px ${SANS}`;
      c.fillText(label, x, y + 46);
      c.fillStyle = COLORS.ink;
      c.font = `600 36px ${SANS}`;
      c.fillText(fit(c, value, colW - 24), x, y + 90);
    });

    c.fillStyle = COLORS.line;
    c.fillRect(72, H - 92, W - 144, 2);
    c.fillStyle = COLORS.accent;
    c.font = `600 30px ${SANS}`;
    c.fillText('zetapro.app', 72, H - 44);
    c.fillStyle = COLORS.muted;
    c.font = `500 26px ${SANS}`;
    c.textAlign = 'right';
    c.fillText('mental math, timed', W - 72, H - 44);
    c.textAlign = 'left';
    return canvas;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /** Shortens text with an ellipsis until it fits in `max` pixels. */
  function fit(c, text, max) {
    let t = String(text);
    if (c.measureText(t).width <= max) return t;
    while (t.length > 1 && c.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  }

  return { PREFIX, MAX_NAME, W, H, newSeed, challengeable, cleanName, encodeChallenge, parseChallenge, challengeUrl, challengeText, verdict, drawCard };
});
