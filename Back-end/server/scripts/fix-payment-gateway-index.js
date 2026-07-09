/**
 * Fix Payment gatewayPaymentId uniqueness — dedupe + unique index migration.
 *
 * WHY: Before the idempotency fix, concurrent/duplicate Razorpay `payment.captured`
 * webhooks could create MORE THAN ONE Payment row for the same gateway capture
 * (`gatewayPaymentId`). This script makes the collection safe to carry the new
 * UNIQUE partial index by:
 *   1. Finding every gatewayPaymentId with >1 Payment row.
 *   2. Choosing a canonical row per group (the one an Order.payment already points to,
 *      else the earliest `completed`, else the earliest created).
 *   3. Re-pointing any Order.payment references off the losers onto the canonical.
 *   4. Archiving the loser rows into `payments_duplicates_archive` (reversible), then
 *      deleting them.
 *   5. Creating the unique partial index { gatewayPaymentId: 1 } ($type: string).
 *
 * SAFE + IDEMPOTENT: re-running after a clean run is a no-op. Runs in DRY-RUN by
 * default — prints the plan and changes nothing. Pass --apply to write.
 *
 *   node scripts/fix-payment-gateway-index.js            # dry run
 *   node scripts/fix-payment-gateway-index.js --apply    # execute
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const INDEX_NAME = 'gatewayPaymentId_1';

function log(...args) { console.log(...args); }

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');

  log(`\n=== Payment gatewayPaymentId dedupe + unique index ===`);
  log(`Mode: ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}\n`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const payments = db.collection('payments');
  const orders = db.collection('orders');
  const archive = db.collection('payments_duplicates_archive');

  // 1. Find duplicate groups (string gatewayPaymentId only — the values the index covers).
  const groups = await payments.aggregate([
    { $match: { gatewayPaymentId: { $type: 'string' } } },
    { $group: { _id: '$gatewayPaymentId', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  log(`Duplicate gatewayPaymentId groups found: ${groups.length}`);

  let losersTotal = 0;
  let ordersRepointed = 0;

  for (const group of groups) {
    // Pull the full docs for this group, oldest first.
    const docs = await payments
      .find({ gatewayPaymentId: group._id })
      .sort({ createdAt: 1 })
      .toArray();

    // 2. Choose canonical: prefer one referenced by an order, else earliest completed, else earliest.
    const referenced = await orders.find(
      { payment: { $in: docs.map(d => d._id) } },
      { projection: { payment: 1 } }
    ).toArray();
    const referencedIds = new Set(referenced.map(o => String(o.payment)));

    const canonical =
      docs.find(d => referencedIds.has(String(d._id))) ||
      docs.find(d => d.status === 'completed') ||
      docs[0];

    const losers = docs.filter(d => String(d._id) !== String(canonical._id));
    losersTotal += losers.length;

    log(`\n  gatewayPaymentId=${group._id}  rows=${docs.length}  keep=${canonical._id}  drop=${losers.length}`);

    for (const loser of losers) {
      // 3. Re-point any order that references a loser onto the canonical.
      const ordersOnLoser = await orders.find({ payment: loser._id }, { projection: { _id: 1 } }).toArray();
      for (const o of ordersOnLoser) {
        ordersRepointed++;
        log(`    order ${o._id}: payment ${loser._id} -> ${canonical._id}`);
        if (APPLY) {
          await orders.updateOne(
            { _id: o._id },
            { $set: { payment: canonical._id, paymentStatus: 'paid' } }
          );
        }
      }

      // 4. Archive (reversible) then delete the loser.
      if (APPLY) {
        await archive.insertOne({ ...loser, _archivedAt: new Date(), _reason: 'gatewayPaymentId dedupe' });
        await payments.deleteOne({ _id: loser._id });
      }
    }
  }

  log(`\nSummary: ${losersTotal} duplicate rows to remove, ${ordersRepointed} order references to re-point.`);

  // 5. Create the unique partial index.
  const existing = await payments.indexes();
  const hasIndex = existing.some(i => i.name === INDEX_NAME && i.unique);
  if (hasIndex) {
    log(`\nUnique index ${INDEX_NAME} already present.`);
  } else if (APPLY) {
    log(`\nCreating unique partial index ${INDEX_NAME}...`);
    await payments.createIndex(
      { gatewayPaymentId: 1 },
      { unique: true, partialFilterExpression: { gatewayPaymentId: { $type: 'string' } } }
    );
    log('✓ Index created.');
  } else {
    log(`\n[DRY-RUN] Would create unique partial index ${INDEX_NAME}.`);
  }

  await mongoose.disconnect();
  log(`\n=== Done (${APPLY ? 'APPLIED' : 'dry-run'}) ===\n`);
  if (!APPLY && (losersTotal > 0 || !hasIndex)) {
    log('Re-run with --apply to execute.');
  }
}

run().catch(async (err) => {
  console.error('❌ Migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
