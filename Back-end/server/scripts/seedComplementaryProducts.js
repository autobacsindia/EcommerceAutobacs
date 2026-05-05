/**
 * Seed script to populate complementary products
 * Run with: node --experimental-modules scripts/seedComplementaryProducts.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// Import models
const Product = (await import('../models/Product.js')).default;
const Category = (await import('../models/Category.js')).default;

// Category-based complementary product mappings
const complementaryMappings = {
  'body-kit': ['car-care', 'tools', 'paint'],
  'performance': ['lubricants', 'tools', 'maintenance'],
  'suspension': ['tools', 'maintenance', 'alignment'],
  'exterior': ['car-care', 'cleaning', 'maintenance'],
  'interior': ['car-care', 'accessories', 'cleaning'],
  'lighting': ['electrical', 'tools', 'wiring'],
  'wheels': ['maintenance', 'tools', 'cleaning'],
  'car-care': ['cleaning', 'maintenance', 'tools'],
  'tools': ['lubricants', 'maintenance', 'safety'],
};

async function seedComplementaryProducts() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all active products with stock
    const products = await Product.find({ 
      isActive: true, 
      stock: { $gt: 0 } 
    }).select('_id name categories').populate('categories', 'slug name');
    
    console.log(`📦 Found ${products.length} active products with stock`);

    let updatedCount = 0;

    for (const product of products) {
      // Get 4 random other products as complementary
      const randomProducts = products
        .filter(p => p._id.toString() !== product._id.toString())
        .sort(() => Math.random() - 0.5)
        .slice(0, 4);

      if (randomProducts.length > 0) {
        product.complementaryProducts = randomProducts.map(p => p._id);
        await product.save();
        updatedCount++;
        
        if (updatedCount <= 10) {
          console.log(`✅ Updated "${product.name}" with ${randomProducts.length} complementary products`);
        }
      }
      
      // Limit to first 100 products to avoid long execution
      if (updatedCount >= 100) break;
    }

    console.log(`\n🎉 Successfully updated ${updatedCount} products with complementary links`);
    console.log('💡 You can now see "Frequently Bought Together" on product pages!');
    console.log('✨ Done!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding complementary products:', error);
    process.exit(1);
  }
}

seedComplementaryProducts();
