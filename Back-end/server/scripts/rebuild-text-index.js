/**
 * Rebuild MongoDB Text Index (Remove Description)
 * 
 * This script removes 'description' from the text index to reduce RAM usage.
 * Description fields are large (KBs per product) and waste memory.
 * 
 * Run this ONCE after deploying the updated Product.js model.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// Connect to MongoDB
console.log('🔌 Connecting to MongoDB...');
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs');
console.log('✓ Connected to MongoDB\n');

const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }), 'products');

async function rebuildTextIndex() {
  try {
    console.log('📊 Current indexes:');
    const indexes = await Product.collection.indexes();
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
    });
    console.log();

    // Check if text index exists
    const textIndex = indexes.find(idx => idx.name === 'name_text_description_text_tags_text_brand_text');
    
    if (!textIndex) {
      console.log('⚠️  Old text index not found. Checking for optimized index...\n');
      
      const newTextIndex = indexes.find(idx => idx.name === 'name_text_tags_text_brand_text');
      if (newTextIndex) {
        console.log('✅ Optimized text index already exists!');
        console.log('   No action needed.\n');
        return;
      } else {
        console.log('❌ No text index found. Creating optimized index...\n');
      }
    } else {
      console.log('🗑️  Dropping old text index (includes description)...');
      await Product.collection.dropIndex('name_text_description_text_tags_text_brand_text');
      console.log('✓ Old index dropped\n');
    }

    // Create optimized text index (without description)
    console.log('✨ Creating optimized text index (name + tags + brand only)...');
    await Product.collection.createIndex(
      { name: 'text', tags: 'text', brand: 'text' },
      { name: 'name_text_tags_text_brand_text' }
    );
    console.log('✓ Optimized index created\n');

    // Verify new index
    console.log('📊 Updated indexes:');
    const updatedIndexes = await Product.collection.indexes();
    updatedIndexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
    });
    console.log();

    // Get collection stats using db.command
    console.log('📈 Collection Stats:');
    try {
      const db = Product.collection.db;
      const collStats = await db.command({ collStats: 'products' });
      
      console.log(`  Documents: ${collStats.count}`);
      console.log(`  Total Size: ${(collStats.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Index Size: ${(collStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Average Doc Size: ${(collStats.avgObjSize / 1024).toFixed(2)} KB\n`);
    } catch (statsErr) {
      console.log('  ⚠️  Could not retrieve collection stats (non-critical)');
      console.log('  This is normal if you lack admin privileges\n');
    }

    console.log('✅ Text index rebuilt successfully!');
    console.log('💡 Benefits:');
    console.log('   - Reduced RAM usage (description removed from index)');
    console.log('   - Faster search queries');
    console.log('   - Better scalability\n');

  } catch (err) {
    console.error('❌ Error rebuilding index:', err.message);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
rebuildTextIndex().catch(err => {
  console.error('💥 Script failed:', err);
  process.exit(1);
});
