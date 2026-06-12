/**
 * One-time migration: WooCommerce → MongoDB + Cloudinary
 *
 * Run BEFORE removing the WordPress integration from the app:
 *   node scripts/migrate-from-wordpress.js
 *
 * What it does:
 *   1. Fetches all published products from WooCommerce and upserts them into MongoDB
 *   2. Fetches all product categories from WooCommerce and upserts them into MongoDB
 *   3. Downloads any product/brand/category images that aren't on Cloudinary yet
 *      and uploads them, replacing the WordPress URLs in MongoDB
 *
 * Safe to re-run — every operation is idempotent (upsert / skip-if-already-done).
 * Requires these env vars — accepts either naming convention:
 *   MONGO_URI or MONGODB_URI
 *   WORDPRESS_SITE_URL or WOOCOMMERCE_BASE_URL
 *   WORDPRESS_API_KEY or WOOCOMMERCE_CONSUMER_KEY
 *   WORDPRESS_API_SECRET or WOOCOMMERCE_CONSUMER_SECRET
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (optional — skips image migration if absent)
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import axios from 'axios';
import https from 'https';
import http from 'http';
import { v2 as cloudinary } from 'cloudinary';

import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';

// ── Env normalisation (accept both naming conventions) ───────────────────────
// Railway may have WOOCOMMERCE_* names; script also accepts WORDPRESS_* aliases.
const MONGO_URI     = process.env.MONGO_URI            || process.env.MONGODB_URI;
const WP_SITE_URL   = process.env.WORDPRESS_SITE_URL   || process.env.WOOCOMMERCE_BASE_URL;
const WP_API_KEY    = process.env.WORDPRESS_API_KEY    || process.env.WOOCOMMERCE_CONSUMER_KEY;
const WP_API_SECRET = process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET;

if (!MONGO_URI || !WP_SITE_URL || !WP_API_KEY || !WP_API_SECRET) {
  console.error('✗ Missing required env vars. Set at least one of each pair:');
  if (!MONGO_URI)     console.error('  MONGO_URI or MONGODB_URI');
  if (!WP_SITE_URL)   console.error('  WORDPRESS_SITE_URL or WOOCOMMERCE_BASE_URL');
  if (!WP_API_KEY)    console.error('  WORDPRESS_API_KEY or WOOCOMMERCE_CONSUMER_KEY');
  if (!WP_API_SECRET) console.error('  WORDPRESS_API_SECRET or WOOCOMMERCE_CONSUMER_SECRET');
  process.exit(1);
}

const hasCloudinary = process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (!hasCloudinary) {
  console.warn('⚠  Cloudinary env vars not set — image migration will be skipped.');
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// ── WooCommerce client ───────────────────────────────────────────────────────
const WC_BASE = WP_SITE_URL.replace(/\/$/, '');
const WC_VERSION = process.env.WORDPRESS_API_VERSION || 'wc/v3';

const wcClient = axios.create({
  baseURL: `${WC_BASE}/wp-json`,
  auth: {
    username: WP_API_KEY,
    password: WP_API_SECRET,
  },
  timeout: 60000,
});

// ── Stats ────────────────────────────────────────────────────────────────────
const stats = {
  products:   { fetched: 0, inserted: 0, updated: 0, failed: 0 },
  categories: { fetched: 0, inserted: 0, updated: 0, failed: 0 },
  images:     { total: 0, migrated: 0, skipped: 0, failed: 0 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
async function wcGetAll(endpoint, params = {}) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await wcClient.get(`/${WC_VERSION}/${endpoint}`, {
      params: { per_page: 100, page, ...params },
    });
    items.push(...res.data);
    if (res.data.length < 100) break;
    page++;
    await new Promise(r => setTimeout(r, 200)); // respect WC rate limits
  }
  return items;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Phase 1: Products ────────────────────────────────────────────────────────
async function migrateProducts() {
  console.log('\n════════════════════════════════════════');
  console.log('PHASE 1 — Products');
  console.log('════════════════════════════════════════');

  let wcProducts;
  try {
    console.log('Fetching products from WooCommerce...');
    wcProducts = await wcGetAll('products', { status: 'publish' });
    stats.products.fetched = wcProducts.length;
    console.log(`Fetched ${wcProducts.length} products from WooCommerce.`);
  } catch (err) {
    console.error(`✗ WooCommerce product fetch failed: ${err.message}`);
    return;
  }

  for (const wc of wcProducts) {
    if (!wc.id || !wc.name) {
      console.warn(`  Skipping invalid product (id=${wc.id})`);
      stats.products.failed++;
      continue;
    }

    try {
      const slug = wc.slug || slugify(wc.name);

      const data = {
        wpId: wc.id,
        wpSlug: wc.slug,
        syncedFromWordPress: true,
        lastSyncedAt: new Date(),

        name: wc.name,
        slug,
        description: wc.description || '',
        shortDescription: wc.short_description || '',
        price: parseFloat(wc.price) || 0,
        salePrice: wc.sale_price ? parseFloat(wc.sale_price) : undefined,
        regularPrice: wc.regular_price ? parseFloat(wc.regular_price) : undefined,
        stock: wc.stock_quantity ?? 0,
        sku: wc.sku || undefined,
        isActive: wc.status === 'publish',

        images: (wc.images || []).map(img => ({
          url: img.src,
          alt: img.alt || wc.name,
          public_id: `wp_${img.id}`,
        })),

        categoryIds: (wc.categories || []).map(c => c.id),
        tags: (wc.tags || []).map(t => t.name),
      };

      // Look up by wpId (re-runs) OR slug (existing docs that predate this migration).
      // Update by _id to avoid re-triggering the slug unique-index on upsert.
      const existingDoc = await Product.findOne({ $or: [{ wpId: wc.id }, { slug }] });
      if (existingDoc) {
        await Product.findByIdAndUpdate(existingDoc._id, { $set: data });
        stats.products.updated++;
      } else {
        await new Product(data).save();
        stats.products.inserted++;
      }
    } catch (err) {
      console.error(`  ✗ Product [${wc.id}] "${wc.name}": ${err.message}`);
      stats.products.failed++;
    }
  }

  console.log(`Products done — inserted: ${stats.products.inserted}, updated: ${stats.products.updated}, failed: ${stats.products.failed}`);
}

// ── Phase 2: Categories ──────────────────────────────────────────────────────
async function migrateCategories() {
  console.log('\n════════════════════════════════════════');
  console.log('PHASE 2 — Categories');
  console.log('════════════════════════════════════════');

  let wcCategories;
  try {
    console.log('Fetching categories from WooCommerce...');
    wcCategories = await wcGetAll('products/categories');
    stats.categories.fetched = wcCategories.length;
    console.log(`Fetched ${wcCategories.length} categories from WooCommerce.`);
  } catch (err) {
    console.error(`✗ WooCommerce category fetch failed: ${err.message}`);
    return;
  }

  for (const wc of wcCategories) {
    try {
      // Look up by wpId (re-runs) OR name (existing docs that predate this migration).
      const existingDoc = await Category.findOne({ $or: [{ wpId: wc.id }, { name: wc.name }] });

      const data = {
        wpId: wc.id,
        name: wc.name,
        slug: wc.slug || slugify(wc.name),
        description: wc.description || '',
        syncedFromWordPress: true,
        lastSyncedAt: new Date(),
        isActive: true,
        ...(wc.image?.src && !existingDoc?.image?.public_id && {
          image: { url: wc.image.src, public_id: '' },
        }),
      };

      if (existingDoc) {
        await Category.findByIdAndUpdate(existingDoc._id, { $set: data });
        stats.categories.updated++;
      } else {
        await new Category(data).save();
        stats.categories.inserted++;
      }
    } catch (err) {
      console.error(`  ✗ Category [${wc.id}] "${wc.name}": ${err.message}`);
      stats.categories.failed++;
    }
  }

  console.log(`Categories done — inserted: ${stats.categories.inserted}, updated: ${stats.categories.updated}, failed: ${stats.categories.failed}`);
}

// ── Phase 3: Image migration ─────────────────────────────────────────────────
const downloadBuffer = (url) =>
  new Promise((resolve, reject) => {
    if (!url?.startsWith('http')) return reject(new Error(`Not a valid URL: "${url}"`));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { timeout: 15000 }, (res) => {
      if ([301, 302].includes(res.statusCode) && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });

// publicId must be deterministic so re-runs overwrite the same Cloudinary asset
// instead of creating autobacs-img_1, autobacs-img_2 duplicates.
const uploadBuffer = (buffer, publicId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id:   publicId,
        overwrite:   true,      // idempotent re-runs: same asset, no duplicates
        invalidate:  true,      // purge CDN cache when overwriting
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        transformation: [{ fetch_format: 'auto', quality: 'auto' }],
      },
      (err, result) => err ? reject(err) : resolve({ url: result.secure_url, public_id: result.public_id })
    );
    stream.end(buffer);
  });

async function migrateImages() {
  if (!hasCloudinary) {
    console.log('\n════════════════════════════════════════');
    console.log('PHASE 3 — Images (SKIPPED — no Cloudinary config)');
    console.log('════════════════════════════════════════');
    return;
  }

  console.log('\n════════════════════════════════════════');
  console.log('PHASE 3 — Images → Cloudinary');
  console.log('════════════════════════════════════════');

  // Products
  const products = await Product.find({
    'images.0': { $exists: true },
    $or: [{ 'images.public_id': { $exists: false } }, { 'images.public_id': '' }, { 'images.public_id': /^wp_/ }],
  }).select('_id name images');

  console.log(`Found ${products.length} products with un-migrated images.`);
  stats.images.total += products.length;

  for (const product of products) {
    let changed = false;
    for (let i = 0; i < product.images.length; i++) {
      const img = product.images[i];
      if (img.public_id && !img.public_id.startsWith('wp_') && img.url?.includes('res.cloudinary.com')) {
        stats.images.skipped++;
        continue;
      }
      if (!img.url?.startsWith('http')) { stats.images.skipped++; continue; }
      try {
        const buf = await downloadBuffer(img.url);
        // Deterministic public_id → overwrite: true makes re-runs safe
        const publicId = `autobacs/products/${product._id}/img-${i}`;
        const result = await uploadBuffer(buf, publicId);
        product.images[i].url = result.url;
        product.images[i].public_id = result.public_id;
        changed = true;
        stats.images.migrated++;
      } catch (err) {
        console.error(`  ✗ Product [${product._id}] image[${i}]: ${err.message}`);
        stats.images.failed++;
      }
    }
    if (changed) await product.save();
  }

  // Categories
  const categories = await Category.find({
    'image.url': { $exists: true, $ne: '' },
    $or: [{ 'image.public_id': { $exists: false } }, { 'image.public_id': '' }, { 'image.public_id': null }],
  }).select('_id name image');

  console.log(`Found ${categories.length} categories with un-migrated images.`);
  stats.images.total += categories.length;

  for (const cat of categories) {
    if (!cat.image?.url?.startsWith('http')) { stats.images.skipped++; continue; }
    try {
      const buf = await downloadBuffer(cat.image.url);
      const result = await uploadBuffer(buf, `autobacs/categories/${cat._id}`);
      cat.image.url = result.url;
      cat.image.public_id = result.public_id;
      await cat.save();
      stats.images.migrated++;
    } catch (err) {
      console.error(`  ✗ Category [${cat._id}] "${cat.name}": ${err.message}`);
      stats.images.failed++;
    }
  }

  // Brands
  const brands = await Brand.find({
    $or: [
      { logo: { $type: 'string', $ne: '' } },
      { 'logo.url': { $exists: true, $ne: '' }, 'logo.public_id': { $in: ['', null] } },
    ],
  }).select('_id name logo');

  console.log(`Found ${brands.length} brands with un-migrated logos.`);
  stats.images.total += brands.length;

  for (const brand of brands) {
    const url = typeof brand.logo === 'string' ? brand.logo : brand.logo?.url;
    if (!url?.startsWith('http')) { stats.images.skipped++; continue; }
    if (url.includes('res.cloudinary.com') && brand.logo?.public_id) { stats.images.skipped++; continue; }
    try {
      const buf = await downloadBuffer(url);
      const result = await uploadBuffer(buf, `autobacs/brands/${brand._id}`);
      brand.logo = { url: result.url, public_id: result.public_id };
      await brand.save();
      stats.images.migrated++;
    } catch (err) {
      console.error(`  ✗ Brand [${brand._id}] "${brand.name}": ${err.message}`);
      stats.images.failed++;
    }
  }

  console.log(`Images done — migrated: ${stats.images.migrated}, skipped: ${stats.images.skipped}, failed: ${stats.images.failed}`);
}

// ── Phase 4: Verification ────────────────────────────────────────────────────
// Returns true if verification passed, false if it failed.
// Caller is responsible for process.exit(1) so the connection can be closed first.
async function verify() {
  console.log('\n════════════════════════════════════════');
  console.log('PHASE 4 — Verification');
  console.log('════════════════════════════════════════');

  const wpHost = WC_BASE.replace(/^https?:\/\//, '');

  // Note: MongoDB stores images as { url, public_id, alt } — field is "url", not "src"
  const wpImageCount = await Product.countDocuments({
    'images.url': { $regex: wpHost.replace('.', '\\.'), $options: 'i' },
  });

  const wpPlaceholderCount = await Product.countDocuments({
    'images.public_id': { $regex: '^wp_' },
  });

  const totalProducts = await Product.countDocuments({});
  const syncedProducts = await Product.countDocuments({ syncedFromWordPress: true });

  console.log(`Total products in MongoDB : ${totalProducts}`);
  console.log(`Synced from WooCommerce   : ${syncedProducts}`);
  console.log(`Images still on WP domain : ${wpImageCount}  ← should be 0`);
  console.log(`Images with wp_ public_id : ${wpPlaceholderCount}  ← should be 0`);

  if (wpImageCount > 0 || wpPlaceholderCount > 0) {
    console.error('\nMigration incomplete:');
    if (wpImageCount > 0)
      console.error(`  ${wpImageCount} product(s) still referencing WordPress images`);
    if (wpPlaceholderCount > 0)
      console.error(`  ${wpPlaceholderCount} product(s) with unprocessed Cloudinary uploads`);
    console.error('Re-run the script to retry failed items (all operations are idempotent).');
    return false;
  }

  console.log('\n✓ Verification passed. WordPress dependency fully retired.');
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('=== WordPress → MongoDB Migration ===');
  console.log(`MongoDB: ${MONGO_URI?.replace(/\/\/.*@/, '//***@')}`);
  console.log(`WooCommerce: ${WC_BASE}`);
  console.log(`Cloudinary: ${hasCloudinary ? 'enabled' : 'disabled (images will not be migrated)'}`);

  await mongoose.connect(MONGO_URI);
  console.log('✓ Connected to MongoDB\n');

  const t0 = Date.now();

  await migrateProducts();
  await migrateCategories();
  await migrateImages();
  const verified = await verify();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n════════════════════════════════════════');
  console.log('MIGRATION SUMMARY');
  console.log('════════════════════════════════════════');
  console.log(`Products   — fetched: ${stats.products.fetched} | inserted: ${stats.products.inserted} | updated: ${stats.products.updated} | failed: ${stats.products.failed}`);
  console.log(`Categories — fetched: ${stats.categories.fetched} | inserted: ${stats.categories.inserted} | updated: ${stats.categories.updated} | failed: ${stats.categories.failed}`);
  console.log(`Images     — total: ${stats.images.total} | migrated: ${stats.images.migrated} | skipped: ${stats.images.skipped} | failed: ${stats.images.failed}`);
  console.log(`\nCompleted in ${elapsed}s`);

  await mongoose.connection.close();

  // Non-zero exit code so CI/shell knows not to proceed to DNS cutover
  if (!verified) process.exit(1);
  process.exit(0);
}

run().catch(err => {
  console.error('✗ Migration failed:', err.message);
  mongoose.connection.close();
  process.exit(1);
});
