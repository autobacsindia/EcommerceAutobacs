/**
 * The date an order is listed under on every staff order list.
 *
 * The owner's rule: the PAID date is the main date of a sale, not when the order
 * was created. An offline order created on 28 Oct and paid on 3 Nov belongs with
 * the 3 Nov sales. So:
 *
 *   paidAt   — when the money arrived. Bank transfer: the day accounts says it
 *              reached the bank (`offlinePayment.paidOn`), at the moment it was
 *              confirmed when that is the same day, else the last moment of that
 *              India-time day. Anything else (Razorpay checkout, payment link,
 *              the last of the payment parts): the moment the order became paid.
 *              Set once and never moved — a refund does not change when a sale
 *              was paid.
 *   listDate — paidAt, or createdAt while the order is unpaid. Stored (not
 *              computed in a query) so the lists can keyset-page on an index.
 *
 * Both are only READ for sorting. Nothing here changes money or payment status.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Payment states that mean the money arrived (a refund keeps its paid date). */
export const PAID_STATES = Object.freeze(['paid', 'refunded']);

/** The last millisecond of the India-time day `paidOn` names (stored as that day's UTC midnight). */
export function endOfIstDay(paidOn) {
  const d = new Date(paidOn);
  if (Number.isNaN(d.getTime())) return null;
  const dayStartUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(dayStartUtc - IST_OFFSET_MS + DAY_MS - 1);
}

/**
 * When the money for `order` arrived, `now` being the moment it is recorded as paid.
 * A bank transfer is never dated later than `now` (a typo'd future day cannot
 * float an order above everything).
 */
export function paidAtFor(order, now = new Date()) {
  const paidOn = order?.offlinePayment?.paidOn;
  if (paidOn) {
    const end = endOfIstDay(paidOn);
    if (end) return end < now ? end : now;
  }
  return now;
}

/**
 * Keeps paidAt / listDate right on a document about to be saved. Called from the
 * Order pre-save hook, so every path that marks an order paid through a save
 * (webhook, payment link, payment parts, bank transfer, admin) is covered.
 * A NEW order that is already paid (an import) is dated by its own createdAt.
 */
export function stampListDate(doc, now = new Date()) {
  if (!doc.createdAt) doc.createdAt = now;
  if (PAID_STATES.includes(doc.paymentStatus) && !doc.paidAt) {
    doc.paidAt = doc.isNew ? paidAtFor(doc, doc.createdAt) : paidAtFor(doc, now);
  }
  const want = doc.paidAt || doc.createdAt;
  if (!doc.listDate || doc.listDate.getTime() !== want.getTime()) doc.listDate = want;
}

/**
 * The date to list `row` under, for a row read from the database rather than one
 * about to be saved. `listDate` when it is stored, else the same rule applied on
 * the fly — paidAt, then createdAt. Returns null when the row carries no usable
 * date at all.
 *
 * Orders written before listDate existed have none until
 * `scripts/backfill-order-list-date.js` has run, and a list that sorts or pages on
 * the raw field crashes on them (`new Date(undefined).toISOString()` throws
 * RangeError). Every list read goes through here so a missing listDate degrades to
 * the created date instead of taking the list down.
 */
export function listDateOf(row) {
  for (const v of [row?.listDate, row?.paidAt, row?.createdAt]) {
    if (v == null) continue;
    const d = v instanceof Date ? v : new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
