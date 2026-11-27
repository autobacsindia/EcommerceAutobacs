/**
 * "Paid, no sale bill yet" — money received for a sale that has no Zoho invoice.
 * Counted in company revenue, shown apart (rules: config/companyRevenue.js).
 *
 *   importZohoPayments  Zoho "Payments Received" export → one row per payment with
 *                       an Unused Amount. Same file twice = same rows. A payment Zoho
 *                       has since applied to an invoice drops to 0 (the invoice
 *                       counts instead) — so a sale never counts twice.
 *   addManualReceipt    money Zoho never recorded, added by an admin with proof.
 *   decideUnbilled      admin: count it / same as a panel order / billed / remove.
 *   rematchUnbilled     count-once check against panel orders (Razorpay id, then
 *                       name + amount + date). Admin decisions are never overwritten.
 */
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import UnbilledReceipt from '../models/UnbilledReceipt.js';
import AppError from '../utils/AppError.js';
import { QUERY_TIMEOUTS } from '../config/db.js';
import { MATCH_TOLERANCE, MATCH_ORDER_SCAN_CAP, UNBILLED_MAX_AMOUNT, UNBILLED_STATES } from '../config/companyRevenue.js';
import { countedOrderFilter } from './revenueOrderFilter.js';
import { parseZohoPaymentCsv, razorpayIdsIn, matchInvoicesToOrders, nameKey, parseInvoiceDate } from './zohoInvoiceInput.js';

const DAY_MS = 864e5;
const TZ = '+05:30';
const round2 = (n) => Math.round((n || 0) * 100) / 100;
const INVOICE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9/_.-]{1,59}$/;
const LIST_FIELDS = '-history -customerKey';

/** Rows that count as revenue in a window. */
export const unbilledCountedMatch = (from) => ({
  state: 'open',
  amount: { $gt: 0 },
  ...(from ? { receivedAt: { $gte: from } } : {}),
});

/**
 * Totals for the revenue summary: counted rows by source (and month), plus the
 * held-back ones an admin still has to look at.
 */
export async function unbilledRevenue(from, { months }) {
  const window = from ? { receivedAt: { $gte: from } } : {};
  const _id = months
    ? { source: '$source', month: { $dateToString: { date: '$receivedAt', format: '%Y-%m', timezone: TZ } } }
    : { source: '$source' };
  const [counted, waiting] = await Promise.all([
    UnbilledReceipt.aggregate([
      { $match: unbilledCountedMatch(from) },
      { $group: { _id, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation }),
    UnbilledReceipt.aggregate([
      { $match: { ...window, state: 'needs_check', amount: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation }),
  ]);
  const bySource = { zoho_payment: 0, manual: 0 };
  let total = 0;
  let count = 0;
  for (const r of counted) {
    bySource[r._id.source] = (bySource[r._id.source] || 0) + r.total;
    total += r.total;
    count += r.count;
  }
  return {
    rows: counted,
    summary: {
      total: round2(total),
      count,
      zoho: round2(bySource.zoho_payment),
      manual: round2(bySource.manual),
      needsCheck: { count: waiting[0]?.count || 0, total: round2(waiting[0]?.total) },
    },
  };
}

/**
 * Count-once check: is an unbilled Zoho payment really a website / sales-panel
 * order the panel already counts? Only auto-decided Zoho rows with money left
 * are looked at; manual rows are an admin's own statement.
 */
export async function rematchUnbilled() {
  const rows = await UnbilledReceipt.find({
    source: 'zoho_payment', stateBy: 'auto', amount: { $gt: 0 }, state: { $in: ['open', 'in_panel', 'needs_check'] },
  })
    .select('receivedAt amount customerKey reference state order')
    .limit(MATCH_ORDER_SCAN_CAP)
    .lean()
    .maxTimeMS(QUERY_TIMEOUTS.import);
  if (!rows.length) return { changed: 0 };

  // 1. A Razorpay payment id in the Zoho reference names the website order exactly.
  const payIds = [...new Set(rows.flatMap((r) => razorpayIdsIn(r.reference)))];
  const payOrder = new Map();
  if (payIds.length) {
    const pays = await Payment.find({ gatewayPaymentId: { $in: payIds } })
      .select('gatewayPaymentId order').lean().maxTimeMS(QUERY_TIMEOUTS.import);
    const counted = new Set(
      (await Order.find({ _id: { $in: pays.map((p) => p.order) }, ...countedOrderFilter(null) }).select('_id').lean()
        .maxTimeMS(QUERY_TIMEOUTS.import)).map((o) => String(o._id))
    );
    for (const p of pays) if (counted.has(String(p.order))) payOrder.set(p.gatewayPaymentId, p.order);
  }

  // 2. Otherwise the same matcher as Zoho invoices: name + amount + date.
  const dates = rows.map((r) => r.receivedAt.getTime());
  const pad = MATCH_TOLERANCE.possibleDays * DAY_MS;
  const from = new Date(Math.min(...dates) - pad);
  const to = new Date(Math.max(...dates) + pad);
  const orders = await Order.find({ ...countedOrderFilter(from), createdAt: { $gte: from, $lte: to } })
    .select('totalAmount createdAt shippingAddress.fullName')
    .limit(MATCH_ORDER_SCAN_CAP)
    .lean()
    .maxTimeMS(QUERY_TIMEOUTS.import);
  const fuzzy = matchInvoicesToOrders(
    rows.map((r) => ({ key: String(r._id), invoiceDate: r.receivedAt, total: r.amount, customerKey: r.customerKey, reference: '' })),
    orders.map((o) => ({ id: o._id, createdAt: o.createdAt, totalAmount: o.totalAmount, nameKey: nameKey(o.shippingAddress?.fullName) }))
  );

  const now = new Date();
  const ops = [];
  for (const r of rows) {
    const viaPay = razorpayIdsIn(r.reference).map((id) => payOrder.get(id)).find(Boolean);
    let d;
    if (viaPay) d = { state: 'in_panel', order: viaPay, reason: 'Razorpay payment of a website order' };
    else {
      const m = fuzzy.get(String(r._id));
      d = m.state === 'linked' ? { state: 'in_panel', order: m.orderId, reason: m.reason }
        : m.state === 'needs_check' ? { state: 'needs_check', order: m.orderId, reason: m.reason }
          : { state: 'open', order: null, reason: 'No panel order like it' };
    }
    if (r.state === d.state && String(r.order || '') === String(d.order || '')) continue;
    ops.push({
      updateOne: {
        // Never overwrite an admin decision made while this ran.
        filter: { _id: r._id, stateBy: 'auto' },
        update: {
          $set: { state: d.state, order: d.order || null, reason: d.reason.slice(0, 200) },
          $push: { history: { $each: [{ at: now, action: 'matched', note: `${d.state}: ${d.reason}`.slice(0, 300) }], $slice: -50 } },
        },
      },
    });
  }
  if (ops.length) await UnbilledReceipt.bulkWrite(ops, { ordered: false });
  return { changed: ops.length };
}

/** Import Zoho's Payments Received export (rows already read by readZohoCsv). */
export async function importZohoPayments(rows, user) {
  const { payments, skipped, errors } = parseZohoPaymentCsv(null, rows);
  const now = new Date();
  const withMoney = payments.filter((p) => p.amount > 0);
  const applied = payments.filter((p) => p.amount <= 0).map((p) => p.zohoPaymentId);
  let inserted = 0;
  let updated = 0;
  if (withMoney.length) {
    const res = await UnbilledReceipt.bulkWrite(
      withMoney.map((p) => ({
        updateOne: {
          filter: { zohoPaymentId: p.zohoPaymentId },
          update: {
            $set: { ...p, importedAt: now },
            $setOnInsert: { source: 'zoho_payment', state: 'open', stateBy: 'auto', reason: 'Not matched yet' },
            $push: { history: { $each: [{ at: now, by: user?._id, byName: user?.name, action: 'imported' }], $slice: -50 } },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    inserted = res.upsertedCount;
    updated = res.matchedCount;
  }
  // Zoho has since put these payments on an invoice: the invoice counts now, not this.
  let billed = 0;
  if (applied.length) {
    const res = await UnbilledReceipt.updateMany(
      { zohoPaymentId: { $in: applied }, amount: { $gt: 0 } },
      {
        $set: { amount: 0, state: 'billed', stateBy: 'auto', reason: 'Zoho applied it to an invoice', importedAt: now },
        $push: { history: { $each: [{ at: now, by: user?._id, byName: user?.name, action: 'billed', note: 'Applied to an invoice in Zoho' }], $slice: -50 } },
      }
    );
    billed = res.modifiedCount;
  }
  // A payment Zoho un-applied (invoice deleted) has money unused again → back to the matcher.
  await UnbilledReceipt.updateMany(
    { source: 'zoho_payment', state: 'billed', stateBy: 'auto', amount: { $gt: 0 } },
    { $set: { state: 'open', reason: 'Unused again in Zoho' } }
  );
  const match = await rematchUnbilled();
  return { kind: 'payments', inserted, updated, billed, skipped, errors, rematched: match.changed, creditsUnmatched: 0 };
}

const clean = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

/** An admin records money Zoho never got (e.g. a project paid in full, seen only in ClickUp). */
export async function addManualReceipt(input, user) {
  const customerName = clean(input.customerName, 200);
  const amount = round2(Number(input.amount));
  const receivedAt = parseInvoiceDate(input.receivedAt);
  if (!customerName) throw new AppError('Enter the customer name.', 400, { expose: true });
  if (!Number.isFinite(amount) || amount <= 0 || amount > UNBILLED_MAX_AMOUNT) {
    throw new AppError('Enter the amount received, in rupees.', 400, { expose: true });
  }
  if (!receivedAt) throw new AppError('Enter the date the money came in.', 400, { expose: true });
  if (receivedAt.getTime() > Date.now() + DAY_MS) throw new AppError('The date cannot be in the future.', 400, { expose: true });
  const proof = clean(input.proof, 500);
  if (!proof) throw new AppError('Add proof — a ClickUp link, quote number or bank reference.', 400, { expose: true });

  const now = new Date();
  const doc = await UnbilledReceipt.create({
    source: 'manual',
    receivedAt,
    customerName,
    customerKey: nameKey(customerName).slice(0, 200),
    mode: clean(input.mode, 60),
    amount,
    proof,
    note: clean(input.note, 500),
    state: 'open',
    stateBy: 'admin',
    reason: 'Added by an admin',
    addedBy: user?._id || null,
    addedByName: user?.name || null,
    history: [{ at: now, by: user?._id, byName: user?.name, action: 'added' }],
  });
  const out = doc.toObject();
  delete out.history;
  return out;
}

const DECISIONS = {
  count: { state: 'open', action: 'decided', note: 'Admin: a separate sale — counted' },
  same_as_panel: { state: 'in_panel', action: 'decided', note: 'Admin: same money as a panel order — not counted again' },
  billed: { state: 'billed', action: 'billed', note: 'Admin: now billed in Zoho' },
  remove: { state: 'removed', action: 'removed', note: 'Admin: removed' },
};

/**
 * An admin settles one row. Every decision is kept in `history` and survives
 * re-imports (stateBy 'admin').
 */
export async function decideUnbilled(id, { decision, invoiceNumber, note }, user) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Entry not found.', 404, { expose: true });
  const d = DECISIONS[decision];
  if (!d) throw new AppError('Unknown decision.', 400, { expose: true });
  const row = await UnbilledReceipt.findById(id).select('source state order').lean();
  if (!row) throw new AppError('Entry not found.', 404, { expose: true });

  const set = { state: d.state, stateBy: 'admin', reason: d.note };
  if (decision === 'billed') {
    const num = clean(invoiceNumber, 60);
    if (!INVOICE_NUMBER.test(num)) throw new AppError('Enter the Zoho invoice number, e.g. AUTO/26-27/0300.', 400, { expose: true });
    set.billedAs = num;
  }
  if (decision === 'same_as_panel' && !row.order) {
    throw new AppError('There is no panel order to compare with. Use “Remove” if it should not count.', 400, { expose: true });
  }
  if (decision === 'remove' && !clean(note, 300)) throw new AppError('Say why it is removed.', 400, { expose: true });

  const now = new Date();
  const histNote = [d.note, set.billedAs ? `as ${set.billedAs}` : '', clean(note, 200)].filter(Boolean).join(' — ').slice(0, 300);
  return UnbilledReceipt.findByIdAndUpdate(
    id,
    { $set: set, $push: { history: { $each: [{ at: now, by: user?._id, byName: user?.name, action: d.action, note: histNote }], $slice: -50 } } },
    { new: true }
  ).select(LIST_FIELDS).lean();
}

/** Rows in one state, newest first (keyset cursor on receivedAt + _id, bounded page). */
export async function listUnbilled({ state = 'open', from = null, cursor, limit = 50 } = {}) {
  if (!UNBILLED_STATES.includes(state)) throw new AppError('Unknown state.', 400, { expose: true });
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const q = { state, ...(state === 'billed' ? {} : { amount: { $gt: 0 } }), ...(from ? { receivedAt: { $gte: from } } : {}) };
  if (cursor) {
    const [d, id] = String(cursor).split('_');
    const at = new Date(Number(d));
    if (!Number.isFinite(at.getTime()) || !mongoose.isValidObjectId(id)) throw new AppError('Bad cursor.', 400, { expose: true });
    const keyset = [{ receivedAt: { $lt: at } }, { receivedAt: at, _id: { $lt: new mongoose.Types.ObjectId(id) } }];
    if (q.receivedAt) q.$and = [{ receivedAt: q.receivedAt }, { $or: keyset }];
    else q.$or = keyset;
    if (q.$and) delete q.receivedAt;
  }
  const rows = await UnbilledReceipt.find(q)
    .sort({ receivedAt: -1, _id: -1 })
    .limit(size + 1)
    .select(LIST_FIELDS)
    .populate({ path: 'order', select: 'totalAmount createdAt status source shippingAddress.fullName' })
    .lean()
    .maxTimeMS(QUERY_TIMEOUTS.listing);
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  const last = page[page.length - 1];
  return { receipts: page, nextCursor: more && last ? `${last.receivedAt.getTime()}_${last._id}` : null };
}
