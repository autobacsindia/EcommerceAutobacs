/**
 * Remove phantom `returnRequest` / `refundDetails` summaries from existing orders.
 *
 * Root cause: both subdocs are Mongoose *nested paths*, and their `status` leaf
 * used to carry `default: "pending"`. A leaf default on a nested path materializes
 * the WHOLE subdoc on every order at creation — so every order ended up with an
 * empty `returnRequest: { status: "pending" }` and `refundDetails: { status:
 * "pending" }` even though no return or refund ever happened. That phantom:
 *   - rendered a bogus "Return Request PENDING / Invalid Date" + "Refund ₹0.00"
 *     card on the customer order page,
 *   - hid the Return button (its gate checks `!returnRequest.status`),
 *   - and matched the admin refunds-queue filter, flooding it with every order.
 *
 * The model default has since been removed (models/Order.js), so NEW orders are
 * clean. This script cleans the already-polluted rows.
 *
 * A *real* return/refund is always stamped with `requestedAt` by the write paths
 * (returnController.js / orderController.js), so `requestedAt` is the authoritative
 * "this is real" marker. We only ever $unset a subdoc that has NO `requestedAt`
 * (and, defensively, no other real-work fields). This is non-destructive to any
 * genuine return/refund.
 *
 * Usage:
 *   node scripts/cleanup-phantom-order-subdocs.js            # dry run (report only)
 *   node scripts/cleanup-phantom-order-subdocs.js --apply    # $unset the phantoms
 *   railway run npm run cleanup-phantom-order-subdocs -- --apply   # against prod Mongo
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from '../models/Order.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[cleanup-phantom-order-subdocs] connected');
}

// A phantom subdoc exists but was never actually written by a real flow: it has
// no `requestedAt`. Guard extra real-work fields too so a hand-edited or partially
// written record is never touched — we require the subdoc to be genuinely empty of
// any signal that a human/flow acted on it.
const phantomReturn = {
  returnRequest: { $exists: true, $ne: null },
  'returnRequest.requestedAt': { $exists: false },
  'returnRequest.approvedAt': { $exists: false },
  'returnRequest.itemReceivedAt': { $exists: false },
};

const phantomRefund = {
  refundDetails: { $exists: true, $ne: null },
  'refundDetails.requestedAt': { $exists: false },
  'refundDetails.processedAt': { $exists: false },
  'refundDetails.transactionId': { $exists: false },
  'refundDetails.amount': { $in: [null, 0] },
};

async function run() {
  await connect();

  const [returnCount, refundCount, total] = await Promise.all([
    Order.countDocuments(phantomReturn),
    Order.countDocuments(phantomRefund),
    Order.estimatedDocumentCount(),
  ]);

  console.log(
    `[cleanup-phantom-order-subdocs] ${total} orders total — ` +
    `phantom returnRequest:${returnCount} phantom refundDetails:${refundCount}`
  );

  if (!APPLY) {
    console.log('[cleanup-phantom-order-subdocs] DRY RUN — re-run with --apply to write.');
    await mongoose.disconnect();
    return;
  }

  const [rr, rd] = await Promise.all([
    Order.updateMany(phantomReturn, { $unset: { returnRequest: '' } }),
    Order.updateMany(phantomRefund, { $unset: { refundDetails: '' } }),
  ]);

  console.log(
    `[cleanup-phantom-order-subdocs] APPLIED — ` +
    `unset returnRequest on ${rr.modifiedCount}, refundDetails on ${rd.modifiedCount}.`
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[cleanup-phantom-order-subdocs] failed:', err);
  process.exit(1);
});
