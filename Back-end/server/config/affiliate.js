/**
 * Affiliate-program constants — single source of truth.
 *
 * An "affiliate" is a person who promotes the store and earns a percentage of what
 * they bring in. They get two things: a unique COUPON CODE (which also discounts the
 * buyer) and a TRACKING LINK (`?ref=CODE`).
 *
 * ── THE ARCHITECTURAL RULE ───────────────────────────────────────────────────────
 * An Affiliate owns the DECISIONS — who qualifies, what rate, active or suspended.
 * It owns NO MONEY. The buyer-facing discount is applied through the affiliate's
 * managed Coupon (Coupon.affiliate), so Order.discount, the invoice and
 * refundMathService all keep reading ONE set of figures. This is the same rule
 * config/campaign.js states for campaigns, and for the same reason: a second money
 * pipeline is how a discounted order gets refunded at full price.
 *
 * The COMMISSION is a separate ledger (models/AffiliateCommission.js) that never
 * touches the order's totals. It is what WE owe the affiliate — it is not part of
 * what the customer paid, so it must never appear in any pricing or refund figure.
 *
 * Import these everywhere (models, service, validators, admin) so a status string or
 * a window length can never drift between call sites.
 */

/**
 * Affiliate lifecycle.
 *
 *   pending   — applied, awaiting review. Attributes nothing, earns nothing.
 *   active    — approved. Their code discounts, their link attributes, they earn.
 *   suspended — the kill switch. New attribution stops immediately and the managed
 *               coupon is deactivated, but commissions ALREADY attributed keep their
 *               lifecycle: the work was done. Voiding those is a separate, deliberate
 *               admin action that writes an `adjust` row, so the audit shows a human
 *               decided it rather than a status flip doing it silently.
 *   rejected  — application declined. Terminal; re-applying creates a new record.
 */
export const AFFILIATE_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected',
});

export const AFFILIATE_STATUSES = Object.freeze(Object.values(AFFILIATE_STATUS));

/** Only an `active` affiliate may attribute a sale or price a coupon. */
export const ATTRIBUTING_STATUSES = Object.freeze([AFFILIATE_STATUS.ACTIVE]);

/**
 * How a sale was attributed.
 *
 *   coupon — the buyer typed the affiliate's code, and it actually applied.
 *   code   — the buyer typed the affiliate's code, and it gave them NO discount
 *            (they had already used it). The affiliate is still credited: the code
 *            is their identity tag, not only a discount mechanism.
 *   link   — the buyer arrived via `?ref=` and the cookie survived to checkout.
 *
 * ⚠️ `code` is deliberately NOT folded into `coupon`. They earn the same commission,
 * but one gave the customer money off and the other did not — so they cost us very
 * different amounts. Merging them would make the payout report unable to answer
 * "what did this affiliate actually cost us", which is the question it exists for.
 *
 * Recorded on the order rather than derived later, because the cookie is gone by the
 * time anyone asks and the coupon can be edited.
 */
export const ATTRIBUTION_SOURCE = Object.freeze({
  COUPON: 'coupon',
  CODE: 'code',
  LINK: 'link',
});

export const ATTRIBUTION_SOURCES = Object.freeze(Object.values(ATTRIBUTION_SOURCE));

/**
 * Commission ledger row kinds.
 *
 *   accrual  — the one positive row per order, written on verified payment.
 *   clawback — a negative row when money goes back (cancel / return / refund).
 *   adjust   — a signed manual correction by an admin.
 *
 * There is exactly ONE `accrual` per order, ever — enforced by a partial-unique index
 * so a replayed Razorpay webhook cannot double-credit. Clawbacks and adjustments are
 * append-only: nothing is ever mutated or deleted, so the history always reconciles.
 * Same shape, and the same reasoning, as models/KarmaLedger.js.
 */
export const COMMISSION_TYPE = Object.freeze({
  ACCRUAL: 'accrual',
  CLAWBACK: 'clawback',
  ADJUST: 'adjust',
});

export const COMMISSION_TYPES = Object.freeze(Object.values(COMMISSION_TYPE));

/**
 * Commission lifecycle.
 *
 *   pending  — payment verified, but the return window has not closed. NOT payable.
 *   approved — delivered, matured, no in-flight return. Payable.
 *   paid     — claimed by a payout batch. IMMUTABLE: it records money that actually
 *              left the bank, so a later refund writes a NEGATIVE row rather than
 *              rewriting this one. Rewriting it would stop the payout reconciling
 *              with the bank statement.
 *   reversed — fully clawed back before it was ever paid.
 *   void     — cancelled by an admin (fraud, error). Never payable.
 */
export const COMMISSION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  PAID: 'paid',
  REVERSED: 'reversed',
  VOID: 'void',
});

export const COMMISSION_STATUSES = Object.freeze(Object.values(COMMISSION_STATUS));

/**
 * Payout lifecycle.
 *
 * Deliberately NO partial state. A manual NEFT/IMPS/UPI transfer is one instruction:
 * it lands or it does not. A partial-payout state would require apportioning a bank
 * event across rows using data we simply do not have.
 *
 *   draft      — rows claimed, transfer not yet made.
 *   processing — transfer initiated at the bank.
 *   paid       — landed; the UTR is recorded.
 *   failed     — did not land. RELEASES the claim: rows return to `approved` /
 *                `payout: null` and can be re-batched.
 *   cancelled  — abandoned before transfer. Also releases the claim.
 */
export const PAYOUT_STATUS = Object.freeze({
  DRAFT: 'draft',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const PAYOUT_STATUSES = Object.freeze(Object.values(PAYOUT_STATUS));

/** Payout states that have RELEASED their commission rows back to the payable pool. */
export const PAYOUT_RELEASING_STATUSES = Object.freeze([
  PAYOUT_STATUS.FAILED,
  PAYOUT_STATUS.CANCELLED,
]);

/** How the money was sent. Recorded for reconciliation; we do not execute the transfer. */
export const PAYOUT_METHOD = Object.freeze({
  NEFT: 'neft',
  IMPS: 'imps',
  UPI: 'upi',
  OTHER: 'other',
});

export const PAYOUT_METHODS = Object.freeze(Object.values(PAYOUT_METHOD));

/**
 * The affiliate code format, shared by the model, the validators, the Next middleware
 * and `utils/affiliateAttribution.js`.
 *
 * Uppercase alphanumeric plus `-`/`_`, 3–24 chars, must start alphanumeric. Deliberately
 * narrow: this string arrives from a URL query parameter and a cookie, both fully
 * client-controlled, and it is used to look up a row that decides who gets paid.
 */
export const CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
export const CODE_MAX_LENGTH = 24;

/** Name of the first-party attribution cookie. Must match Front-end/web/src/middleware.ts. */
export const REF_COOKIE_NAME = 'ab_ref';

const intFromEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Last-click attribution window, in days.
 *
 * ⚠️ THE COOKIE'S `maxAge` IS THE WINDOW, AND THE COOKIE IS SET ON THE EDGE.
 *
 * The browser drops `ab_ref` when it expires, so by the time a request reaches this
 * process an out-of-window claim simply is not there — there is nothing for the server
 * to enforce, and the cookie carries no click timestamp to enforce it against.
 *
 * That means the authoritative value lives in Front-end/web/src/middleware.ts, which
 * runs in the Edge runtime and cannot import this file. It reads
 * NEXT_PUBLIC_AFFILIATE_ATTRIBUTION_WINDOW_DAYS instead. This constant exists so the
 * backend can DESCRIBE the window (admin copy, the affiliate dashboard's "remembered
 * for N days") and must be kept in step with that variable — it does not configure it.
 *
 * There was a `AFFILIATE_ATTRIBUTION_WINDOW_DAYS` in the backend .env.example that
 * nothing read. Setting it did nothing at all, which is worse than having no knob.
 */
export const ATTRIBUTION_WINDOW_DAYS =
  intFromEnv('NEXT_PUBLIC_AFFILIATE_ATTRIBUTION_WINDOW_DAYS', 30);

/**
 * Minimum payable balance before a payout batch can be built, in rupees.
 *
 * Bank fees and the admin's time dominate an ₹80 transfer, and a floor gives a
 * carried-forward clawback debt something to net against before we pay again.
 */
export const MIN_PAYOUT_RUPEES = intFromEnv('AFFILIATE_MIN_PAYOUT_RUPEES', 1000);

/**
 * Read a 0–100 percentage from the environment.
 *
 * ⚠️ NOT `intFromEnv`, and NOT `Number(x) || fallback`. Both treat 0 as absent —
 * `intFromEnv` requires `parsed > 0`, and `||` swallows it — which is fine for a rate
 * where zero is meaningless but WRONG for `DEFAULT_REPEAT_COMMISSION_PERCENT`, where
 * `0` is the deliberate, supported way to say "pay nothing on repeat orders".
 *
 * Same class of bug as the `default: 0` trap documented on Affiliate.discountPercent:
 * a legitimate zero being read as "unset" and silently replaced.
 *
 * Decimals are allowed — 2.5% is a plausible rate.
 */
const percentFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
};

/** Default commission rate (%) applied to a newly approved affiliate. */
export const DEFAULT_COMMISSION_PERCENT = Number(process.env.AFFILIATE_DEFAULT_COMMISSION_PERCENT) || 5;

/**
 * Default commission rate (%) on an order from a buyer who has ordered before.
 *
 * A returning buyer was already ours — the affiliate reactivated them rather than
 * acquiring them, which is worth less. Lower by default, and `0` is a fully supported
 * value meaning "no commission on repeat orders at all".
 */
export const DEFAULT_REPEAT_COMMISSION_PERCENT =
  percentFromEnv('AFFILIATE_DEFAULT_REPEAT_COMMISSION_PERCENT', 2);

/** Default buyer-facing discount (%) on the affiliate's managed coupon. */
export const DEFAULT_DISCOUNT_PERCENT = Number(process.env.AFFILIATE_DEFAULT_DISCOUNT_PERCENT) || 5;

/**
 * A `pending` commission older than this with no maturity date is surfaced in the
 * admin as STALE. It means the order was paid but never marked delivered — an
 * operations problem, not a payable. We never auto-approve on age.
 */
export const STALE_PENDING_DAYS = intFromEnv('AFFILIATE_STALE_PENDING_DAYS', 60);

/** Rows processed per maturation-sweep tick. Bounds the cron's write burst. */
export const MATURATION_BATCH_SIZE = intFromEnv('AFFILIATE_MATURATION_BATCH_SIZE', 200);

/**
 * Master switch for everything that MOVES MONEY — accrual, maturation, clawback,
 * payouts. OFF by default, matching the house convention for money-moving jobs
 * (see cronService.scheduleCareersMediaRetention).
 *
 * Attribution (the cookie, the snapshot on the order) is deliberately NOT gated on
 * this: capturing who referred a sale is harmless, and having the data already on the
 * orders is what makes turning the program on a flip rather than a backfill.
 */
export const isAffiliateEnabled = () =>
  String(process.env.AFFILIATE_COMMISSION_ENABLED).toLowerCase() === 'true';

export default {
  AFFILIATE_STATUS,
  AFFILIATE_STATUSES,
  ATTRIBUTING_STATUSES,
  ATTRIBUTION_SOURCE,
  ATTRIBUTION_SOURCES,
  COMMISSION_TYPE,
  COMMISSION_TYPES,
  COMMISSION_STATUS,
  COMMISSION_STATUSES,
  PAYOUT_STATUS,
  PAYOUT_STATUSES,
  PAYOUT_RELEASING_STATUSES,
  PAYOUT_METHOD,
  PAYOUT_METHODS,
  CODE_REGEX,
  CODE_MAX_LENGTH,
  REF_COOKIE_NAME,
  ATTRIBUTION_WINDOW_DAYS,
  MIN_PAYOUT_RUPEES,
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_REPEAT_COMMISSION_PERCENT,
  DEFAULT_DISCOUNT_PERCENT,
  STALE_PENDING_DAYS,
  MATURATION_BATCH_SIZE,
  isAffiliateEnabled,
};
