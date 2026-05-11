/**
 * Directly query the 3 problematic products by their IDs
 */

import mongoose from 'mongoose';
import Product from './models/Product.js';

async function checkSpecificProducts() {
  const mongoUrl = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs';
  
  console.log('[MongoDB] Connecting...');
  await mongoose.connect(mongoUrl);
  console.log('[MongoDB] Connected successfully\n');

  try {
    const ids = [
      '69ec61c5a6df9853ce9ba987',
      '69e08a69256efd9c2ca8ca5b',
      '69e08a68256efd9c2ca8ca55'
    ];

    console.log('=== Checking Specific Product IDs ===\n');

    for (const id of ids) {
      console.log(`Looking for ID: ${id}`);
      
      // Try to find by ID
      const product = await Product.findById(id);
      
      if (product) {
        console.log(`✓ FOUND`);
        console.log(`  Name: ${product.name}`);
        console.log(`  Slug: "${product.slug}"`);
        console.log(`  Stock: ${product.stock}`);
        
        // Check if slug is corrupted
        if (!product.slug || product.slug.startsWith('-') || /^[-\s]+$/.test(product.slug)) {
          console.log(`  ❌ CORRUPTED SLUG!`);
          
          // Fix it
          const newSlug = product.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          
          console.log(`  → Fixing to: "${newSlug}"`);
          product.slug = newSlug;
          await product.save();
          console.log(`  ✓ Fixed!\n`);
        } else {
          console.log(`  ✓ Slug is valid\n`);
        }
      } else {
        console.log(`❌ NOT FOUND\n`);
      }
    }

  } catch (error) {
    console.error('[Error]', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n[MongoDB] Disconnected');
    process.exit(0);
  }
}

checkSpecificProducts();
