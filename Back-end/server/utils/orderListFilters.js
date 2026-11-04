import { STAGE } from './teamWorkflow.js';
import { amountRange, istRange } from './listQuery.js';

/**
 * Search / filter / sort for the team panel's order lists — one reading of the
 * query string for every list, so "search" means the same thing everywhere.
 *
 *   q      — words to find in the order number, customer name / phone / email,
 *            city, seller and product names (case-insensitive)
 *   step   — a workflow stage key (stock_check, to_ship, …): work lists only
 *            (`stage` already means processing / delivered on the paid lists)
 *   source — 'website' | 'sales'
 *   sort   — 'newest' (default) | 'oldest' | 'amount_desc' | 'amount_asc' (the
 *            amount sorts are for the lists read straight from the orders
 *            collection; a work list reads them as newest)
 *   from / to — the order's list date: when it was paid, or placed while unpaid
 *            (YYYY-MM-DD, India time, both days included; utils/orderListDate.js)
 *   min / max — the order total, rupees, inclusive
 *   eta    — 'due_today' | 'overdue' | 'none': a parcel in transit whose expected
 *            delivery date is today / has passed / was never set (work lists only)
 */
export const LIST_SORTS = Object.freeze(['newest', 'oldest', 'amount_desc', 'amount_asc']);
export const LIST_SOURCES = Object.freeze(['website', 'sales']);
export const LIST_ETA = Object.freeze(['due_today', 'overdue', 'none']);
const ETA_COUNT = { due_today: 'dueToday', overdue: 'overdue', none: 'missing' };
const STAGES = new Set(Object.values(STAGE));

export function readListFilters({ q, step, source, sort, eta, from, to, min, max } = {}) {
  const words = String(q ?? '').trim().toLowerCase().replace(/^#/, '').slice(0, 60);
  return {
    q: words || null,
    stage: STAGES.has(step) ? step : null,
    source: LIST_SOURCES.includes(source) ? source : null,
    sort: LIST_SORTS.includes(sort) ? sort : 'newest',
    eta: LIST_ETA.includes(eta) ? eta : null,
    placed: istRange(from, to),
    amount: amountRange(min, max),
  };
}

/** Is `n` inside a { $gte, $lt / $lte } range (Dates or numbers)? */
function inRange(n, r) {
  if (!Number.isFinite(n)) return false;
  const v = (x) => (x instanceof Date ? x.getTime() : x);
  return (r.$gte === undefined || n >= v(r.$gte))
    && (r.$lt === undefined || n < v(r.$lt))
    && (r.$lte === undefined || n <= v(r.$lte));
}

/** Does a work-list row (teamWorkflowService.row) pass the filters? */
export function rowMatches(row, f) {
  if (f.source && row.source !== f.source) return false;
  if (f.eta && !(row.eta?.[ETA_COUNT[f.eta]] > 0)) return false;
  if (f.placed && !inRange(new Date(row.listDate || row.createdAt).getTime(), f.placed)) return false;
  if (f.amount && !inRange(Number(row.totalAmount), f.amount)) return false;
  if (f.stage && row.summaryStage !== f.stage && !(row.lines || []).some((l) => l.stage === f.stage)) return false;
  if (f.q) {
    const hay = [
      row.orderNumber, row.customer?.name, row.customer?.phone, row.customer?.email, row.city, row.soldBy,
      ...(row.lines || []).map((l) => `${l.name} ${l.variantLabel || ''}`),
    ].join(' ').toLowerCase();
    // Every word must appear somewhere ("hilux kochi" narrows; it does not widen).
    if (!f.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The same filters as a Mongo query, for lists read straight from the orders
 * collection (Order processing / Delivered). Added on top of the list's own,
 * index-served conditions, so they narrow an already-bounded set.
 */
export function orderQueryFor(f) {
  const and = [];
  if (f.source === 'sales') and.push({ salesUser: { $type: 'objectId' } });
  if (f.source === 'website') and.push({ salesUser: null });
  if (f.placed) and.push({ listDate: f.placed });
  if (f.amount) and.push({ totalAmount: f.amount });
  if (f.q) {
    for (const w of f.q.split(/\s+/).slice(0, 5)) {
      const re = new RegExp(escapeRegex(w), 'i');
      and.push({
        $or: [
          { 'shippingAddress.fullName': re },
          { 'shippingAddress.phone': re },
          { 'shippingAddress.city': re },
          { guestEmail: re },
          { 'items.name': re },
          // The order number shown everywhere is the last 8 characters of the id.
          ...(/^[0-9a-f]{3,24}$/.test(w) ? [{ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: escapeRegex(w), options: 'i' } } }] : []),
        ],
      });
    }
  }
  return and.length ? { $and: and } : {};
}
