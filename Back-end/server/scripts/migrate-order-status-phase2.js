/**
 * Phase 2 migration: remap Order.status to the fulfillment-only vocabulary.
 *
 * Payment-driven values move off the fulfillment axis (paymentStatus already
 * carries them from the Phase 1 backfill):
 *   pending   → awaiting_payment
 *   confirmed → processing        (the collapsed "confirmed" step)
 *   failed    → awaiting_payment  (payment failure lives in paymentStatus)
 *   refunded  → returned          (refund lives in paymentStatus)
 * Already-valid values (processing/shipped/delivered/cancelled/returned) are left
 * untouched. Idempotent — a second run finds nothing to change.
 *
 * Usage:
 *   node scripts/migrate-order-status-phase2.js            # dry run
 *   node scripts/migrate-order-status-phase2.js --apply    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const REMAP = {
  pending: 'awaiting_payment',
  confirmed: 'processing',
  failed: 'awaiting_payment',
  refunded: 'returned',
};

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[migrate-order-status] connected');

  const report = {};
  for (const [from, to] of Object.entries(REMAP)) {
    // Use the raw collection so the OLD enum value isn't rejected by the new schema.
    const filter = { status: from };
    const count = await mongoose.connection.collection('orders').countDocuments(filter);
    report[`${from}→${to}`] = count;
    if (APPLY && count > 0) {
      await mongoose.connection.collection('orders').updateMany(filter, { $set: { status: to } });
    }
  }

  console.log(`[migrate-order-status] ${APPLY ? 'APPLIED' : 'DRY RUN'} —`, JSON.stringify(report));
  if (!APPLY) console.log('[migrate-order-status] re-run with --apply to write.');
}

run()
  .catch((err) => { console.error('[migrate-order-status] failed:', err); process.exitCode = 1; })
  .finally(async () => { await mongoose.connection.close(); console.log('[migrate-order-status] disconnected'); });
