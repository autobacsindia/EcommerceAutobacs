/**
 * Migrate Product.stock from numeric quantity to coarse status enum.
 *
 * Old model: stock = Number (units on hand).
 * New model: stock = 'in' | 'low' | 'out' (admin-managed availability).
 *
 * Mapping (legacy numeric -> status):
 *   <= 0      -> 'out'
 *   1 .. 5    -> 'low'
 *   > 5       -> 'in'
 *
 * Idempotent: only documents whose `stock` is still numeric are touched, so
 * re-running after a partial migration is safe. Uses the native driver
 * (Product.collection) so the new String enum schema does not reject the
 * still-numeric source values during the read/update.
 *
 * Usage:
 *   node --import=dotenv/config scripts/migrate-stock-to-status.js
 *   node --import=dotenv/config scripts/migrate-stock-to-status.js --dry-run
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import { STOCK_STATUS } from '../utils/stockStatus.js';

dotenv.config();

const LOW_THRESHOLD = 5;
const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  console.log('='.repeat(60));
  console.log(`Stock -> status migration${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log('='.repeat(60));

  if (!process.env.MONGODB_URI) {
    console.error('[ERROR] MONGODB_URI not set in environment');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[OK] Connected to MongoDB\n');

  const col = Product.collection;

  // Operate only on docs where stock is still a number (BSON type "double" or "int").
  const numericFilter = { stock: { $type: 'number' } };
  const remaining = await col.countDocuments(numericFilter);
  console.log(`[INFO] ${remaining} product(s) with numeric stock to migrate\n`);

  if (remaining === 0) {
    console.log('[OK] Nothing to migrate.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Buckets — evaluated against the still-numeric values.
  const buckets = [
    { label: STOCK_STATUS.OUT, filter: { stock: { $type: 'number', $lte: 0 } } },
    { label: STOCK_STATUS.LOW, filter: { stock: { $type: 'number', $gt: 0, $lte: LOW_THRESHOLD } } },
    { label: STOCK_STATUS.IN,  filter: { stock: { $type: 'number', $gt: LOW_THRESHOLD } } },
  ];

  for (const { label, filter } of buckets) {
    const count = await col.countDocuments(filter);
    if (DRY_RUN) {
      console.log(`[DRY] would set ${count} product(s) -> '${label}'`);
      continue;
    }
    const res = await col.updateMany(filter, { $set: { stock: label } });
    console.log(`[OK] set ${res.modifiedCount} product(s) -> '${label}'`);
  }

  if (!DRY_RUN) {
    const left = await col.countDocuments(numericFilter);
    console.log(`\n[VERIFY] numeric stock remaining: ${left} (expected 0)`);
  }

  await mongoose.disconnect();
  console.log('\n[DONE]');
  process.exit(0);
}

run().catch(async (err) => {
  console.error('[FATAL]', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
