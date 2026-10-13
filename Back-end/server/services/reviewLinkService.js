/**
 * Signed review links — let a real buyer review without an account.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Posting a review requires a logged-in account, and the post-delivery request
 * email skips any order without one. Most sales here start on a phone call or
 * WhatsApp and check out as a guest, so those customers were never asked for a
 * review and could not have left one if they had been. 923 products carry five
 * reviews between them, and that is the reason.
 *
 * So the LINK carries the proof instead of the session: admin mints one for a
 * specific order and product, the salesperson sends it on WhatsApp, and the
 * customer writes the review with no account at all.
 *
 * ── Why a token and not an order id in the URL ──────────────────────────────
 * `/review/<orderId>/<productId>` would let anyone who can count enumerate
 * every order in the database and leave a "verified purchase" review on any
 * product. The token is an HMAC over exactly those two ids plus an expiry,
 * signed with a server secret, so a link cannot be guessed, edited to point at
 * another product, or extended past its expiry. Verification is constant-time.
 *
 * ── What the token does NOT do ──────────────────────────────────────────────
 * It is not a session. It authorises ONE action — review this product on this
 * order — and nothing else. It never logs anyone in, never exposes the order,
 * and carries no personal data: the payload is two ids and a timestamp.
 *
 * Single use is enforced by the DATABASE, not here: Review has a unique index
 * on (order, product). A replayed link loses the race and is told the review
 * already exists, which is the only approach that holds under two taps on the
 * same WhatsApp message.
 */
import crypto from 'crypto';

/** 30 days: long enough for a slow delivery and a reminder, short enough to expire. */
export const LINK_TTL_DAYS = 30;

/**
 * Dedicated secret, falling back to JWT_SECRET so the feature works on an
 * environment that has not set it yet. Rotating REVIEW_LINK_SECRET invalidates
 * every outstanding link, which is the intended emergency control.
 */
const secret = () => process.env.REVIEW_LINK_SECRET || process.env.JWT_SECRET || '';

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64url = (s) =>
  Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sign = (payload) =>
  base64url(crypto.createHmac('sha256', secret()).update(payload).digest());

/**
 * Mint a token for one order + one product.
 *
 * @param {string} orderId
 * @param {string} productId
 * @param {number} [ttlDays]
 * @returns {{ token: string, expiresAt: Date }}
 * @throws {Error} when no secret is configured — a token signed with an empty
 *         key is forgeable by anyone, so this fails loudly rather than issuing
 *         a link that looks fine and protects nothing.
 */
export const mintReviewToken = (orderId, productId, ttlDays = LINK_TTL_DAYS) => {
  if (!secret()) throw new Error('[reviewLink] REVIEW_LINK_SECRET / JWT_SECRET is not set');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const body = base64url(JSON.stringify({
    o: String(orderId),
    p: String(productId),
    e: Math.floor(expiresAt.getTime() / 1000),
  }));
  return { token: `${body}.${sign(body)}`, expiresAt };
};

/**
 * Verify a token and return what it authorises.
 *
 * @param {string} token
 * @returns {{ ok: true, orderId: string, productId: string, expiresAt: Date }
 *          | { ok: false, reason: 'malformed'|'bad-signature'|'expired'|'unconfigured' }}
 */
export const readReviewToken = (token) => {
  if (!secret()) return { ok: false, reason: 'unconfigured' };

  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return { ok: false, reason: 'malformed' };

  /*
    Compare in constant time. `===` on a hex/base64 string leaks how many
    leading characters matched through its timing, which is enough to forge a
    signature byte by byte given enough attempts. Buffers of unequal length
    make timingSafeEqual throw, so the length is checked first.
  */
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(String(mac));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload?.o || !payload?.p || !payload?.e) return { ok: false, reason: 'malformed' };

  const expiresAt = new Date(payload.e * 1000);
  if (expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, orderId: String(payload.o), productId: String(payload.p), expiresAt };
};

/** The customer-facing URL for a token, on the storefront. */
export const reviewLinkUrl = (token) => {
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${base}/review/${token}`;
};

export default { mintReviewToken, readReviewToken, reviewLinkUrl, LINK_TTL_DAYS };
