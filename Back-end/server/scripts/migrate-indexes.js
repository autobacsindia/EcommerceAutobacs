#!/usr/bin/env node

/**
 * Database Index Migration Script
 * 
 * Adds optimized indexes to Product and Order collections.
 * This script should be run during a maintenance window.
 * 
 * Usage:
 *   node scripts/migrate-indexes.js
 * 
 * What it does:
 *   1. Checks existing indexes
 *   2. Adds missing optimized indexes
 *   3. Validates index usage
 *   4. Reports index statistics
 * 
 * Safety features:
 *   - Uses background indexing (no downtime)
 *   - Checks for existing indexes before creating
 *   - Reports index size and usage
 *   - Dry-run mode available
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in environment variables');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('-d');
const isVerbose = args.includes('--verbose') || args.includes('-v');

console.log('='.repeat(80));
console.log('🗄️  Database Index Migration');
console.log('='.repeat(80));
console.log(`Database: ${MONGO_URI.split('@')[1] || MONGO_URI}`);
console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes)' : '⚡ LIVE (applying changes)'}`);
console.log('='.repeat(80));
console.log();

async function migrateIndexes() {
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected successfully\n');

    const db = mongoose.connection.db;

    // ========================================================================
    // PRODUCT COLLECTION INDEXES
    // ========================================================================
    console.log('📦 PRODUCT COLLECTION');
    console.log('-'.repeat(80));

    const productIndexes = await db.collection('products').indexes();
    console.log(`📊 Current indexes: ${productIndexes.length}`);
    
    if (isVerbose) {
      console.log('\nExisting indexes:');
      productIndexes.forEach((idx, i) => {
        console.log(`  ${i + 1}. ${idx.name}: ${JSON.stringify(idx.key)}`);
      });
      console.log();
    }

    const productIndexesToAdd = [
      {
        name: 'brand_isActive_createdAt',
        spec: { brand: 1, isActive: 1, createdAt: -1 },
        description: 'Brand filtering + new arrivals sorting',
        query: 'find({ brand, isActive: true }).sort({ createdAt: -1 })'
      },
      {
        name: 'categories_price_isActive',
        spec: { categories: 1, price: 1, isActive: 1 },
        description: 'Category + price range filtering',
        query: 'find({ categories, price: { $gte, $lte }, isActive: true })'
      },
      {
        name: 'isActive_createdAt',
        spec: { isActive: 1, createdAt: -1 },
        description: 'New arrivals / homepage queries',
        query: 'find({ isActive: true }).sort({ createdAt: -1 })'
      }
    ];

    const existingProductIndexNames = productIndexes.map(idx => idx.name);
    
    for (const index of productIndexesToAdd) {
      if (existingProductIndexNames.includes(index.name)) {
        console.log(`✅ Index "${index.name}" already exists`);
      } else {
        if (isDryRun) {
          console.log(`🔍 [DRY RUN] Would add index: ${index.name}`);
          console.log(`   Spec: ${JSON.stringify(index.spec)}`);
          console.log(`   For query: ${index.query}`);
        } else {
          console.log(`⚡ Creating index: ${index.name}`);
          console.log(`   Description: ${index.description}`);
          
          await db.collection('products').createIndex(index.spec, {
            name: index.name,
            background: true // Prevents blocking writes
          });
          
          console.log(`✅ Index "${index.name}" created successfully\n`);
        }
      }
    }

    console.log();

    // ========================================================================
    // ORDER COLLECTION INDEXES
    // ========================================================================
    console.log('📋 ORDER COLLECTION');
    console.log('-'.repeat(80));

    const orderIndexes = await db.collection('orders').indexes();
    console.log(`📊 Current indexes: ${orderIndexes.length}`);
    
    if (isVerbose) {
      console.log('\nExisting indexes:');
      orderIndexes.forEach((idx, i) => {
        console.log(`  ${i + 1}. ${idx.name}: ${JSON.stringify(idx.key)}`);
      });
      console.log();
    }

    const orderIndexesToAdd = [
      {
        name: 'status_createdAt',
        spec: { status: 1, createdAt: -1 },
        description: 'Admin dashboard - filter by status, sort by date',
        query: 'find({ status }).sort({ createdAt: -1 })'
      }
    ];

    const existingOrderIndexNames = orderIndexes.map(idx => idx.name);
    
    for (const index of orderIndexesToAdd) {
      if (existingOrderIndexNames.includes(index.name)) {
        console.log(`✅ Index "${index.name}" already exists`);
      } else {
        if (isDryRun) {
          console.log(`🔍 [DRY RUN] Would add index: ${index.name}`);
          console.log(`   Spec: ${JSON.stringify(index.spec)}`);
          console.log(`   For query: ${index.query}`);
        } else {
          console.log(`⚡ Creating index: ${index.name}`);
          console.log(`   Description: ${index.description}`);
          
          await db.collection('orders').createIndex(index.spec, {
            name: index.name,
            background: true
          });
          
          console.log(`✅ Index "${index.name}" created successfully\n`);
        }
      }
    }

    console.log();

    // ========================================================================
    // INDEX STATISTICS
    // ========================================================================
    console.log('📈 INDEX STATISTICS');
    console.log('-'.repeat(80));

    // Get collection stats
    const productStats = await db.command({ collStats: 'products' });
    const orderStats = await db.command({ collStats: 'orders' });

    console.log(`\n📦 Products Collection:`);
    console.log(`   Documents: ${productStats.count.toLocaleString()}`);
    console.log(`   Indexes: ${productStats.nindexes}`);
    console.log(`   Total Index Size: ${(productStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Average Object Size: ${(productStats.avgObjSize / 1024).toFixed(2)} KB`);

    console.log(`\n📋 Orders Collection:`);
    console.log(`   Documents: ${orderStats.count.toLocaleString()}`);
    console.log(`   Indexes: ${orderStats.nindexes}`);
    console.log(`   Total Index Size: ${(orderStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Average Object Size: ${(orderStats.avgObjSize / 1024).toFixed(2)} KB`);

    console.log();

    // ========================================================================
    // VALIDATION QUERIES
    // ========================================================================
    if (!isDryRun) {
      console.log('\n🔍 VALIDATING INDEX USAGE');
      console.log('-'.repeat(80));

      // Test 1: Brand page query (MOST COMMON)
      console.log('\n📦 Test 1: Brand page + new arrivals');
      console.log('   Query: find({ brand, isActive: true }).sort({ createdAt: -1 })');
      const brandExplain = await db.collection('products')
        .find({ brand: 'Test Brand', isActive: true })
        .sort({ createdAt: -1 })
        .limit(1)
        .explain('executionStats');
      
      const brandWinningPlan = brandExplain.queryPlanner.winningPlan;
      const brandStage = brandWinningPlan.inputStage?.stage || brandWinningPlan.stage;
      const brandDocsExamined = brandExplain.executionStats?.totalDocsExamined || 0;
      const brandKeysExamined = brandExplain.executionStats?.totalKeysExamined || 0;
      const brandTime = brandExplain.executionStats?.executionTimeMillis || 0;
      
      console.log(`   Stage: ${brandStage}`);
      console.log(`   Docs Examined: ${brandDocsExamined}`);
      console.log(`   Keys Examined: ${brandKeysExamined}`);
      console.log(`   Time: ${brandTime}ms`);
      console.log(`   ${brandStage === 'IXSCAN' ? '✅ Using index efficiently' : brandStage === 'FETCH' ? '⚠️  Fetching documents (check if normal)' : '❌ COLLSCAN - Index not used!'}`);

      // Test 2: Category + price filter (MULTIKEY INDEX RISK)
      console.log('\n📦 Test 2: Category + price range (multikey index check)');
      console.log('   Query: find({ categories, price: { $gte, $lte }, isActive: true })');
      
      // Get a sample category ID
      const sampleProduct = await db.collection('products').findOne({ categories: { $exists: true, $not: { $size: 0 } } });
      const sampleCategoryId = sampleProduct?.categories?.[0];
      
      if (sampleCategoryId) {
        const catExplain = await db.collection('products')
          .find({ 
            categories: sampleCategoryId,
            price: { $gte: 1000, $lte: 5000 },
            isActive: true 
          })
          .limit(1)
          .explain('executionStats');
        
        const catWinningPlan = catExplain.queryPlanner.winningPlan;
        const catStage = catWinningPlan.inputStage?.stage || catWinningPlan.stage;
        const catDocsExamined = catExplain.executionStats?.totalDocsExamined || 0;
        const catKeysExamined = catExplain.executionStats?.totalKeysExamined || 0;
        const catTime = catExplain.executionStats?.executionTimeMillis || 0;
        
        console.log(`   Stage: ${catStage}`);
        console.log(`   Docs Examined: ${catDocsExamined}`);
        console.log(`   Keys Examined: ${catKeysExamined}`);
        console.log(`   Time: ${catTime}ms`);
        
        if (catDocsExamined > catKeysExamined * 10) {
          console.log('   ⚠️  WARNING: High docsExamined ratio - multikey index degradation detected!');
          console.log('   💡 Consider falling back to: { categories: 1, isActive: 1 } and filter price in memory');
        } else {
          console.log(`   ${catStage === 'IXSCAN' ? '✅ Multikey index working well' : '⚠️  Check query plan'}`);
        }
      } else {
        console.log('   ⚠️  No products with categories found - skipping test');
      }

      // Test 3: Homepage new arrivals (LOW SELECTIVITY RISK)
      console.log('\n📦 Test 3: Homepage new arrivals');
      console.log('   Query: find({ isActive: true }).sort({ createdAt: -1 }).limit(20)');
      const homeExplain = await db.collection('products')
        .find({ isActive: true })
        .sort({ createdAt: -1 })
        .limit(20)
        .explain('executionStats');
      
      const homeWinningPlan = homeExplain.queryPlanner.winningPlan;
      const homeStage = homeWinningPlan.inputStage?.stage || homeWinningPlan.stage;
      const homeDocsExamined = homeExplain.executionStats?.totalDocsExamined || 0;
      const homeKeysExamined = homeExplain.executionStats?.totalKeysExamined || 0;
      const homeTime = homeExplain.executionStats?.executionTimeMillis || 0;
      
      console.log(`   Stage: ${homeStage}`);
      console.log(`   Docs Examined: ${homeDocsExamined}`);
      console.log(`   Keys Examined: ${homeKeysExamined}`);
      console.log(`   Time: ${homeTime}ms`);
      console.log(`   ${homeStage === 'IXSCAN' ? '✅ Using index' : '❌ Not using index!'}`);
      
      // Check selectivity
      const totalProducts = await db.collection('products').countDocuments();
      const activeProducts = await db.collection('products').countDocuments({ isActive: true });
      const activePercentage = ((activeProducts / totalProducts) * 100).toFixed(1);
      
      console.log(`\n   📊 Index Selectivity:`);
      console.log(`   Total products: ${totalProducts}`);
      console.log(`   Active products: ${activeProducts} (${activePercentage}%)`);
      
      if (activePercentage > 90) {
        console.log(`   ⚠️  WARNING: Low selectivity (${activePercentage}% active)`);
        console.log(`   💡 Consider partial index: { createdAt: -1 } with { partialFilterExpression: { isActive: true } }`);
      } else {
        console.log(`   ✅ Good selectivity (${activePercentage}% active)`);
      }

      // Test 4: Admin order dashboard
      console.log('\n📋 Test 4: Admin order dashboard');
      console.log('   Query: find({ status }).sort({ createdAt: -1 })');
      const orderExplain = await db.collection('orders')
        .find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .limit(1)
        .explain('executionStats');
      
      const orderWinningPlan = orderExplain.queryPlanner.winningPlan;
      const orderStage = orderWinningPlan.inputStage?.stage || orderWinningPlan.stage;
      const orderDocsExamined = orderExplain.executionStats?.totalDocsExamined || 0;
      const orderKeysExamined = orderExplain.executionStats?.totalKeysExamined || 0;
      const orderTime = orderExplain.executionStats?.executionTimeMillis || 0;
      
      console.log(`   Stage: ${orderStage}`);
      console.log(`   Docs Examined: ${orderDocsExamined}`);
      console.log(`   Keys Examined: ${orderKeysExamined}`);
      console.log(`   Time: ${orderTime}ms`);
      console.log(`   ${orderStage === 'IXSCAN' ? '✅ Using index efficiently' : '❌ Not using index!'}`);

      console.log();
    }

    // ========================================================================
    // WRITE PERFORMANCE CHECK
    // ========================================================================
    console.log('\n📝 WRITE PERFORMANCE METRICS');
    console.log('-'.repeat(80));
    
    const serverStatus = await db.admin().serverStatus();
    const writeConflicts = serverStatus.metrics?.operation?.writeConflicts || 0;
    
    console.log(`\n   Write Conflicts: ${writeConflicts}`);
    console.log(`   ${writeConflicts > 100 ? '⚠️  High write conflicts - monitor index impact' : '✅ Write conflicts within normal range'}`);
    
    if (isVerbose) {
      console.log('\n   💡 Monitor after deployment:');
      console.log('   - Insert latency (should not increase >10%)');
      console.log('   - Bulk import performance (WordPress sync)');
      console.log('   - Write conflict rate');
    }

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('='.repeat(80));
    console.log('✅ MIGRATION COMPLETE');
    console.log('='.repeat(80));
    
    if (isDryRun) {
      console.log('\n🔍 This was a DRY RUN. No indexes were created.');
      console.log('   Run without --dry-run to apply changes:\n');
      console.log('   node scripts/migrate-indexes.js\n');
    } else {
      console.log('\n⚡ All indexes created successfully!');
      console.log('\n💡 Next steps:');
      console.log('   1. Monitor query performance in MongoDB Atlas');
      console.log('   2. Check for slow queries in logs');
      console.log('   3. Verify index usage with .explain("executionStats")\n');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('👋 Database connection closed');
  }
}

// Run migration
migrateIndexes();
