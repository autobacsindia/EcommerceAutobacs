/**
 * B2B / B2C on a GTM (sales-panel) quotation and order — owner, 2026-11-25.
 *
 *   B2C (retail)   → offers allowed as today: offer prices below the catalogue
 *                    price and a % discount on the total (e.g. "Black Friday").
 *                    Ship before payment is NOT available.
 *   B2B (business) → no % discount on the total. Each catalogue line may carry a
 *                    staff-set "B2B price" at or below its catalogue price (owner,
 *                    2026-11-28) — the same server checks as a B2C offer price
 *                    (₹1 minimum, never above list) and the same >10% approval. Company name + GSTIN are required (they go on the
 *                    tax invoice). Ship before payment is available once accounts
 *                    has approved the order as B2B.
 *
 * There is no new "type" field: B2B IS the existing enterprise buyer
 * (Order.buyer.type === 'enterprise', config/buyer.js), which already requires a
 * checksum-valid GSTIN — so a retail customer cannot be passed off as B2B by a
 * click. Everything here is a pure function of the stored document.
 *
 * Accounts' check (Order.buyerTypeCheck) is set to `pending` on every GTM order
 * created after this shipped; older orders have none and behave as before
 * (they are B2C unless their buyer is an enterprise).
 */
import { BUYER_TYPES } from '../config/buyer.js';

export const SALES_TYPES = Object.freeze({ B2B: 'b2b', B2C: 'b2c' });

export const isB2B = (doc) => doc?.buyer?.type === BUYER_TYPES.ENTERPRISE;
export const salesTypeOf = (doc) => (isB2B(doc) ? SALES_TYPES.B2B : SALES_TYPES.B2C);

/** Order state for accounts' check, written when a GTM order is created. */
export const pendingCheckFor = (doc) => ({ status: 'pending', type: salesTypeOf(doc) });

export const NO_SHIP_BEFORE_PAYMENT_B2C = 'Ship before payment: not available — retail (B2C) order.';
export const NEEDS_ACCOUNTS_CHECK = 'Accounts must first approve this order as B2B (with a note).';

/** Discount on the total (stored `discount` on a quotation, `salesDiscount` on an order). */
const discountOf = (doc) => {
  const d = doc?.salesDiscount ?? doc?.discount;
  return d && Number(d.percent) > 0 ? d : null;
};

/** Catalogue lines sold below their catalogue price (`listPrice` is set only then). */
const offerLineCount = (lines) => (lines || []).filter((l) => !l.custom && Number(l.listPrice) > Number(l.price)).length;

/**
 * Why these money terms are not allowed on a B2B order — or null when they are.
 * Only the % discount on the total is refused: per-line B2B prices are allowed
 * (owner, 2026-11-28) and are bounded by priceSalesLines + the >10% approval.
 * @param {{discount?: object|null, lines?: Array}} p  priced lines (order/quotation shape)
 */
export function b2bOfferProblem({ discount }) {
  if (discount && Number(discount.percent) > 0) {
    return 'B2B orders get no discount on the total: set a B2B price on each item instead.';
  }
  return null;
}

/** "B2B price on 2 items", or null — said on the B2B badge so accounts sees it. */
const describeB2BPrices = (doc) => {
  const n = offerLineCount(doc?.items);
  return n ? `B2B price on ${n} item${n === 1 ? '' : 's'}` : null;
};

/** "10% off (Black Friday)", "offer prices on 2 items", or null. */
function describeOffers(doc) {
  const parts = [];
  const d = discountOf(doc);
  if (d) parts.push(`${d.percent}% off${d.reason ? ` (${d.reason})` : ''}`);
  const n = offerLineCount(doc?.items);
  if (n) parts.push(`offer price on ${n} item${n === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' + ') : null;
}

const LABEL = { b2b: 'B2B', b2c: 'B2C' };

const shapeChange = (c) => ({
  at: c.at || null,
  byName: c.byName || null,
  role: c.role || null,
  from: c.from,
  to: c.to,
  fromLabel: LABEL[c.from] || c.from,
  toLabel: LABEL[c.to] || c.to,
  reason: c.reason || '',
  // What the change did to "Ship before payment" (see PAY_LATER_EFFECT_TEXT).
  payLaterEffect: c.payLaterEffect || 'none',
  payLaterNote: PAY_LATER_EFFECT_TEXT[c.payLaterEffect] || null,
});

const shapeCheck = (c) => (c?.status
  ? {
    status: c.status,
    type: c.type || null,
    byName: c.byName || null,
    role: c.role || null,
    at: c.at || null,
    note: c.note || '',
    // Newest first, for the order view.
    changes: (c.changes || []).map(shapeChange).reverse(),
  }
  : null);

// ── Changing the type after accounts' check (owner 2026-11-26) ──────────────────

/** The most changes one order may carry (a guard against a runaway loop, not a policy). */
export const TYPE_CHANGE_MAX = 20;
export const TYPE_CHANGE_REASON_MIN = 3;
export const TYPE_CHANGE_REASON_MAX = 300;

/** Order states in which the order has gone (closed, or the customer has it). */
const CLOSED_STATUSES = ['cancelled', 'returned'];
/** Parcels that have left the building. */
export const LEFT_SHIPMENT_STATUSES = Object.freeze(['shipped', 'delivered', 'lost']);

export const PAY_LATER_EFFECT_TEXT = Object.freeze({
  withdrawn: 'Ship before payment was taken back: the order waits for payment again. Send the customer a payment link.',
  kept_shipped_unpaid: 'Already shipped without payment, so ship before payment was left running. The admin was told.',
});

const hasLeft = (order) => !!order?.payLater?.dispatchedAt
  || ['shipped', 'delivered'].includes(order?.status)
  || (order?.shipments || []).some((s) => LEFT_SHIPMENT_STATUSES.includes(s.status));

/**
 * What changing this B2B order to B2C does to "Ship before payment":
 *   'none'                 → not on, or the order is paid (nothing owed)
 *   'withdrawn'            → on, unpaid, nothing has left → it is taken back
 *   'kept_shipped_unpaid'  → on, unpaid, a parcel has left → left running, admin told
 */
export function payLaterEffectOf(order) {
  if (!order?.payLater?.approvedAt || order.paymentStatus === 'paid') return 'none';
  return hasLeft(order) ? 'kept_shipped_unpaid' : 'withdrawn';
}

/**
 * Why this GTM order's type cannot be changed to `to` right now — or null.
 * `to` is 'b2b' | 'b2c'. Pure; the service re-checks all of it in its write.
 */
export function typeChangeProblem(order, to) {
  if (!order?.buyerTypeCheck?.status) return 'Only orders made in the sales panel (with a B2B / B2C check) can be changed.';
  if (to !== SALES_TYPES.B2B && to !== SALES_TYPES.B2C) return 'Choose B2B or B2C.';
  if (salesTypeOf(order) === to) return null; // the service treats this as "already done"
  if (CLOSED_STATUSES.includes(order.status)) return `This order is ${order.status}. Its type can no longer be changed.`;
  // The receipt already in the customer's inbox prints the company name and GSTIN
  // (or not). Changing the type now would make our record disagree with their copy.
  if (order.invoiceNo != null) {
    return 'The receipt has already been emailed to the customer with this type, so it cannot be changed now. Speak to the admin about a corrected bill.';
  }
  if ((order.buyerTypeCheck.changeCount || 0) >= TYPE_CHANGE_MAX) {
    return 'This order has been changed too many times. Speak to the admin.';
  }
  if (to === SALES_TYPES.B2B) {
    // B2B gets no discount on the total. We never reprice an existing order here:
    // the customer agreed this total. If it carries one it was sold as retail.
    const offer = b2bOfferProblem({ discount: order.salesDiscount });
    if (offer) return `${offer} This order was sold with a discount on the total, so it cannot become B2B. Make a new B2B quotation instead.`;
  }
  return null;
}

/**
 * The badge and its short reason, for GTM, accounts and the admin.
 * `shipBeforePayment`: 'allowed' | 'needs_check' | 'not_b2c'.
 */
export function shapeSalesType(doc) {
  const b2b = isB2B(doc);
  const check = shapeCheck(doc?.buyerTypeCheck);
  // Changed to B2C after it shipped unpaid: stays red until the customer pays.
  const alert = doc?.paymentStatus !== 'paid'
    && (doc?.buyerTypeCheck?.changes || []).some((c) => c.payLaterEffect === 'kept_shipped_unpaid')
    ? 'Changed to B2C after it was shipped without payment. The customer still has to pay — follow up.'
    : null;
  // A legacy order (no check at all) keeps working as before: B2B on it needs no check.
  const approved = !check || check.status === 'approved';
  if (b2b) {
    const prices = describeB2BPrices(doc);
    const head = `Business order — ${prices ? `${prices}, ` : ''}no discount on the total.`;
    return {
      type: SALES_TYPES.B2B,
      label: 'B2B',
      reason: approved
        ? `${head} Ship before payment allowed.`
        : `${head} Ship before payment once accounts approves.`,
      shipBeforePayment: approved ? 'allowed' : 'needs_check',
      company: { legalName: doc.buyer.legalName || '', gstin: doc.buyer.gstin || '' },
      check,
      alert,
    };
  }
  const offers = describeOffers(doc);
  return {
    type: SALES_TYPES.B2C,
    label: 'B2C',
    reason: offers ? `Retail order — offer applied: ${offers}.` : 'Retail order — no offer applied.',
    shipBeforePayment: 'not_b2c',
    company: null,
    check,
    alert,
  };
}

/**
 * Why ship-before-payment is refused on this order for its type, or null.
 * B2B only; on a GTM order made after this shipped, accounts must have approved it.
 */
export function payLaterTypeProblem(order) {
  if (!isB2B(order)) return NO_SHIP_BEFORE_PAYMENT_B2C;
  const c = order.buyerTypeCheck;
  if (c?.status && c.status !== 'approved') return NEEDS_ACCOUNTS_CHECK;
  return null;
}
