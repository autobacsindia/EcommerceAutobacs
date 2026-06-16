/**
 * CLI: WooCommerce → MongoDB + Cloudinary sync.
 *
 *   node scripts/migrate-from-wordpress.js              # full sync
 *   node scripts/migrate-from-wordpress.js --dry-run    # counts only, no writes
 *   node scripts/migrate-from-wordpress.js --no-images  # skip Cloudinary image phase
 *
 * Thin wrapper around services/wordpressSyncService.js (the shared logic the
 * scheduled cron also uses). Idempotent + non-destructive — safe to re-run.
 * Requires MONGO_URI (or MONGODB_URI), WORDPRESS_SITE_URL/API_KEY/API_SECRET,
 * and optionally the CLOUDINARY_* vars for image migration.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import { runWordPressSync } from '../services/wordpressSyncService.js';

const dryRun = process.argv.includes('--dry-run');
const withImages = !process.argv.includes('--no-images');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('✗ Missing MONGO_URI (or MONGODB_URI)');
  process.exit(1);
}

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`✓ Connected to MongoDB${dryRun ? ' (DRY RUN — no writes)' : ''}\n`);
  let ok = false;
  try {
    ({ ok } = await runWordPressSync({ dryRun, withImages, logger: console }));
  } catch (err) {
    console.error('✗ Sync failed:', err.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
