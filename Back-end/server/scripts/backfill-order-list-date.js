/**
 * Backfill `Order.paidAt` / `Order.listDate` and build the indexes the staff
 * order lists now sort on (utils/orderListDate.js).
 *
 * Why: the owner's rule is that the PAID date is the main date of a sale. Every
 * staff order list (GTM, Accounts, Procurement, Marketing, Admin) now sorts on
 * `listDate` — the paid date, or the created date while unpaid. New saves keep it
 * right (Order pre-save hook); orders saved before that have neither field and
 * would sort to the bottom of every list until this runs.
 *
 * Paid date of an existing paid / refunded order, first that applies:
 *   1. bank transfer: the day accounts says the money arrived (offlinePayment.paidOn),
 *      at the confirmation moment if the same day, else 11:59:59 pm that India day
 *   2. payment parts: when the last part was paid
 *   3. workflow.enteredAt: when the order was confirmed paid and entered the team workflow
 *   4. the first `processing` entry in statusHistory (not WooCommerce imports, whose
 *      history was written at import time)
 *   5. createdAt (website checkout: paid within minutes of creation)
 *
 * Safe to run more than once, and safe while the site is live: it only touches
 * orders missing a field, and each write is conditional on the order still missing
 * it, so a payment saved meanwhile (which sets its own paidAt) is never overwritten.
 * Run it BEFORE the deploy (so the lists are right the moment it lands) and AGAIN
 * after (for orders the old code saved in between).
 *
 * Indexes: prod runs autoIndex off, so the schema's new indexes are built here.
 *
 * Usage:
 *   node --import=dotenv/config scripts/backfill-order-list-date.js           # dry run: counts + sample, no writes
 *   node --import=dotenv/config scripts/backfill-order-list-date.js --apply   # write fields, then build indexes
 *
 * Rollback (the old code ignores both fields, so this is only needed to undo fully):
 *   db.orders.updateMany({}, { $unset: { paidAt: '', listDate: '' } })
 *   db.orders.dropIndex('<name>') for each index named in INDEXES below
 */

import mongoose from 'mongoose';
import Order from '../models/Order.js';
import { endOfIstDay, PAID_STATES } from '../utils/orderListDate.js';

const APPLY = process.argv.includes('--apply');
const BATCH = 500;

export const INDEXES = [
  [{ salesUser: 1, listDate: -1, _id: -1 }, { partialFilterExpression: { salesUser: { $type: 'objectId' } }, name: 'staff_sales_by_list_date' }],
  [{ paymentStatus: 1, listDate: -1, _id: -1 }, { partialFilterExpression: { salesUser: { $type: 'objectId' } }, name: 'staff_sales_by_payment_list_date' }],
  [{ paymentStatus: 1, listDate: -1, _id: -1 }, { partialFilterExpression: { 'workflow.enteredAt': { $type: 'date' } }, name: 'team_workflow_paid_list_date' }],
  [{ 'workflow.open': 1, listDate: 1, _id: 1 }, { partialFilterExpression: { 'workflow.open': true }, name: 'team_workflow_open_list_date' }],
  [{ listDate: -1, _id: -1 }, { name: 'order_list_date' }],
];

const SELECT = 'createdAt paymentStatus source offlinePayment paymentParts workflow.enteredAt statusHistory.status statusHistory.timestamp';

/** When an existing paid order's money arrived — see the list in the header. */
export function derivePaidAt(o) {
  const paidOn = o.offlinePayment?.paidOn;
  if (paidOn) {
    const end = endOfIstDay(paidOn);
    const confirmed = o.offlinePayment.confirmedAt ? new Date(o.offlinePayment.confirmedAt) : null;
    if (end) return confirmed && confirmed < end ? confirmed : end;
  }
  const parts = (o.paymentParts || []).filter((p) => p.status === 'paid' && p.paidAt).map((p) => new Date(p.paidAt).getTime());
  if (parts.length) return new Date(Math.max(...parts));
  if (o.workflow?.enteredAt) return new Date(o.workflow.enteredAt);
  if (o.source !== 'woocommerce') {
    const hit = (o.statusHistory || []).find((h) => h.status === 'processing' && h.timestamp);
    if (hit) return new Date(hit.timestamp);
  }
  return new Date(o.createdAt);
}

/** The update one order needs, or null. Conditional on the fields still being missing. */
export function planFor(o) {
  const paid = PAID_STATES.includes(o.paymentStatus);
  if (paid && !o.paidAt) {
    const paidAt = derivePaidAt(o);
    return { filter: { _id: o._id, paidAt: { $exists: false } }, set: { paidAt, listDate: paidAt } };
  }
  if (!o.listDate) {
    const listDate = o.paidAt || o.createdAt;
    return { filter: { _id: o._id, listDate: { $exists: false } }, set: { listDate } };
  }
  return null;
}

async function backfill() {
  const coll = Order.collection;
  const missing = {
    $or: [
      { listDate: { $exists: false } },
      { paymentStatus: { $in: PAID_STATES }, paidAt: { $exists: false } },
    ],
  };
  let afterId = null;
  let scanned = 0;
  let paidStamped = 0;
  let unpaidStamped = 0;
  let written = 0;
  const sample = [];

  // Keyset on immutable _id; each batch re-reads only orders still missing a field.
  for (;;) {
    const rows = await Order.find(afterId ? { $and: [missing, { _id: { $gt: afterId } }] } : missing)
      .select(`${SELECT} paidAt listDate`).sort({ _id: 1 }).limit(BATCH).lean();
    if (!rows.length) break;
    afterId = rows[rows.length - 1]._id;
    const ops = [];
    for (const o of rows) {
      scanned += 1;
      const plan = planFor(o);
      if (!plan) continue;
      if (plan.set.paidAt) paidStamped += 1; else unpaidStamped += 1;
      if (sample.length < 10) sample.push({ id: String(o._id), createdAt: o.createdAt, ...plan.set });
      ops.push({ updateOne: { filter: plan.filter, update: { $set: plan.set } } });
    }
    if (APPLY && ops.length) {
      const res = await coll.bulkWrite(ops, { ordered: false });
      written += res.modifiedCount;
    }
  }

  console.log(`[list-date] scanned ${scanned}; paid orders to date: ${paidStamped}; unpaid orders to date: ${unpaidStamped}`);
  console.log('[list-date] sample:', JSON.stringify(sample, null, 2));
  if (APPLY) console.log(`[list-date] written: ${written}`);
}

async function buildIndexes() {
  const existing = new Set((await Order.collection.indexes()).map((i) => i.name));
  for (const [keys, options] of INDEXES) {
    if (existing.has(options.name)) {
      console.log(`[list-date] index ${options.name}: already there`);
    } else if (APPLY) {
      await Order.collection.createIndex(keys, options);
      console.log(`[list-date] index ${options.name}: built`);
    } else {
      console.log(`[list-date] index ${options.name}: would build`);
    }
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`[list-date] ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to write)'}`);
  await backfill();
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('[list-date] failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
