// Color themes, as data. MAIN are the eight in the account menu (two light, two
// mid-tone, four dark); MORE are the rest, in the "More themes" picker. app.js puts
// a theme's palette on <html> as CSS custom properties. Light and Dark are also
// the stylesheet's own defaults (:root and its dark block), which Auto follows; a
// test keeps those blocks and the data here equal.
//
// The original palettes (Light, Dark, Paper, Rose, Lavender, Midnight, Forest,
// Ember and the two high-contrast ones) are hand-tuned and listed in full. The
// others give a few base colors and derive() works out the rest, nudging text
// colors just far enough to reach WCAG AA contrast (test/themes.test.js checks
// every theme). `base` is the light or dark mode a theme builds on, which the
// desktop app hands to the OS so native controls and the window buttons match.
//
// Palette sources. All are MIT-licensed; colors are adjusted where contrast needed it:
//   Solarized         Ethan Schoonover, github.com/altercation/solarized
//   Gruvbox           Pavel Pertsev, github.com/morhetz/gruvbox
//   Catppuccin        github.com/catppuccin/catppuccin (Latte, Frappé, Mocha)
//   Rosé Pine         github.com/rose-pine/rose-pine-theme (main, Dawn)
//   Everforest        Sainnhe Park, github.com/sainnhe/everforest
//   One Dark / Light  Atom, github.com/atom/atom (packages/one-dark-ui, one-light-ui)
//   Nord              Arctic Ice Studio, github.com/nordtheme/nord
//   Dracula           github.com/dracula/dracula-theme
//   Tokyo Night       enkia, github.com/enkia/tokyo-night-vscode-theme
//   Kanagawa          rebelot, github.com/rebelot/kanagawa.nvim
//   Night Owl         Sarah Drasner, github.com/sdras/night-owl-vscode-theme
// Ash, Slate, Meadow, Glacier, Fog, Clay, Sage, Dusk, Lagoon and Plum are this app's own.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZetaproThemes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Every color a theme sets, as CSS custom properties (without the leading --). */
  const TOKENS = ['page', 'surface', 'surface-2', 'ink', 'ink-2', 'muted', 'grid', 'axis', 'border', 'border-strong',
    'accent', 'accent-hover', 'accent-text', 'accent-wash', 'on-accent', 'series-1', 'good', 'bad', 'bad-wash', 'shadow'];

  // ---- color arithmetic (#rrggbb) -------------------------------------------------
  const rgb = (c) => {
    const h = c.replace('#', '');
    const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const hex = (v) => `#${v.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => {
    const x = rgb(a);
    const y = rgb(b);
    return hex(x.map((v, i) => v + (y[i] - v) * t));
  };
  /** WCAG relative luminance. */
  const lum = (c) => {
    const [r, g, b] = rgb(c).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /** WCAG contrast ratio, 1 to 21. */
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const rgba = (c, a) => `rgba(${rgb(c).join(', ')}, ${a.toFixed(2)})`;
  /**
   * `c`, moved toward black or white (away from the first background) only as far
   * as it takes to reach each [background, ratio] pair.
   */
  const reach = (c, pairs) => {
    const toward = lum(c) < lum(pairs[0][0]) ? '#000000' : '#ffffff';
    for (let i = 0; i <= 50; i++) {
      const m = i ? mix(c, toward, i / 50) : c;
      if (pairs.every(([bg, ratio]) => contrast(m, bg) >= ratio)) return m;
    }
    return toward;
  };
  /**
   * [accent, text on accent-filled buttons]. A light theme keeps white text if an
   * accent at most a fifth deeper allows it; otherwise (and on a dark theme) a deep
   * shade of the accent or white, whichever reaches 4.5:1, moving the accent a
   * step at a time (deeper on light themes, lighter on dark) until one does.
   */
  const onAccent = (accent, dark) => {
    const deep = (a) => mix(a, '#000000', 0.84);
    const step = (i) => (i ? mix(accent, dark ? '#ffffff' : '#000000', i / 50) : accent);
    if (!dark) for (let i = 0; i <= 10; i++) if (contrast('#ffffff', step(i)) >= 4.5) return [step(i), '#ffffff'];
    for (let i = 0; i <= 25; i++) {
      for (const o of [deep(step(i)), '#ffffff']) if (contrast(o, step(i)) >= 4.5) return [step(i), o];
    }
    return [accent, dark ? '#000000' : '#ffffff'];
  };

  /**
   * A full palette from a few base colors: page, surface (cards), ink (text) and
   * accent, plus any token given outright (good, bad, ink-2, muted, surface-2...).
   */
  function derive(s) {
    const dark = lum(s.page) < lum(s.ink);
    const mid = lum(s.page) > 0.03 && lum(s.page) < 0.55;
    const { page, surface } = s;
    const s2 = s['surface-2'] || mix(surface, s.ink, dark ? 0.06 : 0.05);
    const ink = reach(s.ink, [[page, 7], [surface, 7]]);
    const ink2 = reach(s['ink-2'] || mix(ink, surface, 0.3), [[surface, 4.5], [page, 4.5], [s2, 4.5]]);
    const muted = reach(s.muted || mix(ink, surface, 0.5), [[surface, 3], [page, 3]]);
    const [accent, on] = s['on-accent'] ? [s.accent, s['on-accent']] : onAccent(s.accent, dark);
    const good = reach(s.good || (dark ? '#4ade80' : '#2e7d32'), [[surface, 4.5], [page, 4.5]]);
    const bad = reach(s.bad || (dark ? '#f87171' : '#c62828'), [[surface, 4.5], [page, 4.5]]);
    const line = mid ? [0.14, 0.24] : [0.10, 0.18];
    return {
      page,
      surface,
      'surface-2': s2,
      ink,
      'ink-2': ink2,
      muted,
      grid: s.grid || mix(surface, ink, dark ? 0.09 : 0.11),
      axis: s.axis || mix(surface, ink, dark ? 0.16 : 0.24),
      border: rgba(ink, line[0]),
      'border-strong': rgba(ink, line[1]),
      accent,
      'accent-hover': dark ? mix(accent, '#ffffff', 0.15) : mix(accent, '#000000', 0.12),
      'accent-text': reach(s['accent-text'] || accent, [[surface, 4.5], [page, 4.5]]),
      'accent-wash': rgba(accent, dark || mid ? 0.14 : 0.10),
      'on-accent': on,
      'series-1': accent,
      good,
      bad,
      'bad-wash': rgba(bad, dark ? 0.14 : 0.10),
      shadow: dark ? 'none' : `0 1px 2px ${rgba(ink, 0.04)}, 0 4px 16px ${rgba(ink, 0.05)}`,
    };
  }

  // ---- the themes -----------------------------------------------------------------
  // tone: 'light' | 'neutral' (mid-tone) | 'dark', for grouping. `full` is a
  // hand-tuned palette, used exactly; `from` is derive()'s input.
  const THEMES = [
    // Main: the account menu, in this order.
    { id: 'light', name: 'Light', tone: 'light', main: true, css: true, full: {
      page: '#f9f9f7', surface: '#fcfcfb', 'surface-2': '#f2f1ed', ink: '#0b0b0b', 'ink-2': '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
      border: 'rgba(11, 11, 11, 0.10)', 'border-strong': 'rgba(11, 11, 11, 0.18)',
      accent: '#2976d3', 'accent-hover': '#256abf', 'accent-text': '#1c5cab', 'accent-wash': 'rgba(42, 120, 214, 0.10)', 'on-accent': '#fff', 'series-1': '#2a78d6',
      good: '#006300', bad: '#d03b3b', 'bad-wash': 'rgba(208, 59, 59, 0.10)', shadow: '0 1px 2px rgba(11, 11, 11, 0.04), 0 4px 16px rgba(11, 11, 11, 0.04)' } },
    { id: 'paper', name: 'Paper', tone: 'light', main: true, full: {
      page: '#f4efe6', surface: '#fbf8f2', 'surface-2': '#ebe4d6', ink: '#2b2622', 'ink-2': '#5c544b', muted: '#8a8173', grid: '#e0d8c8', axis: '#c9bfac',
      border: 'rgba(43, 38, 34, 0.12)', 'border-strong': 'rgba(43, 38, 34, 0.20)',
      accent: '#b4532a', 'accent-hover': '#9c4622', 'accent-text': '#8f3f1e', 'accent-wash': 'rgba(180, 83, 42, 0.12)', 'on-accent': '#fff', 'series-1': '#b4532a',
      good: '#3f7d20', bad: '#c0392b', 'bad-wash': 'rgba(192, 57, 43, 0.10)', shadow: '0 1px 2px rgba(43, 38, 34, 0.05), 0 4px 16px rgba(43, 38, 34, 0.05)' } },
    { id: 'ash', name: 'Ash', tone: 'neutral', main: true, from: { page: '#a8a298', surface: '#b2ada3', ink: '#24211d', accent: '#174b51', good: '#1f4d17', bad: '#7a170f' } },
    { id: 'slate', name: 'Slate', tone: 'neutral', main: true, from: { page: '#3d4555', surface: '#475062', ink: '#f2f4f8', accent: '#93bbf5', good: '#93dba5', bad: '#ffa3a3' } },
    { id: 'dark', name: 'Dark', tone: 'dark', main: true, css: true, full: {
      page: '#0d0d0d', surface: '#1a1a19', 'surface-2': '#232321', ink: '#f0efec', 'ink-2': '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835',
      border: 'rgba(255, 255, 255, 0.10)', 'border-strong': 'rgba(255, 255, 255, 0.18)',
      accent: '#3987e5', 'accent-hover': '#5598e7', 'accent-text': '#86b6ef', 'accent-wash': 'rgba(57, 135, 229, 0.16)', 'on-accent': '#071526', 'series-1': '#3987e5',
      good: '#0ca30c', bad: '#e66767', 'bad-wash': 'rgba(230, 103, 103, 0.14)', shadow: 'none' } },
    { id: 'midnight', name: 'Midnight', tone: 'dark', main: true, full: {
      page: '#0b1020', surface: '#131a2e', 'surface-2': '#1b2440', ink: '#e6ebf5', 'ink-2': '#a9b4cc', muted: '#7783a0', grid: '#232d4a', axis: '#2f3a5a',
      border: 'rgba(230, 235, 245, 0.10)', 'border-strong': 'rgba(230, 235, 245, 0.18)',
      accent: '#38bdf8', 'accent-hover': '#5ccbfa', 'accent-text': '#7dd3fc', 'accent-wash': 'rgba(56, 189, 248, 0.14)', 'on-accent': '#04202e', 'series-1': '#38bdf8',
      good: '#34d399', bad: '#f87171', 'bad-wash': 'rgba(248, 113, 113, 0.14)', shadow: 'none' } },
    { id: 'forest', name: 'Forest', tone: 'dark', main: true, full: {
      page: '#0c1410', surface: '#131f19', 'surface-2': '#1a2a22', ink: '#e4efe8', 'ink-2': '#a7bdb0', muted: '#7a9184', grid: '#22342b', axis: '#2e4438',
      border: 'rgba(228, 239, 232, 0.10)', 'border-strong': 'rgba(228, 239, 232, 0.18)',
      accent: '#4ade80', 'accent-hover': '#6ee7a0', 'accent-text': '#86efac', 'accent-wash': 'rgba(74, 222, 128, 0.14)', 'on-accent': '#052e16', 'series-1': '#4ade80',
      good: '#a3e635', bad: '#f87171', 'bad-wash': 'rgba(248, 113, 113, 0.14)', shadow: 'none' } },
    { id: 'ember', name: 'Ember', tone: 'dark', main: true, full: {
      page: '#14110e', surface: '#1d1915', 'surface-2': '#27211b', ink: '#f3ece4', 'ink-2': '#c9bcae', muted: '#988a7b', grid: '#2f2821', axis: '#3d342b',
      border: 'rgba(243, 236, 228, 0.10)', 'border-strong': 'rgba(243, 236, 228, 0.18)',
      accent: '#f59e0b', 'accent-hover': '#fbb53c', 'accent-text': '#fcd34d', 'accent-wash': 'rgba(245, 158, 11, 0.14)', 'on-accent': '#2a1a02', 'series-1': '#f59e0b',
      good: '#84cc16', bad: '#f87171', 'bad-wash': 'rgba(248, 113, 113, 0.14)', shadow: 'none' } },

    // More themes: light
    { id: 'rose', name: 'Rose', tone: 'light', full: {
      page: '#fbf3f5', surface: '#fffafb', 'surface-2': '#f5e6ea', ink: '#2a1b21', 'ink-2': '#5e4650', muted: '#8f7781', grid: '#efdde3', axis: '#dcc3cc',
      border: 'rgba(42, 27, 33, 0.10)', 'border-strong': 'rgba(42, 27, 33, 0.18)',
      accent: '#c2185b', 'accent-hover': '#a8144f', 'accent-text': '#9c1450', 'accent-wash': 'rgba(194, 24, 91, 0.10)', 'on-accent': '#fff', 'series-1': '#c2185b',
      good: '#2e7d32', bad: '#d32f2f', 'bad-wash': 'rgba(211, 47, 47, 0.10)', shadow: '0 1px 2px rgba(42, 27, 33, 0.04), 0 4px 16px rgba(42, 27, 33, 0.05)' } },
    { id: 'lavender', name: 'Lavender', tone: 'light', full: {
      page: '#f6f4fb', surface: '#fcfbff', 'surface-2': '#ece8f6', ink: '#1d1830', 'ink-2': '#4f4867', muted: '#847e9b', grid: '#e2ddf0', axis: '#c9c2de',
      border: 'rgba(29, 24, 48, 0.10)', 'border-strong': 'rgba(29, 24, 48, 0.18)',
      accent: '#6d4ad8', 'accent-hover': '#5d3cc2', 'accent-text': '#5534b6', 'accent-wash': 'rgba(109, 74, 216, 0.10)', 'on-accent': '#fff', 'series-1': '#6d4ad8',
      good: '#2b8a3e', bad: '#e03131', 'bad-wash': 'rgba(224, 49, 49, 0.10)', shadow: '0 1px 2px rgba(29, 24, 48, 0.04), 0 4px 16px rgba(29, 24, 48, 0.05)' } },
    // High contrast: the strongest text and borders, for easier reading.
    { id: 'contrast-light', name: 'High Contrast', tone: 'light', full: {
      page: '#ffffff', surface: '#f0f0f0', 'surface-2': '#e2e2e2', ink: '#000000', 'ink-2': '#1a1a1a', muted: '#4a4a4a', grid: '#c8c8c8', axis: '#8f8f8f',
      border: 'rgba(0, 0, 0, 0.38)', 'border-strong': 'rgba(0, 0, 0, 0.65)',
      accent: '#0040c0', 'accent-hover': '#00309a', 'accent-text': '#00319a', 'accent-wash': 'rgba(0, 64, 192, 0.12)', 'on-accent': '#fff', 'series-1': '#0040c0',
      good: '#005c00', bad: '#b00000', 'bad-wash': 'rgba(176, 0, 0, 0.10)', shadow: 'none' } },
    { id: 'solarized-light', name: 'Solarized Light', tone: 'light', from: { page: '#eee8d5', surface: '#fdf6e3', ink: '#073642', 'ink-2': '#586e75', muted: '#93a1a1', accent: '#268bd2', good: '#859900', bad: '#dc322f' } },
    { id: 'gruvbox-light', name: 'Gruvbox Light', tone: 'light', from: { page: '#fbf1c7', surface: '#f9f5d7', ink: '#282828', 'ink-2': '#504945', muted: '#7c6f64', accent: '#af3a03', good: '#79740e', bad: '#9d0006' } },
    { id: 'catppuccin-latte', name: 'Catppuccin Latte', tone: 'light', from: { page: '#eff1f5', surface: '#e6e9ef', ink: '#4c4f69', 'ink-2': '#5c5f77', muted: '#7c7f93', accent: '#8839ef', good: '#40a02b', bad: '#d20f39' } },
    { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', tone: 'light', from: { page: '#faf4ed', surface: '#fffaf3', 'surface-2': '#f2e9e1', ink: '#575279', 'ink-2': '#797593', muted: '#9893a5', accent: '#286983', good: '#56949f', bad: '#b4637a' } },
    { id: 'everforest-light', name: 'Everforest Light', tone: 'light', from: { page: '#f4f0d9', surface: '#fdf6e3', ink: '#5c6a72', 'ink-2': '#5c6a72', muted: '#939f91', accent: '#8da101', good: '#8da101', bad: '#f85552' } },
    { id: 'one-light', name: 'One Light', tone: 'light', from: { page: '#eaeaeb', surface: '#fafafa', ink: '#383a42', 'ink-2': '#696c77', muted: '#a0a1a7', accent: '#4078f2', good: '#50a14f', bad: '#e45649' } },
    { id: 'meadow', name: 'Meadow', tone: 'light', from: { page: '#eef4ea', surface: '#f8fbf5', ink: '#16241a', accent: '#2f7a4c', good: '#3b7a1f', bad: '#c0392b' } },
    { id: 'glacier', name: 'Glacier', tone: 'light', from: { page: '#ecf3f8', surface: '#f8fbfd', ink: '#0f1e2b', accent: '#16679f', good: '#1f7a4d', bad: '#c43a3a' } },

    // More themes: mid-tone
    { id: 'fog', name: 'Fog', tone: 'neutral', from: { page: '#b3bbc5', surface: '#c2c9d2', ink: '#10151b', accent: '#1d4a85', good: '#1e5b2c', bad: '#8c1c1c' } },
    { id: 'clay', name: 'Clay', tone: 'neutral', from: { page: '#c8b29d', surface: '#d5c2b0', ink: '#22160d', accent: '#8a3218', good: '#3c5a17', bad: '#8f1a10' } },
    { id: 'sage', name: 'Sage', tone: 'neutral', from: { page: '#acbaa9', surface: '#bbc8b8', ink: '#111a11', accent: '#2c5634', good: '#24521d', bad: '#8a1f17' } },
    { id: 'nord', name: 'Nord', tone: 'neutral', from: { page: '#2e3440', surface: '#3b4252', 'surface-2': '#434c5e', ink: '#eceff4', 'ink-2': '#d8dee9', muted: '#a3abb9', accent: '#88c0d0', good: '#a3be8c', bad: '#bf616a' } },
    { id: 'catppuccin-frappe', name: 'Catppuccin Frappé', tone: 'neutral', from: { page: '#303446', surface: '#414559', ink: '#c6d0f5', 'ink-2': '#b5bfe2', muted: '#949cbb', accent: '#ca9ee6', good: '#a6d189', bad: '#e78284' } },
    { id: 'everforest-dark', name: 'Everforest Dark', tone: 'neutral', from: { page: '#2d353b', surface: '#343f44', 'surface-2': '#3d484d', ink: '#d3c6aa', muted: '#9da9a0', accent: '#a7c080', good: '#a7c080', bad: '#e67e80' } },
    { id: 'dusk', name: 'Dusk', tone: 'neutral', from: { page: '#463f53', surface: '#51495f', ink: '#f5eff8', accent: '#f0a6ca', good: '#a5dfb4', bad: '#ffaaa5' } },

    // More themes: dark
    { id: 'contrast-dark', name: 'High Contrast Dark', tone: 'dark', full: {
      page: '#000000', surface: '#1a1a1a', 'surface-2': '#2a2a2a', ink: '#ffffff', 'ink-2': '#f0f0f0', muted: '#c4c4c4', grid: '#4a4a4a', axis: '#7a7a7a',
      border: 'rgba(255, 255, 255, 0.42)', 'border-strong': 'rgba(255, 255, 255, 0.72)',
      accent: '#ffd400', 'accent-hover': '#ffe14d', 'accent-text': '#ffe14d', 'accent-wash': 'rgba(255, 212, 0, 0.16)', 'on-accent': '#000000', 'series-1': '#ffd400',
      good: '#5cff8a', bad: '#ff7070', 'bad-wash': 'rgba(255, 112, 112, 0.18)', shadow: 'none' } },
    { id: 'solarized-dark', name: 'Solarized Dark', tone: 'dark', from: { page: '#002b36', surface: '#073642', ink: '#eee8d5', 'ink-2': '#93a1a1', muted: '#839496', accent: '#268bd2', good: '#859900', bad: '#dc322f' } },
    { id: 'gruvbox-dark', name: 'Gruvbox Dark', tone: 'dark', from: { page: '#282828', surface: '#32302f', 'surface-2': '#3c3836', ink: '#fbf1c7', 'ink-2': '#d5c4a1', muted: '#a89984', accent: '#fe8019', good: '#b8bb26', bad: '#fb4934' } },
    { id: 'dracula', name: 'Dracula', tone: 'dark', from: { page: '#21222c', surface: '#282a36', 'surface-2': '#343746', ink: '#f8f8f2', muted: '#6272a4', accent: '#bd93f9', good: '#50fa7b', bad: '#ff5555' } },
    { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', tone: 'dark', from: { page: '#181825', surface: '#1e1e2e', 'surface-2': '#313244', ink: '#cdd6f4', 'ink-2': '#bac2de', muted: '#9399b2', accent: '#cba6f7', good: '#a6e3a1', bad: '#f38ba8' } },
    { id: 'rose-pine', name: 'Rosé Pine', tone: 'dark', from: { page: '#191724', surface: '#1f1d2e', 'surface-2': '#26233a', ink: '#e0def4', 'ink-2': '#908caa', muted: '#6e6a86', accent: '#c4a7e7', good: '#9ccfd8', bad: '#eb6f92' } },
    { id: 'tokyo-night', name: 'Tokyo Night', tone: 'dark', from: { page: '#16161e', surface: '#1a1b26', 'surface-2': '#292e42', ink: '#c0caf5', 'ink-2': '#a9b1d6', muted: '#737aa2', accent: '#7aa2f7', good: '#9ece6a', bad: '#f7768e' } },
    { id: 'one-dark', name: 'One Dark', tone: 'dark', from: { page: '#21252b', surface: '#282c34', 'surface-2': '#2c313a', ink: '#d7dae0', 'ink-2': '#abb2bf', muted: '#5c6370', accent: '#61afef', good: '#98c379', bad: '#e06c75' } },
    { id: 'kanagawa', name: 'Kanagawa', tone: 'dark', from: { page: '#16161d', surface: '#1f1f28', 'surface-2': '#2a2a37', ink: '#dcd7ba', 'ink-2': '#c8c093', muted: '#727169', accent: '#7e9cd8', good: '#98bb6c', bad: '#e46876' } },
    { id: 'night-owl', name: 'Night Owl', tone: 'dark', from: { page: '#011627', surface: '#0b2942', ink: '#d6deeb', muted: '#637777', accent: '#82aaff', good: '#addb67', bad: '#ef5350' } },
    { id: 'lagoon', name: 'Lagoon', tone: 'dark', from: { page: '#081a1c', surface: '#0f262a', ink: '#e2f3f1', accent: '#2dd4bf', good: '#a3e635', bad: '#fb7185' } },
    { id: 'plum', name: 'Plum', tone: 'dark', from: { page: '#170f1c', surface: '#211726', ink: '#f3e8f6', accent: '#f472b6', good: '#86efac', bad: '#fca5a5' } },
  ];

  // Each theme's every color, as { '--page': '#…', … }, worked out once.
  const PALETTES = new Map(THEMES.map((t) => {
    const p = t.full || derive(t.from);
    return [t.id, Object.fromEntries(TOKENS.map((k) => [`--${k}`, p[k]]))];
  }));
  const palette = (id) => PALETTES.get(id) || null;

  const LIST = THEMES.map((t) => {
    const p = PALETTES.get(t.id);
    return {
      id: t.id, name: t.name, tone: t.tone, main: !!t.main, css: !!t.css,
      base: lum(p['--page']) < lum(p['--ink']) ? 'dark' : 'light',
      swatch: [p['--page'], p['--surface'], p['--accent']], // drawn in the menu
    };
  });
  const byId = Object.fromEntries(LIST.map((t) => [t.id, t]));
  const MAIN = LIST.filter((t) => t.main);
  const TONES = [['light', 'Light'], ['neutral', 'Mid-tone'], ['dark', 'Dark']];
  // The picker lists these by tone, then by name.
  const MORE = TONES.flatMap(([tone]) => LIST.filter((t) => !t.main && t.tone === tone).sort((a, b) => a.name.localeCompare(b.name)));

  /** 'light' | 'dark' | 'system' for a theme setting: what the OS should follow. */
  const baseOf = (theme) => (byId[theme] ? byId[theme].base : 'system');

  return { LIST, MAIN, MORE, TONES, TOKENS, byId, baseOf, palette, IDS: ['system', ...LIST.map((t) => t.id)], lum, contrast };
});
