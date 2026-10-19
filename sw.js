// Offline support for the phone app. Built by tools/build-web.mjs, which fills
// in VERSION (a hash of every file) and FILES. A new deploy changes VERSION, so
// the phone picks up the update the next time the app is opened.
const VERSION = 'd0d020070ae2';
const FILES = ["./","index.html","engine.js","stats.js","e80.js","datamodel.js","web-store.js","sync.js","charts.js","app.js","styles.css","pwa.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/apple-touch-icon.png"];
const CACHE = `zetapro-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zetapro-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only the app's own files are cached; sync calls to GitHub always go live.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
