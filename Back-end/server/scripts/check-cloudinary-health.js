/**
 * Cloudinary Health Check - Monitor Missing public_ids
 * 
 * Purpose: Detect products with missing Cloudinary public_ids
 * that would prevent proper image cleanup.
 * 
 * Usage:
 *   npm run check-cloudinary-health
 * 
 * Can be run as:
 *   - Cron job (daily)
 *   - Deploy health check
 *   - Manual monitoring
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';

dotenv.config();

async function checkCloudinaryHealth() {
  console.log('='.repeat(60));
  console.log('Cloudinary Health Check');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  if (!process.env.MONGODB_URI) {
    console.error('[ERROR] MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    // Count products with missing public_id
    const productsWithMissingIds = await Product.countDocuments({
      images: { $elemMatch: { public_id: { $exists: false } } }
    });

    // Count total images missing public_id
    const products = await Product.find({
      images: { $elemMatch: { public_id: { $exists: false } } }
    }).select('images');

    let totalImagesMissing = 0;
    products.forEach(product => {
      product.images.forEach(img => {
        if (!img.public_id) {
          totalImagesMissing++;
        }
      });
    });

    // Total products and images
    const totalProducts = await Product.countDocuments();
    const totalImages = await Product.aggregate([
      { $unwind: '$images' },
      { $count: 'total' }
    ]);

    console.log('METRICS:');
    console.log(`  Total products:           ${totalProducts}`);
    console.log(`  Total images:             ${totalImages[0]?.total || 0}`);
    console.log(`  Products with missing ID: ${productsWithMissingIds}`);
    console.log(`  Images missing public_id: ${totalImagesMissing}`);
    console.log('');

    // Health status
    if (productsWithMissingIds === 0) {
      console.log('✅ HEALTHY: All Cloudinary images have public_id');
      console.log('   Image cleanup will work properly.');
      console.log('   Estimated storage cost: ~$50/month');
    } else {
      const percentage = ((productsWithMissingIds / totalProducts) * 100).toFixed(2);
      console.log(`⚠️  WARNING: ${productsWithMissingIds} products (${percentage} percent) have missing public_id`);
      console.log(`   ${totalImagesMissing} images cannot be cleaned up`);
      console.log('');
      console.log('   IMPACT:');
      console.log(`   - Orphaned images accumulating in Cloudinary`);
      console.log(`   - Estimated extra cost: $${(totalImagesMissing * 0.01).toFixed(2)}/month`);
      console.log('');
      console.log('   ACTION REQUIRED:');
      console.log('   1. Run: npm run backfill-cloudinary-ids');
      console.log('   2. Monitor: npm run check-cloudinary-health');
      
      // Exit with error code for CI/CD alerts
      process.exitCode = 1;
    }

    console.log('\n' + '='.repeat(60));

  } catch (err) {
    console.error('[FATAL] Health check failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run
checkCloudinaryHealth().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
