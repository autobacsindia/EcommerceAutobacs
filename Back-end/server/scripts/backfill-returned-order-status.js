/**
 * Backfill: move orders with an ALREADY-APPROVED return onto the `returned`
 * fulfillment stage.
 *
 * Going forward, returnController.reviewReturn flips the order the moment operations
 * approves a return (orderRepository.markReturnedOnReturnApproval), so the admin
 * Orders column stops reading a stale "Delivered". Returns approved BEFORE that change
 * shipped never got the flip — this closes that gap for existing rows.
 *
 * Scope (deliberately narrow — the fulfillment axis ONLY):
 *   - Order.status must still be `delivered` (never touch cancelled/processing/etc.).
 *   - The order must have a ReturnRequest whose status is in-flight or completed
 *     (approved / courier_booked / received / refunded). `pending`, `rejected` and
 *     `cancelled` returns are left alone — the order was, and stays, delivered.
 *   - paymentStatus is NOT touched. Money movement is the refund flow's business; an
 *     approved-but-unrefunded return is still a `paid` order.
 *   - Karma / coupons / customer emails are NOT touched — this is a display-state
 *     correction on historical rows, not a replay of the return lifecycle.
 *
 * Each flipped order gets a statusHistory entry so the change is auditable rather than
 * appearing to have always been that way.
 *
 * Usage:
 *   node scripts/backfill-returned-order-status.js           # dry run (report only)
 *   node scripts/backfill-returned-order-status.js --apply   # write
 *   railway run npm run backfill-returned-order-status -- --apply   # against prod Mongo
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from '../models/Order.js';
import ReturnRequest from '../models/ReturnRequest.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const TAG = '[backfill-returned-order-status]';

// A return at or past approval means the order is no longer simply "delivered".
const IN_FLIGHT_OR_DONE = ['approved', 'courier_booked', 'received', 'refunded'];

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log(`${TAG} connected`);
}

async function run() {
  await connect();

  // Distinct order ids carrying a return at/past approval, then intersect with orders
  // still sitting at `delivered`. Two small queries beat a $lookup here — the return
  // collection is tiny relative to orders.
  const orderIds = await ReturnRequest.distinct('order', { status: { $in: IN_FLIGHT_OR_DONE } });
  const candidates = await Order.find(
    { _id: { $in: orderIds }, status: 'delivered' },
    { _id: 1, orderNumber: 1 }
  ).lean();

  console.log(
    `${TAG} ${orderIds.length} order(s) have an approved-or-later return — ` +
    `${candidates.length} still stuck on 'delivered'.`
  );

  if (candidates.length === 0) {
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    for (const o of candidates.slice(0, 20)) console.log(`${TAG}   would flip ${o.orderNumber || o._id}`);
    if (candidates.length > 20) console.log(`${TAG}   …and ${candidates.length - 20} more`);
    console.log(`${TAG} DRY RUN — re-run with --apply to write.`);
    await mongoose.disconnect();
    return;
  }

  const res = await Order.updateMany(
    { _id: { $in: candidates.map((o) => o._id) }, status: 'delivered' },
    {
      $set: { status: 'returned' },
      $push: {
        statusHistory: {
          status: 'returned',
          timestamp: new Date(),
          reason: 'return_completed',
          notes: 'Backfill: return already approved before the auto-flip shipped',
        },
      },
    }
  );

  console.log(`${TAG} APPLIED — flipped ${res.modifiedCount} order(s) to 'returned'.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(`${TAG} failed:`, err);
  process.exit(1);
});
