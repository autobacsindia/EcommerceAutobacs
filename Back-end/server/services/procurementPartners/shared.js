/**
 * Shared pieces of the procurement side of Autobacs Partner: who may use it,
 * input cleaning, and the ONE price check every approval and price review goes
 * through.
 */
import AppError from '../../utils/AppError.js';
import { STAFF_TEAMS } from '../../config/staff.js';
import { isObjectId } from '../../utils/listQuery.js';
import { resolveMarginRule } from '../supplierPortal/marginRules.js';
import { suggestSellingPrice, checkPrice } from '../../utils/supplierPricing.js';

export const PAGE_SIZE = 30;
export const MAX_PRICE_RUPEES = 10_000_000; // ₹1 crore — beyond any real part

export const fail = (message, status, code) => {
  const err = new AppError(message, status, { expose: true });
  if (code) err.code = code;
  return err;
};
export const idOf = (v) => (v == null ? null : String(v._id ?? v));
export const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Active procurement staff, or the admin. Same rule as supplier enquiries and the supplier directory. */
export const mayReviewPartners = (u) => u?.role === 'admin'
  || (u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.PROCUREMENT);

export function guard(actor) {
  if (!mayReviewPartners(actor)) throw fail('Supplier partners are handled by the procurement team.', 403);
}

/** Plain single-line (or multi-line) text, control characters removed, capped. */
export function text(v, max, { multiline = false } = {}) {
  let s = [...String(v ?? '')].filter((c) => { const n = c.charCodeAt(0); return n === 9 || n === 10 || n === 13 || (n >= 32 && n !== 127); }).join('');
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

export function requireId(v, what = 'record') {
  const s = String(v ?? '');
  if (!isObjectId(s)) throw fail(`That ${what} was not found.`, 404);
  return s;
}

/** A note the supplier will read (request changes / reject): required, plain text. */
export function requireNote(v, what = 'Tell the supplier what to change') {
  const note = text(v, 1000, { multiline: true });
  if (note.length < 5) throw fail(`${what} (at least 5 characters).`, 400);
  return note;
}

/** Whole rupees incl. GST, as Product.price stores them. */
export function cleanPrice(v) {
  const n = typeof v === 'string' ? Number(v.replace(/[₹,\s]/g, '')) : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PRICE_RUPEES) {
    throw fail('Selling price: enter whole rupees including GST, e.g. 3035.', 400);
  }
  return n;
}

const rupeeText = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/**
 * The price rules for a supplier-listed product. Throws:
 *   422 BELOW_COST  — the price (ex-GST) is under the supplier's cost. Never allowed.
 *   422 BELOW_FLOOR — under the floor margin, unless `override === true` with a reason.
 * Returns { rule, suggestedPrice, marginBp, belowFloor, overrideReason }.
 */
export async function priceDecision({ costPaise, gstPct, price, categoryIds = [], override = false, overrideReason = '' }) {
  const rule = await resolveMarginRule(categoryIds);
  const suggestedPrice = suggestSellingPrice({ costPaise, gstPct, marginBp: rule.targetBp });
  const { marginBp, belowCost, belowFloor } = checkPrice({ costPaise, gstPct, priceRupees: price, floorBp: rule.floorBp });
  if (belowCost) {
    throw fail(`${rupeeText(price)} is below what the supplier charges us. Pick a higher price (suggested ${rupeeText(suggestedPrice)}).`, 422, 'BELOW_COST');
  }
  const reason = text(overrideReason, 300);
  if (belowFloor && !(override === true && reason.length >= 5)) {
    throw fail(
      `${rupeeText(price)} gives a ${(marginBp / 100).toFixed(1)}% margin, below the ${(rule.floorBp / 100).toFixed(1)}% floor. `
      + 'Tick "sell below floor" and give a reason, or raise the price.',
      422,
      'BELOW_FLOOR',
    );
  }
  return { rule, suggestedPrice, marginBp, belowFloor, overrideReason: belowFloor ? reason : '' };
}

/** Pricing numbers for a review screen — never throws on a low price. */
export async function pricingView({ costPaise, gstPct, categoryIds = [], price = null }) {
  const rule = await resolveMarginRule(categoryIds);
  const suggestedPrice = suggestSellingPrice({ costPaise, gstPct, marginBp: rule.targetBp });
  const current = price ? checkPrice({ costPaise, gstPct, priceRupees: price, floorBp: rule.floorBp }) : null;
  return {
    costPaise,
    gstPct,
    rule: { targetBp: rule.targetBp, floorBp: rule.floorBp, source: rule.source },
    suggestedPrice,
    ...(current ? { currentPrice: price, currentMarginBp: current.marginBp, currentBelowFloor: current.belowFloor, currentBelowCost: current.belowCost } : {}),
  };
}

/** The actor stamp every decision carries. */
export const stamp = (actor) => ({ reviewedAt: new Date(), reviewedBy: actor._id, reviewedByName: actor.name || '' });
