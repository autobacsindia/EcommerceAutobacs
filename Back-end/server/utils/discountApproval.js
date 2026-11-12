/**
 * "Above 10%: prior approval mandatory" — the sales incentive policy, for GTM
 * quotations (services/salesQuotationService.js) and the orders made from them.
 *
 * The discount is measured against the WEBSITE price (what the catalogue charges
 * today, festival offer included — pricingService is the one authority), in two ways:
 *
 *   line   = a catalogue line's offer price below its website price
 *            (listPrice − price) ÷ listPrice
 *   total  = everything the customer is let off — line markdowns AND the % discount
 *            on the whole quotation — against the website value of every line
 *            (Σ (listPrice ?? price) × qty − totalAmount) ÷ Σ (listPrice ?? price) × qty
 *
 * A custom line has no website price: its agreed price IS the reference, so only the
 * % discount on the whole quotation can make it count.
 *
 * Approval is needed when EITHER is strictly above the threshold (10% exactly is fine).
 * The comparison is integer paise maths — no float rounding can tip 10% over.
 *
 * An approval holds only for the prices it was given on: `priceKey` fingerprints
 * every line's product, variant, quantity and price, the discount percent and the
 * total. Any of those changing → a different key → a fresh approval is needed.
 * Address, notes and customer details are not money and do not change the key.
 *
 * Pure: no database, no clock.
 */
import crypto from 'crypto';
import { toPaise } from './money.js';

/** Policy threshold, percent. Strictly above it needs approval. */
export const APPROVAL_THRESHOLD_PERCENT = 10;

export const APPROVAL_STATUSES = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });

export const APPROVAL_REASON_MIN = 3;
export const APPROVAL_REASON_MAX = 300;
export const APPROVAL_NOTE_MAX = 300;

const idOf = (v) => (v == null ? '' : String(v._id ?? v));

/** Percent with two decimals, for display and the record. (off ÷ base, in paise.) */
const percentOf = (offPaise, basePaise) => (basePaise > 0 ? Math.round((offPaise * 10000) / basePaise) / 100 : 0);
/** off ÷ base > threshold%, exactly. */
const overThreshold = (offPaise, basePaise) => basePaise > 0 && offPaise * 100 > basePaise * APPROVAL_THRESHOLD_PERCENT;

/**
 * How deep a quotation's discount is.
 * @param {{ items: Array<{price:number, listPrice?:number|null, quantity:number}>, totalAmount:number }} q
 * @returns {{ maxLinePercent:number, totalPercent:number, percent:number, needsApproval:boolean }}
 */
export function discountDepth(q) {
  let base = 0;
  let maxLinePercent = 0;
  let lineOver = false;
  for (const l of q?.items || []) {
    const qty = Number(l.quantity) || 0;
    const price = toPaise(l.price);
    const list = l.listPrice != null && toPaise(l.listPrice) > price ? toPaise(l.listPrice) : price;
    base += list * qty;
    if (list > price) {
      maxLinePercent = Math.max(maxLinePercent, percentOf(list - price, list));
      if (overThreshold(list - price, list)) lineOver = true;
    }
  }
  const off = Math.max(0, base - toPaise(q?.totalAmount));
  const totalPercent = percentOf(off, base);
  return {
    maxLinePercent,
    totalPercent,
    percent: Math.max(maxLinePercent, totalPercent),
    needsApproval: lineOver || overThreshold(off, base),
  };
}

/** The fingerprint of everything about money on a quotation. */
export function priceKeyOf(q) {
  const lines = (q?.items || []).map((l) => [
    l.custom ? `c:${String(l.name || '').trim()}` : `p:${idOf(l.product)}`,
    l.variantId ? idOf(l.variantId) : '',
    Number(l.quantity) || 0,
    toPaise(l.price),
    l.listPrice != null ? toPaise(l.listPrice) : '',
  ].join('|'));
  const body = [...lines, `d:${Number(q?.discount?.percent || 0)}`, `t:${toPaise(q?.totalAmount)}`].join('\n');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
}

/**
 * Where a quotation stands on approval, from its current prices and stored record.
 *   not_needed  — 10% or less: works exactly as before
 *   needed      — above 10%, no request for these prices yet (or the old one is
 *                 for prices that have since changed)
 *   pending     — requested for these prices, waiting for the head / an admin
 *   approved    — approved for these exact prices
 *   rejected    — rejected for these prices; edit the prices or ask again
 */
export function approvalState(q) {
  const depth = discountDepth(q);
  if (!depth.needsApproval) return { state: 'not_needed', ...depth, current: null };
  const a = q?.discountApproval;
  if (!a?.status || a.priceKey !== priceKeyOf(q)) return { state: 'needed', ...depth, current: null };
  return { state: a.status, ...depth, current: a };
}

/** Does this quotation still need an approval before it can be shared or accepted? */
export const isBlocked = (q) => !['not_needed', 'approved'].includes(approvalState(q).state);

/** The request reason, checked. */
export function cleanApprovalReason(raw) {
  const reason = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < APPROVAL_REASON_MIN) return { error: 'Write a short reason for the discount (e.g. "fleet customer, 6 cars").' };
  if (reason.length > APPROVAL_REASON_MAX) return { error: `Keep the reason under ${APPROVAL_REASON_MAX} characters.` };
  return { reason };
}

/** The approver's note, trimmed and bounded (optional on approve, required on reject). */
export const cleanApprovalNote = (raw) => String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, APPROVAL_NOTE_MAX);
