/**
 * CLI: rehost WordPress blog-post images → Cloudinary (ADR-005).
 *
 *   node scripts/rehost-wp-article-images.js            # DRY RUN — counts WP images (default)
 *   node scripts/rehost-wp-article-images.js --apply    # download + upload + rewrite URLs
 *
 * Thin wrapper around services/wordpressArticleImageService.js. Idempotent — images already
 * on Cloudinary are skipped, so it is safe to re-run.
 * Requires MONGO_URI (or MONGODB_URI), CLOUDINARY_* and (optionally) WORDPRESS_SITE_URL.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import { runArticleImageRehost } from '../services/wordpressArticleImageService.js';

const dryRun = !process.argv.includes('--apply');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('✗ Missing MONGO_URI (or MONGODB_URI)');
  process.exit(1);
}

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`✓ Connected to MongoDB${dryRun ? ' (DRY RUN — pass --apply to upload)' : ''}\n`);
  let ok = false;
  try {
    ({ ok } = await runArticleImageRehost({ dryRun, logger: console }));
  } catch (err) {
    console.error('✗ Article image rehost failed:', err.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
