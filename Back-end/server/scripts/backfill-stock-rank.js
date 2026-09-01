/**
 * Backfill and audit `Product.stockRank`.
 *
 * `stockRank` is denormalized from `stock` so both search engines have a numeric
 * key they can sort on — sorting on the `stock` STRING is actively wrong, because
 * the enum orders alphabetically as backorder < in < low < out and therefore
 * promotes exactly what it was meant to sink.
 *
 * Mongoose hooks in models/Product.js keep the field current on save /
 * findOneAndUpdate / updateOne / updateMany. They CANNOT cover `bulkWrite` or raw
 * driver writes, which bypass middleware entirely — the same hole that used to let
 * the Elasticsearch index drift. So this script exists in two modes:
 *
 *   (default)  audit  — report how many documents disagree, change nothing
 *   --apply           — repair them
 *
 * Run the audit after any bulk import or migration that touches stock. It is cheap
 * and it is the only thing that will tell you the field has drifted.
 *
 * Rollback: `stockRank` is derived, never authoritative. If a run is ever wrong,
 * re-run `--apply` — it recomputes from `stock`, which is the source of truth.
 * Nothing else reads or writes the field, so there is no state to unwind.
 *
 * Usage:
 *   node scripts/backfill-stock-rank.js            # audit only
 *   node scripts/backfill-stock-rank.js --apply    # repair
 */
import mongoose from 'mongoose';
import 'dotenv/config';
import Product from '../models/Product.js';
import { PURCHASABLE_STOCK, NON_PURCHASABLE_STOCK } from '../utils/stockStatus.js';

const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

// autoIndex:false is mandatory in any script that imports models — it defaults to
// true, and merely connecting would build every declared index against whatever
// cluster this points at, which with the local .env is production.
await mongoose.connect(uri, { autoIndex: false });

// Two mismatch classes: buyable stock that is not ranked 0, and non-buyable stock
// that is not ranked 1. Expressed as explicit queries rather than a full scan with
// per-document comparison so the work stays on the server.
const WRONG = [
  { label: 'purchasable but ranked non-zero', filter: { stock: { $in: [...PURCHASABLE_STOCK] }, stockRank: { $ne: 0 } }, rank: 0 },
  { label: 'unbuyable but not ranked 1', filter: { stock: { $in: [...NON_PURCHASABLE_STOCK] }, stockRank: { $ne: 1 } }, rank: 1 },
];

const total = await Product.estimatedDocumentCount();
console.log(`Products: ${total}`);
console.log(APPLY ? 'Mode: APPLY (will write)\n' : 'Mode: AUDIT (dry run, use --apply to repair)\n');

let drift = 0;
for (const { label, filter, rank } of WRONG) {
  const count = await Product.countDocuments(filter);
  drift += count;
  if (count === 0) {
    console.log(`  ✅ ${label}: 0`);
    continue;
  }
  console.log(`  ${APPLY ? '🔧' : '⚠️ '} ${label}: ${count}`);
  if (APPLY) {
    // updateMany goes through the Mongoose hook, which would set stockRank from a
    // `stock` value this payload does not carry. Setting it explicitly is both
    // correct and independent of hook behaviour — this script is the backstop FOR
    // the hooks, so it must not depend on them.
    const res = await Product.collection.updateMany(filter, { $set: { stockRank: rank } });
    console.log(`     → updated ${res.modifiedCount}`);
  }
}

console.log('');
if (drift === 0) {
  console.log('✅ stockRank is consistent with stock.');
} else if (APPLY) {
  console.log(`✅ Repaired ${drift} document(s).`);
} else {
  console.log(`⚠️  ${drift} document(s) drifted. Re-run with --apply to repair.`);
}

await mongoose.disconnect();
process.exit(drift > 0 && !APPLY ? 1 : 0);
