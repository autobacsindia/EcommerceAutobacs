/**
 * Run a full WooCommerce → Mongo sync on demand (the same routine the 3-hour cron
 * runs via services/cronService.js → runWordPressSync). This is the authoritative
 * way to make product data — price AND the discount-badge `originalPrice` — match
 * WooCommerce, because it re-pulls every product from the source of truth.
 *
 * Why this exists: the admin endpoints POST /import/wordpress/full and
 * GET /import/wordpress/preview call the RETIRED ProductImportService (every method
 * throws). The only live full-sync path is runWordPressSync. This wraps it as a CLI
 * so it can be triggered without waiting for the cron.
 *
 * Dry-run by default (computes counts, writes nothing, skips Cloudinary). Pass --apply
 * to write. Pass --no-images to skip Cloudinary image migration on an apply run.
 *
 * Usage (must run where WooCommerce + Mongo creds exist — i.e. prod env):
 *   railway run node --import=dotenv/config scripts/run-wordpress-sync.js            # dry run
 *   railway run node --import=dotenv/config scripts/run-wordpress-sync.js --apply    # write
 *   railway run node --import=dotenv/config scripts/run-wordpress-sync.js --apply --no-images
 *
 * After an --apply run, refresh read paths:
 *   npm run reindex-products            # originalPrice/price are ES-indexed
 *   # flush Redis route:* / public:* keys
 *
 * Requires MONGODB_URI (or MONGO_URI) + WooCommerce API config in the environment.
 */

import mongoose from 'mongoose';
import { runWordPressSync } from '../services/wordpressSyncService.js';

const APPLY = process.argv.includes('--apply');
const WITH_IMAGES = !process.argv.includes('--no-images');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(
    `[run-wordpress-sync] connected. mode=${APPLY ? 'APPLY' : 'DRY-RUN'} withImages=${APPLY ? WITH_IMAGES : false}\n`
  );

  // dryRun computes counts and writes nothing (and skips image migration internally).
  const { ok, stats, durationMs } = await runWordPressSync({
    dryRun: !APPLY,
    withImages: WITH_IMAGES,
    logger: console,
  });

  console.log('\n--- Sync result ---');
  console.log(`ok            : ${ok}`);
  console.log(`durationMs    : ${durationMs}`);
  console.log(`products      : inserted=${stats.products.inserted} updated=${stats.products.updated} failed=${stats.products.failed}`);
  if (stats.categories) {
    console.log(`categories    : inserted=${stats.categories.inserted} updated=${stats.categories.updated} failed=${stats.categories.failed}`);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] Nothing was written. Re-run with --apply to sync for real.');
  } else {
    console.log('\n[APPLIED] Sync complete. Next: `npm run reindex-products` and flush Redis route:* / public:* caches.');
  }

  await mongoose.connection.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[run-wordpress-sync] failed:', err);
  process.exit(1);
});
