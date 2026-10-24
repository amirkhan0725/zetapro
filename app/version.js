// The app version shown in the UI and its change log. Kept equal to
// package.json's version by a test; bump both when releasing.
(function (root, info) {
  if (typeof module === 'object' && module.exports) module.exports = info;
  else root.ZetaproVersion = info;
})(typeof self !== 'undefined' ? self : this, {
  version: '1.2.0',
  changes: [
    {
      version: '1.2.0',
      date: '2026-10-25',
      items: [
        'Sign in with Google or email to sync your games across devices: no GitHub tokens needed.',
        'Syncing is now instant and only sends what changed.',
        'Export and import a backup file of all your games (Manage data).',
        'The Windows app signs in with email and password; add a password to a Google account in the browser version.',
      ],
    },
    {
      version: '1.1.0',
      date: '2026-10-25',
      items: [
        'On-screen number pad on phones: no more keyboard popping up over the problem.',
        'Optional 3-2-1 countdown before a round, and the timer turns red for the last 10 seconds.',
        'Undo after deleting games, and restore games from any earlier synced version.',
        'Results show how you did against your recent average and your goal.',
        'Clearer wording: "Slowdown" instead of "Cost".',
        'Tabs sit at the bottom of the screen on phones.',
        'The Windows app tells you when a new version is out.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-24',
      items: [
        'Zetamac-style game with per-type stats, factor map, mistake patterns and trouble problems.',
        'Smart, trouble and custom drills, with smart drill stats and pace tracking.',
        'Optiver-style 80 in 8 with net scoring and per-type stats.',
        'Goals, sync across devices through a private GitHub repo, and a phone app.',
      ],
    },
  ],
});
