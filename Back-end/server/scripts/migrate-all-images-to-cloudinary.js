/**
 * Unified image normalization: migrate every stray non-Cloudinary image URL → Cloudinary.
 *
 * After the WooCommerce → Mongo migration, image URLs are a mix: some point at Cloudinary,
 * some still point at the old WordPress CDN (autobacsindia.com/wp-content). Those WP URLs die
 * the moment WordPress is switched off. This script finds EVERY external (non-Cloudinary)
 * http(s) image URL across all collections, uploads it to Cloudinary, and rewrites the doc.
 *
 * Collections covered:
 *   Product.images[].url        (+ public_id)
 *   Brand.logo.url              (+ public_id)
 *   Category.image.url          (+ public_id)
 *   User.avatar.url             (+ public_id)
 *   Vehicle.image.url
 *   Review.images[].url
 *   MediaItem.url, .thumbnail   (images only — videos/embeds skipped)
 *   ReturnRequest.images[].url, .video.url
 *   Article  (coverImage + inline <img> in content) — delegated to the existing rehost service.
 *
 * NOT touched: Order item/return snapshots — those are immutable historical records.
 *
 * Usage (from Back-end/server/):
 *   node scripts/migrate-all-images-to-cloudinary.js            # AUDIT (dry run) — counts only
 *   node scripts/migrate-all-images-to-cloudinary.js --apply    # download + upload + rewrite
 *   node scripts/migrate-all-images-to-cloudinary.js --apply --only=vehicles,reviews
 *
 * Idempotent: URLs already on Cloudinary are skipped, so it is safe to re-run.
 * Requires MONGODB_URI (or MONGO_URI) and CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import https from 'https';
import http from 'http';
import { v2 as cloudinary } from 'cloudinary';

import Product       from '../models/Product.js';
import Brand         from '../models/Brand.js';
import Category      from '../models/Category.js';
import User          from '../models/User.js';
import Vehicle       from '../models/Vehicle.js';
import Review        from '../models/Review.js';
import MediaItem     from '../models/MediaItem.js';
import ReturnRequest from '../models/ReturnRequest.js';
import { runArticleImageRehost } from '../services/wordpressArticleImageService.js';

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const DRY   = !APPLY;
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null;
const want = (name) => !ONLY || ONLY.has(name);

// ── Cloudinary ───────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** True if url is an external http(s) image we should pull onto Cloudinary. */
const isExternalImage = (url) =>
  typeof url === 'string' &&
  /^https?:\/\//i.test(url) &&
  !url.includes('res.cloudinary.com');

const downloadBuffer = (url) =>
  new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { timeout: 20000 }, (res) => {
        if ([301, 302].includes(res.statusCode) && res.headers.location) {
          return downloadBuffer(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject)
      .on('timeout', () => reject(new Error('Timeout')));
  });

const uploadBuffer = (buffer, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'],
        transformation: [{ fetch_format: 'auto', quality: 'auto' }],
      },
      (err, result) =>
        err ? reject(err) : resolve({ url: result.secure_url, public_id: result.public_id })
    );
    stream.end(buffer);
  });

const stats = {};
const bump = (coll, key) => {
  stats[coll] ??= { found: 0, migrated: 0, failed: 0 };
  stats[coll][key]++;
};

/**
 * Migrate one external URL. In dry-run, just counts. Returns { url, public_id } or null on
 * failure / skip (dry run returns null so callers don't write).
 */
const migrate = async (coll, url, folder, label) => {
  if (!isExternalImage(url)) return null;
  bump(coll, 'found');
  if (DRY) {
    console.log(`  [audit] ${label}: ${url}`);
    return null;
  }
  try {
    console.log(`  ↓ ${label}: ${url}`);
    const buf = await downloadBuffer(url);
    const res = await uploadBuffer(buf, folder);
    console.log(`  ✓ → ${res.public_id}`);
    bump(coll, 'migrated');
    return res;
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    bump(coll, 'failed');
    return null;
  }
};

// ── Per-collection passes ─────────────────────────────────────────────────────

async function doProducts() {
  console.log('\n── Products ──');
  const docs = await Product.find({ images: { $elemMatch: { url: /^https?:\/\// } } })
    .select('_id name images');
  for (const d of docs) {
    let changed = false;
    for (let i = 0; i < d.images.length; i++) {
      const res = await migrate('products', d.images[i].url, `autobacs/products/${d._id}`, `product "${d.name}" [${i}]`);
      if (res) { d.images[i].url = res.url; d.images[i].public_id = res.public_id; changed = true; }
    }
    if (changed) await d.save();
  }
}

async function doBrands() {
  console.log('\n── Brands ──');
  // Use the native collection: legacy logos are stored as a plain string URL, which the
  // Mongoose object schema would mangle on load. Read raw, normalize to { url, public_id }.
  const coll = Brand.collection;
  const docs = await coll
    .find({ $or: [{ logo: { $type: 'string', $regex: '^https?://' } }, { 'logo.url': { $regex: '^https?://' } }] })
    .toArray();
  for (const d of docs) {
    const currentUrl = typeof d.logo === 'string' ? d.logo : d.logo?.url;
    const res = await migrate('brands', currentUrl, 'autobacs/brands', `brand "${d.name}"`);
    if (res) await coll.updateOne({ _id: d._id }, { $set: { logo: { url: res.url, public_id: res.public_id } } });
  }
}

async function doCategories() {
  console.log('\n── Categories ──');
  const docs = await Category.find({ 'image.url': /^https?:\/\// }).select('_id name image');
  for (const d of docs) {
    const res = await migrate('categories', d.image?.url, 'autobacs/categories', `category "${d.name}"`);
    if (res) { d.image.url = res.url; d.image.public_id = res.public_id; await d.save(); }
  }
}

async function doUsers() {
  console.log('\n── User avatars ──');
  const docs = await User.find({ 'avatar.url': /^https?:\/\// }).select('_id email avatar');
  for (const d of docs) {
    const res = await migrate('avatars', d.avatar?.url, 'autobacs/avatars', `avatar ${d.email}`);
    if (res) { d.avatar.url = res.url; d.avatar.public_id = res.public_id; await d.save(); }
  }
}

async function doVehicles() {
  console.log('\n── Vehicles ──');
  const docs = await Vehicle.find({ 'image.url': /^https?:\/\// }).select('_id name image');
  for (const d of docs) {
    const res = await migrate('vehicles', d.image?.url, 'autobacs/vehicles', `vehicle "${d.name}"`);
    if (res) { d.image.url = res.url; await d.save(); } // Vehicle.image has no public_id field
  }
}

async function doReviews() {
  console.log('\n── Reviews ──');
  const docs = await Review.find({ images: { $elemMatch: { url: /^https?:\/\// } } }).select('_id images');
  for (const d of docs) {
    let changed = false;
    for (let i = 0; i < d.images.length; i++) {
      const res = await migrate('reviews', d.images[i].url, `autobacs/reviews/${d._id}`, `review ${d._id} [${i}]`);
      if (res) { d.images[i].url = res.url; changed = true; }
    }
    if (changed) await d.save();
  }
}

async function doMediaItems() {
  console.log('\n── Media library (images only) ──');
  const docs = await MediaItem.find({ type: 'image' }).select('_id title url thumbnail');
  for (const d of docs) {
    let changed = false;
    const main = await migrate('media', d.url, `autobacs/media/${d._id}`, `media "${d.title}"`);
    if (main) { d.url = main.url; changed = true; }
    const thumb = await migrate('media', d.thumbnail, `autobacs/media/${d._id}`, `media thumb "${d.title}"`);
    if (thumb) { d.thumbnail = thumb.url; changed = true; }
    if (changed) await d.save();
  }
}

async function doReturnRequests() {
  console.log('\n── Return requests ──');
  const docs = await ReturnRequest.find({
    $or: [{ images: { $elemMatch: { url: /^https?:\/\// } } }, { 'video.url': /^https?:\/\// }],
  }).select('_id images video');
  for (const d of docs) {
    let changed = false;
    for (let i = 0; i < (d.images?.length || 0); i++) {
      const res = await migrate('returns', d.images[i].url, `autobacs/returns/${d._id}`, `return ${d._id} img[${i}]`);
      if (res) { d.images[i].url = res.url; changed = true; }
    }
    if (d.video?.url) {
      const res = await migrate('returns', d.video.url, `autobacs/returns/${d._id}`, `return ${d._id} video`);
      if (res) { d.video.url = res.url; changed = true; }
    }
    if (changed) await d.save();
  }
}

async function doArticles() {
  console.log('\n── Articles (cover + inline content) ──');
  const { stats: s } = await runArticleImageRehost({ dryRun: DRY, logger: console });
  stats.articles = {
    found:    s.coverRehosted + s.inlineRehosted,
    migrated: DRY ? 0 : s.coverRehosted + s.inlineRehosted,
    failed:   s.failed,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const PASSES = [
  ['products',   doProducts],
  ['brands',     doBrands],
  ['categories', doCategories],
  ['avatars',    doUsers],
  ['vehicles',   doVehicles],
  ['reviews',    doReviews],
  ['media',      doMediaItems],
  ['returns',    doReturnRequests],
  ['articles',   doArticles],
];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('✗ MONGODB_URI / MONGO_URI not set'); process.exit(1); }
  if (!process.env.CLOUDINARY_CLOUD_NAME) { console.error('✗ CLOUDINARY_CLOUD_NAME not set'); process.exit(1); }

  console.log(`=== Image normalization → Cloudinary ${DRY ? '(AUDIT / DRY RUN — pass --apply to migrate)' : '(APPLYING)'} ===`);
  if (ONLY) console.log(`Filtering to: ${[...ONLY].join(', ')}`);

  await mongoose.connect(uri);
  console.log('✓ Connected to MongoDB');

  const t0 = Date.now();
  for (const [name, fn] of PASSES) {
    if (want(name)) await fn();
  }

  console.log('\n════════════ SUMMARY ════════════');
  let totalFound = 0, totalFailed = 0;
  for (const [coll, s] of Object.entries(stats)) {
    console.log(`${coll.padEnd(12)} found(external): ${s.found}  migrated: ${s.migrated}  failed: ${s.failed}`);
    totalFound += s.found; totalFailed += s.failed;
  }
  console.log(`\n${DRY ? 'External URLs found' : 'Migrated'}: ${totalFound}  failed: ${totalFailed}  in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (DRY && totalFound > 0) console.log('Re-run with --apply to upload these to Cloudinary and rewrite the docs.');

  await mongoose.connection.close();
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('✗ Fatal:', err);
  mongoose.connection.close().catch(() => {});
  process.exit(1);
});
