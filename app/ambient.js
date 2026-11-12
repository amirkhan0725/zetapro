// Play page: a calm "math starfield" in the wide card under Record and This
// week. Faint digits and operators (with the odd π, √, Σ, ∞) drift and twinkle
// over one very faint curve that slowly changes shape. Decorative only: the
// card is aria-hidden and takes no input.
//
// Kept cheap on purpose:
// - about 30 fps, devicePixelRatio capped at 2;
// - every glyph is drawn once into a sprite atlas (again only when the theme,
//   the font or the pixel ratio changes) and copied with drawImage per frame;
//   the frame loop allocates nothing;
// - it stops completely while the card can't be seen: scrolled off, the window
//   hidden, another page showing, or a layout without the card (CSS hides it on
//   narrow and short windows);
// - with reduced motion it draws one still frame.
// window.ZetaproAmbient.state() reports what it's doing and what a frame costs.
(function () {
  'use strict';

  const FRAME_MS = 1000 / 30;
  const MAX_DPR = 2;
  const RESIZE_MS = 120;

  // Mostly digits, then operators, with a sprinkle of the fancier symbols.
  const GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '−', '×', '÷', '=', 'π', '√', 'Σ', '∞'];
  const N_DIGITS = 10;
  const N_OPS = 5;
  const N_RARE = 4;
  // Three depths, far to near: smaller, slower and fainter at the back.
  const SIZES = [11, 13, 17];
  const TIER_SPEED = [0.55, 1, 1.6];
  const TIER_ALPHA = [0.75, 0.9, 1];
  const CELL = 26; // CSS px per atlas cell, room for the largest glyph
  const HALF = CELL / 2;

  const MIN_GLYPHS = 34;
  const MAX_GLYPHS = 90;
  const AREA_PER_GLYPH = 2300; // CSS px² of card per glyph
  const DRIFT_X = 5.5; // px/s at the middle depth: a slow slide right, rising a little
  const DRIFT_Y = -1.1;
  const INK_ALPHA = 0.24; // peak opacity before twinkle and depth
  const ACCENT_ALPHA = 0.36;
  const ACCENT_SHARE = 0.28;
  const EDGE_X = 56; // glyphs fade out near the card's edges, so wrapping is invisible
  const EDGE_Y = 20;
  const WRAP = 16;

  const CURVE_ALPHA = 0.2;
  const CURVE_STEP = 8; // CSS px per line segment

  let card = null;
  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let laidW = 0; // the size the glyphs were last laid out for
  let laidH = 0;

  let atlas = null;
  let actx = null;
  let atlasCell = 0;
  let curveStroke = null;
  let ink = '';
  let accent = '';
  let family = '';
  let colorsDirty = true;
  let atlasDirty = true;
  let curveDirty = true;
  let stillDirty = true;

  // The glyphs, structure-of-arrays so the loop never allocates.
  const px = new Float32Array(MAX_GLYPHS);
  const py = new Float32Array(MAX_GLYPHS);
  const vx = new Float32Array(MAX_GLYPHS);
  const vy = new Float32Array(MAX_GLYPHS);
  const base = new Float32Array(MAX_GLYPHS);
  const freq = new Float32Array(MAX_GLYPHS);
  const phase = new Float32Array(MAX_GLYPHS);
  const gly = new Uint8Array(MAX_GLYPHS);
  const tone = new Uint8Array(MAX_GLYPHS);
  const tier = new Uint8Array(MAX_GLYPHS);
  let count = 0;

  let time = 0;
  let last = 0;
  let inView = false;
  let onPlay = false;
  let reduced = false;
  let running = false;
  let timer = 0;
  let raf = 0;
  let resizeTimer = 0;
  const stats = { frames: 0, lastMs: 0, sumMs: 0, maxMs: 0 };

  function pickGlyph() {
    const r = Math.random();
    if (r < 0.6) return (Math.random() * N_DIGITS) | 0;
    if (r < 0.93) return N_DIGITS + ((Math.random() * N_OPS) | 0);
    return N_DIGITS + N_OPS + ((Math.random() * N_RARE) | 0);
  }

  /** A fresh look and motion for glyph i (its position is the caller's). */
  function assign(i) {
    const r = Math.random();
    const t = r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
    const a = Math.random() < ACCENT_SHARE ? 1 : 0;
    const speed = TIER_SPEED[t] * (0.75 + Math.random() * 0.5);
    tier[i] = t;
    tone[i] = a;
    gly[i] = pickGlyph();
    vx[i] = DRIFT_X * speed;
    vy[i] = DRIFT_Y * speed * (0.5 + Math.random());
    base[i] = (a ? ACCENT_ALPHA : INK_ALPHA) * TIER_ALPHA[t] * (0.55 + Math.random() * 0.45);
    freq[i] = (Math.PI * 2) / (4 + Math.random() * 7); // a 4–11 s twinkle
    phase[i] = Math.random() * Math.PI * 2;
  }

  /** Fits the glyph count to the card's area; existing glyphs keep their places. */
  function layout(w, h) {
    const n = Math.max(MIN_GLYPHS, Math.min(MAX_GLYPHS, Math.round((w * h) / AREA_PER_GLYPH)));
    if (laidW && laidH) {
      const sx = w / laidW;
      const sy = h / laidH;
      for (let i = 0; i < count; i++) { px[i] *= sx; py[i] *= sy; }
    }
    // New glyphs spread evenly (an R2 low-discrepancy sequence), not in clumps.
    const ox = Math.random();
    const oy = Math.random();
    for (let i = count; i < n; i++) {
      assign(i);
      px[i] = ((ox + i * 0.7548776662) % 1) * w;
      py[i] = ((oy + i * 0.5698402910) % 1) * h;
    }
    count = n;
    laidW = w;
    laidH = h;
  }

  /** "#rrggbb" or "rgb(a)(…)" → [r, g, b], via the canvas's own color parser. */
  function rgbOf(color) {
    actx.fillStyle = '#000';
    actx.fillStyle = color;
    const c = String(actx.fillStyle);
    if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const m = c.match(/[\d.]+/g) || [0, 0, 0];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }

  /** Reads the theme's colors and font from the card; flags what must be rebuilt. */
  function readColors() {
    colorsDirty = false;
    const cs = getComputedStyle(card);
    const i = cs.getPropertyValue('--ink').trim() || '#808080';
    const a = cs.getPropertyValue('--accent').trim() || i;
    const f = cs.fontFamily || 'system-ui, sans-serif';
    if (i === ink && a === accent && f === family) return;
    ink = i;
    accent = a;
    family = f;
    atlasDirty = true;
    curveDirty = true;
    stillDirty = true;
  }

  /** Draws every glyph, in both tones and all three sizes, into the atlas. */
  function buildAtlas() {
    atlasDirty = false;
    const cp = Math.ceil(CELL * dpr);
    atlas.width = GLYPHS.length * cp; // also clears it
    atlas.height = 2 * SIZES.length * cp;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    for (let a = 0; a < 2; a++) {
      actx.fillStyle = a ? accent : ink;
      for (let t = 0; t < SIZES.length; t++) {
        actx.font = `400 ${SIZES[t] * dpr}px ${family}`;
        const cy = (a * SIZES.length + t) * cp + cp / 2;
        for (let g = 0; g < GLYPHS.length; g++) actx.fillText(GLYPHS[g], g * cp + cp / 2, cy);
      }
    }
    atlasCell = cp;
  }

  /** The curve's stroke: the accent, fading in and out at the card's ends. */
  function buildCurve() {
    curveDirty = false;
    const [r, g, b] = rgbOf(accent);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    grad.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, 1)`);
    grad.addColorStop(0.82, `rgba(${r}, ${g}, ${b}, 1)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    curveStroke = grad;
  }

  /** Everything a frame needs, built outside the frame loop. */
  function prepare() {
    if (colorsDirty) readColors();
    if (atlasDirty) buildAtlas();
    if (curveDirty) buildCurve();
  }

  /** One frame, advanced by dt seconds. Allocation-free. */
  function draw(dt) {
    const t0 = performance.now();
    time += dt;
    const T = time;
    const w = W;
    const h = H;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);

    // A faint plotted curve, slowly breathing and shifting.
    const amp = h * (0.17 + 0.05 * Math.sin(T * 0.11));
    const k = ((Math.PI * 2) / w) * (1.45 + 0.3 * Math.sin(T * 0.053));
    const ph = T * 0.3;
    const cy = h * 0.54;
    const segs = Math.ceil(w / CURVE_STEP) + 1;
    ctx.globalAlpha = CURVE_ALPHA;
    ctx.strokeStyle = curveStroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let s = 0; s <= segs; s++) {
      const x = s * CURVE_STEP;
      const y = cy + amp * Math.sin(x * k + ph) * (0.8 + 0.2 * Math.sin(x * k * 0.5 - ph * 0.6));
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // The glyphs.
    const cp = atlasCell;
    const spanX = w + 2 * WRAP;
    const spanY = h + 2 * WRAP;
    for (let i = 0; i < count; i++) {
      let x = px[i] + vx[i] * dt;
      let y = py[i] + vy[i] * dt;
      if (x > w + WRAP) { x -= spanX; y = Math.random() * h; assign(i); }
      else if (x < -WRAP) x += spanX;
      if (y < -WRAP) y += spanY;
      else if (y > h + WRAP) y -= spanY;
      px[i] = x;
      py[i] = y;
      const f = freq[i];
      const p = phase[i];
      const tw = 0.5 + 0.5 * Math.sin(T * f + p);
      let a = base[i] * (0.28 + 0.72 * tw * tw);
      const yy = y + 1.6 * Math.sin(T * f * 0.45 + p * 1.7); // a slight sway
      if (x < EDGE_X) a *= x > 0 ? x / EDGE_X : 0;
      else if (x > w - EDGE_X) a *= x < w ? (w - x) / EDGE_X : 0;
      if (yy < EDGE_Y) a *= yy > 0 ? yy / EDGE_Y : 0;
      else if (yy > h - EDGE_Y) a *= yy < h ? (h - yy) / EDGE_Y : 0;
      if (a < 0.006) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(atlas, gly[i] * cp, (tone[i] * SIZES.length + tier[i]) * cp, cp, cp, x - HALF, yy - HALF, CELL, CELL);
    }
    ctx.globalAlpha = 1;

    const ms = performance.now() - t0;
    stats.frames++;
    stats.lastMs = ms;
    stats.sumMs += ms;
    if (ms > stats.maxMs) stats.maxMs = ms;
  }

  // ---- scheduling: sleep on a timer, then draw on the next vsync -------------
  // The timer keeps the page from waking every display frame; the gate (on the
  // vsync timestamps) keeps it at about 30 fps whatever the display's rate.

  function tick() {
    timer = 0;
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    if (last && now - last < FRAME_MS - 4) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const begin = performance.now();
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    draw(dt);
    const wait = FRAME_MS - 10 - (performance.now() - begin);
    timer = setTimeout(tick, wait > 0 ? wait : 0);
  }

  function start() {
    if (running) return;
    prepare();
    running = true;
    last = 0;
    tick();
  }

  function stop() {
    if (!running) return;
    running = false;
    if (timer) clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    timer = 0;
    raf = 0;
  }

  /** Runs only while the card is laid out, on screen, on Play, in a visible window. */
  function update() {
    const shown = W > 0 && H > 0 && inView && onPlay && !document.hidden;
    if (shown && !reduced) { start(); return; }
    stop();
    if (shown && reduced && stillDirty) {
      prepare();
      draw(0);
      stillDirty = false;
    }
  }

  function applySize() {
    resizeTimer = 0;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const d = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (w === W && h === H && d === dpr) return;
    W = w;
    H = h;
    if (w > 0 && h > 0) {
      if (d !== dpr) atlasDirty = true;
      dpr = d;
      layout(w, h);
      canvas.width = Math.round(w * d); // resets the context, so the transform follows
      canvas.height = Math.round(h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      curveDirty = true;
      stillDirty = true;
      if (running) { prepare(); draw(0); } // no blank frame while the next one waits
    }
    update();
  }

  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    // Appearing (from a layout without the card) draws at once; resizes settle first.
    if (!W || !H) applySize();
    else resizeTimer = setTimeout(applySize, RESIZE_MS);
  }

  function onTheme() {
    colorsDirty = true;
    stillDirty = true;
    if (running) prepare();
    else update();
  }

  function watchPixelRatio() {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', () => { watchPixelRatio(); applySize(); }, { once: true });
  }

  function init() {
    card = document.getElementById('ambientCard');
    canvas = card && card.querySelector('canvas');
    ctx = canvas && canvas.getContext('2d');
    if (!ctx) return;
    atlas = document.createElement('canvas');
    actx = atlas.getContext('2d');

    onPlay = document.body.dataset.view === 'play';
    new MutationObserver(() => {
      onPlay = document.body.dataset.view === 'play';
      update();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });

    // Themes set data-theme (and colors) on <html>; Auto follows the OS.
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    window.addEventListener('zm-theme', onTheme);

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = motion.matches;
    motion.addEventListener('change', () => {
      reduced = motion.matches;
      stillDirty = true;
      update();
    });

    document.addEventListener('visibilitychange', update);
    new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      update();
    }).observe(card);
    new ResizeObserver(onResize).observe(canvas);
    watchPixelRatio();
    applySize();
  }

  window.ZetaproAmbient = {
    /** What it's doing, for tests: running, why not, the size, and frame costs in ms. */
    state() {
      return {
        running, inView, onPlay, reduced, hidden: document.hidden,
        width: W, height: H, dpr, glyphs: count, ink, accent,
        frames: stats.frames, lastMs: stats.lastMs, meanMs: stats.frames ? stats.sumMs / stats.frames : 0, maxMs: stats.maxMs,
      };
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
