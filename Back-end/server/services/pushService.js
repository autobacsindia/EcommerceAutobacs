/**
 * Push notifications — a pop-up on the person's computer or phone even when the
 * website tab is closed (the browser must be running). Web Push with VAPID keys:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (mailto:…)
 * Without the keys, push is simply off: the panel hides the switch, and nothing
 * else changes (the bell and its sounds work as before).
 *
 * The server sends to the browser's push service, so endpoints are restricted to
 * the real push services — never an address someone typed (SSRF).
 *
 * Best-effort by design: sending never throws and never slows the action that
 * triggered it.
 *
 * ── Dead devices ────────────────────────────────────────────────────────────
 *   404 / 410            the push service says the device is gone → removed now
 *   other 4xx (not 429)  refused (e.g. 403: subscribed with old keys) → counted;
 *                        MAX_FAILURES in a row → removed. A pop-up that gets
 *                        through resets the count.
 *   5xx, 429, timeouts   the push service's own trouble → not counted
 *   not seen STALE_DAYS  removed by the daily clean-up (cronService)
 * A removed device that is still in use re-adds itself the next time the panel
 * opens on it (lib/push.ts resyncPush), so clean-up can never switch anyone off.
 */
import webpush from 'web-push';
import AppError from '../utils/AppError.js';
import pushSubscriptionRepository from '../repositories/pushSubscriptionRepository.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const MAX_FAILURES = 3;
export const STALE_DAYS = 60;
const DEVICE_LIST_MAX = 500;
const GONE = new Set([404, 410]);

/** The push services browsers use: Chrome/Edge/Android, Firefox, Windows, Safari/iOS. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

let configuredWith = '';
export function pushConfigured() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (configuredWith !== pub) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@autobacsindia.com', pub, priv);
    configuredWith = pub;
  }
  return true;
}

export const publicKey = () => (pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null);

/** A subscription from the browser, checked. */
export function cleanSubscription(input = {}) {
  const endpoint = String(input.endpoint || '');
  let url;
  try { url = new URL(endpoint); } catch { throw fail('Invalid push subscription.', 400); }
  if (url.protocol !== 'https:' || endpoint.length > 1000 || !PUSH_HOSTS.some((re) => re.test(url.hostname))) {
    throw fail('This browser\'s push service is not supported.', 400);
  }
  const p256dh = String(input.keys?.p256dh || '');
  const auth = String(input.keys?.auth || '');
  if (!/^[A-Za-z0-9_-]{40,200}=*$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,100}=*$/.test(auth)) {
    throw fail('Invalid push subscription.', 400);
  }
  return { endpoint, keys: { p256dh, auth } };
}

export async function subscribe(user, input = {}, userAgent = '') {
  if (!pushConfigured()) throw fail('Notifications are not set up on the server yet.', 503);
  const sub = cleanSubscription(input);
  await pushSubscriptionRepository.upsert(user._id, { ...sub, userAgent: String(userAgent || '').slice(0, 300) });
  return { subscribed: true };
}

export async function unsubscribe(user, endpoint) {
  await pushSubscriptionRepository.removeForUser(user._id, String(endpoint || ''));
  return { subscribed: false };
}

/**
 * Send one notification to each listed person, on every device they turned it on.
 * @param {{ userId: string, url: string }[]} recipients
 * @param {{ title: string, body: string, tag?: string }} message
 * @returns {Promise<number>} how many devices accepted it. Never throws.
 */
export async function sendToUsers(recipients, message) {
  try {
    if (!pushConfigured() || !recipients.length) return 0;
    const urlOf = new Map(recipients.map((r) => [String(r.userId), r.url]));
    const subs = await pushSubscriptionRepository.findForUsers([...urlOf.keys()]);
    if (!subs.length) return 0;
    const sent = [];
    await Promise.all(subs.map(async (s) => {
      const outcome = await deliver(s, payloadFor(message, urlOf.get(idOf(s.user)) || '/'));
      if (outcome.result === 'sent') sent.push(s._id);
    }));
    if (sent.length) await pushSubscriptionRepository.touch(sent).catch(() => {});
    return sent.length;
  } catch (err) {
    console.error('[Push] failed (ignored):', err.message);
    return 0;
  }
}

function payloadFor(message, url) {
  return JSON.stringify({
    title: String(message.title || 'Roavion').slice(0, 120),
    body: String(message.body || '').slice(0, 240),
    tag: message.tag || undefined,
    url,
    ...(message.testId && { testId: message.testId }),
  });
}

/**
 * One pop-up to one device, and what became of it. Never throws.
 * @returns {Promise<{ result: 'sent'|'gone'|'refused'|'failed', status?: number }>}
 *   sent    the push service took it
 *   gone    the device no longer exists (removed)
 *   refused the push service turned this device down (counted; removed at MAX_FAILURES)
 *   failed  the push service had trouble (not this device's fault; nothing recorded)
 */
async function deliver(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 3600, urgency: 'high', timeout: 8000 });
    return { result: 'sent' };
  } catch (err) {
    const status = Number(err?.statusCode) || 0;
    if (GONE.has(status)) {
      await pushSubscriptionRepository.removeByEndpoint(sub.endpoint).catch(() => {});
      return { result: 'gone', status };
    }
    if (status >= 400 && status < 500 && status !== 429) {
      const failures = await pushSubscriptionRepository.recordFailure(sub._id, `${status} ${err?.body || err?.message || ''}`.trim()).catch(() => 0);
      if (failures >= MAX_FAILURES) await pushSubscriptionRepository.removeById(sub._id).catch(() => {});
      console.warn(`[Push] device refused (${status}), ${failures}/${MAX_FAILURES}${failures >= MAX_FAILURES ? ' — removed' : ''}`);
      return { result: 'refused', status };
    }
    console.error('[Push] send failed (ignored):', status || '', err?.message);
    return { result: 'failed', ...(status && { status }) };
  }
}

const TEST_MESSAGE = {
  title: 'Roavion notifications are on', body: 'You will get a pop-up like this for new messages and new work.', tag: 'push-test',
};
const cleanTestId = (raw) => (typeof raw === 'string' && /^[\w-]{8,40}$/.test(raw) ? raw : undefined);

/**
 * "Send me a test" from the panel.
 *
 * With `endpoint` (this browser's own sign-up) the test goes to THAT device only
 * and says what happened to it — a working phone must not make a dead office PC
 * look fine. `testId` rides along so the browser's worker can tell the page "it
 * arrived" (push-sw.js). Without `endpoint` (an older page): every device.
 */
export async function sendTest(user, chatPath, { endpoint, testId } = {}) {
  if (!pushConfigured()) throw fail('Notifications are not set up on the server yet.', 503);
  if (endpoint) {
    const sub = await pushSubscriptionRepository.findOneForUser(user._id, String(endpoint));
    // The browser holds a sign-up the server does not (cleaned up, or saved for
    // someone else): the page re-saves it and tries again.
    if (!sub) throw fail('This browser is not signed up for pop-ups on the server.', 409);
    const outcome = await deliver(sub, payloadFor({ ...TEST_MESSAGE, testId: cleanTestId(testId) }, chatPath));
    if (outcome.result === 'sent') await pushSubscriptionRepository.touch([sub._id]).catch(() => {});
    return { sent: outcome.result === 'sent' ? 1 : 0, ...outcome };
  }
  if (!(await pushSubscriptionRepository.countForUser(user._id))) throw fail('Turn on notifications on this device first.', 409);
  const n = await sendToUsers([{ userId: idOf(user._id), url: chatPath }], TEST_MESSAGE);
  return { sent: n };
}

/** The daily clean-up: devices nobody has opened the panel on for STALE_DAYS. Never throws. */
export async function removeStaleDevices(now = Date.now()) {
  try {
    const res = await pushSubscriptionRepository.removeNotSeenSince(new Date(now - STALE_DAYS * 24 * 60 * 60 * 1000));
    return { removed: res?.deletedCount ?? 0 };
  } catch (err) {
    console.error('[Push] stale clean-up failed:', err.message);
    return { removed: 0, error: err.message };
  }
}

/** "Chrome on Mac" from a user-agent string (Brave reports itself as Chrome). */
export function describeBrowser(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad'
    : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
          : /Linux|CrOS/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/**
 * The admin's "who has pop-ups working": every person in the panel, their
 * devices, and the people with none. `people` are the panel's users (admins and
 * active staff), passed in so this stays free of the user repository.
 */
export async function listDevices(people, now = Date.now()) {
  const rows = await pushSubscriptionRepository.listAll(DEVICE_LIST_MAX);
  const byUser = new Map();
  for (const r of rows) {
    const k = idOf(r.user);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push({
      id: idOf(r._id),
      device: describeBrowser(r.userAgent),
      addedAt: r.createdAt,
      lastSeenAt: r.updatedAt,
      lastWorkedAt: r.lastSentAt || null,
      failures: r.failures || 0,
      lastError: r.failures ? r.lastError || '' : '',
      health: r.failures ? 'failing' : r.lastSentAt ? 'working' : 'untested',
    });
  }
  return {
    configured: pushConfigured(),
    staleDays: STALE_DAYS,
    people: people.map((p) => ({ ...p, devices: byUser.get(idOf(p.id)) || [] })),
    truncated: rows.length >= DEVICE_LIST_MAX,
    checkedAt: new Date(now),
  };
}

export default {
  pushConfigured, publicKey, cleanSubscription, subscribe, unsubscribe, sendToUsers, sendTest, removeStaleDevices, listDevices, describeBrowser,
};
