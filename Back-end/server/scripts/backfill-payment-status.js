/**
 * Backfill Order.paymentStatus (Phase 1 of the payment/fulfillment split).
 *
 * Derives the new denormalized payment axis for existing orders. The Payment doc
 * is authoritative when present; otherwise we infer from the (conflated) order
 * status. Idempotent — safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-payment-status.js            # dry run (counts only)
 *   node scripts/backfill-payment-status.js --apply    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

// Payment-doc status → payment axis (authoritative). Non-terminal/unpaid states
// return null so we fall back to inferring from the order status.
function fromPayment(status) {
  switch (status) {
    case 'completed': return 'paid';
    case 'refunded': return 'refunded';
    case 'failed': return 'failed';
    default: return null; // pending / processing / cancelled → infer from order
  }
}

// Fallback: infer the payment axis from the conflated order status.
// `cancelled` returns null → we leave paymentStatus UNSET so the admin UI shows a
// neutral "—" rather than a misleading "Awaiting" on a long-closed order (we have
// no Payment record for migrated orders to say whether money ever changed hands).
function fromOrderStatus(status) {
  if (['confirmed', 'processing', 'shipped', 'delivered'].includes(status)) return 'paid';
  if (status === 'refunded') return 'refunded';
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending'; // genuinely awaiting payment
  return null; // cancelled / unknown → leave unset
}

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[backfill-payment-status] connected');

  const cursor = Order.find({}).select('_id status payment').cursor({ batchSize: 500 });
  const tally = { paid: 0, failed: 0, refunded: 0, pending: 0, unset: 0 };
  let processed = 0;

  for await (const order of cursor) {
    let derived = null;
    if (order.payment) {
      const pay = await Payment.findById(order.payment).select('status').lean();
      if (pay) derived = fromPayment(pay.status);
    }
    if (!derived) derived = fromOrderStatus(order.status);

    processed += 1;
    if (derived === null) {
      tally.unset += 1; // left blank on purpose (e.g. cancelled history) → "—"
      continue;
    }
    tally[derived] += 1;
    if (APPLY) {
      await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: derived } });
    }
  }

  console.log(`[backfill-payment-status] ${APPLY ? 'APPLIED' : 'DRY RUN'} — ${processed} orders`, JSON.stringify(tally));
  if (!APPLY) console.log('[backfill-payment-status] re-run with --apply to write.');
}

run()
  .catch((err) => {
    console.error('[backfill-payment-status] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log('[backfill-payment-status] disconnected');
  });
