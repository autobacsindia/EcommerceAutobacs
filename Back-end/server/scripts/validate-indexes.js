#!/usr/bin/env node

/**
 * Production Index Validation Script
 * 
 * Run this AFTER deploying indexes to production to validate performance.
 * 
 * Usage:
 *   node scripts/validate-indexes.js
 * 
 * What it checks:
 *   1. Multikey index degradation (categories + price)
 *   2. Index selectivity (isActive field)
 *   3. Query plan validation (IXSCAN vs COLLSCAN)
 *   4. Write performance impact
 *   5. Covered query opportunities
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

console.log('='.repeat(80));
console.log('🔍 Production Index Validation');
console.log('='.repeat(80));
console.log(`Database: ${MONGO_URI.split('@')[1] || MONGO_URI}`);
console.log('='.repeat(80));
console.log();

async function validateIndexes() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    const results = {
      passed: 0,
      warnings: 0,
      failures: 0,
      recommendations: []
    };

    // ========================================================================
    // TEST 1: Multikey Index Risk (Categories + Price)
    // ========================================================================
    console.log('🧨 TEST 1: Multikey Index Performance');
    console.log('-'.repeat(80));

    const sampleProduct = await db.collection('products').findOne({ 
      categories: { $exists: true, $not: { $size: 0 } } 
    });

    if (sampleProduct?.categories?.[0]) {
      const catId = sampleProduct.categories[0];
      
      const explain = await db.collection('products')
        .find({ 
          categories: catId,
          price: { $gte: 1000, $lte: 5000 },
          isActive: true 
        })
        .limit(100)
        .explain('executionStats');

      const stage = explain.queryPlanner.winningPlan.inputStage?.stage || 
                    explain.queryPlanner.winningPlan.stage;
      const docsExamined = explain.executionStats.totalDocsExamined;
      const keysExamined = explain.executionStats.totalKeysExamined;
      const ratio = docsExamined / (keysExamined || 1);

      console.log(`Query: find({ categories, price: { $gte, $lte }, isActive: true })`);
      console.log(`Stage: ${stage}`);
      console.log(`Docs Examined: ${docsExamined}`);
      console.log(`Keys Examined: ${keysExamined}`);
      console.log(`Docs/Keys Ratio: ${ratio.toFixed(2)}x`);

      // FETCH with low ratio is GOOD (means index filtered well)
      if (ratio < 5) {
        if (ratio < 2) {
          console.log('✅ PASS: Excellent multikey index performance!');
          console.log(`   💡 Ratio < 2x means index is highly efficient\n`);
        } else {
          console.log('✅ PASS: Multikey index working efficiently\n');
        }
        results.passed++;
      } else if (ratio > 10) {
        console.log('❌ FAIL: Multikey index degradation detected!');
        console.log('   Recommendation: Fall back to { categories: 1, isActive: 1 }');
        console.log('   Handle price filtering in application code\n');
        results.failures++;
        results.recommendations.push({
          type: 'CRITICAL',
          index: 'categories_price_isActive',
          action: 'Replace with { categories: 1, isActive: 1 } and filter price in memory',
          reason: `High docs/keys ratio (${ratio.toFixed(1)}x) indicates multikey degradation`
        });
      } else {
        console.log('⚠️  WARNING: Moderate performance - monitor closely\n');
        results.warnings++;
        results.recommendations.push({
          type: 'WARNING',
          index: 'categories_price_isActive',
          action: 'Monitor query performance under load',
          reason: `Docs/keys ratio is ${ratio.toFixed(1)}x (threshold: 10x)`
        });
      }
    } else {
      console.log('⚠️  SKIP: No products with categories found\n');
      results.warnings++;
    }

    // ========================================================================
    // TEST 2: Index Selectivity (isActive field)
    // ========================================================================
    console.log('📉 TEST 2: Index Selectivity Analysis');
    console.log('-'.repeat(80));

    const totalProducts = await db.collection('products').countDocuments();
    const activeProducts = await db.collection('products').countDocuments({ isActive: true });
    const inactiveProducts = totalProducts - activeProducts;
    const activePercentage = ((activeProducts / totalProducts) * 100).toFixed(1);

    console.log(`Total Products: ${totalProducts.toLocaleString()}`);
    console.log(`Active Products: ${activeProducts.toLocaleString()} (${activePercentage}%)`);
    console.log(`Inactive Products: ${inactiveProducts.toLocaleString()} (${(100 - activePercentage).toFixed(1)}%)`);

    if (activePercentage > 95) {
      // Check if partial index exists
      const indexes = await db.collection('products').indexes();
      const hasPartialIndex = indexes.some(idx => 
        idx.name === 'createdAt_-1' && idx.partialFilterExpression
      );
      
      if (hasPartialIndex) {
        console.log('✅ PASS: Partial index already in use (optimal!)');
        console.log(`   Index: { createdAt: -1 } with { partialFilterExpression: { isActive: true } }`);
        console.log(`   Benefit: 40-60% smaller index, better cache efficiency\n`);
        results.passed++;
      } else {
        console.log('❌ FAIL: Very low selectivity (95%+ active)');
        console.log('   Recommendation: Use partial index instead');
        console.log('   db.products.createIndex({ createdAt: -1 }, { partialFilterExpression: { isActive: true } })\n');
        results.failures++;
        results.recommendations.push({
          type: 'OPTIMIZATION',
          index: 'isActive_createdAt',
          action: 'Replace with partial index: { createdAt: -1 } with { partialFilterExpression: { isActive: true } }',
          reason: `${activePercentage}% of products are active - index has low selectivity`
        });
      }
    } else if (activePercentage > 85) {
      console.log('⚠️  WARNING: Moderate selectivity - current index acceptable\n');
      results.warnings++;
    } else {
      console.log('✅ PASS: Good selectivity - index is effective\n');
      results.passed++;
    }

    // ========================================================================
    // TEST 3: Brand Query Performance
    // ========================================================================
    console.log('🏷️  TEST 3: Brand Page Query');
    console.log('-'.repeat(80));

    const brandExplain = await db.collection('products')
      .find({ brand: 'Test', isActive: true })
      .sort({ createdAt: -1 })
      .limit(20)
      .explain('executionStats');

    const brandStage = brandExplain.queryPlanner.winningPlan.inputStage?.stage || 
                       brandExplain.queryPlanner.winningPlan.stage;
    const brandTime = brandExplain.executionStats.executionTimeMillis;

    console.log(`Query: find({ brand, isActive: true }).sort({ createdAt: -1 }).limit(20)`);
    console.log(`Stage: ${brandStage}`);
    console.log(`Execution Time: ${brandTime}ms`);

    if (brandStage === 'IXSCAN') {
      console.log('✅ PASS: Using compound index efficiently\n');
      results.passed++;
    } else if (brandStage === 'FETCH') {
      console.log('⚠️  WARNING: FETCH stage present (may be normal for limit queries)\n');
      results.warnings++;
    } else {
      console.log('❌ FAIL: Not using index (COLLSCAN detected)\n');
      results.failures++;
    }

    // ========================================================================
    // TEST 4: Homepage Query Performance
    // ========================================================================
    console.log('🏠 TEST 4: Homepage New Arrivals');
    console.log('-'.repeat(80));

    const homeExplain = await db.collection('products')
      .find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(20)
      .explain('executionStats');

    const homeStage = homeExplain.queryPlanner.winningPlan.inputStage?.stage || 
                      homeExplain.queryPlanner.winningPlan.stage;
    const homeTime = homeExplain.executionStats.executionTimeMillis;
    const homeDocsExamined = homeExplain.executionStats.totalDocsExamined;

    console.log(`Query: find({ isActive: true }).sort({ createdAt: -1 }).limit(20)`);
    console.log(`Stage: ${homeStage}`);
    console.log(`Docs Examined: ${homeDocsExamined}`);
    console.log(`Execution Time: ${homeTime}ms`);

    if (homeStage === 'IXSCAN' && homeDocsExamined <= 100) {
      console.log('✅ PASS: Efficient index scan\n');
      results.passed++;
    } else if (homeDocsExamined > 1000) {
      console.log('❌ FAIL: Examining too many documents\n');
      results.failures++;
    } else {
      console.log('⚠️  WARNING: Acceptable but could be optimized\n');
      results.warnings++;
    }

    // ========================================================================
    // TEST 5: Order Dashboard Query
    // ========================================================================
    console.log('📋 TEST 5: Admin Order Dashboard');
    console.log('-'.repeat(80));

    const orderExplain = await db.collection('orders')
      .find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(50)
      .explain('executionStats');

    const orderStage = orderExplain.queryPlanner.winningPlan.inputStage?.stage || 
                       orderExplain.queryPlanner.winningPlan.stage;
    const orderTime = orderExplain.executionStats.executionTimeMillis;

    console.log(`Query: find({ status: 'pending' }).sort({ createdAt: -1 }).limit(50)`);
    console.log(`Stage: ${orderStage}`);
    console.log(`Execution Time: ${orderTime}ms`);

    if (orderStage === 'IXSCAN') {
      console.log('✅ PASS: Using compound index\n');
      results.passed++;
    } else {
      console.log('❌ FAIL: Not using index\n');
      results.failures++;
    }

    // ========================================================================
    // TEST 6: Write Performance Impact
    // ========================================================================
    console.log('📝 TEST 6: Write Performance Metrics');
    console.log('-'.repeat(80));

    try {
      const serverStatus = await db.admin().serverStatus();
      const writeConflicts = serverStatus.metrics?.operation?.writeConflicts || 0;
      const inserts = serverStatus.metrics?.operation?.insert || { total: 0 };
      const updates = serverStatus.metrics?.operation?.update || { total: 0 };

      console.log(`Write Conflicts: ${writeConflicts}`);
      console.log(`Total Inserts: ${inserts.total?.toLocaleString() || 0}`);
      console.log(`Total Updates: ${updates.total?.toLocaleString() || 0}`);

      if (writeConflicts > 100) {
        console.log('⚠️  WARNING: High write conflicts - monitor index impact\n');
        results.warnings++;
        results.recommendations.push({
          type: 'MONITORING',
          action: 'Monitor insert latency after index deployment',
          reason: `${writeConflicts} write conflicts detected`
        });
      } else {
        console.log('✅ PASS: Write conflicts within normal range\n');
        results.passed++;
      }
    } catch (error) {
      // MongoDB Atlas restricted user can't access serverStatus
      console.log('⚠️  SKIP: serverStatus requires admin permissions (Atlas limitation)');
      console.log('   💡 Monitor write performance in MongoDB Atlas dashboard\n');
      results.warnings++;
    }

    // ========================================================================
    // TEST 7: Covered Query Opportunities
    // ========================================================================
    console.log('🎯 TEST 7: Covered Query Analysis');
    console.log('-'.repeat(80));

    console.log('Opportunity: Brand page with projection');
    console.log('Current: find({ brand, isActive: true }).sort({ createdAt: -1 })');
    console.log('Optimized: find({ brand, isActive: true }, { name: 1, price: 1, slug: 1 }).sort({ createdAt: -1 })');
    console.log('Benefit: No document fetch - pure index response');
    console.log('Implementation: Add { name: 1, price: 1, slug: 1 } to brand index if this query is common\n');

    results.recommendations.push({
      type: 'OPTIMIZATION',
      action: 'Consider covered query index: { brand: 1, isActive: 1, createdAt: -1, name: 1, price: 1, slug: 1 }',
      reason: 'Eliminates document fetch for brand pages with projection',
      impact: 'HIGH'
    });

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('='.repeat(80));
    console.log('📊 VALIDATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`⚠️  Warnings: ${results.warnings}`);
    console.log(`❌ Failures: ${results.failures}`);
    console.log();

    if (results.recommendations.length > 0) {
      console.log('💡 RECOMMENDATIONS:');
      console.log('-'.repeat(80));
      results.recommendations.forEach((rec, i) => {
        console.log(`\n${i + 1}. [${rec.type}] ${rec.action}`);
        console.log(`   Reason: ${rec.reason}`);
        if (rec.impact) console.log(`   Impact: ${rec.impact}`);
      });
      console.log();
    }

    if (results.failures === 0) {
      console.log('✅ All critical checks passed! Indexes are performing well.');
    } else {
      console.log(`⚠️  ${results.failures} critical issue(s) detected. Review recommendations above.`);
    }

    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed');
  }
}

validateIndexes();
