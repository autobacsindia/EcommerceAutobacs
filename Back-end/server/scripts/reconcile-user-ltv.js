/**
 * Reconcile each User's purchase denorm (paidOrderCount / totalSpentPaise /
 * hasPurchased) against the Order collection. Two jobs in one:
 *
 *  1. BACKSTOP for PAY-2 — the incremental reversal (reversePurchase) is best-effort
 *     off a status change; a dropped job would drift the denorm. Run this on a
 *     schedule (e.g. nightly) to self-heal.
 *  2. MIGRATION — before PAY-2 shipped, refunds/returns never decremented the denorm,
 *     so existing prod LTV is INFLATED. Run this once (with --apply) to correct it.
 *
 * Net revenue definition (mirrors the incremental logic in orderStatusService):
 *   an order counts toward a user's LTV iff it was paid (purchaseCounted === true)
 *   AND is not currently in a money-returned state (status ∉ {cancelled, returned}).
 *
 *   paidOrderCount = # of such orders
 *   totalSpentPaise = Σ round(totalAmount * 100) over such orders   (floored at 0)
 *   hasPurchased    = paidOrderCount > 0
 *
 * Also stamps purchaseReversed=true on counted-but-returned/cancelled orders so the
 * incremental once-only guard stays consistent with the reconciled denorm.
 *
 * Idempotent. Safe to re-run. Dry-run by default (reports drift, writes nothing).
 *
 * Usage:
 *   node --import=dotenv/config scripts/reconcile-user-ltv.js            # dry run
 *   node --import=dotenv/config scripts/reconcile-user-ltv.js --apply    # apply
 *   railway run node --import=dotenv/config scripts/reconcile-user-ltv.js --apply
 *
 * Requires MONGODB_URI (or MONGO_URI).
 */

import mongoose from 'mongoose';
import Order from '../models/Order.js';
import User from '../models/User.js';

const APPLY = process.argv.includes('--apply');
const REFUNDED_STATES = ['cancelled', 'returned'];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[reconcile-user-ltv] connected. mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  // Net revenue per user from paid, non-refunded orders.
  const rows = await Order.aggregate([
    { $match: { purchaseCounted: true, user: { $ne: null }, status: { $nin: REFUNDED_STATES } } },
    {
      $group: {
        _id: '$user',
        paidOrderCount: { $sum: 1 },
        // totalAmount is rupees; store integer paise to match the denorm.
        totalSpentPaise: { $sum: { $round: [{ $multiply: [{ $ifNull: ['$totalAmount', 0] }, 100] }, 0] } },
      },
    },
  ]);
  const wanted = new Map(rows.map((r) => [String(r._id), r]));

  const stats = { usersScanned: 0, usersDrifted: 0, ordersStamped: 0 };

  // Walk every user that has ever been counted (so we also zero-out users whose
  // only orders were later refunded and thus don't appear in `wanted`).
  const countedUserIds = await Order.distinct('user', { purchaseCounted: true, user: { $ne: null } });

  for (const uid of countedUserIds) {
    stats.usersScanned++;
    const target = wanted.get(String(uid)) || { paidOrderCount: 0, totalSpentPaise: 0 };
    const paidOrderCount = target.paidOrderCount;
    const totalSpentPaise = Math.max(0, Math.round(target.totalSpentPaise || 0));
    const hasPurchased = paidOrderCount > 0;

    const user = await User.findById(uid).select('paidOrderCount totalSpentPaise hasPurchased').lean();
    if (!user) continue;

    const drifted =
      (user.paidOrderCount || 0) !== paidOrderCount ||
      (user.totalSpentPaise || 0) !== totalSpentPaise ||
      !!user.hasPurchased !== hasPurchased;

    if (drifted) {
      stats.usersDrifted++;
      console.log(
        `  ${APPLY ? 'fix' : 'drift'} user ${uid}: ` +
        `count ${user.paidOrderCount ?? 0}→${paidOrderCount}, ` +
        `paise ${user.totalSpentPaise ?? 0}→${totalSpentPaise}`
      );
      if (APPLY) {
        await User.updateOne({ _id: uid }, { $set: { paidOrderCount, totalSpentPaise, hasPurchased } });
      }
    }
  }

  // Keep the incremental guard consistent: mark counted-but-refunded orders reversed.
  if (APPLY) {
    const res = await Order.updateMany(
      { purchaseCounted: true, status: { $in: REFUNDED_STATES }, purchaseReversed: { $ne: true } },
      { $set: { purchaseReversed: true } },
    );
    stats.ordersStamped = res.modifiedCount;
  } else {
    stats.ordersStamped = await Order.countDocuments({
      purchaseCounted: true, status: { $in: REFUNDED_STATES }, purchaseReversed: { $ne: true },
    });
  }

  console.log('\n── Summary ─────────────────────────────');
  console.log(`  users scanned:            ${stats.usersScanned}`);
  console.log(`  users ${APPLY ? 'corrected' : 'drifted'}:  ${stats.usersDrifted}`);
  console.log(`  refunded orders ${APPLY ? 'stamped' : 'to stamp'}: ${stats.ordersStamped}`);

  await mongoose.disconnect();
  console.log(`\n[reconcile-user-ltv] done (${APPLY ? 'APPLIED' : 'DRY-RUN — no writes'}).`);
}

main().catch((err) => {
  console.error('[reconcile-user-ltv] failed:', err);
  process.exit(1);
});
