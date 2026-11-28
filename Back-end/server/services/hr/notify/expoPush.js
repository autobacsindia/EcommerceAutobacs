/**
 * Expo push transport (https://docs.expo.dev/push-notifications/sending-notifications/).
 * One HTTPS POST per ≤100 messages to Expo, which hands them to FCM / APNs.
 *
 * `EXPO_ACCESS_TOKEN` is optional: set it only if "enhanced push security" is
 * switched on for the project in the Expo dashboard.
 *
 * Returns one result per message, in order:
 *   { ok: true }                                   accepted by Expo
 *   { ok: false, gone: true }                      DeviceNotRegistered → drop the token
 *   { ok: false, gone: false, error }              refused (bad token, too big …)
 * Throws `ExpoTransportError` when Expo itself could not be reached or answered
 * 5xx/429 — the caller retries the whole job later.
 */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;
const TIMEOUT_MS = 10_000;

export const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

export class ExpoTransportError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ExpoTransportError';
    this.status = status;
  }
}

function headers() {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) h.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return h;
}

async function sendChunk(messages, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST', headers: headers(), body: JSON.stringify(messages), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ExpoTransportError(`Expo push unreachable: ${err.message}`);
  }
  if (res.status === 429 || res.status >= 500) throw new ExpoTransportError(`Expo push answered ${res.status}`, res.status);
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  const tickets = Array.isArray(json?.data) ? json.data : null;
  if (!res.ok || !tickets || tickets.length !== messages.length) {
    // A whole-request refusal (bad auth, bad shape): every message failed, not retryable.
    const why = json?.errors?.[0]?.message || `Expo push answered ${res.status}`;
    return messages.map(() => ({ ok: false, gone: false, error: String(why).slice(0, 200) }));
  }
  return tickets.map((t) => {
    if (t?.status === 'ok') return { ok: true };
    const code = t?.details?.error || '';
    return { ok: false, gone: code === 'DeviceNotRegistered', error: String(t?.message || code || 'refused').slice(0, 200) };
  });
}

/** @param {Array<{to:string,title:string,body:string,data?:object}>} messages */
export async function sendExpoPush(messages, { fetchImpl = globalThis.fetch } = {}) {
  const out = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK).map((m) => ({
      sound: 'default', priority: 'high', channelId: 'default', ...m,
    }));
    out.push(...await sendChunk(chunk, fetchImpl));
  }
  return out;
}
