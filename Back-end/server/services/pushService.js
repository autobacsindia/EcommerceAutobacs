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
 * triggered it. A device that is gone (404 / 410) is removed.
 */
import webpush from 'web-push';
import AppError from '../utils/AppError.js';
import pushSubscriptionRepository from '../repositories/pushSubscriptionRepository.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

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
      const payload = JSON.stringify({
        title: String(message.title || 'Roavion').slice(0, 120),
        body: String(message.body || '').slice(0, 240),
        tag: message.tag || undefined,
        url: urlOf.get(idOf(s.user)) || '/',
      });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600, urgency: 'high', timeout: 8000 });
        sent.push(s._id);
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await pushSubscriptionRepository.removeByEndpoint(s.endpoint).catch(() => {});
        } else {
          console.error('[Push] send failed (ignored):', err?.statusCode || '', err?.message);
        }
      }
    }));
    if (sent.length) await pushSubscriptionRepository.touch(sent).catch(() => {});
    return sent.length;
  } catch (err) {
    console.error('[Push] failed (ignored):', err.message);
    return 0;
  }
}

/** "Send me a test" from the panel. */
export async function sendTest(user, chatPath) {
  if (!pushConfigured()) throw fail('Notifications are not set up on the server yet.', 503);
  if (!(await pushSubscriptionRepository.countForUser(user._id))) throw fail('Turn on notifications on this device first.', 409);
  const n = await sendToUsers([{ userId: idOf(user._id), url: chatPath }], {
    title: 'Roavion notifications are on', body: 'You will get a pop-up like this for new messages and new work.', tag: 'push-test',
  });
  return { sent: n };
}

export default { pushConfigured, publicKey, cleanSubscription, subscribe, unsubscribe, sendToUsers, sendTest };
