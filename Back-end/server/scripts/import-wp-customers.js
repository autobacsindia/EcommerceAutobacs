/**
 * CLI: WooCommerce customers → Mongo User (ADR-005).
 *
 *   node scripts/import-wp-customers.js            # DRY RUN — counts only, no writes (default)
 *   node scripts/import-wp-customers.js --apply    # write users
 *
 * Thin wrapper around services/wordpressCustomerImportService.js. Idempotent +
 * non-destructive — safe to re-run. Passwords are NOT migrated; migrated users are
 * forced through password reset on first login.
 * Requires MONGO_URI (or MONGODB_URI) and WORDPRESS_SITE_URL/API_KEY/API_SECRET.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import { runCustomerImport } from '../services/wordpressCustomerImportService.js';

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
    ({ ok } = await runCustomerImport({ dryRun, logger: console }));
  } catch (err) {
    console.error('✗ Customer import failed:', err.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
