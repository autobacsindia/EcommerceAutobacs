/**
 * Find and fix ALL products with corrupted slugs
 * This searches for slugs starting with "-" or containing only dashes/spaces
 */

import mongoose from 'mongoose';
import Product from '../../models/Product.js';

async function fixAllCorruptedSlugs() {
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs';
  
  console.log('[MongoDB] Connecting...');
  await mongoose.connect(mongoUrl);
  console.log('[MongoDB] Connected successfully\n');

  try {
    // Find ALL products
    const allProducts = await Product.find({});
    console.log(`Total products in database: ${allProducts.length}\n`);

    let fixedCount = 0;
    let noSlugCount = 0;
    
    for (const product of allProducts) {
      let needsFix = false;
      let reason = '';
      
      // Check for corrupted slug
      if (!product.slug) {
        needsFix = true;
        reason = 'No slug';
        noSlugCount++;
      } else if (product.slug.startsWith('-')) {
        needsFix = true;
        reason = `Starts with "-"`;
      } else if (product.slug.includes('%20')) {
        needsFix = true;
        reason = 'Contains %20';
      } else if (product.slug.trim() === '') {
        needsFix = true;
        reason = 'Empty/whitespace only';
      } else if (product.slug.startsWith('product-')) {
        needsFix = true;
        reason = 'Starts with "product-"';
      } else if (/^[-\s]+$/.test(product.slug)) {
        needsFix = true;
        reason = 'Only dashes/spaces';
      }
      
      if (needsFix) {
        console.log(`❌ ${product.name}`);
        console.log(`   ID: ${product._id}`);
        console.log(`   Current slug: "${product.slug}"`);
        console.log(`   Reason: ${reason}`);
        
        // Generate a proper slug from the name
        const newSlug = product.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        
        console.log(`   → New slug: "${newSlug}"`);
        
        // Check if new slug already exists
        const existingProduct = await Product.findOne({ slug: newSlug, _id: { $ne: product._id } });
        if (existingProduct) {
          console.log(`   ⚠️  Slug already exists for: ${existingProduct.name}`);
          // Add ID to make it unique
          const uniqueSlug = `${newSlug}-${product._id.slice(-6)}`;
          product.slug = uniqueSlug;
          console.log(`   → Using unique slug: "${uniqueSlug}"`);
        } else {
          product.slug = newSlug;
        }
        
        await product.save();
        fixedCount++;
        console.log(`   ✓ Fixed\n`);
      }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Total products: ${allProducts.length}`);
    console.log(`Fixed: ${fixedCount}`);
    console.log(`Had no slug: ${noSlugCount}`);
    console.log(`Already valid: ${allProducts.length - fixedCount}`);
    
    if (fixedCount === 0) {
      console.log('\n✅ All product slugs are valid!');
    } else {
      console.log(`\n✓ Successfully fixed ${fixedCount} product(s)`);
    }

  } catch (error) {
    console.error('[Error]', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n[MongoDB] Disconnected');
    process.exit(0);
  }
}

fixAllCorruptedSlugs();
