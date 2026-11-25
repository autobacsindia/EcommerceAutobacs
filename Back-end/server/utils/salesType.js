/**
 * B2B / B2C on a GTM (sales-panel) quotation and order — owner, 2026-11-25.
 *
 *   B2C (retail)   → offers allowed as today: offer prices below the catalogue
 *                    price and a % discount on the total (e.g. "Black Friday").
 *                    Ship before payment is NOT available.
 *   B2B (business) → NO offers: every catalogue line at its catalogue price and no
 *                    % discount. Company name + GSTIN are required (they go on the
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
 * @param {{discount?: object|null, lines: Array}} p  priced lines (order/quotation shape)
 */
export function b2bOfferProblem({ discount, lines }) {
  if (discount && Number(discount.percent) > 0) {
    return 'B2B orders get no offers: remove the discount on the total.';
  }
  const n = offerLineCount(lines);
  if (n) {
    return `B2B orders get no offers: ${n === 1 ? 'one item is' : `${n} items are`} below the catalogue price. Use the catalogue price.`;
  }
  return null;
}

/** "10% off (Black Friday)", "offer prices on 2 items", or null. */
function describeOffers(doc) {
  const parts = [];
  const d = discountOf(doc);
  if (d) parts.push(`${d.percent}% off${d.reason ? ` (${d.reason})` : ''}`);
  const n = offerLineCount(doc?.items);
  if (n) parts.push(`offer price on ${n} item${n === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' + ') : null;
}

const shapeCheck = (c) => (c?.status
  ? {
    status: c.status,
    type: c.type || null,
    byName: c.byName || null,
    role: c.role || null,
    at: c.at || null,
    note: c.note || '',
  }
  : null);

/**
 * The badge and its short reason, for GTM, accounts and the admin.
 * `shipBeforePayment`: 'allowed' | 'needs_check' | 'not_b2c'.
 */
export function shapeSalesType(doc) {
  const b2b = isB2B(doc);
  const check = shapeCheck(doc?.buyerTypeCheck);
  // A legacy order (no check at all) keeps working as before: B2B on it needs no check.
  const approved = !check || check.status === 'approved';
  if (b2b) {
    return {
      type: SALES_TYPES.B2B,
      label: 'B2B',
      reason: approved
        ? 'Business order — no offers. Ship before payment allowed.'
        : 'Business order — no offers. Ship before payment once accounts approves.',
      shipBeforePayment: approved ? 'allowed' : 'needs_check',
      company: { legalName: doc.buyer.legalName || '', gstin: doc.buyer.gstin || '' },
      check,
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
