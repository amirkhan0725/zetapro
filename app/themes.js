// The named colour themes beyond Auto, Light and Dark. Each one's colours are a
// `:root[data-theme="id"]` block in styles.css (a test keeps the two in step);
// `base` is the light or dark mode it builds on, which the desktop app hands to
// the OS so native controls and the window buttons match.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZetaproThemes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // swatch: [page, surface, accent], drawn in the theme picker.
  const LIST = [
    { id: 'paper', name: 'Paper', base: 'light', swatch: ['#f4efe6', '#fbf8f2', '#b4532a'] },
    { id: 'rose', name: 'Rose', base: 'light', swatch: ['#fbf3f5', '#fffafb', '#c2185b'] },
    { id: 'lavender', name: 'Lavender', base: 'light', swatch: ['#f6f4fb', '#fcfbff', '#6d4ad8'] },
    { id: 'midnight', name: 'Midnight', base: 'dark', swatch: ['#0b1020', '#131a2e', '#38bdf8'] },
    { id: 'forest', name: 'Forest', base: 'dark', swatch: ['#0c1410', '#131f19', '#4ade80'] },
    { id: 'ember', name: 'Ember', base: 'dark', swatch: ['#14110e', '#1d1915', '#f59e0b'] },
    // High contrast: the strongest text and borders, for easier reading.
    { id: 'contrast-light', name: 'Contrast', base: 'light', swatch: ['#ffffff', '#f0f0f0', '#0040c0'] },
    { id: 'contrast-dark', name: 'Contrast Dark', base: 'dark', swatch: ['#000000', '#1a1a1a', '#ffd400'] },
  ];
  const byId = Object.fromEntries(LIST.map((t) => [t.id, t]));

  /** 'light' | 'dark' | 'system' for a theme setting: what the OS should follow. */
  const baseOf = (theme) => (byId[theme] ? byId[theme].base : theme === 'light' || theme === 'dark' ? theme : 'system');

  return { LIST, byId, baseOf, IDS: ['system', 'light', 'dark', ...LIST.map((t) => t.id)] };
});
