// Caps on client-controlled strings we persist (defense-in-depth; the schema also
// bounds them). Keep generous enough for real values, tight enough to stop abuse.
const MAX_COOKIE = 256;
const MAX_UA = 512;
const MAX_URL = 1024;

const cap = (v, max) => (v ? String(v).slice(0, max) : undefined);

/** Accept only a real http(s) URL, bounded in length; else undefined. */
function safeUrl(raw) {
  if (!raw || typeof raw !== 'string') return undefined;
  const s = raw.trim().slice(0, MAX_URL);
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return s;
  } catch {
    /* not a URL */
  }
  return undefined;
}

/**
 * Extract Meta marketing-attribution signals from an inbound request, to persist
 * on the Order and replay via CAPI on payment success (metaCapiService.js).
 *
 * `_fbp`/`_fbc` are the Meta Pixel's first-party cookies. The client IP comes from
 * `req.ip`: the app sets `trust proxy` = 2, so Express walks X-Forwarded-For from
 * the RIGHT past the 2 trusted hops (Cloudflare/Vercel → Railway) and returns the
 * real buyer IP — NOT the client-spoofable leftmost XFF token. Every field is
 * optional (absent for offline/pre-Pixel orders) and length-bounded since all are
 * client-controlled; `eventSourceUrl` is validated as a real URL before it's
 * stored/replayed to Meta.
 */
export function extractMetaTracking(req) {
  const cookies = req.cookies || {};

  const tracking = {
    fbp: cap(cookies._fbp, MAX_COOKIE),
    fbc: cap(cookies._fbc, MAX_COOKIE),
    clientIp: req.ip || undefined,
    userAgent: cap(req.headers['user-agent'], MAX_UA),
    // The checkout page URL, sent by the client (Referer is unreliable through proxies).
    eventSourceUrl: safeUrl(req.body && req.body.eventSourceUrl) || safeUrl(req.headers['referer']),
  };

  // Return undefined when nothing useful was captured, so callers can skip setting it.
  return Object.values(tracking).some(Boolean) ? tracking : undefined;
}

export default { extractMetaTracking };
