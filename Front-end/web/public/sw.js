/*
 * Service-worker kill-switch.
 *
 * The app no longer ships a service worker (the PWA/Workbox integration was
 * removed). This file used to be a stale Workbox precache SW whose manifest
 * pointed at deleted routes — any browser that registered a prior build could
 * keep serving stale chunks. Nothing in the app registers a SW anymore, but a
 * returning visitor's browser still fetches THIS file when it checks its
 * existing registration for an update. So this stub takes over, purges all
 * caches, and unregisters itself.
 *
 * Keep this file deployed indefinitely.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* best-effort */
      }
      await self.registration.unregister();
      const clients = await self.clients.matchAll();
      clients.forEach((client) => client.navigate(client.url));
    })()
  );
});
