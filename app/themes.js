// Color themes, as data. MAIN are the eight in the account menu (two light, two
// mid-tone, four dark); MORE are the rest, in the "More themes" picker, which shows
// each tone in rows of four (a test keeps each tone's count a multiple of 4). app.js puts
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
//   Ayu Light         Konstantin Pschera, github.com/ayu-theme/ayu-colors
//   Kanagawa Lotus    rebelot, github.com/rebelot/kanagawa.nvim (the light variant)
// Ash, Slate, Meadow, Glacier, Fog, Clay, Sage, Dusk, Lagoon, Plum, Newsprint, Orchid,
// Sepia, Mauve, Wheat, Seafoam, Cacao, Moss, Graphite, Wine, Denim and Spruce are this app's own.
//
// Checklist every theme meets (test/themes.test.js checks the numeric parts):
//   1. Text: body ink 7:1 on the page, 4.5:1 on cards; secondary text, accent text
//      and good/bad text 4.5:1 on page and cards; muted labels 3:1 (WCAG AA).
//   2. UI parts: the accent (focus rings, chart lines, selected borders) 3:1 against
//      page and cards (WCAG 1.4.11); text on accent buttons 4.5:1.
//   3. Coherent levels: page, card and switch backgrounds share one hue family; cards
//      apart from the page (>= 1.025:1, plus a border, and a shadow on light themes);
//      backgrounds low in chroma (OKLCH C <= 0.07) so the accent and good/bad carry hue.
//   4. One accent that stands out from the background but sits in the palette; it must
//      not read as "wrong" (OKLab distance from bad >= 0.10).
//   5. Good and bad: apart in normal vision (OKLab >= 0.15) and still apart under
//      simulated protanopia, deuteranopia and tritanopia (>= 0.08, Machado 2009), by
//      lightness or a green-teal vs red-orange split, not by hue alone.
//   6. Charts: grid lines 1.15:1 and axes 1.4:1 on cards, the series line is the accent
//      (item 2); the heatmap uses its own fixed blue ramp with its own text colors.
//   7. Each theme looks like itself: no two themes nearly share both page and accent.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZetaproThemes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Every color a theme sets, as CSS custom properties (without the leading --). */
  const TOKENS = [
    'page',
    'surface',
    'surface-2',
    'ink',
    'ink-2',
    'muted',
    'grid',
    'axis',
    'border',
    'border-strong',
    'accent',
    'accent-hover',
    'accent-text',
    'accent-wash',
    'on-accent',
    'series-1',
    'good',
    'bad',
    'bad-wash',
    'shadow',
    'streak',
    'on-good',
    'on-bad',
  ];

  // ---- color arithmetic (#rrggbb) -------------------------------------------------
  const rgb = (c) => {
    const h = c.replace('#', '');
    const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const hex = (v) =>
    `#${v
      .map((x) =>
        Math.round(Math.min(255, Math.max(0, x)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  const mix = (a, b, t) => {
    const x = rgb(a);
    const y = rgb(b);
    return hex(x.map((v, i) => v + (y[i] - v) * t));
  };
  /** WCAG relative luminance. */
  const lum = (c) => {
    const [r, g, b] = rgb(c)
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
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
    const ink = reach(s.ink, [
      [page, 7],
      [surface, 7],
    ]);
    const ink2 = reach(s['ink-2'] || mix(ink, surface, 0.3), [
      [surface, 4.5],
      [page, 4.5],
      [s2, 4.5],
    ]);
    const muted = reach(s.muted || mix(ink, surface, 0.5), [
      [surface, 3],
      [page, 3],
    ]);
    const [accent, on] = s['on-accent'] ? [s.accent, s['on-accent']] : onAccent(s.accent, dark);
    const good = reach(s.good || (dark ? '#4ade80' : '#2e7d32'), [
      [surface, 4.5],
      [page, 4.5],
    ]);
    const bad = reach(s.bad || (dark ? '#f87171' : '#c62828'), [
      [surface, 4.5],
      [page, 4.5],
    ]);
    const line = mid ? [0.14, 0.24] : [0.1, 0.18];
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
      'accent-text': reach(s['accent-text'] || accent, [
        [surface, 4.5],
        [page, 4.5],
      ]),
      'accent-wash': rgba(accent, dark || mid ? 0.14 : 0.1),
      'on-accent': on,
      'series-1': accent,
      good,
      bad,
      'bad-wash': rgba(bad, dark ? 0.14 : 0.1),
      shadow: dark ? 'none' : `0 1px 2px ${rgba(ink, 0.04)}, 0 4px 16px ${rgba(ink, 0.05)}`,
    };
  }

  /** Text on a filled good/bad badge: white if it reads at 4.5:1, else a deep shade of the fill. */
  const onFill = (bg) => {
    if (contrast('#ffffff', bg) >= 4.5) return '#ffffff';
    const deep = mix(bg, '#000000', 0.84);
    if (contrast(deep, bg) >= 4.5) return deep;
    return contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000';
  };

  /**
   * The colors every palette works out from its own, unless it gives them: the
   * Quick play combo and Code Compare streak orange (readable on the theme's page
   * and cards), and the text on filled good and bad badges.
   */
  function withStatus(p) {
    const dark = lum(p.page) < lum(p.ink);
    return {
      ...p,
      streak:
        p.streak ||
        reach(dark ? '#fb923c' : '#c2410c', [
          [p.surface, 4.5],
          [p.page, 4.5],
        ]),
      'on-good': p['on-good'] || onFill(p.good),
      'on-bad': p['on-bad'] || onFill(p.bad),
    };
  }

  // ---- the themes -----------------------------------------------------------------
  // tone: 'light' | 'neutral' (mid-tone) | 'dark', for grouping. `full` is a
  // hand-tuned palette, used exactly; `from` is derive()'s input.
  const THEMES = [
    // Main: the account menu, in this order.
    {
      id: 'light',
      name: 'Light',
      tone: 'light',
      main: true,
      css: true,
      full: {
        page: '#f9f9f7',
        surface: '#fcfcfb',
        'surface-2': '#f2f1ed',
        ink: '#0b0b0b',
        'ink-2': '#52514e',
        muted: '#898781',
        grid: '#e1e0d9',
        axis: '#c3c2b7',
        border: 'rgba(11, 11, 11, 0.1)',
        'border-strong': 'rgba(11, 11, 11, 0.18)',
        accent: '#2976d3',
        'accent-hover': '#256abf',
        'accent-text': '#1c5cab',
        'accent-wash': 'rgba(42, 120, 214, 0.1)',
        'on-accent': '#fff',
        'series-1': '#2a78d6',
        good: '#006300',
        bad: '#cf3854',
        'bad-wash': 'rgba(207, 56, 84, 0.1)',
        shadow: '0 1px 2px rgba(11, 11, 11, 0.04), 0 4px 16px rgba(11, 11, 11, 0.04)',
      },
    },
    {
      id: 'paper',
      name: 'Paper',
      tone: 'light',
      main: true,
      full: {
        page: '#f4efe6',
        surface: '#fbf8f2',
        'surface-2': '#ebe4d6',
        ink: '#2b2622',
        'ink-2': '#5c544b',
        muted: '#8a8173',
        grid: '#e0d8c8',
        axis: '#c9bfac',
        border: 'rgba(43, 38, 34, 0.12)',
        'border-strong': 'rgba(43, 38, 34, 0.20)',
        accent: '#b4532a',
        'accent-hover': '#9c4622',
        'accent-text': '#8f3f1e',
        'accent-wash': 'rgba(180, 83, 42, 0.12)',
        'on-accent': '#fff',
        'series-1': '#b4532a',
        good: '#306e0a',
        bad: '#c92049',
        'bad-wash': 'rgba(201, 32, 73, 0.10)',
        shadow: '0 1px 2px rgba(43, 38, 34, 0.05), 0 4px 16px rgba(43, 38, 34, 0.05)',
      },
    },
    {
      id: 'ash',
      name: 'Ash',
      tone: 'neutral',
      main: true,
      from: { page: '#a8a298', surface: '#b2ada3', ink: '#24211d', accent: '#174b51', good: '#024239', bad: '#7a170f' },
    },
    {
      id: 'slate',
      name: 'Slate',
      tone: 'neutral',
      main: true,
      from: { page: '#3d4555', surface: '#475062', ink: '#f2f4f8', accent: '#93bbf5', good: '#adf6be', bad: '#ffa3a3' },
    },
    {
      id: 'dark',
      name: 'Dark',
      tone: 'dark',
      main: true,
      css: true,
      full: {
        page: '#0d0d0d',
        surface: '#1a1a19',
        'surface-2': '#232321',
        ink: '#f0efec',
        'ink-2': '#c3c2b7',
        muted: '#898781',
        grid: '#2c2c2a',
        axis: '#383835',
        border: 'rgba(255, 255, 255, 0.1)',
        'border-strong': 'rgba(255, 255, 255, 0.18)',
        accent: '#3987e5',
        'accent-hover': '#5598e7',
        'accent-text': '#86b6ef',
        'accent-wash': 'rgba(57, 135, 229, 0.16)',
        'on-accent': '#071526',
        'series-1': '#3987e5',
        good: '#0ca30c',
        bad: '#d17875',
        'bad-wash': 'rgba(209, 120, 117, 0.14)',
        shadow: 'none',
      },
    },
    {
      id: 'midnight',
      name: 'Midnight',
      tone: 'dark',
      main: true,
      full: {
        page: '#0b1020',
        surface: '#131a2e',
        'surface-2': '#1b2440',
        ink: '#e6ebf5',
        'ink-2': '#a9b4cc',
        muted: '#7783a0',
        grid: '#232d4a',
        axis: '#2f3a5a',
        border: 'rgba(230, 235, 245, 0.10)',
        'border-strong': 'rgba(230, 235, 245, 0.18)',
        accent: '#38bdf8',
        'accent-hover': '#5ccbfa',
        'accent-text': '#7dd3fc',
        'accent-wash': 'rgba(56, 189, 248, 0.14)',
        'on-accent': '#04202e',
        'series-1': '#38bdf8',
        good: '#34d399',
        bad: '#f7745c',
        'bad-wash': 'rgba(247, 116, 92, 0.14)',
        shadow: 'none',
      },
    },
    {
      id: 'forest',
      name: 'Forest',
      tone: 'dark',
      main: true,
      full: {
        page: '#0c1410',
        surface: '#131f19',
        'surface-2': '#1a2a22',
        ink: '#e4efe8',
        'ink-2': '#a7bdb0',
        muted: '#7a9184',
        grid: '#22342b',
        axis: '#2e4438',
        border: 'rgba(228, 239, 232, 0.10)',
        'border-strong': 'rgba(228, 239, 232, 0.18)',
        accent: '#4ade80',
        'accent-hover': '#6ee7a0',
        'accent-text': '#86efac',
        'accent-wash': 'rgba(74, 222, 128, 0.14)',
        'on-accent': '#052e16',
        'series-1': '#4ade80',
        good: '#a3e635',
        bad: '#f87171',
        'bad-wash': 'rgba(248, 113, 113, 0.14)',
        shadow: 'none',
      },
    },
    {
      id: 'ember',
      name: 'Ember',
      tone: 'dark',
      main: true,
      full: {
        page: '#14110e',
        surface: '#1d1915',
        'surface-2': '#27211b',
        ink: '#f3ece4',
        'ink-2': '#c9bcae',
        muted: '#988a7b',
        grid: '#2f2821',
        axis: '#3d342b',
        border: 'rgba(243, 236, 228, 0.10)',
        'border-strong': 'rgba(243, 236, 228, 0.18)',
        accent: '#f59e0b',
        'accent-hover': '#fbb53c',
        'accent-text': '#fcd34d',
        'accent-wash': 'rgba(245, 158, 11, 0.14)',
        'on-accent': '#2a1a02',
        'series-1': '#f59e0b',
        good: '#84cc16',
        bad: '#f87171',
        'bad-wash': 'rgba(248, 113, 113, 0.14)',
        shadow: 'none',
      },
    },

    // More themes: light
    {
      id: 'rose',
      name: 'Rose',
      tone: 'light',
      full: {
        page: '#fbf3f5',
        surface: '#fffafb',
        'surface-2': '#f5e6ea',
        ink: '#2a1b21',
        'ink-2': '#5e4650',
        muted: '#8f7781',
        grid: '#efdde3',
        axis: '#dcc3cc',
        border: 'rgba(42, 27, 33, 0.10)',
        'border-strong': 'rgba(42, 27, 33, 0.18)',
        accent: '#c2185b',
        'accent-hover': '#a8144f',
        'accent-text': '#9c1450',
        'accent-wash': 'rgba(194, 24, 91, 0.10)',
        'on-accent': '#fff',
        'series-1': '#c2185b',
        good: '#247d4a',
        bad: '#c3431d',
        'bad-wash': 'rgba(195, 67, 29, 0.10)',
        shadow: '0 1px 2px rgba(42, 27, 33, 0.04), 0 4px 16px rgba(42, 27, 33, 0.05)',
      },
    },
    {
      id: 'lavender',
      name: 'Lavender',
      tone: 'light',
      full: {
        page: '#f6f4fb',
        surface: '#fcfbff',
        'surface-2': '#ece8f6',
        ink: '#1d1830',
        'ink-2': '#4f4867',
        muted: '#847e9b',
        grid: '#e2ddf0',
        axis: '#c9c2de',
        border: 'rgba(29, 24, 48, 0.10)',
        'border-strong': 'rgba(29, 24, 48, 0.18)',
        accent: '#6d4ad8',
        'accent-hover': '#5d3cc2',
        'accent-text': '#5534b6',
        'accent-wash': 'rgba(109, 74, 216, 0.10)',
        'on-accent': '#fff',
        'series-1': '#6d4ad8',
        good: '#417b48',
        bad: '#d5270a',
        'bad-wash': 'rgba(213, 39, 10, 0.10)',
        shadow: '0 1px 2px rgba(29, 24, 48, 0.04), 0 4px 16px rgba(29, 24, 48, 0.05)',
      },
    },
    // High contrast: the strongest text and borders, for easier reading.
    {
      id: 'contrast-light',
      name: 'High Contrast',
      tone: 'light',
      full: {
        page: '#ffffff',
        surface: '#f0f0f0',
        'surface-2': '#e2e2e2',
        ink: '#000000',
        'ink-2': '#1a1a1a',
        muted: '#4a4a4a',
        grid: '#c8c8c8',
        axis: '#8f8f8f',
        border: 'rgba(0, 0, 0, 0.38)',
        'border-strong': 'rgba(0, 0, 0, 0.65)',
        accent: '#0040c0',
        'accent-hover': '#00309a',
        'accent-text': '#00319a',
        'accent-wash': 'rgba(0, 64, 192, 0.12)',
        'on-accent': '#fff',
        'series-1': '#0040c0',
        good: '#095e23',
        bad: '#b00000',
        'bad-wash': 'rgba(176, 0, 0, 0.10)',
        shadow: 'none',
      },
    },
    {
      id: 'solarized-light',
      name: 'Solarized Light',
      tone: 'light',
      from: {
        page: '#eee8d5',
        surface: '#fdf6e3',
        ink: '#073642',
        'ink-2': '#586e75',
        muted: '#93a1a1',
        accent: '#268bd2',
        good: '#4b6e3f',
        bad: '#cc0817',
      },
    },
    {
      id: 'gruvbox-light',
      name: 'Gruvbox Light',
      tone: 'light',
      from: {
        page: '#fbf1c7',
        surface: '#f9f5d7',
        ink: '#282828',
        'ink-2': '#504945',
        muted: '#7c6f64',
        accent: '#af3a03',
        good: '#79740e',
        bad: '#8d1814',
      },
    },
    {
      id: 'catppuccin-latte',
      name: 'Catppuccin Latte',
      tone: 'light',
      from: {
        page: '#eff1f5',
        surface: '#e6e9ef',
        ink: '#4c4f69',
        'ink-2': '#5c5f77',
        muted: '#7c7f93',
        accent: '#8839ef',
        good: '#256d15',
        bad: '#d20f39',
      },
    },
    {
      id: 'rose-pine-dawn',
      name: 'Rosé Pine Dawn',
      tone: 'light',
      from: {
        page: '#faf4ed',
        surface: '#fffaf3',
        'surface-2': '#f2e9e1',
        ink: '#575279',
        'ink-2': '#797593',
        muted: '#9893a5',
        accent: '#286983',
        good: '#3d7782',
        bad: '#a85251',
      },
    },
    {
      id: 'everforest-light',
      name: 'Everforest Light',
      tone: 'light',
      from: {
        page: '#f4f0d9',
        surface: '#fdf6e3',
        ink: '#5c6a72',
        'ink-2': '#5c6a72',
        muted: '#939f91',
        accent: '#6c7d00',
        good: '#8da101',
        bad: '#b83f64',
      },
    },
    {
      id: 'one-light',
      name: 'One Light',
      tone: 'light',
      from: {
        page: '#eaeaeb',
        surface: '#fafafa',
        ink: '#383a42',
        'ink-2': '#696c77',
        muted: '#a0a1a7',
        accent: '#4078f2',
        good: '#497048',
        bad: '#b93d0a',
      },
    },
    {
      id: 'meadow',
      name: 'Meadow',
      tone: 'light',
      from: { page: '#eef4ea', surface: '#f8fbf5', ink: '#16241a', accent: '#2f7a4c', good: '#35784d', bad: '#ca2619' },
    },
    {
      id: 'glacier',
      name: 'Glacier',
      tone: 'light',
      from: { page: '#ecf3f8', surface: '#f8fbfd', ink: '#0f1e2b', accent: '#16679f', good: '#1f7a4d', bad: '#ce272f' },
    },
    {
      id: 'ayu-light',
      name: 'Ayu Light',
      tone: 'light',
      from: {
        page: '#f8f9fa',
        surface: '#ffffff',
        ink: '#5c6166',
        'ink-2': '#787b80',
        muted: '#8a9199',
        accent: '#c27400',
        'on-accent': '#1a1000',
        good: '#497f1d',
        bad: '#b84e6e',
      },
    },
    {
      id: 'kanagawa-lotus',
      name: 'Kanagawa Lotus',
      tone: 'light',
      from: {
        page: '#e5ddb0',
        surface: '#f2ecbc',
        ink: '#545464',
        'ink-2': '#43436c',
        muted: '#8a8980',
        accent: '#4d699b',
        good: '#485d2b',
        bad: '#a83761',
      },
    },
    {
      id: 'newsprint',
      name: 'Newsprint',
      tone: 'light',
      from: { page: '#e8e7e3', surface: '#f6f5f2', ink: '#141414', accent: '#262626', good: '#2e6d44', bad: '#bd0105' },
    },
    {
      id: 'orchid',
      name: 'Orchid',
      tone: 'light',
      from: { page: '#f8f0f6', surface: '#fffafd', ink: '#2a1528', accent: '#9c2f93', good: '#1f7a5a', bad: '#c2410c' },
    },
    {
      id: 'sepia',
      name: 'Sepia',
      tone: 'light',
      from: { page: '#e9dcc0', surface: '#f4ead6', ink: '#2b1d10', accent: '#6b3e1c', good: '#386940', bad: '#bd0105' },
    },

    // More themes: mid-tone
    {
      id: 'fog',
      name: 'Fog',
      tone: 'neutral',
      from: { page: '#b3bbc5', surface: '#c2c9d2', ink: '#10151b', accent: '#1d4a85', good: '#20523d', bad: '#940210' },
    },
    {
      id: 'clay',
      name: 'Clay',
      tone: 'neutral',
      from: { page: '#c8b29d', surface: '#d5c2b0', ink: '#22160d', accent: '#8a3218', good: '#325003', bad: '#891352' },
    },
    {
      id: 'sage',
      name: 'Sage',
      tone: 'neutral',
      from: { page: '#acbaa9', surface: '#bbc8b8', ink: '#111a11', accent: '#2c5634', good: '#1e513a', bad: '#920a07' },
    },
    {
      id: 'nord',
      name: 'Nord',
      tone: 'neutral',
      from: {
        page: '#2e3440',
        surface: '#3b4252',
        'surface-2': '#434c5e',
        ink: '#eceff4',
        'ink-2': '#d8dee9',
        muted: '#a3abb9',
        accent: '#88c0d0',
        good: '#b3d398',
        bad: '#d8a0aa',
      },
    },
    {
      id: 'catppuccin-frappe',
      name: 'Catppuccin Frappé',
      tone: 'neutral',
      from: {
        page: '#303446',
        surface: '#414559',
        ink: '#c6d0f5',
        'ink-2': '#b5bfe2',
        muted: '#949cbb',
        accent: '#ca9ee6',
        good: '#b2cf73',
        bad: '#dea8a9',
      },
    },
    {
      id: 'everforest-dark',
      name: 'Everforest Dark',
      tone: 'neutral',
      from: {
        page: '#2d353b',
        surface: '#343f44',
        'surface-2': '#3d484d',
        ink: '#d3c6aa',
        muted: '#9da9a0',
        accent: '#a7c080',
        good: '#b2be6e',
        bad: '#e78fa5',
      },
    },
    {
      id: 'dusk',
      name: 'Dusk',
      tone: 'neutral',
      from: { page: '#463f53', surface: '#51495f', ink: '#f5eff8', accent: '#f0a6ca', good: '#9ce0be', bad: '#fbac7c' },
    },
    {
      id: 'mauve',
      name: 'Mauve',
      tone: 'neutral',
      from: { page: '#b5a3b3', surface: '#c1b1bf', ink: '#1f141e', accent: '#55215a', good: '#0e4638', bad: '#7a1309' },
    },
    {
      id: 'wheat',
      name: 'Wheat',
      tone: 'neutral',
      from: { page: '#c9bc8e', surface: '#d5caa0', ink: '#211c0a', accent: '#1f4a78', good: '#03523a', bad: '#920310' },
    },
    {
      id: 'seafoam',
      name: 'Seafoam',
      tone: 'neutral',
      from: { page: '#9fbfba', surface: '#aecbc6', ink: '#0d1f1d', accent: '#6e2350', good: '#005440', bad: '#872900' },
    },
    {
      id: 'cacao',
      name: 'Cacao',
      tone: 'neutral',
      from: { page: '#4a3b33', surface: '#554539', ink: '#f5ebe1', accent: '#f2b880', good: '#aee2a6', bad: '#fa9ab8' },
    },
    {
      id: 'moss',
      name: 'Moss',
      tone: 'neutral',
      from: { page: '#3b4532', surface: '#46513c', ink: '#eef2e4', accent: '#d4e46a', good: '#87e0cb', bad: '#fcac8d' },
    },
    {
      id: 'graphite',
      name: 'Graphite',
      tone: 'neutral',
      from: { page: '#3b3b3d', surface: '#464648', ink: '#f2f2f2', accent: '#ff9f5a', good: '#51d5e3', bad: '#ff96ad' },
    },
    {
      id: 'wine',
      name: 'Wine',
      tone: 'neutral',
      from: { page: '#4f2f3b', surface: '#5b3947', ink: '#f8eaef', accent: '#f3d48c', good: '#9fe0c0', bad: '#fe9b83' },
    },
    {
      id: 'denim',
      name: 'Denim',
      tone: 'neutral',
      from: { page: '#2f4766', surface: '#395373', ink: '#eef3fa', accent: '#ffcc5c', good: '#b3e186', bad: '#fcafc1' },
    },
    {
      id: 'spruce',
      name: 'Spruce',
      tone: 'neutral',
      from: { page: '#22454a', surface: '#2b5157', ink: '#e8f4f2', accent: '#7fe3d6', good: '#c4ec8a', bad: '#ff9a9a' },
    },

    // More themes: dark
    {
      id: 'contrast-dark',
      name: 'High Contrast Dark',
      tone: 'dark',
      full: {
        page: '#000000',
        surface: '#1a1a1a',
        'surface-2': '#2a2a2a',
        ink: '#ffffff',
        'ink-2': '#f0f0f0',
        muted: '#c4c4c4',
        grid: '#4a4a4a',
        axis: '#7a7a7a',
        border: 'rgba(255, 255, 255, 0.42)',
        'border-strong': 'rgba(255, 255, 255, 0.72)',
        accent: '#ffd400',
        'accent-hover': '#ffe14d',
        'accent-text': '#ffe14d',
        'accent-wash': 'rgba(255, 212, 0, 0.16)',
        'on-accent': '#000000',
        'series-1': '#ffd400',
        good: '#5cff8a',
        bad: '#ff7070',
        'bad-wash': 'rgba(255, 112, 112, 0.18)',
        shadow: 'none',
      },
    },
    {
      id: 'solarized-dark',
      name: 'Solarized Dark',
      tone: 'dark',
      from: {
        page: '#002b36',
        surface: '#073642',
        ink: '#eee8d5',
        'ink-2': '#93a1a1',
        muted: '#839496',
        accent: '#268bd2',
        good: '#859900',
        bad: '#de7f7c',
      },
    },
    {
      id: 'gruvbox-dark',
      name: 'Gruvbox Dark',
      tone: 'dark',
      from: {
        page: '#282828',
        surface: '#32302f',
        'surface-2': '#3c3836',
        ink: '#fbf1c7',
        'ink-2': '#d5c4a1',
        muted: '#a89984',
        accent: '#fe8019',
        good: '#b8bb26',
        bad: '#fc6771',
      },
    },
    {
      id: 'dracula',
      name: 'Dracula',
      tone: 'dark',
      from: {
        page: '#21222c',
        surface: '#282a36',
        'surface-2': '#343746',
        ink: '#f8f8f2',
        muted: '#6272a4',
        accent: '#bd93f9',
        good: '#50fa7b',
        bad: '#ff5555',
      },
    },
    {
      id: 'catppuccin-mocha',
      name: 'Catppuccin Mocha',
      tone: 'dark',
      from: {
        page: '#181825',
        surface: '#1e1e2e',
        'surface-2': '#313244',
        ink: '#cdd6f4',
        'ink-2': '#bac2de',
        muted: '#9399b2',
        accent: '#cba6f7',
        good: '#a6e3a1',
        bad: '#f38ba8',
      },
    },
    {
      id: 'rose-pine',
      name: 'Rosé Pine',
      tone: 'dark',
      from: {
        page: '#191724',
        surface: '#1f1d2e',
        'surface-2': '#26233a',
        ink: '#e0def4',
        'ink-2': '#908caa',
        muted: '#6e6a86',
        accent: '#c4a7e7',
        good: '#9ccfd8',
        bad: '#eb6f92',
      },
    },
    {
      id: 'tokyo-night',
      name: 'Tokyo Night',
      tone: 'dark',
      from: {
        page: '#16161e',
        surface: '#1a1b26',
        'surface-2': '#292e42',
        ink: '#c0caf5',
        'ink-2': '#a9b1d6',
        muted: '#737aa2',
        accent: '#7aa2f7',
        good: '#9ece6a',
        bad: '#f7768e',
      },
    },
    {
      id: 'one-dark',
      name: 'One Dark',
      tone: 'dark',
      from: {
        page: '#21252b',
        surface: '#282c34',
        'surface-2': '#2c313a',
        ink: '#d7dae0',
        'ink-2': '#abb2bf',
        muted: '#5c6370',
        accent: '#61afef',
        good: '#98c379',
        bad: '#e06c75',
      },
    },
    {
      id: 'kanagawa',
      name: 'Kanagawa',
      tone: 'dark',
      from: {
        page: '#16161d',
        surface: '#1f1f28',
        'surface-2': '#2a2a37',
        ink: '#dcd7ba',
        'ink-2': '#c8c093',
        muted: '#727169',
        accent: '#7e9cd8',
        good: '#95bd60',
        bad: '#e46876',
      },
    },
    {
      id: 'night-owl',
      name: 'Night Owl',
      tone: 'dark',
      from: {
        page: '#011627',
        surface: '#0b2942',
        ink: '#d6deeb',
        muted: '#637777',
        accent: '#82aaff',
        good: '#addb67',
        bad: '#ef5350',
      },
    },
    {
      id: 'lagoon',
      name: 'Lagoon',
      tone: 'dark',
      from: { page: '#081a1c', surface: '#0f262a', ink: '#e2f3f1', accent: '#2dd4bf', good: '#a3e635', bad: '#fb7185' },
    },
    {
      id: 'plum',
      name: 'Plum',
      tone: 'dark',
      from: { page: '#170f1c', surface: '#211726', ink: '#f3e8f6', accent: '#f472b6', good: '#86efac', bad: '#eda3a3' },
    },
  ];

  // Each theme's every color, as { '--page': '#…', … }, worked out once.
  const PALETTES = new Map(
    THEMES.map((t) => {
      const p = withStatus(t.full || derive(t.from));
      return [t.id, Object.fromEntries(TOKENS.map((k) => [`--${k}`, p[k]]))];
    }),
  );
  const palette = (id) => PALETTES.get(id) || null;

  const LIST = THEMES.map((t) => {
    const p = PALETTES.get(t.id);
    return {
      id: t.id,
      name: t.name,
      tone: t.tone,
      main: !!t.main,
      css: !!t.css,
      base: lum(p['--page']) < lum(p['--ink']) ? 'dark' : 'light',
      swatch: [p['--page'], p['--surface'], p['--accent']], // drawn in the menu
    };
  });
  const byId = Object.fromEntries(LIST.map((t) => [t.id, t]));
  const MAIN = LIST.filter((t) => t.main);
  const TONES = [
    ['light', 'Light'],
    ['neutral', 'Mid-tone'],
    ['dark', 'Dark'],
  ];
  // The picker lists these by tone, then by name.
  const MORE = TONES.flatMap(([tone]) =>
    LIST.filter((t) => !t.main && t.tone === tone).sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** 'light' | 'dark' | 'system' for a theme setting: what the OS should follow. */
  const baseOf = (theme) => (byId[theme] ? byId[theme].base : 'system');

  return {
    LIST,
    MAIN,
    MORE,
    TONES,
    TOKENS,
    byId,
    baseOf,
    palette,
    IDS: ['system', ...LIST.map((t) => t.id)],
    lum,
    contrast,
  };
});
