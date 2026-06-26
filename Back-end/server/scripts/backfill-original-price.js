/**
 * Backfill `originalPrice` so the discount badge ("% OFF") renders correctly.
 *
 * Background — the discount badge on product cards/PDP reads ONE field: `originalPrice`
 * (badge shows when `originalPrice > price`). The live WooCommerce cron sync
 * (services/wordpressSyncService.js) historically stored the list price in
 * `regularPrice`/`salePrice` (which the frontend never reads) and never set
 * `originalPrice`, so genuinely-discounted products showed no badge. The sync code
 * is now fixed; this script repairs the EXISTING catalog from data already in the DB.
 *
 * Rules (per product), derived only from data we already store — no WooCommerce re-fetch:
 *   - If `regularPrice` is present:
 *       • regularPrice > price  →  set originalPrice = regularPrice   (genuine sale → badge)
 *       • regularPrice <= price →  clear originalPrice (null)         (no sale → no/stale badge)
 *   - If `regularPrice` is absent:
 *       • Leave originalPrice UNTOUCHED. These are legacy one-off imports (e.g.
 *         import-migrated-data.js) whose originalPrice may be a valid, non-recoverable
 *         badge. We must not fabricate or wipe it.
 *
 * Suspect overcharge flagging (admin "brand import" path, now fixed):
 *   Products with NO regularPrice AND originalPrice == price are likely the buggy
 *   path where the regular price was saved as the selling price and the real sale
 *   price was lost. We CANNOT recover their price from the DB, so we only REPORT
 *   them (SKU + price). Re-sync these from WooCommerce to correct price + badge.
 *   This script never changes a `price`.
 *
 * Idempotent. Safe to re-run. Dry-run by default.
 *
 * Usage:
 *   node --import=dotenv/config scripts/backfill-original-price.js            # dry run (no writes)
 *   node --import=dotenv/config scripts/backfill-original-price.js --apply    # apply changes
 *   # against Railway prod:
 *   railway run node --import=dotenv/config scripts/backfill-original-price.js --apply
 *
 * After --apply against prod, remember to:
 *   - reindex Elasticsearch (originalPrice is an indexed field):  npm run reindex-products
 *   - flush Redis product caches:  route:*  and  public:*  keys
 *
 * Requires MONGODB_URI (or MONGO_URI) in the environment.
 */

import mongoose from 'mongoose';
import Product from '../models/Product.js';

const APPLY = process.argv.includes('--apply');

// Treat sub-rupee differences as equal to avoid float-noise churn.
const approxEqual = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.01;

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[backfill-original-price] connected. mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  // Only soft-delete-live products. Pull the fields we reason about.
  const cursor = Product
    .find({ deletedAt: null }, { name: 1, sku: 1, price: 1, originalPrice: 1, regularPrice: 1 })
    .lean()
    .cursor();

  const stats = {
    scanned: 0,
    setBadge: 0,     // originalPrice set to regularPrice (sale → badge)
    cleared: 0,      // stale/no-op originalPrice cleared
    unchanged: 0,    // already correct
    skippedNoReg: 0, // no regularPrice → left untouched
    suspect: [],     // likely overcharge (no regularPrice, originalPrice == price)
  };

  const ops = [];

  for await (const p of cursor) {
    stats.scanned++;
    const price = p.price || 0;
    const hasReg = typeof p.regularPrice === 'number' && p.regularPrice > 0;

    if (!hasReg) {
      stats.skippedNoReg++;
      // Flag the buggy admin-import shape: looks like the selling price IS the regular
      // price (originalPrice present and == price) with no recoverable sale price.
      if (typeof p.originalPrice === 'number' && approxEqual(p.originalPrice, price)) {
        stats.suspect.push({ sku: p.sku || '(no sku)', name: p.name, price });
      }
      continue;
    }

    const desired = p.regularPrice > price ? p.regularPrice : null;
    const current = typeof p.originalPrice === 'number' ? p.originalPrice : null;

    if (approxEqual(current ?? -1, desired ?? -1) && (current === null) === (desired === null)) {
      stats.unchanged++;
      continue;
    }

    if (desired === null) {
      stats.cleared++;
      ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { originalPrice: null } } } });
    } else {
      stats.setBadge++;
      ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { originalPrice: desired } } } });
    }
  }

  if (APPLY && ops.length) {
    // Batch to keep memory + a single huge bulkWrite in check.
    const BATCH = 500;
    for (let i = 0; i < ops.length; i += BATCH) {
      await Product.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    }
  }

  console.log('--- Summary ---');
  console.log(`scanned            : ${stats.scanned}`);
  console.log(`badge set          : ${stats.setBadge}  (originalPrice ← regularPrice)`);
  console.log(`stale cleared      : ${stats.cleared}   (originalPrice → null)`);
  console.log(`already correct    : ${stats.unchanged}`);
  console.log(`skipped (no regPr) : ${stats.skippedNoReg}`);
  console.log(`suspect overcharge : ${stats.suspect.length} (no regularPrice, originalPrice == price)`);

  if (stats.suspect.length) {
    console.log('\n--- Suspect overcharge SKUs (re-sync from WooCommerce; price NOT modified) ---');
    for (const s of stats.suspect.slice(0, 200)) {
      console.log(`  ${s.sku}\t₹${s.price}\t${s.name}`);
    }
    if (stats.suspect.length > 200) console.log(`  …and ${stats.suspect.length - 200} more`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] ${ops.length} product(s) would be updated. Re-run with --apply to write.`);
  } else {
    console.log(`\n[APPLIED] ${ops.length} product(s) updated.`);
    console.log('Next: `npm run reindex-products` and flush Redis route:* / public:* caches.');
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill-original-price] failed:', err);
  process.exit(1);
});
