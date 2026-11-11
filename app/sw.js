// Offline support for the phone app. Built by tools/build-web.mjs, which fills
// in VERSION (a hash of every file) and FILES. A new deploy changes VERSION, so
// the phone picks up the update the next time the app is opened.
const VERSION = 'af0e401444e1';
const FILES = ["./","index.html","version.js","engine.js","stats.js","progress.js","e80.js","datamodel.js","web-store.js","sync.js","firebase-config.js","cloud.js","charts.js","oa.js","oa-odds.js","oa-seq.js","oa-rank.js","oa-iv.js","oa-books.js","oa-zap.js","oa-mock.js","oa-quick.js","leaderboard.js","app.js","oa-ui.js","lb-ui.js","vendor/firebase-app-compat.js","vendor/firebase-auth-compat.js","vendor/firebase-firestore-compat.js","styles.css","pwa.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/apple-touch-icon.png"];
const CACHE = `zetapro-app-${VERSION}`;

self.addEventListener('install', (e) => {
  // Straight from the server: the browser's HTTP cache (GitHub Pages allows 10
  // minutes) could otherwise hand back the previous version's files, which
  // would then be served under this version until the next deploy.
  const fresh = FILES.map((f) => new Request(f, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zetapro-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only the app's own files are cached; sync calls to GitHub always go live.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
