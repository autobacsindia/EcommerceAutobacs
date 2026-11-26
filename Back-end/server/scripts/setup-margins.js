/**
 * Minimum margin on supplier buys — the indexes, and the Margins report for orders
 * that already have supplier payments. Production runs with autoIndex off, so a
 * deploy never builds these; this script is the explicit, checkable way.
 *
 *   payments.payment_request_below_margin   { createdAt: -1, _id: -1 }, partial { 'margin.below': true }
 *                                           — the admin's "Below-margin exceptions" list.
 *                                             Starts empty (no payment has `margin` before this ships).
 *   orderlinemargins.*                      the new collection's 3 indexes (unique line, date, margin).
 *
 * Then, with --backfill, every order that has a supplier payment gets its Margins rows
 * (services/supplierMarginService.refreshOrder — idempotent, recomputed from the
 * payments, so running it twice changes nothing). Old payments are NOT changed or
 * flagged: the minimum applies to payments raised from now on.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/setup-margins.js                       # dry run: says what it would do
 *   node scripts/setup-margins.js --apply               # build the indexes
 *   node scripts/setup-margins.js --apply --backfill    # …and fill the Margins report
 * Then: npm run audit-index-drift
 *
 * Rollback: db.paymentrequests.dropIndex('payment_request_below_margin');
 *           db.orderlinemargins.drop()   — a report cache; the next payment rebuilds its order's rows.
 */
import mongoose from 'mongoose';
import PaymentRequest from '../models/PaymentRequest.js';
import OrderLineMargin from '../models/OrderLineMargin.js';

const APPLY = process.argv.includes('--apply');
const BACKFILL = process.argv.includes('--backfill');
const TAG = '[setup-margins]';

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const out = [];
  const below = PaymentRequest.schema.indexes().find(([, o]) => o?.name === 'payment_request_below_margin');
  const wanted = [
    [PaymentRequest.collection, below],
    ...OrderLineMargin.schema.indexes().map((spec) => [OrderLineMargin.collection, spec]),
  ];
  for (const [coll, [keys, options]] of wanted) {
    const existing = new Set((await coll.indexes().catch(() => [])).map((i) => i.name));
    const label = `${coll.collectionName}.${options.name}`;
    if (existing.has(options.name)) out.push([label, 'already there']);
    else if (apply) {
      await coll.createIndex(keys, options);
      out.push([label, 'built']);
    } else out.push([label, 'would build']);
  }
  for (const [name, state] of out) log(`${TAG} ${name}: ${state}`);
  return out;
}

export async function backfill({ apply = APPLY, log = console.log } = {}) {
  // Served by payment_request_order ({ order, status }, partial on order).
  const orderIds = await PaymentRequest.distinct('order', { order: { $type: 'objectId' }, kind: 'supplier' });
  log(`${TAG} ${orderIds.length} orders have supplier payments`);
  if (!apply) return { orders: orderIds.length, rows: 0 };
  const { refreshOrder } = await import('../services/supplierMarginService.js');
  let rows = 0;
  for (const [i, orderId] of orderIds.entries()) {
    rows += await refreshOrder(orderId);
    if ((i + 1) % 200 === 0) log(`${TAG} ${i + 1}/${orderIds.length} orders, ${rows} rows`);
  }
  log(`${TAG} done: ${orderIds.length} orders, ${rows} rows`);
  return { orders: orderIds.length, rows };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the models must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`${TAG} ${APPLY ? 'APPLY' : 'DRY RUN (add --apply)'}${BACKFILL ? ' + backfill' : ''}`);
  await buildIndexes();
  if (BACKFILL) await backfill();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(`${TAG} failed:`, err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
