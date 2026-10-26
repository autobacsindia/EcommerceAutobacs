/**
 * One-off: supplier payments raised before the "Payment Pending" stage existed.
 *
 * Until now, raising a supplier payment marked the item "Ordered from supplier"
 * at once. Now the item reads "Payment Pending" until the admin pays, which is
 * the `supplierPaymentAt` flag on the order's workflow line. This sets that flag
 * for every item whose supplier payment is still waiting (submitted, approved or
 * on hold), so those items show "Payment Pending" too. Paid, declined and
 * cancelled requests are left alone. Nothing about money changes.
 *
 * Safe to re-run: a line that already has the flag is skipped.
 *
 *   node scripts/backfill-payment-pending.js            # report only (default)
 *   node scripts/backfill-payment-pending.js --apply    # set the flags
 *
 * Rollback: unset `workflow.lines.$[].supplierPaymentAt` / `supplierPaymentRef`
 * on the orders listed in the report (the item's stock decision is untouched).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');
  console.log(`Cluster: ${uri.replace(/^[^@]*@/, '').replace(/\/.*$/, '')}   mode: ${APPLY ? 'APPLY' : 'report only'}`);
  // autoIndex MUST be false: importing models + connecting would otherwise build indexes on this cluster.
  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;

  const open = await db.collection('paymentrequests')
    .find({ kind: 'supplier', status: { $in: ['submitted', 'approved', 'on_hold'] }, order: { $type: 'objectId' } })
    .project({ number: 1, order: 1, itemIds: 1, createdAt: 1 })
    .toArray();
  console.log(`Open supplier payments: ${open.length}`);

  let toSet = 0;
  for (const r of open) {
    const order = await db.collection('orders').findOne({ _id: r.order }, { projection: { orderNumber: 1, 'workflow.lines': 1 } });
    for (const itemId of r.itemIds || []) {
      const line = (order?.workflow?.lines || []).find((l) => String(l.itemId) === String(itemId));
      if (!line || line.supplierPaymentAt || line.stock === 'out_of_stock') continue;
      toSet += 1;
      console.log(`  ${r.number} → order ${order.orderNumber || order._id} item ${itemId} (stock: ${line.stock})`);
      if (APPLY) {
        await db.collection('orders').updateOne(
          { _id: r.order, 'workflow.lines': { $elemMatch: { itemId, supplierPaymentAt: { $exists: false } } } },
          { $set: { 'workflow.lines.$.supplierPaymentAt': r.createdAt || new Date(), 'workflow.lines.$.supplierPaymentRef': r.number } },
        );
      }
    }
  }
  console.log(APPLY ? `Done: ${toSet} line(s) now "Payment Pending".` : `${toSet} line(s) would become "Payment Pending". Re-run with --apply.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
