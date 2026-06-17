/**
 * CLI: WordPress blog posts → Mongo Article (ADR-005).
 *
 *   node scripts/import-wp-posts.js            # DRY RUN — counts only, no writes (default)
 *   node scripts/import-wp-posts.js --apply    # write articles
 *
 * Thin wrapper around services/wordpressPostImportService.js. Idempotent +
 * non-destructive (upsert on wpId) — safe to re-run. Skips WordPress pages.
 * Requires MONGO_URI (or MONGODB_URI) and WORDPRESS_SITE_URL.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import { runPostImport } from '../services/wordpressPostImportService.js';

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
    ({ ok } = await runPostImport({ dryRun, logger: console }));
  } catch (err) {
    console.error('✗ Post import failed:', err.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
