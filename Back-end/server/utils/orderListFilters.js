import { STAGE } from './teamWorkflow.js';
import { amountRange, istRange } from './listQuery.js';
import { listDateOf } from './orderListDate.js';

/**
 * Search / filter / sort for the team panel's order lists — one reading of the
 * query string for every list, so "search" means the same thing everywhere.
 *
 *   q      — words to find in the order number, customer name / phone / email,
 *            city, seller and product names (case-insensitive). Every
 *            word must match somewhere; a leading # (the order number as shown)
 *            is ignored.
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
  if (f.placed && !inRange(listDateOf(row)?.getTime() ?? NaN, f.placed)) return false;
  if (f.amount && !inRange(Number(row.totalAmount), f.amount)) return false;
  if (f.stage && row.summaryStage !== f.stage && !(row.lines || []).some((l) => l.stage === f.stage)) return false;
  if (f.q) {
    const hay = [
      // The id too: an order number copied in full (24 characters) must find its order.
      row.id, row.orderNumber, row.customer?.name, row.customer?.phone, row.customer?.email, row.city, row.soldBy,
      ...(row.lines || []).map((l) => `${l.name} ${l.variantLabel || ''}`),
    ].join(' ').toLowerCase();
    // Every word must appear somewhere ("hilux kochi" narrows; it does not widen).
    if (!f.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Search words, as orderQueryFor reads them (at most five). */
const searchWords = (f) => (f.q ? f.q.split(/\s+/).slice(0, 5) : []);

// The registered customer's own account (email / name / phone on the user) is looked
// up per word, bounded: only the first three words of three characters or more, and
// at most 200 accounts each — enough to find a customer, never an unbounded $in.
const USER_LANE_WORDS = 3;
const USER_LANE_MIN_LENGTH = 3;
export const USER_LANE_MAX_IDS = 200;

/**
 * Adds `userIds` (word → matching account ids) to the filters, so orderQueryFor can
 * also match an order by its customer's account. An order only carries the account
 * by id, and the account email is not copied onto the order (only a guest's is), so
 * without this a search for a registered customer's email finds nothing.
 *
 * `findIds(word, { limit })` is userRepository.findIdsByNameOrEmail (regex-escaped).
 */
export async function withCustomerIds(f, findIds) {
  const words = searchWords(f).filter((w) => w.length >= USER_LANE_MIN_LENGTH).slice(0, USER_LANE_WORDS);
  if (!words.length) return f;
  const found = await Promise.all(words.map((w) => findIds(w, { limit: USER_LANE_MAX_IDS })));
  const userIds = {};
  words.forEach((w, i) => { if (found[i]?.length) userIds[w] = found[i]; });
  return { ...f, userIds };
}

/**
 * The same filters as a Mongo query, for lists read straight from the orders
 * collection (Order processing / Delivered). Added on top of the list's own,
 * index-served conditions, so they narrow an already-bounded set.
 */
export function orderQueryFor(f) {
  const and = [];
  if (f.source === 'sales') and.push({ salesUser: { $type: 'objectId' } });
  if (f.source === 'website') and.push({ salesUser: null });
  // A date filter compares the stored listDate only. Widening it to also match
  // paidAt/createdAt for orders written before listDate existed would mean an $or,
  // which costs an in-memory sort of every matching row (see utils/listQuery.js
  // afterClause) — so an order that has not been backfilled yet is simply absent
  // from a date-filtered list until scripts/backfill-order-list-date.js has run.
  // The in-memory rowMatches above has no such cost and does fall back.
  if (f.placed) and.push({ listDate: f.placed });
  if (f.amount) and.push({ totalAmount: f.amount });
  if (f.q) {
    for (const w of searchWords(f)) {
      const re = new RegExp(escapeRegex(w), 'i');
      const accounts = f.userIds?.[w];
      and.push({
        $or: [
          { 'shippingAddress.fullName': re },
          { 'shippingAddress.phone': re },
          { 'shippingAddress.city': re },
          { guestEmail: re },
          { 'items.name': re },
          ...(accounts?.length ? [{ user: { $in: accounts } }] : []),
          // The order number shown everywhere is the last 8 characters of the id.
          ...(/^[0-9a-f]{3,24}$/.test(w) ? [{ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: escapeRegex(w), options: 'i' } } }] : []),
        ],
      });
    }
  }
  return and.length ? { $and: and } : {};
}
