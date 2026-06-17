/**
 * CLI: WooCommerce product reviews → Mongo Review (ADR-005).
 *
 *   node scripts/import-wp-reviews.js            # DRY RUN — counts only, no writes (default)
 *   node scripts/import-wp-reviews.js --apply    # write reviews
 *
 * Thin wrapper around services/wordpressReviewImportService.js. Idempotent +
 * non-destructive (upsert on wpId) — safe to re-run. Recomputes product rating averages.
 * Requires MONGO_URI (or MONGODB_URI) and WORDPRESS_SITE_URL/API_KEY/API_SECRET.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import { runReviewImport } from '../services/wordpressReviewImportService.js';

const dryRun = !process.argv.includes('--apply');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('✗ Missing MONGO_URI (or MONGODB_URI)');
  process.exit(1);
}

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`✓ Connected to MongoDB${dryRun ? ' (DRY RUN — pass --apply to write)' : ''}\n`);
  let ok = false;
  try {
    ({ ok } = await runReviewImport({ dryRun, logger: console }));
  } catch (err) {
    console.error('✗ Review import failed:', err.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
