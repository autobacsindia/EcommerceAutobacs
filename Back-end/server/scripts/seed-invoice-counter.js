/**
 * Seed the sequential invoice counter.
 *
 * Sets the "invoice" Counter to the LAST invoice number already issued (e.g. by
 * the legacy WooCommerce store), so the next invoice this system generates is
 * last+1 and the series continues without collisions or restarts.
 *
 * Usage:
 *   node --import=dotenv/config scripts/seed-invoice-counter.js <lastIssuedNumber>
 *   node --import=dotenv/config scripts/seed-invoice-counter.js 59            # next → 60
 *   node --import=dotenv/config scripts/seed-invoice-counter.js 59 --force    # allow lowering
 *
 * Safe by default: refuses to LOWER an existing counter (which would risk
 * re-issuing numbers) unless --force is passed. Idempotent when re-run with the
 * same or a higher value.
 */
import mongoose from 'mongoose';
import Counter from '../models/Counter.js';

const COUNTER_NAME = 'invoice';

const run = async () => {
  const arg = process.argv[2];
  const force = process.argv.includes('--force');
  const last = Number(arg);

  if (!arg || !Number.isInteger(last) || last < 0) {
    console.error('Usage: node scripts/seed-invoice-counter.js <lastIssuedNumber> [--force]');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI (or MONGO_URI) is not set. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const existing = await Counter.findById(COUNTER_NAME).lean();
    const current = existing?.seq ?? null;

    if (current != null && last < current && !force) {
      console.error(
        `Refusing to lower the invoice counter from ${current} to ${last} ` +
          `(next would re-issue numbers). Re-run with --force if this is intentional.`
      );
      process.exit(2);
    }

    await Counter.findByIdAndUpdate(
      COUNTER_NAME,
      { $set: { seq: last } },
      { upsert: true, new: true }
    );

    console.log(
      `Invoice counter seeded: seq=${last} (was ${current ?? 'unset'}). ` +
        `Next invoice number will be ${last + 1}.`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Failed to seed invoice counter:', err.message);
  process.exit(1);
});
