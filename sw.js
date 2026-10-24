// The app used to live at the site root with an offline worker here. It now
// lives at /app/ with its own worker, so this one clears the old copy and
// unregisters itself; the front page needs no offline support.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('zetapro-') && !k.startsWith('zetapro-app-')) await caches.delete(k);
    }
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
