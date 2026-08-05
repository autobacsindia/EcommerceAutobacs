/**
 * Normalizes a Razorpay payment entity into our own payment-method taxonomy.
 *
 * Pure functions, no I/O — the gateway payload in, our enum + a small structured
 * `methodDetails` subdoc out. Kept out of razorpayService so it is unit-testable
 * without mocking the SDK, and so the same mapping can be replayed over historical
 * `paymentDetails.razorpay` blobs by the backfill script.
 *
 * WHY THIS EXISTS: the previous inline mapper keyed on a `'debitcard'` method that
 * Razorpay has never emitted. Real debit cards arrive as `method: 'card'` with
 * `card.type: 'debit'`, so every debit card in the system was recorded as
 * `credit_card`, and `cardless_emi` fell through to `other` — meaning the admin
 * payment-mix report could not tell cards apart or see cardless EMI at all.
 */

/**
 * Razorpay `method` → our Payment.paymentMethod enum.
 * `card` is deliberately absent: it resolves to credit_card/debit_card via card.type.
 */
const METHOD_MAP = Object.freeze({
  netbanking: 'net_banking',
  wallet: 'wallet',
  upi: 'upi',
  emi: 'emi',
  // Cardless EMI is still a instalment loan from the customer's point of view; bucketing
  // it as `emi` keeps the payment mix honest. The lender-vs-card distinction that actually
  // governs refund behaviour lives in methodDetails.emi.kind, not in this enum.
  cardless_emi: 'emi',
});

/** Razorpay `card.type` → our card enum half. */
const CARD_TYPE_MAP = Object.freeze({
  debit: 'debit_card',
  credit: 'credit_card',
  prepaid: 'wallet',
});

/**
 * Resolve our `paymentMethod` enum value for a Razorpay payment entity.
 *
 * Unknown/new gateway methods (paylater, bank_transfer, nach, …) return `other`
 * rather than the raw string: an out-of-enum value would throw Mongoose validation
 * inside the payment transaction and strand captured money in an unrecorded state.
 * The raw method is always preserved in methodDetails.rawMethod.
 *
 * @param {Object|string} payment - Razorpay payment entity (or a bare method string).
 * @returns {string} one of Payment.paymentMethod's enum values
 */
export function resolvePaymentMethod(payment) {
  const entity = typeof payment === 'string' ? { method: payment } : (payment || {});
  const method = entity.method;

  if (method === 'card') {
    // `card.type` is absent on some acquirer responses — fall back to credit_card,
    // which is what the old mapper always returned, so we never regress.
    return CARD_TYPE_MAP[entity.card?.type] || 'credit_card';
  }
  return METHOD_MAP[method] || 'other';
}

/**
 * Razorpay reports EMI interest as basis points (1300 = 13%). Guard the other
 * convention too: anything ≤ 100 is already a percentage, so treat it as one
 * instead of silently rendering 13% as 0.13%.
 * @param {number|undefined} rate
 * @returns {number|undefined} rate as a percentage, or undefined if unusable
 */
function toRatePercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n > 100 ? n / 100 : n;
}

/**
 * Classify which EMI product this is. This drives refund behaviour — Razorpay
 * accepts partial refunds on credit-card EMI and cardless EMI but rejects them
 * on debit-card EMI — so it must be derived from stored facts, never guessed at
 * refund time.
 * @returns {'credit_card'|'debit_card'|'cardless'|'unknown'}
 */
function resolveEmiKind(entity) {
  if (entity.method === 'cardless_emi') return 'cardless';
  // `emi_plan`/`emi` (present when the payment is fetched with expand[]=emi) is the
  // most direct signal; card.type is the fallback available on the raw webhook payload.
  const planType = entity.emi_plan?.type || entity.emi?.type;
  const type = planType || entity.card?.type;
  if (type === 'debit') return 'debit_card';
  if (type === 'credit') return 'credit_card';
  return 'unknown';
}

/**
 * Extract the structured method detail we want to keep queryable, out of the
 * otherwise opaque `paymentDetails.razorpay` blob.
 *
 * Everything is optional: a webhook payload carries less than an expanded fetch,
 * and we would rather store a partial record than none at all. Absent fields are
 * omitted (not set to null) so they never render as empty rows in the admin UI.
 *
 * @param {Object} payment - Razorpay payment entity
 * @returns {Object} methodDetails subdoc
 */
export function buildMethodDetails(payment) {
  const entity = payment || {};
  const details = {};

  if (entity.method) details.rawMethod = entity.method;

  const card = entity.card;
  if (card) {
    if (card.network) details.cardNetwork = card.network;
    if (card.type) details.cardType = card.type;
    if (card.issuer) details.cardIssuer = card.issuer;
    if (card.last4) details.cardLast4 = card.last4;
  }

  if (entity.method === 'emi' || entity.method === 'cardless_emi') {
    const plan = entity.emi_plan || entity.emi || {};
    const emi = { kind: resolveEmiKind(entity) };

    // Issuer: the bank for card EMI, the lender for cardless (`provider`, e.g. zestmoney).
    const issuer = plan.issuer || entity.provider || card?.issuer;
    if (issuer) emi.issuer = issuer;

    const months = Number(plan.duration);
    if (Number.isInteger(months) && months > 0) emi.months = months;

    const ratePercent = toRatePercent(plan.rate);
    if (ratePercent !== undefined) emi.ratePercent = ratePercent;

    details.emi = emi;
  }

  return details;
}

/**
 * Whether Razorpay will accept a PARTIAL refund against this payment.
 *
 * Debit-card EMI is full-refund-only at the issuer — the bank is never told which
 * line of a multi-item order came back, so it can only unwind the whole loan.
 * Attempting a partial refund is rejected at the gateway.
 *
 * Derived at read time rather than stored, so the policy can be corrected without
 * a data backfill. `unknown`-kind EMI is treated as permitted: we must not block a
 * legitimate credit-card-EMI refund just because the payload lacked `card.type`;
 * if it really is debit EMI the gateway rejects it and the caller surfaces that.
 *
 * @param {Object} paymentDoc - our Payment document (needs methodDetails)
 * @returns {boolean}
 */
export function supportsPartialRefund(paymentDoc) {
  return paymentDoc?.methodDetails?.emi?.kind !== 'debit_card';
}

/**
 * Human-readable one-liner for order/admin UI and emails, e.g.
 * "EMI · HDFC Bank · 6 months @ 14%". Returns undefined for non-EMI payments so
 * callers can simply skip rendering.
 * @param {Object} paymentDoc - our Payment document (needs methodDetails)
 * @returns {string|undefined}
 */
export function describeEmiPlan(paymentDoc) {
  const emi = paymentDoc?.methodDetails?.emi;
  if (!emi) return undefined;

  const KIND_LABEL = {
    credit_card: 'Credit Card EMI',
    debit_card: 'Debit Card EMI',
    cardless: 'Cardless EMI',
    unknown: 'EMI',
  };

  const parts = [KIND_LABEL[emi.kind] || 'EMI'];
  if (emi.issuer) parts.push(emi.issuer);
  if (emi.months) {
    parts.push(emi.ratePercent ? `${emi.months} months @ ${emi.ratePercent}%` : `${emi.months} months`);
  }
  return parts.join(' · ');
}
