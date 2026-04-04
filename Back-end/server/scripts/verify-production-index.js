/**
 * Verify Production MongoDB Text Index
 * 
 * Checks if the optimized text index (without description) is active in production.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load production environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env.production') });

console.log('🔌 Connecting to PRODUCTION MongoDB...\n');

try {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to production database\n');

  const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }), 'products');
  
  console.log('📊 Checking Production Indexes:\n');
  const indexes = await Product.collection.indexes();
  
  let foundOptimizedIndex = false;
  let foundOldIndex = false;
  
  indexes.forEach(idx => {
    if (idx.name.includes('text')) {
      console.log(`Index: ${idx.name}`);
      console.log(`  Fields:`, JSON.stringify(idx.key));
      
      if (idx.name === 'name_text_tags_text_brand_text') {
        console.log(`  ✅ OPTIMIZED INDEX FOUND (description removed)`);
        foundOptimizedIndex = true;
      } else if (idx.name === 'name_text_description_text_tags_text_brand_text') {
        console.log(`  ❌ OLD INDEX FOUND (includes description - needs removal)`);
        foundOldIndex = true;
      }
      console.log();
    }
  });
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📋 VERIFICATION RESULTS:\n');
  
  if (foundOptimizedIndex && !foundOldIndex) {
    console.log('✅ CONFIRMED: Optimized index is active in production');
    console.log('   - Description field is NOT indexed');
    console.log('   - No migration needed');
    console.log('   - Search performance is already optimized\n');
  } else if (foundOldIndex && !foundOptimizedIndex) {
    console.log('❌ ISSUE: Old index still exists in production');
    console.log('   - Description field IS indexed (wasting RAM)');
    console.log('   - Migration script NEEDS to be run\n');
    console.log('   Run: node scripts/rebuild-text-index.js\n');
  } else if (foundOptimizedIndex && foundOldIndex) {
    console.log('⚠️  WARNING: Both indexes exist');
    console.log('   - Run migration to remove old index\n');
  } else {
    console.log('❌ ERROR: No text index found');
    console.log('   - Need to create optimized index\n');
  }
  
  // Get collection stats
  try {
    const db = Product.collection.db;
    const collStats = await db.command({ collStats: 'products' });
    
    console.log('📈 Production Collection Stats:');
    console.log(`  Documents: ${collStats.count}`);
    console.log(`  Total Size: ${(collStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Index Size: ${(collStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Average Doc Size: ${(collStats.avgObjSize / 1024).toFixed(2)} KB\n`);
  } catch (statsErr) {
    console.log('⚠️  Could not retrieve collection stats (non-critical)\n');
  }
  
  await mongoose.disconnect();
  console.log('🔌 Disconnected from production database');
  
} catch (err) {
  console.error('❌ Error:', err.message);
  console.error('\nMake sure MONGODB_URI is set in .env.production');
  process.exit(1);
}
