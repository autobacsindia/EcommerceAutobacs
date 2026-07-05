/**
 * Backfill the Sales CRM (Lead collection) + the User purchase denorm from
 * existing data. Run once after deploying the CRM feature; safe to re-run
 * (every write is idempotent — leads dedup by identity + source ref, and the
 * purchase denorm is recomputed from scratch).
 *
 * Seeds leads from the same sources the live triggers/sweeps use:
 *   • consultations              → warm leads
 *   • orders pending / failed    → payment_pending / payment_failed leads
 *   • dormant registered users   → re-engagement leads
 * (Admin-cancelled orders are intentionally excluded — not a live prospect.)
 *
 * Usage:
 *   node scripts/backfill-crm-leads.js            # dry run (counts only, no writes)
 *   node scripts/backfill-crm-leads.js --apply    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from '../models/Order.js';
import User from '../models/User.js';
import Consultation from '../models/Consultation.js';
import leadSyncService from '../services/leadSyncService.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const PAID = ['confirmed', 'processing', 'shipped', 'delivered', 'refunded'];
const DORMANCY_DAYS = Number(process.env.LEAD_DORMANCY_DAYS) || 30;
const BATCH = 500;

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[backfill-crm] connected');
}

/** Recompute User.hasPurchased/firstPurchaseAt/paidOrderCount from paid orders. */
async function backfillPurchaseDenorm() {
  const rows = await Order.aggregate([
    { $match: { status: { $in: PAID }, user: { $ne: null } } },
    { $group: { _id: '$user', count: { $sum: 1 }, first: { $min: '$createdAt' } } },
  ]);
  console.log(`[backfill-crm] users with paid orders: ${rows.length}`);
  if (!APPLY) return rows.length;

  for (const r of rows) {
    await User.updateOne(
      { _id: r._id },
      { $set: { hasPurchased: true, firstPurchaseAt: r.first, paidOrderCount: r.count } }
    );
  }
  return rows.length;
}

/** Iterate a cursor in batches, calling fn(doc). Returns count synced. */
async function eachSync(cursor, fn) {
  let synced = 0;
  for await (const doc of cursor) {
    if (!APPLY) { synced += 1; continue; }
    const lead = await leadSyncService.safeSync(() => fn(doc));
    if (lead) synced += 1;
  }
  return synced;
}

async function run() {
  await connect();
  const report = {};

  report.purchaseDenorm = await backfillPurchaseDenorm();

  report.consultations = await eachSync(
    Consultation.find().cursor({ batchSize: BATCH }),
    (c) => leadSyncService.upsertFromConsultation(c)
  );

  // Pre-payment prospects: never paid (awaiting), payment failed, or payment cancelled.
  report.orders = await eachSync(
    Order.find({ paymentStatus: { $in: ['pending', 'failed', 'cancelled'] }, status: { $ne: 'cancelled' } }).cursor({ batchSize: BATCH }),
    (o) => leadSyncService.upsertFromOrder(o)
  );

  const dormantCutoff = new Date(Date.now() - DORMANCY_DAYS * 24 * 60 * 60 * 1000);
  report.dormantUsers = await eachSync(
    User.find({
      paidOrderCount: 0,
      isGuest: { $ne: true },
      role: { $ne: 'admin' },
      createdAt: { $lt: dormantCutoff },
    }).cursor({ batchSize: BATCH }),
    (u) => leadSyncService.upsertFromDormantUser(u)
  );

  console.log(`[backfill-crm] ${APPLY ? 'APPLIED' : 'DRY RUN'} —`, JSON.stringify(report, null, 2));
  if (!APPLY) console.log('[backfill-crm] re-run with --apply to write.');
}

run()
  .catch((err) => {
    console.error('[backfill-crm] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log('[backfill-crm] disconnected');
  });
