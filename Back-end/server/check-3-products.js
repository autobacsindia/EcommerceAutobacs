/**
 * Check and fix the 3 problematic products
 * Run this to verify slug integrity
 */

import mongoose from 'mongoose';
import Product from './models/Product.js';

async function checkProducts() {
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs';
  
  console.log('[MongoDB] Connecting...');
  await mongoose.connect(mongoUrl);
  console.log('[MongoDB] Connected successfully');

  try {
    // Find the 3 problematic products by their known IDs
    const productIds = [
      '69ec61c5a6df9853ce9ba987', // Endeavour Bonnet Light Mount Bracket
      '69e08a69256efd9c2ca8ca5b', // Innova Crysta Type 1 to Type 3 Conversion Kit
      '69e08a68256efd9c2ca8ca55', // Proman Rotatable Bonnet Light Mount for Jimny
    ];

    console.log('\n=== Checking 3 Problematic Products ===\n');

    for (const id of productIds) {
      const product = await Product.findById(id);
      
      if (!product) {
        console.log(`❌ Product ${id} NOT FOUND`);
        continue;
      }

      console.log(`✓ Product: ${product.name}`);
      console.log(`  ID: ${product._id}`);
      console.log(`  Slug: "${product.slug}"`);
      console.log(`  Stock: ${product.stock}`);
      console.log(`  Price: ₹${product.price}`);
      
      // Check if slug is corrupted
      const isCorrupted = !product.slug || 
                          product.slug.startsWith('-') || 
                          product.slug.includes('%20') ||
                          product.slug.trim() === '' ||
                          product.slug.startsWith('product-');
      
      if (isCorrupted) {
        console.log(`  ⚠️  CORRUPTED SLUG DETECTED!`);
        
        // Generate a proper slug from the name
        const newSlug = product.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        
        console.log(`  → Fixing slug to: "${newSlug}"`);
        
        product.slug = newSlug;
        await product.save();
        console.log(`  ✓ Slug updated successfully`);
      } else {
        console.log(`  ✓ Slug is valid`);
      }
      
      console.log('');
    }

    // Also check for ANY products with corrupted slugs
    console.log('\n=== Scanning for Other Corrupted Slugs ===\n');
    
    const allProducts = await Product.find({});
    let corruptedCount = 0;
    
    for (const product of allProducts) {
      const isCorrupted = !product.slug || 
                          product.slug.startsWith('-') || 
                          product.slug.includes('%20') ||
                          product.slug.trim() === '' ||
                          product.slug.startsWith('product-');
      
      if (isCorrupted) {
        corruptedCount++;
        console.log(`❌ ${product.name}`);
        console.log(`   Bad slug: "${product.slug}"`);
        
        // Fix it
        const newSlug = product.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        
        product.slug = newSlug;
        await product.save();
        console.log(`   → Fixed to: "${newSlug}"\n`);
      }
    }
    
    if (corruptedCount === 0) {
      console.log('✅ No corrupted slugs found!');
    } else {
      console.log(`\n✓ Fixed ${corruptedCount} corrupted slug(s)`);
    }

  } catch (error) {
    console.error('[Error]', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n[MongoDB] Disconnected');
    process.exit(0);
  }
}

checkProducts();
