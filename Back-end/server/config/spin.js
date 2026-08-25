/**
 * Spin-to-Win constants — single source of truth for the post-purchase rewards wheel.
 *
 * A "spin" is a single, server-decided reward granted once per PAID order. The wheel is
 * pure theatre: the client picks nothing, verifies nothing, and cannot influence the
 * outcome. Everything below exists so a status string, a prize kind, or a void reason
 * can never drift between the model, the service, the validators and the admin UI.
 *
 * ── Why this does NOT violate the stock landmine ──────────────────────────────
 * CLAUDE.md forbids building quantity-decrement or reservation logic against Product's
 * coarse `in/low/out` availability enum, and forbids reviving WarehouseInventory. This
 * feature touches neither. Goodies live in their own SpinPrize collection with genuine
 * integer stock, entirely outside the catalogue — no Product write, no Elasticsearch
 * sync, no WarehouseInventory. The prohibition is about lying to shoppers with a
 * quantity the catalogue does not track; here the quantity is real and is the whole
 * point.
 */

// Lifecycle is deliberately the SAME vocabulary as the discount-campaign engine
// (config/campaign.js): draft → configure, live → running, off → instant kill switch.
// CLAUDE.md forbids a second way to express an established concept, and a parallel
// set of status words is how an operator flips the wrong one and correctly sees
// nothing happen.
export { CAMPAIGN_STATUS as SPIN_STATUS, CAMPAIGN_STATUSES as SPIN_STATUSES } from './campaign.js';

/**
 * What a prize actually hands over.
 *
 *   goodie — a physical object off a shelf. Needs a human to put it in the parcel,
 *            so it is the only kind that enters the fulfilment queue.
 *   coupon — a discount code, issued through the EXISTING coupon engine. Never a
 *            second money pipeline (see config/campaign.js for why that matters).
 *   karma  — loyalty points via karmaService. Gated on LoyaltyConfig.enabled, which
 *            is currently OFF in production — a karma prize on a disabled programme
 *            falls back to the floor prize rather than awarding nothing silently.
 */
export const PRIZE_KIND = Object.freeze({
  GOODIE: 'goodie',
  COUPON: 'coupon',
  KARMA: 'karma',
});

export const PRIZE_KINDS = Object.freeze(Object.values(PRIZE_KIND));

/**
 * A spin result's lifecycle.
 *
 *   granted — the customer won it and it stands.
 *   void    — clawed back. The order was cancelled or refunded, so the prize is
 *             withdrawn and (if not yet physically shipped) its stock returned.
 *
 * There is no `pending`. A spin either completed inside its transaction or it did
 * not happen at all; a half-state would be a second source of truth about whether
 * stock was taken.
 */
export const SPIN_RESULT_STATUS = Object.freeze({
  GRANTED: 'granted',
  VOID: 'void',
});

export const SPIN_RESULT_STATUSES = Object.freeze(Object.values(SPIN_RESULT_STATUS));

/** Why a granted prize was withdrawn. Free-form would drift; these are reportable. */
export const VOID_REASON = Object.freeze({
  ORDER_CANCELLED: 'order_cancelled',
  ORDER_RETURNED: 'order_returned',
  ORDER_REFUNDED: 'order_refunded',
  ADMIN_REVOKED: 'admin_revoked',
});

export const VOID_REASONS = Object.freeze(Object.values(VOID_REASON));

/**
 * How many times the draw may lose the race for a unit before falling back.
 *
 * A null return from the guarded decrement means a concurrent spin took the last one
 * (or the daily cap closed). We drop that prize and re-draw. Three attempts covers
 * realistic contention; beyond that the honest answer is the floor prize, which has
 * unlimited stock and therefore cannot fail. Unbounded retries would turn a hot
 * last-unit into a spin that hangs.
 */
export const MAX_DRAW_ATTEMPTS = 3;

/** Visual slices on the wheel. Display only — unrelated to how many prizes exist. */
export const DEFAULT_SEGMENT_COUNT = 8;
export const MIN_SEGMENT_COUNT = 6;
export const MAX_SEGMENT_COUNT = 12;

/**
 * Hosts the Google review CTA is allowed to point at.
 *
 * Validated with `new URL()` and an exact hostname match, never a substring or a
 * "starts with" test — `https://evil.com/?x=google.com` passes a naive contains
 * check, and `//evil.com` passes a naive "starts with /" check. That exact class of
 * bug is on record in this repo from the promo-banner link work.
 */
export const REVIEW_URL_ALLOWED_HOSTS = Object.freeze([
  'search.google.com',
  'g.page',
  'maps.google.com',
  'www.google.com',
  'maps.app.goo.gl',
]);

// ── Cache keys ────────────────────────────────────────────────────────────────
// Shared so the writer, the reader and the purger cannot drift apart. The key sits
// UNDER the pattern deliberately: one purge call covers every spin cache entry, and
// the flush-cache script's `public:*` sweep covers it too.

/** Cache-aside entry for "which campaign is live right now" (services/spinService.js). */
export const SPIN_LIVE_CAMPAIGN_CACHE_KEY = 'public:spin:live-campaign';

/** Every spin cache entry. Purged after any campaign or prize write. */
export const SPIN_CACHE_PATTERN = 'public:spin:*';
