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
import Lead from '../models/Lead.js';
import leadSyncService from '../services/leadSyncService.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const DORMANCY_DAYS = Number(process.env.LEAD_DORMANCY_DAYS) || 30;
const BATCH = 500;

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[backfill-crm] connected');
}

/**
 * Recompute the User purchase denorm from paid orders — hasPurchased,
 * firstPurchaseAt, lastOrderAt, paidOrderCount, and net LTV (totalSpentPaise).
 * Uses the canonical payment signal (`paymentStatus: 'paid'`), not the legacy
 * fulfillment `status`, so it matches the live markPurchased hook. Refunded
 * orders are excluded ⇒ net LTV (refund decrement is wired separately, ADR-006).
 * Fully recompute-from-source, so re-running is idempotent (set, not $inc).
 */
async function backfillPurchaseDenorm() {
  const rows = await Order.aggregate([
    { $match: { paymentStatus: 'paid', user: { $ne: null } } },
    {
      $group: {
        _id: '$user',
        count: { $sum: 1 },
        first: { $min: '$createdAt' },
        last: { $max: '$createdAt' },
        // Order.totalAmount is rupees; store integer paise to match runtime.
        spentPaise: { $sum: { $round: [{ $multiply: ['$totalAmount', 100] }, 0] } },
      },
    },
  ]);
  console.log(`[backfill-crm] users with paid orders: ${rows.length}`);
  if (!APPLY) return rows.length;

  // Mark every already-paid order as counted so the runtime once-guard
  // (markPurchaseCountedOnce) never re-counts a historical order into net LTV.
  await Order.updateMany({ paymentStatus: 'paid' }, { $set: { purchaseCounted: true } });

  for (const r of rows) {
    await User.updateOne(
      { _id: r._id },
      {
        $set: {
          hasPurchased: true,
          firstPurchaseAt: r.first,
          lastOrderAt: r.last,
          paidOrderCount: r.count,
          totalSpentPaise: r.spentPaise,
        },
      }
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

/**
 * Legacy leads predate the cycle model — stamp cycleStartedAt = createdAt so
 * cycle-age reporting is correct. Idempotent: only touches docs missing the
 * field (new leads get it from the schema default).
 */
async function backfillCycleStart() {
  const count = await Lead.countDocuments({ cycleStartedAt: { $exists: false } });
  console.log(`[backfill-crm] leads missing cycleStartedAt: ${count}`);
  if (!APPLY || count === 0) return count;
  await Lead.updateMany(
    { cycleStartedAt: { $exists: false } },
    [{ $set: { cycleStartedAt: '$createdAt' } }]
  );
  return count;
}

async function run() {
  await connect();
  const report = {};

  report.purchaseDenorm = await backfillPurchaseDenorm();
  report.cycleStartedAt = await backfillCycleStart();

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
