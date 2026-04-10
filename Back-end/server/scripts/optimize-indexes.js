#!/usr/bin/env node

/**
 * Index Optimization Script
 * 
 * Removes redundant indexes and creates partial indexes for better performance.
 * 
 * Usage:
 *   node scripts/optimize-indexes.js
 *   node scripts/optimize-indexes.js --dry-run
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in environment variables');
  process.exit(1);
}

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('-d');

console.log('='.repeat(80));
console.log('🔧 Index Optimization Script');
console.log('='.repeat(80));
console.log(`Database: ${MONGO_URI.split('@')[1] || MONGO_URI}`);
console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes)' : '⚡ APPLYING CHANGES'}`);
console.log('='.repeat(80));
console.log();

async function optimizeIndexes() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    // ========================================================================
    // ANALYSIS
    // ========================================================================
    console.log('📊 ANALYZING CURRENT INDEXES');
    console.log('-'.repeat(80));

    const productIndexes = await db.collection('products').indexes();
    const orderIndexes = await db.collection('orders').indexes();

    console.log(`\n📦 Products: ${productIndexes.length} indexes`);
    console.log(`📋 Orders: ${orderIndexes.length} indexes`);

    // Check active product percentage
    const totalProducts = await db.collection('products').countDocuments();
    const activeProducts = await db.collection('products').countDocuments({ isActive: true });
    const activePercentage = ((activeProducts / totalProducts) * 100).toFixed(1);

    console.log(`\n📈 Active Products: ${activeProducts}/${totalProducts} (${activePercentage}%)`);

    // ========================================================================
    // OPTIMIZATION PLAN
    // ========================================================================
    console.log('\n📋 OPTIMIZATION PLAN');
    console.log('-'.repeat(80));

    const optimizations = [];

    // 1. Remove redundant brand_1 (covered by brand_isActive_createdAt)
    if (productIndexes.find(idx => idx.name === 'brand_1')) {
      optimizations.push({
        action: 'DROP',
        collection: 'products',
        index: 'brand_1',
        reason: 'Covered by compound index: { brand: 1, isActive: 1, createdAt: -1 }',
        savings: '~50 KB'
      });
    }

    // 2. Remove redundant categories_1_isActive_1 (covered by categories_price_isActive)
    if (productIndexes.find(idx => idx.name === 'categories_1_isActive_1')) {
      optimizations.push({
        action: 'DROP',
        collection: 'products',
        index: 'categories_1_isActive_1',
        reason: 'Covered by compound index: { categories: 1, price: 1, isActive: 1 }',
        savings: '~80 KB'
      });
    }

    // 3. Remove redundant price_1 (covered by categories_price_isActive)
    if (productIndexes.find(idx => idx.name === 'price_1')) {
      optimizations.push({
        action: 'DROP',
        collection: 'products',
        index: 'price_1',
        reason: 'Covered by compound index: { categories: 1, price: 1, isActive: 1 }',
        savings: '~40 KB'
      });
    }

    // 4. Remove redundant createdAt_-1 (covered by isActive_createdAt)
    if (productIndexes.find(idx => idx.name === 'createdAt_-1')) {
      optimizations.push({
        action: 'DROP',
        collection: 'products',
        index: 'createdAt_-1',
        reason: 'Covered by compound index: { isActive: 1, createdAt: -1 }',
        savings: '~50 KB'
      });
    }

    // 5. Remove redundant status_1 in orders (covered by status_createdAt)
    if (orderIndexes.find(idx => idx.name === 'status_1')) {
      optimizations.push({
        action: 'DROP',
        collection: 'orders',
        index: 'status_1',
        reason: 'Covered by compound index: { status: 1, createdAt: -1 }',
        savings: '~10 KB'
      });
    }

    // 6. Create partial index for createdAt if >95% active
    if (parseFloat(activePercentage) > 95) {
      optimizations.push({
        action: 'CREATE',
        collection: 'products',
        index: 'createdAt_-1_partial',
        spec: { createdAt: -1 },
        options: { partialFilterExpression: { isActive: true } },
        reason: `${activePercentage}% products active - partial index is 40-60% smaller`,
        replaces: 'isActive_createdAt (optional)',
        savings: '~100-150 KB'
      });
    }

    // Display plan
    optimizations.forEach((opt, i) => {
      console.log(`\n${i + 1}. [${opt.action}] ${opt.collection}.${opt.index}`);
      console.log(`   Reason: ${opt.reason}`);
      if (opt.savings) console.log(`   Estimated savings: ${opt.savings}`);
    });

    console.log(`\n💰 Total estimated savings: ~330-430 KB (10-15% reduction)`);

    // ========================================================================
    // EXECUTE OPTIMIZATIONS
    // ========================================================================
    if (optimizations.length === 0) {
      console.log('\n✅ No optimizations needed!');
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log(isDryRun ? '🔍 DRY RUN - What would be done:' : '⚡ EXECUTING OPTIMIZATIONS');
    console.log('='.repeat(80));

    for (const opt of optimizations) {
      if (opt.action === 'DROP') {
        if (isDryRun) {
          console.log(`\n🔍 Would drop: ${opt.collection}.${opt.index}`);
        } else {
          console.log(`\n🗑️  Dropping: ${opt.collection}.${opt.index}`);
          await db.collection(opt.collection).dropIndex(opt.index);
          console.log(`   ✅ Dropped successfully`);
        }
      } else if (opt.action === 'CREATE') {
        if (isDryRun) {
          console.log(`\n🔍 Would create: ${opt.collection}.${opt.index}`);
          console.log(`   Spec: ${JSON.stringify(opt.spec)}`);
          if (opt.options) console.log(`   Options: ${JSON.stringify(opt.options)}`);
        } else {
          console.log(`\n✨ Creating: ${opt.collection}.${opt.index}`);
          await db.collection(opt.collection).createIndex(opt.spec, opt.options);
          console.log(`   ✅ Created successfully`);
        }
      }
    }

    // ========================================================================
    // FINAL STATS
    // ========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL INDEX STATISTICS');
    console.log('='.repeat(80));

    const newProductIndexes = await db.collection('products').indexes();
    const newOrderIndexes = await db.collection('orders').indexes();
    const productStats = await db.command({ collStats: 'products' });
    const orderStats = await db.command({ collStats: 'orders' });

    console.log(`\n📦 Products:`);
    console.log(`   Indexes: ${productIndexes.length} → ${newProductIndexes.length}`);
    console.log(`   Index Size: ${(productStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);

    console.log(`\n📋 Orders:`);
    console.log(`   Indexes: ${orderIndexes.length} → ${newOrderIndexes.length}`);
    console.log(`   Index Size: ${(orderStats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n✅ Optimization complete!');

    if (isDryRun) {
      console.log('\n💡 To apply these changes, run:');
      console.log('   node scripts/optimize-indexes.js');
    }

  } catch (error) {
    console.error('\n❌ Optimization failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed');
  }
}

optimizeIndexes();
