/**
 * CLI: WooCommerce orders → Mongo Order (ADR-005). Historical, read-only orders that
 * feed the sales/marketing dashboard.
 *
 *   node scripts/import-wp-orders.js            # DRY RUN — counts only, no writes (default)
 *   node scripts/import-wp-orders.js --apply    # write orders
 *
 * Thin wrapper around services/wordpressOrderImportService.js. Idempotent +
 * non-destructive (upsert on wpId) — safe to re-run. Run import-wp-customers.js first
 * so orders can link to migrated users by wpId.
 * Requires MONGO_URI (or MONGODB_URI) and WORDPRESS_SITE_URL/API_KEY/API_SECRET.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import { runOrderImport } from '../services/wordpressOrderImportService.js';

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
    ({ ok } = await runOrderImport({ dryRun, logger: console }));
  } catch (err) {
    console.error('✗ Order import failed:', err.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
