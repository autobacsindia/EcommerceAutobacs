/*
 * Push notifications for the staff panel (services/pushService.js on the server).
 *
 * This worker does ONE thing: show a pop-up when the server pushes, and open
 * the right page when it is clicked. It has NO fetch handler and caches
 * nothing — the site's pages and files load exactly as without it (the old
 * caching worker was removed for serving stale files; see /sw.js, the
 * kill-switch that must stay deployed).
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Roavion';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag, // a new message in the same chat still alerts
    icon: '/web-app-manifest-192x192.png',
    badge: '/web-app-manifest-192x192.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse a tab of this site if one is open; otherwise open a new one.
    const tab = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      if ('navigate' in tab) await tab.navigate(url);
      return;
    }
    await self.clients.openWindow(url);
  })());
});
