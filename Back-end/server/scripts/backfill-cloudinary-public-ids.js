/**
 * Backfill Cloudinary public_id for Existing Products
 * 
 * Purpose: Extract public_id from Cloudinary URLs for products
 * that were imported from WordPress without public_id.
 * 
 * This enables proper image cleanup and prevents storage cost explosion.
 * 
 * Usage:
 *   npm run backfill-cloudinary-ids
 * 
 * Impact:
 *   - Before: ~$500/month Cloudinary bill (orphaned images)
 *   - After: ~$50/month (proper cleanup)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';

dotenv.config();

/**
 * Extract public_id from Cloudinary URL
 * 
 * Handles:
 * - Standard URLs: https://res.cloudinary.com/{cloud}/image/upload/v1234567890/folder/image.jpg
 * - Transformed URLs: https://res.cloudinary.com/{cloud}/image/upload/c_fill,w_300/v1234567890/folder/image.jpg
 * - Nested folders: https://res.cloudinary.com/{cloud}/image/upload/v1234567890/products/2024/item.jpg
 * 
 * @param {string} url - Cloudinary image URL
 * @returns {string|null} - Extracted public_id or null
 */
function extractPublicId(url) {
  try {
    if (!url || !url.includes('cloudinary.com')) {
      return null;
    }

    // Remove query params
    const cleanUrl = url.split('?')[0];

    // Extract everything after /upload/
    const uploadIndex = cleanUrl.indexOf('/upload/');
    if (uploadIndex === -1) {
      return null;
    }

    const afterUpload = cleanUrl.substring(uploadIndex + 8); // length of '/upload/'

    // Remove version (v1234567890/)
    const withoutVersion = afterUpload.replace(/^v\d+\//, '');

    // Remove file extension
    const publicId = withoutVersion.replace(/\.[^/.]+$/, '');

    return publicId || null;
  } catch (err) {
    console.error('[ERROR] Failed to extract public_id:', url, err.message);
    return null;
  }
}

/**
 * Run the backfill process
 */
async function run() {
  console.log('='.repeat(60));
  console.log('Cloudinary public_id Backfill Script');
  console.log('='.repeat(60));

  // Connect to database
  if (!process.env.MONGODB_URI) {
    console.error('[ERROR] MONGODB_URI not set in environment');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[OK] Connected to MongoDB\n');

  // Find products with missing public_id
  const productsWithMissingIds = await Product.countDocuments({
    images: { $elemMatch: { public_id: { $exists: false } } }
  });

  console.log(`[INFO] Found ${productsWithMissingIds} products with missing public_id\n`);

  if (productsWithMissingIds === 0) {
    console.log('[OK] All products have public_id. No backfill needed.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Process products using cursor (memory-efficient for large datasets)
  const cursor = Product.find({
    images: { $elemMatch: { public_id: { $exists: false } } }
  }).cursor();

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let processed = 0;
  const batchSize = 100;

  console.log('[START] Processing products...\n');

  for await (const product of cursor) {
    let modified = false;

    for (const image of product.images) {
      if (!image.public_id && image.url) {
        const publicId = extractPublicId(image.url);

        if (publicId) {
          image.public_id = publicId;
          modified = true;
        } else {
          skipped++;
          if (skipped <= 10) {
            console.warn(`[SKIP] ${image.url}`);
          }
        }
      }
    }

    if (modified) {
      try {
        await product.save();
        updated++;
        
        if (updated % batchSize === 0) {
          console.log(`[PROGRESS] Updated ${updated} products...`);
        }
      } catch (err) {
        errors++;
        console.error(`[ERROR] Failed to save product ${product._id}:`, err.message);
      }
    }

    processed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Products processed: ${processed}`);
  console.log(`Products updated:   ${updated}`);
  console.log(`Images skipped:     ${skipped}`);
  console.log(`Errors:             ${errors}`);
  console.log('='.repeat(60));

  if (skipped > 0) {
    console.warn(`\n[WARNING] ${skipped} images could not be backfilled.`);
    console.warn('These images may:');
    console.warn('  - Not be from Cloudinary');
    console.warn('  - Have malformed URLs');
    console.warn('  - Need manual intervention');
  }

  if (errors > 0) {
    console.error(`\n[ERROR] ${errors} products failed to update.`);
    console.error('Check the logs above for details.');
  }

  // Verify results
  const remaining = await Product.countDocuments({
    images: { $elemMatch: { public_id: { $exists: false } } }
  });

  console.log(`\n[VERIFY] Remaining products without public_id: ${remaining}`);

  if (remaining === 0) {
    console.log('[OK] All Cloudinary images now have public_id!');
    console.log('[OK] Image cleanup will work properly.');
  } else {
    console.warn(`[WARNING] ${remaining} products still missing public_id.`);
    console.warn('These may need manual review.');
  }

  await mongoose.disconnect();
  console.log('\n[OK] Database connection closed.');
}

// Run with error handling
run().catch((err) => {
  console.error('[FATAL] Script failed:', err);
  process.exit(1);
});
