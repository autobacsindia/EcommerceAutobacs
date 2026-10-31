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

/** Every open tab of this site — including one loaded before this worker took over. */
const tabs = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Roavion';
  event.waitUntil((async () => {
    let shown = true;
    try {
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || undefined,
        renotify: !!data.tag, // a new message in the same chat still alerts
        icon: '/web-app-manifest-192x192.png',
        badge: '/web-app-manifest-192x192.png',
        data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
      });
    } catch {
      shown = false;
    }
    // "Send me a test pop-up": tell the page it got this far, so it can say
    // whether the computer (not the website) is what hides pop-ups.
    if (data.testId) (await tabs()).forEach((c) => c.postMessage({ type: 'roavion-push-received', id: data.testId, shown }));
  })());
});

/*
 * The browser replaced this device's sign-up (it does this now and then, and
 * after some updates). Sign up again with the same key so pop-ups keep coming,
 * and ask any open panel tab to save the new one on the server; with no tab
 * open, the panel saves it the next time it opens (lib/push.ts resyncPush).
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
      if (key && !(await self.registration.pushManager.getSubscription())) {
        await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
    } catch {
      // The open panel re-signs up on its own.
    }
    (await tabs()).forEach((c) => c.postMessage({ type: 'roavion-push-resubscribe' }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await tabs();
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
