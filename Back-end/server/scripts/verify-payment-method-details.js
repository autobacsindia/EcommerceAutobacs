/**
 * READ-ONLY verification for the payment-method backfill. Makes no writes.
 *
 * Prints the corrected method mix and the detail of every EMI payment, so the admin
 * "Payment gateways" report can be reconciled against the underlying rows — in
 * particular whether an EMI row that rendered as "0% success" was actually a failure
 * or a fully refunded capture (paymentRepository.recordRefund flips a fully refunded
 * row to status 'refunded').
 *
 * Usage: node --import=dotenv/config scripts/verify-payment-method-details.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from '../models/Payment.js';
import { describeEmiPlan } from '../utils/paymentMethodDetails.js';

dotenv.config();

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);

  const mix = await Payment.aggregate([
    {
      $group: {
        _id: { method: '$paymentMethod', status: '$status' },
        n: { $sum: 1 },
        amount: { $sum: '$amount' },
        refunded: { $sum: { $ifNull: ['$refundAmount', 0] } },
      },
    },
    { $sort: { n: -1 } },
  ]);

  console.log('\n── method × status ─────────────────────────────');
  for (const r of mix) {
    console.log(
      `${(r._id.method || '?').padEnd(13)} ${(r._id.status || '?').padEnd(10)} n=${String(r.n).padStart(2)}  ` +
      `amount=${inr(r.amount).padStart(12)}  refunded=${inr(r.refunded)}`
    );
  }

  const emis = await Payment.find({ paymentMethod: 'emi' }).lean();
  console.log('\n── EMI payments ────────────────────────────────');
  if (!emis.length) console.log('(none)');
  for (const p of emis) {
    console.log(
      `${String(p._id)}  ${inr(p.amount)}  status=${p.status}  refunded=${inr(p.refundAmount)}\n` +
      `  plan: ${describeEmiPlan(p) || '(no plan detail — pre-dates expand[]=emi enrichment)'}\n` +
      `  raw gateway method: ${p.methodDetails?.rawMethod || '?'}   card.type: ${p.methodDetails?.cardType || '—'}`
    );
  }

  const cards = await Payment.countDocuments({ paymentMethod: 'debit_card' });
  console.log(`\ndebit_card rows after backfill: ${cards}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[verify] failed:', err);
  process.exit(1);
});
