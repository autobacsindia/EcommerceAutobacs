/**
 * Backfill `Payment.methodDetails` and correct `Payment.paymentMethod` for historical rows.
 *
 * Why this is needed: the old mapper keyed on a `'debitcard'` method Razorpay has never
 * emitted, so every debit card was recorded as `credit_card`, and `cardless_emi` fell
 * through to `other`. The admin payment-mix report has therefore been wrong since day one.
 *
 * Nothing is lost — the full gateway entity was always kept in `paymentDetails.razorpay`,
 * so both the corrected method and the new structured `methodDetails` are recomputed from
 * data we already hold. No gateway calls.
 *
 * Idempotent: re-derives from each row's own stored entity, so re-running is a no-op.
 *
 * LIMITATION: EMI tenure/rate is not in the stored webhook payload (it needs an
 * `expand[]=emi` fetch, which only NEW captures perform). Historical EMI rows get their
 * kind and issuer but `months`/`ratePercent` stay absent. That is correct — better a
 * partial record than a fabricated one.
 *
 * Usage:
 *   node scripts/backfill-payment-method-details.js            # dry run (report only, no writes)
 *   node scripts/backfill-payment-method-details.js --apply    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from '../models/Payment.js';
import { resolvePaymentMethod, buildMethodDetails } from '../utils/paymentMethodDetails.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const BATCH = 500;

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[backfill-method-details] connected');
}

/** Shallow equality over the flat-ish methodDetails shape, to avoid pointless writes. */
function sameDetails(a = {}, b = {}) {
  const norm = (d) => JSON.stringify({ ...d, emi: d.emi ? { ...d.emi } : undefined });
  return norm(a) === norm(b);
}

async function run() {
  await connect();

  let scanned = 0;
  let changed = 0;
  let noEntity = 0;
  const methodMoves = new Map(); // "credit_card→debit_card" → count
  let afterId = null;

  // Keyset pagination on immutable _id (writes bump updatedAt, which would shift a skip/limit window).
  for (;;) {
    const filter = afterId ? { _id: { $gt: afterId } } : {};
    const payments = await Payment.find(filter).sort({ _id: 1 }).limit(BATCH).lean();
    if (payments.length === 0) break;

    const ops = [];
    for (const p of payments) {
      const entity = p.paymentDetails?.razorpay;
      if (!entity?.method) {
        // Offline/imported rows with no gateway entity — nothing to derive from. Skip
        // rather than guess; their paymentMethod was set by hand and is authoritative.
        noEntity += 1;
        continue;
      }

      const nextMethod = resolvePaymentMethod(entity);
      const nextDetails = buildMethodDetails(entity);

      const methodChanged = nextMethod !== p.paymentMethod;
      const detailsChanged = !sameDetails(p.methodDetails, nextDetails);
      if (!methodChanged && !detailsChanged) continue;

      if (methodChanged) {
        const key = `${p.paymentMethod} → ${nextMethod}`;
        methodMoves.set(key, (methodMoves.get(key) || 0) + 1);
      }
      changed += 1;
      ops.push({
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { paymentMethod: nextMethod, methodDetails: nextDetails } },
        },
      });
    }
    if (APPLY && ops.length) await Payment.bulkWrite(ops, { ordered: false });

    scanned += payments.length;
    afterId = payments[payments.length - 1]._id;
    if (payments.length < BATCH) break;
  }

  console.log(`[backfill-method-details] scanned=${scanned} changed=${changed} skipped_no_entity=${noEntity} (${APPLY ? 'APPLIED' : 'dry run'})`);
  if (methodMoves.size) {
    console.log('[backfill-method-details] paymentMethod corrections:');
    for (const [move, n] of [...methodMoves].sort((a, b) => b[1] - a[1])) console.log(`  ${move}: ${n}`);
  } else {
    console.log('[backfill-method-details] no paymentMethod corrections needed.');
  }
  if (!APPLY) console.log('[backfill-method-details] re-run with --apply to write.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[backfill-method-details] failed:', err);
  process.exit(1);
});
