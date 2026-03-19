/**
 * Migration Script: Upload existing product/brand/category images to Cloudinary
 *
 * What it does:
 *   1. Connects to MongoDB
 *   2. Finds all products / brands / categories whose images lack a public_id
 *      (i.e. they were created before the Cloudinary integration)
 *   3. Downloads each image URL (http/https)
 *   4. Uploads the buffer to Cloudinary
 *   5. Updates the MongoDB document with new { url, public_id }
 *
 * Run once:
 *   node scripts/migrateImagesToCloudinary.js
 *
 * Safe to re-run — skips items that already have a public_id.
 * Logs every action so you can see exactly what happened.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import https from 'https';
import http from 'http';
import { v2 as cloudinary } from 'cloudinary';

// ── Cloudinary config ────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

// ── MongoDB models (inline — avoids importing the full app) ─────────────────
import Product  from '../models/Product.js';
import Brand    from '../models/Brand.js';
import Category from '../models/Category.js';

// ── Stats tracker ────────────────────────────────────────────────────────────
const stats = {
  products:   { total: 0, migrated: 0, skipped: 0, failed: 0 },
  brands:     { total: 0, migrated: 0, skipped: 0, failed: 0 },
  categories: { total: 0, migrated: 0, skipped: 0, failed: 0 },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Download a URL into a Buffer. Follows one redirect. */
const downloadBuffer = (url) =>
  new Promise((resolve, reject) => {
    if (!url || !url.startsWith('http')) {
      return reject(new Error(`Not a valid http URL: "${url}"`));
    }

    const lib = url.startsWith('https') ? https : http;

    lib.get(url, { timeout: 15000 }, (res) => {
      // Follow redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error(`Timeout downloading ${url}`)));
  });

/** Upload a Buffer to Cloudinary, return { secure_url, public_id } */
const uploadBuffer = (buffer, folder) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'],
        transformation: [{ fetch_format: 'auto', quality: 'auto' }],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.end(buffer);
  });

/** Download + upload one URL, return Cloudinary result */
const migrateUrl = async (url, folder, label) => {
  console.log(`  ↓ Downloading: ${url}`);
  const buffer = await downloadBuffer(url);
  console.log(`  ↑ Uploading to Cloudinary (${folder})...`);
  const result = await uploadBuffer(buffer, folder);
  console.log(`  ✓ ${label}: ${result.public_id}`);
  return result;
};

// ────────────────────────────────────────────────────────────────────────────
// Product migration
// ────────────────────────────────────────────────────────────────────────────
const migrateProducts = async () => {
  console.log('\n════════════════════════════════════════');
  console.log('PRODUCTS');
  console.log('════════════════════════════════════════');

  // Find products that have at least one image without a public_id
  const products = await Product.find({
    'images.0': { $exists: true },
    $or: [
      { 'images.public_id': { $exists: false } },
      { 'images.public_id': '' },
      { 'images.public_id': null },
    ],
  }).select('_id name images');

  stats.products.total = products.length;
  console.log(`Found ${products.length} products with un-migrated images.\n`);

  for (const product of products) {
    console.log(`Product [${product._id}] "${product.name}"`);
    let changed = false;

    for (let i = 0; i < product.images.length; i++) {
      const img = product.images[i];

      // Skip already migrated
      if (img.public_id && img.public_id.trim() !== '') {
        console.log(`  [${i}] Already has public_id, skipping.`);
        continue;
      }

      if (!img.url || !img.url.startsWith('http')) {
        console.warn(`  [${i}] No valid URL ("${img.url}"), skipping.`);
        stats.products.skipped++;
        continue;
      }

      try {
        const folder = `autobacs/products/${product._id}`;
        const { secure_url, public_id } = await migrateUrl(
          img.url, folder, `product image[${i}]`
        );
        product.images[i].url       = secure_url;
        product.images[i].public_id = public_id;
        changed = true;
      } catch (err) {
        console.error(`  ✗ Failed image[${i}]: ${err.message}`);
        stats.products.failed++;
      }
    }

    if (changed) {
      await product.save();
      console.log(`  ✓ Saved product ${product._id}\n`);
      stats.products.migrated++;
    } else {
      stats.products.skipped++;
    }
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Brand migration
// ────────────────────────────────────────────────────────────────────────────
const migrateBrands = async () => {
  console.log('\n════════════════════════════════════════');
  console.log('BRANDS');
  console.log('════════════════════════════════════════');

  // Handle both old logo:String and new logo:{ url, public_id }
  const brands = await Brand.find({
    $or: [
      // Old schema — logo is a plain string URL
      { logo: { $type: 'string', $ne: '' } },
      // New schema — object but no public_id yet
      { 'logo.url': { $exists: true, $ne: '' }, 'logo.public_id': '' },
      { 'logo.url': { $exists: true, $ne: '' }, 'logo.public_id': null },
    ],
  }).select('_id name logo');

  stats.brands.total = brands.length;
  console.log(`Found ${brands.length} brands with un-migrated logos.\n`);

  for (const brand of brands) {
    console.log(`Brand [${brand._id}] "${brand.name}"`);

    // Determine current URL (works for both old String and new object)
    const currentUrl = typeof brand.logo === 'string'
      ? brand.logo
      : brand.logo?.url;

    if (!currentUrl || !currentUrl.startsWith('http')) {
      console.warn(`  No valid URL ("${currentUrl}"), skipping.`);
      stats.brands.skipped++;
      continue;
    }

    // Skip if already on Cloudinary
    if (currentUrl.includes('res.cloudinary.com') && brand.logo?.public_id) {
      console.log('  Already on Cloudinary, skipping.');
      stats.brands.skipped++;
      continue;
    }

    try {
      const { secure_url, public_id } = await migrateUrl(
        currentUrl, 'autobacs/brands', `brand logo`
      );
      brand.logo = { url: secure_url, public_id };
      await brand.save();
      console.log(`  ✓ Saved brand ${brand._id}\n`);
      stats.brands.migrated++;
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      stats.brands.failed++;
    }
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Category migration
// ────────────────────────────────────────────────────────────────────────────
const migrateCategories = async () => {
  console.log('\n════════════════════════════════════════');
  console.log('CATEGORIES');
  console.log('════════════════════════════════════════');

  const categories = await Category.find({
    'image.url': { $exists: true, $ne: '' },
    $or: [
      { 'image.public_id': { $exists: false } },
      { 'image.public_id': '' },
      { 'image.public_id': null },
    ],
  }).select('_id name image');

  stats.categories.total = categories.length;
  console.log(`Found ${categories.length} categories with un-migrated images.\n`);

  for (const cat of categories) {
    console.log(`Category [${cat._id}] "${cat.name}"`);

    if (!cat.image?.url || !cat.image.url.startsWith('http')) {
      console.warn(`  No valid URL ("${cat.image?.url}"), skipping.`);
      stats.categories.skipped++;
      continue;
    }

    try {
      const { secure_url, public_id } = await migrateUrl(
        cat.image.url, 'autobacs/categories', 'category image'
      );
      cat.image.url       = secure_url;
      cat.image.public_id = public_id;
      await cat.save();
      console.log(`  ✓ Saved category ${cat._id}\n`);
      stats.categories.migrated++;
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      stats.categories.failed++;
    }
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
const run = async () => {
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    console.error('✗ MONGODB_URI or MONGO_URI not set in .env');
    process.exit(1);
  }
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.error('✗ CLOUDINARY_CLOUD_NAME not set in .env');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

  console.log('=== Cloudinary Image Migration ===');
  console.log(`Connecting to MongoDB...`);

  await mongoose.connect(mongoUri);
  console.log('✓ Connected to MongoDB\n');

  const startTime = Date.now();

  await migrateProducts();
  await migrateBrands();
  await migrateCategories();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n════════════════════════════════════════');
  console.log('MIGRATION SUMMARY');
  console.log('════════════════════════════════════════');
  console.log(`Products   — total: ${stats.products.total} | migrated: ${stats.products.migrated} | skipped: ${stats.products.skipped} | failed: ${stats.products.failed}`);
  console.log(`Brands     — total: ${stats.brands.total} | migrated: ${stats.brands.migrated} | skipped: ${stats.brands.skipped} | failed: ${stats.brands.failed}`);
  console.log(`Categories — total: ${stats.categories.total} | migrated: ${stats.categories.migrated} | skipped: ${stats.categories.skipped} | failed: ${stats.categories.failed}`);
  console.log(`\nCompleted in ${elapsed}s`);

  await mongoose.connection.close();
  console.log('✓ MongoDB connection closed');
  process.exit(0);
};

run().catch((err) => {
  console.error('✗ Migration failed:', err.message);
  mongoose.connection.close();
  process.exit(1);
});
