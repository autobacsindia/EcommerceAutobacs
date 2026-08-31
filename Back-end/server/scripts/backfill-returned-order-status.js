/**
 * Reconcile `Order.status` against the returns that actually came back.
 *
 * ── WHAT CHANGED, AND WHY THIS SCRIPT HAD TO ──────────────────────────────────────
 * This script used to flip EVERY order with an approved-or-later return from
 * `delivered` to `returned`. That mirrored the runtime behaviour at the time — and both
 * were wrong for a partial return. `returned` is a TERMINAL state in
 * orderStatusService.STATUS_TRANSITIONS, so a customer who sent back 1 of 3 faulty items
 * could never return the other 2, and the order could never move again. It also told the
 * admin Orders column that an order the customer still mostly holds had come back.
 *
 * The runtime flip is now gated on the return covering every DELIVERED line
 * (returnController.syncOrderReturnedStatus → utils/orderReturns.coversEveryDeliveredLine).
 * This script applies the same gate, from the same shared predicate, so a backfill can
 * never re-introduce what the gate was added to prevent.
 *
 * ── TWO DIRECTIONS, DELIBERATELY SEPARATE FLAGS ───────────────────────────────────
 *   --apply           flip `delivered` → `returned`, but ONLY where the returns cover
 *                     every delivered line. Safe and idempotent.
 *   --repair-partial  move `returned` → `delivered` for orders the OLD ungated flip
 *                     pushed into a terminal state while the customer still holds
 *                     items. This is the repair for existing production rows.
 *
 * They are separate because the repair is the riskier half: an order can also reach
 * `returned` legitimately (an admin moving it by hand, or the full-refund path in
 * orderController.updateReturnStatus). To avoid reverting those, the repair only touches
 * orders whose LATEST `returned` statusHistory entry was written by the automatic flip —
 * `reason: 'return_completed'` with a note matching the strings those call sites write.
 * Anything moved by a human is left exactly where the human put it.
 *
 * ── ROLLBACK ──────────────────────────────────────────────────────────────────────
 * Every write appends a statusHistory entry naming this script, so the previous state is
 * recoverable per order. To undo a --repair-partial run:
 *
 *   db.orders.updateMany(
 *     { 'statusHistory.notes': /backfill-returned-order-status: reverted/ },
 *     { $set: { status: 'returned' } }
 *   )
 *
 * and the inverse (set status 'delivered') to undo an --apply run. Verify the count
 * matches what the run reported before trusting either.
 *
 * Scope, unchanged from before (the fulfillment axis ONLY):
 *   - paymentStatus is NOT touched. An approved-but-unrefunded return is still `paid`.
 *   - Karma / coupons / customer emails are NOT touched — this corrects a display state
 *     on historical rows, it does not replay the return lifecycle.
 *
 * Usage:
 *   node scripts/backfill-returned-order-status.js                    # dry run (both directions)
 *   node scripts/backfill-returned-order-status.js --apply            # write the forward flips
 *   node scripts/backfill-returned-order-status.js --repair-partial   # write the reverts
 *   railway run npm run backfill-returned-order-status -- --apply     # against prod Mongo
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from '../models/Order.js';
import ReturnRequest from '../models/ReturnRequest.js';
import { RETURN_QUANTITY_CONSUMING_STATUSES } from '../config/returnPolicy.js';
import { coversEveryDeliveredLine } from '../utils/orderReturns.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const REPAIR = process.argv.includes('--repair-partial');
const TAG = '[backfill-returned-order-status]';

// A return at or past approval means the order is no longer simply "delivered".
const IN_FLIGHT_OR_DONE = ['approved', 'courier_booked', 'received', 'refunded'];

/**
 * Notes written by the automatic flip (returnController's three call sites). Used to
 * tell an auto-flip apart from a deliberate human one, which must not be reverted.
 */
const AUTO_FLIP_NOTE = /Return .* (approved|settled offline)|Offline return .* recorded|Backfill: return already approved/i;

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  /*
    ⚠️ autoIndex:false is MANDATORY here. This script imports models, and Mongoose
    defaults autoIndex to true — merely connecting would build every declared index
    against whatever cluster the script points at, which for this repo's local .env is
    PRODUCTION. (CLAUDE.md landmine; this script was missing it.)
  */
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`${TAG} connected`);
}

/** productId → units spoken for by a return, for one order. Mirrors returnRequestRepository. */
async function returnedByProductFor(orderIds) {
  const rows = await ReturnRequest.aggregate([
    { $match: { order: { $in: orderIds }, status: { $in: RETURN_QUANTITY_CONSUMING_STATUSES } } },
    { $unwind: '$items' },
    { $group: { _id: { order: '$order', product: '$items.product' }, qty: { $sum: '$items.quantity' } } },
  ]);

  const byOrder = new Map();
  for (const r of rows) {
    const key = String(r._id.order);
    if (!byOrder.has(key)) byOrder.set(key, new Map());
    byOrder.get(key).set(String(r._id.product), r.qty || 0);
  }
  return byOrder;
}

/** Fields the coverage predicate needs — nothing more. */
const COVERAGE_FIELDS = { orderNumber: 1, status: 1, items: 1, shipments: 1, cancellations: 1, statusHistory: 1 };

async function forwardPass() {
  const orderIds = await ReturnRequest.distinct('order', { status: { $in: IN_FLIGHT_OR_DONE } });
  const candidates = await Order.find(
    { _id: { $in: orderIds }, status: 'delivered' }, COVERAGE_FIELDS,
  ).lean();

  const returned = await returnedByProductFor(candidates.map((o) => o._id));

  const full = [];
  const partial = [];
  for (const order of candidates) {
    const map = returned.get(String(order._id)) || new Map();
    (coversEveryDeliveredLine(order, map) ? full : partial).push(order);
  }

  console.log(
    `${TAG} FORWARD: ${candidates.length} delivered order(s) carry an approved-or-later return — `
    + `${full.length} fully returned (will flip), ${partial.length} only PARTLY returned (left alone).`,
  );

  if (!APPLY || full.length === 0) {
    for (const o of full.slice(0, 20)) console.log(`${TAG}   would flip ${o.orderNumber || o._id}`);
    if (full.length > 20) console.log(`${TAG}   …and ${full.length - 20} more`);
    return;
  }

  const res = await Order.updateMany(
    { _id: { $in: full.map((o) => o._id) }, status: 'delivered' },
    {
      $set: { status: 'returned' },
      $push: {
        statusHistory: {
          status: 'returned',
          timestamp: new Date(),
          reason: 'return_completed',
          notes: 'backfill-returned-order-status: every delivered line was returned',
        },
      },
    },
  );
  console.log(`${TAG} FORWARD APPLIED — flipped ${res.modifiedCount} order(s) to 'returned'.`);
}

async function repairPass() {
  // Orders sitting at `returned` — did the returns actually cover everything?
  const stuck = await Order.find({ status: 'returned' }, COVERAGE_FIELDS).lean();
  const returned = await returnedByProductFor(stuck.map((o) => o._id));

  const wrong = stuck.filter((order) => {
    const map = returned.get(String(order._id)) || new Map();
    if (coversEveryDeliveredLine(order, map)) return false; // legitimately returned

    /*
      Only revert what the AUTOMATIC flip moved. An order an admin marked returned by
      hand, or one moved by the legacy full-refund path, is a human decision — reverting
      it would be this script overruling a person.
    */
    const last = [...(order.statusHistory || [])]
      .reverse()
      .find((h) => h.status === 'returned');
    return Boolean(last && AUTO_FLIP_NOTE.test(last.notes || ''));
  });

  console.log(
    `${TAG} REPAIR: ${stuck.length} order(s) at 'returned' — `
    + `${wrong.length} were auto-flipped by a PARTIAL return and are stuck in a terminal state.`,
  );

  if (!REPAIR || wrong.length === 0) {
    for (const o of wrong.slice(0, 20)) console.log(`${TAG}   would revert ${o.orderNumber || o._id} → delivered`);
    if (wrong.length > 20) console.log(`${TAG}   …and ${wrong.length - 20} more`);
    return;
  }

  const res = await Order.updateMany(
    { _id: { $in: wrong.map((o) => o._id) }, status: 'returned' },
    {
      $set: { status: 'delivered' },
      $push: {
        statusHistory: {
          status: 'delivered',
          timestamp: new Date(),
          reason: 'customer_received',
          notes: 'backfill-returned-order-status: reverted — only part of this order was returned',
        },
      },
    },
  );
  console.log(`${TAG} REPAIR APPLIED — reverted ${res.modifiedCount} order(s) to 'delivered'.`);
}

async function run() {
  await connect();
  await forwardPass();
  await repairPass();

  if (!APPLY && !REPAIR) {
    console.log(`${TAG} DRY RUN — re-run with --apply (forward) and/or --repair-partial (reverts).`);
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(`${TAG} failed:`, err);
  process.exit(1);
});
