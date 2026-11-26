/**
 * Our margin on what procurement buys for an order — pure maths, no I/O.
 *
 *   margin % = (what the customer paid for the item − what we pay the supplier)
 *              ÷ what the customer paid for the item
 *
 * Owner's rules (2026-11-26):
 *   • Both sides WITH GST — the customer's price as shown on the site (GST
 *     included) against the supplier's full bill. ₹1,00,000 sale, ₹70,000 bill = 30%.
 *   • The customer's price is AFTER their coupon / karma share (what we actually
 *     received) — refundMathService's per-line net, the same figure a refund uses.
 *   • Delivery fees and courier costs are left out: margin is on the product only.
 *   • A margin of exactly the minimum passes; only below it needs a reason + accounts.
 *
 * All money is integer paise; margin is in basis points (1% = 100 bp), floored, so a
 * rounding hair can never lift a below-minimum buy over the line.
 */
import { refundableForLines } from '../services/refundMathService.js';
import { toPaise } from './money.js';
import { requestPartReplaced } from './supplierParts.js';

export const BASE_CURRENCY = 'INR';
/** A supplier request still counts as a cost while it is one of these. */
export const COST_STATUSES = Object.freeze(['submitted', 'approved', 'on_hold', 'paid']);
export const MARGIN_REASON_MIN = 5;
export const MARGIN_REASON_MAX = 500;

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** Margin in basis points, floored; null when there is no sale to measure against. */
export function marginBp(salePaise, costPaise) {
  const sale = Math.round(Number(salePaise) || 0);
  const cost = Math.round(Number(costPaise) || 0);
  if (sale <= 0) return null;
  return Math.floor(((sale - cost) * 10000) / sale);
}

/** Below the minimum? Exactly the minimum is fine. An unmeasurable margin is not "below". */
export const isBelow = (bp, minBp) => bp != null && bp < minBp;

/** The most the supplier may charge for this sale while keeping `minBp`, in paise (floored). */
export const maxCostPaise = (salePaise, minBp) => Math.floor((Math.max(0, salePaise) * (10000 - minBp)) / 10000);

/** "30%" / "27.5%" from basis points. */
export const pctText = (bp) => (bp == null ? '—' : `${Number((bp / 100).toFixed(2))}%`);

/**
 * What the customer paid for each order line, in paise: price × quantity, less the
 * line's share of the coupon / karma discount. Delivery fees are not in it.
 * @returns {Map<string, number>} itemId → paise
 */
export function lineSales(order) {
  const out = new Map();
  for (const item of order?.items || []) {
    const { netRupees } = refundableForLines(order, [{
      itemId: item._id, product: item.product, variantId: item.variantId, quantity: item.quantity, unitPrice: item.price,
    }]);
    out.set(idOf(item._id), toPaise(netRupees));
  }
  return out;
}

/**
 * A supplier request's bill in rupee paise — the money moved plus any supplier credit
 * used — or null when the rupees are not known yet (a foreign bill not yet paid).
 */
export function billPaiseOf(r) {
  const currency = r?.currency || BASE_CURRENCY;
  if (currency === BASE_CURRENCY) return toPaise(r.amount) + toPaise(r.credit?.amount || 0);
  // A foreign bill: its rupees exist once the bank debited them (the credit, in the
  // foreign currency, cannot be added in rupees — left out, so the cost reads low).
  return Number(r.amount) > 0 ? toPaise(r.amount) : null;
}

/** Split `total` across keys in proportion to `weights` (paise, integers, sums exactly). */
function allocate(total, keys, weights) {
  const out = new Map();
  if (!keys.length) return out;
  const sum = keys.reduce((s, k) => s + Math.max(0, weights.get(k) || 0), 0);
  let given = 0;
  keys.forEach((k, i) => {
    const share = i === keys.length - 1
      ? total - given
      : sum > 0 ? Math.floor((total * Math.max(0, weights.get(k) || 0)) / sum) : Math.floor(total / keys.length);
    given += share;
    out.set(k, share);
  });
  return out;
}

/**
 * Which supplier requests count as the cost of an order's items:
 *   • live (submitted / approved / on hold / paid) — declined and cancelled ones don't;
 *   • not for a part whose supplier was REPLACED — that money comes back as credit,
 *     and the new supplier's payment is the cost now;
 *   • a deal (a made-to-order item paid in parts) counts its AGREED total once, not
 *     each part — so the advance alone can't make the margin look good.
 */
export function costRequests(order, requests) {
  return (requests || []).filter((r) => r.kind === 'supplier'
    && COST_STATUSES.includes(r.status)
    && !(order && requestPartReplaced(order, r)));
}

/**
 * Per-line cost and margin for an order.
 *
 * @param {object} order        an Order (items, discount, karmaDiscount, workflow for parts)
 * @param {Array}  requests     the order's supplier requests (any status; filtered here)
 * @param {Map}    dealsById    dealId → { agreedPaise, currency, itemIds }
 * @returns {Map<string, {salePaise, costPaise, unknown, refs:string[], suppliers:string[]}>}
 *          only lines that carry at least one cost
 */
export function lineCosts(order, requests, dealsById = new Map()) {
  const sales = lineSales(order);
  const lines = new Map();
  const touch = (itemId) => {
    if (!lines.has(itemId)) lines.set(itemId, { salePaise: sales.get(itemId) || 0, costPaise: 0, unknown: false, refs: [], suppliers: [] });
    return lines.get(itemId);
  };
  const dealsDone = new Set();
  for (const r of costRequests(order, requests)) {
    const dealId = r.deal ? idOf(r.deal) : '';
    const deal = dealId ? dealsById.get(dealId) : null;
    const itemIds = (deal?.itemIds?.length ? deal.itemIds : r.itemIds || []).map(idOf).filter((id) => sales.has(id));
    if (!itemIds.length) continue;
    let bill;
    if (deal) {
      for (const id of itemIds) {
        const line = touch(id);
        if (r.number && !line.refs.includes(r.number)) line.refs.push(r.number);
      }
      if (dealsDone.has(dealId)) continue;
      dealsDone.add(dealId);
      bill = (deal.currency || BASE_CURRENCY) === BASE_CURRENCY ? deal.agreedPaise : null;
    } else {
      bill = billPaiseOf(r);
    }
    const shares = bill == null ? null : allocate(bill, itemIds, sales);
    for (const id of itemIds) {
      const line = touch(id);
      if (shares) line.costPaise += shares.get(id);
      else line.unknown = true;
      if (r.number && !line.refs.includes(r.number)) line.refs.push(r.number);
      const name = r.payee?.name || '';
      if (name && !line.suppliers.includes(name)) line.suppliers.push(name);
    }
  }
  return lines;
}

/** Sale, cost and margin over a group of lines (a request's items). */
export function groupMargin(lines, itemIds, minBp) {
  let salePaise = 0;
  let costPaise = 0;
  let unknown = false;
  for (const id of itemIds.map(idOf)) {
    const l = lines.get(id);
    if (!l) continue;
    salePaise += l.salePaise;
    costPaise += l.costPaise;
    unknown = unknown || l.unknown;
  }
  const bp = unknown ? null : marginBp(salePaise, costPaise);
  return { salePaise, costPaise, bp, minBp, unknown, below: !unknown && isBelow(bp, minBp) };
}

/** A margin reason as typed, trimmed and length-checked; '' when none was given. */
export function cleanMarginReason(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MARGIN_REASON_MAX);
}
