/**
 * Database Indexes Migration Script
 * 
 * Purpose: Ensure all critical MongoDB indexes exist in production
 * Run this script before launching to production
 * 
 * Usage: node scripts/ensure-production-indexes.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function ensureProductionIndexes() {
  console.log('=== Starting Production Index Migration ===\n');
  
  if (!process.env.MONGO_URI) {
    console.error('ERROR: MONGO_URI not set in environment variables');
    process.exit(1);
  }
  
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected successfully\n');
    
    const db = mongoose.connection.db;
    const results = {
      created: [],
      existing: [],
      errors: []
    };
    
    // ── Products Collection Indexes ─────────────────────────────────────────
    console.log('Checking Products collection indexes...');
    const productsCol = db.collection('products');
    
    const productIndexes = [
      {
        name: 'slug_unique',
        spec: { slug: 1 },
        options: { unique: true, background: true },
        description: 'Product URL uniqueness (SEO)'
      },
      {
        name: 'sku_unique',
        spec: { sku: 1 },
        options: { unique: true, sparse: true, background: true },
        description: 'SKU uniqueness'
      },
      {
        name: 'externalId_unique',
        spec: { externalId: 1 },
        options: { unique: true, sparse: true, background: true },
        description: 'External ID uniqueness (WordPress sync)'
      },
      {
        name: 'isActive_stock',
        spec: { isActive: 1, stock: 1 },
        options: { background: true },
        description: 'Product listing with stock filter'
      },
      {
        name: 'categories_isActive',
        spec: { categories: 1, isActive: 1 },
        options: { background: true },
        description: 'Category browsing'
      },
      {
        name: 'brand_isActive_createdAt',
        spec: { brand: 1, isActive: 1, createdAt: -1 },
        options: { background: true },
        description: 'Brand filtering + sorting (NEW ARRIVALS)'
      },
      {
        name: 'categories_price_isActive',
        spec: { categories: 1, price: 1, isActive: 1 },
        options: { background: true },
        description: 'Category + price range filtering'
      },
      {
        name: 'isActive_createdAt',
        spec: { isActive: 1, createdAt: -1 },
        options: { background: true },
        description: 'New arrivals / homepage'
      },
      {
        name: 'averageRating_desc',
        spec: { averageRating: -1 },
        options: { background: true },
        description: 'Top rated products'
      },
      {
        name: 'compatibleVehicles',
        spec: { compatibleVehicles: 1 },
        options: { background: true },
        description: 'Vehicle-specific products'
      },
      {
        name: 'isFeatured',
        spec: { isFeatured: 1 },
        options: { background: true },
        description: 'Featured products'
      },
      {
        name: 'isFastMoving',
        spec: { isFastMoving: 1 },
        options: { background: true },
        description: 'Fast-moving products'
      },
      {
        name: 'text_search',
        spec: { name: 'text', tags: 'text', brand: 'text' },
        options: { background: true },
        description: 'Full-text search'
      }
    ];
    
    for (const idx of productIndexes) {
      try {
        await productsCol.createIndex(idx.spec, idx.options);
        results.created.push(`Products.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.code === 86 || err.message.includes('already exists') || err.message.includes('same name')) {
          results.existing.push(`Products.${idx.name}`);
          console.log(`  ⊘ Already exists: ${idx.name}`);
        } else {
          results.errors.push(`Products.${idx.name}: ${err.message}`);
          console.error(`  ✗ Error: ${idx.name} - ${err.message}`);
        }
      }
    }
    
    // ── Users Collection Indexes ────────────────────────────────────────────
    console.log('\nChecking Users collection indexes...');
    const usersCol = db.collection('users');
    
    const userIndexes = [
      {
        name: 'email_unique',
        spec: { email: 1 },
        options: { unique: true, background: true },
        description: 'Email uniqueness'
      },
      {
        name: 'role',
        spec: { role: 1 },
        options: { background: true },
        description: 'User role filtering'
      },
      {
        name: 'wpId_unique',
        spec: { wpId: 1 },
        options: { unique: true, sparse: true, background: true },
        description: 'WooCommerce customer linkage (ADR-005)'
      }
    ];

    for (const idx of userIndexes) {
      try {
        await usersCol.createIndex(idx.spec, idx.options);
        results.created.push(`Users.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.code === 86 || err.message.includes('already exists') || err.message.includes('same name')) {
          results.existing.push(`Users.${idx.name}`);
          console.log(`  ⊘ Already exists: ${idx.name}`);
        } else {
          results.errors.push(`Users.${idx.name}: ${err.message}`);
          console.error(`  ✗ Error: ${idx.name} - ${err.message}`);
        }
      }
    }
    
    // ── Carts Collection Indexes ────────────────────────────────────────────
    console.log('\nChecking Carts collection indexes...');
    const cartsCol = db.collection('carts');
    
    const cartIndexes = [
      {
        name: 'sessionId',
        spec: { sessionId: 1 },
        options: {
          unique: true,
          partialFilterExpression: { sessionId: { $exists: true } },
          background: true
        },
        description: 'Guest cart lookup (unique per session, partial index)'
      },
      {
        name: 'user',
        spec: { user: 1 },
        options: {
          unique: true,
          partialFilterExpression: { user: { $exists: true } },
          background: true
        },
        description: 'Authenticated user cart lookup (unique per user, partial index)'
      }
    ];
    
    for (const idx of cartIndexes) {
      try {
        await cartsCol.createIndex(idx.spec, idx.options);
        results.created.push(`Carts.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.code === 86 || err.message.includes('already exists') || err.message.includes('same name')) {
          results.existing.push(`Carts.${idx.name}`);
          console.log(`  ⊘ Already exists: ${idx.name}`);
        } else {
          results.errors.push(`Carts.${idx.name}: ${err.message}`);
          console.error(`  ✗ Error: ${idx.name} - ${err.message}`);
        }
      }
    }
    
    // ── Orders Collection Indexes ───────────────────────────────────────────
    console.log('\nChecking Orders collection indexes...');
    const ordersCol = db.collection('orders');
    
    const orderIndexes = [
      {
        name: 'user_createdAt',
        spec: { user: 1, createdAt: -1 },
        options: { background: true },
        description: 'User order history'
      },
      {
        name: 'status_createdAt',
        spec: { status: 1, createdAt: -1 },
        options: { background: true },
        description: 'Order status filtering'
      },
      {
        name: 'razorpayOrderId',
        spec: { 'payment.razorpayOrderId': 1 },
        options: { sparse: true, background: true },
        description: 'Razorpay order lookup'
      },
      {
        name: 'sessionId',
        spec: { sessionId: 1 },
        options: {
          partialFilterExpression: { sessionId: { $exists: true } },
          background: true
        },
        description: 'Guest order lookup (order confirmation, tracking, partial index)'
      },
      {
        name: 'wpId_unique',
        spec: { wpId: 1 },
        options: { unique: true, sparse: true, background: true },
        description: 'WooCommerce order linkage (ADR-005)'
      },
      {
        name: 'source',
        spec: { source: 1 },
        options: { background: true },
        description: 'Separate historical WooCommerce orders from live web orders (ADR-005)'
      },
      {
        name: 'refundDetails.transactionId',
        spec: { 'refundDetails.transactionId': 1 },
        options: { sparse: true, background: true },
        description: 'Refund webhook fallback lookup by Razorpay refund id (findOneByRefundId)'
      }
    ];

    for (const idx of orderIndexes) {
      try {
        await ordersCol.createIndex(idx.spec, idx.options);
        results.created.push(`Orders.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.code === 86 || err.message.includes('already exists') || err.message.includes('same name')) {
          results.existing.push(`Orders.${idx.name}`);
          console.log(`  ⊘ Already exists: ${idx.name}`);
        } else {
          results.errors.push(`Orders.${idx.name}: ${err.message}`);
          console.error(`  ✗ Error: ${idx.name} - ${err.message}`);
        }
      }
    }
    
    // ── Reviews Collection Indexes (ADR-005) ────────────────────────────────
    console.log('\nChecking Reviews collection indexes...');
    const reviewsCol = db.collection('reviews');

    // Reconcile the legacy {product,user} unique index. Older deployments created it WITHOUT
    // the partial filter, which would falsely collide guest/imported/manual reviews (user
    // unset → all treated as null). Drop the non-partial version so the partial one (below)
    // can take its place. Idempotent: a no-op once the partial index exists.
    try {
      const existing = await reviewsCol.indexes();
      const legacy = existing.find(i => i.name === 'product_1_user_1' && !i.partialFilterExpression);
      if (legacy) {
        await reviewsCol.dropIndex('product_1_user_1');
        console.log('  ↻ Dropped legacy product_1_user_1 (missing partial filter)');
      }
    } catch (err) {
      console.warn(`  ⚠ Could not reconcile product_1_user_1: ${err.message}`);
    }

    const reviewIndexes = [
      {
        name: 'product_isApproved',
        spec: { product: 1, isApproved: 1 },
        options: { background: true },
        description: 'Approved reviews per product'
      },
      {
        name: 'product_user_unique',
        spec: { product: 1, user: 1 },
        options: { unique: true, partialFilterExpression: { user: { $exists: true } }, background: true },
        description: 'One review per user per product (partial — excludes guest/imported)'
      },
      {
        name: 'isTestimonial_isApproved',
        spec: { isTestimonial: 1, isApproved: 1 },
        options: { background: true },
        description: 'Homepage testimonials feed'
      },
      {
        name: 'wpId_unique',
        spec: { wpId: 1 },
        options: { unique: true, sparse: true, background: true },
        description: 'WooCommerce review linkage (ADR-005)'
      }
    ];

    for (const idx of reviewIndexes) {
      try {
        await reviewsCol.createIndex(idx.spec, idx.options);
        results.created.push(`Reviews.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.code === 86 || err.message.includes('already exists') || err.message.includes('same name')) {
          results.existing.push(`Reviews.${idx.name}`);
          console.log(`  ⊘ Already exists: ${idx.name}`);
        } else {
          results.errors.push(`Reviews.${idx.name}: ${err.message}`);
          console.error(`  ✗ Error: ${idx.name} - ${err.message}`);
        }
      }
    }

    // ── Articles Collection Indexes (ADR-005) ───────────────────────────────
    console.log('\nChecking Articles collection indexes...');
    const articlesCol = db.collection('articles');

    const articleIndexes = [
      {
        name: 'slug_unique',
        spec: { slug: 1 },
        options: { unique: true, background: true },
        description: 'Article lookup by slug (also serves root /<slug> blog route)'
      },
      {
        name: 'type_status_publishedAt',
        spec: { type: 1, status: 1, publishedAt: -1 },
        options: { background: true },
        description: 'Blog/news listing'
      },
      {
        name: 'wpId_unique',
        spec: { wpId: 1 },
        options: { unique: true, sparse: true, background: true },
        description: 'WordPress post linkage (ADR-005)'
      }
    ];

    for (const idx of articleIndexes) {
      try {
        await articlesCol.createIndex(idx.spec, idx.options);
        results.created.push(`Articles.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.code === 86 || err.message.includes('already exists') || err.message.includes('same name')) {
          results.existing.push(`Articles.${idx.name}`);
          console.log(`  ⊘ Already exists: ${idx.name}`);
        } else {
          results.errors.push(`Articles.${idx.name}: ${err.message}`);
          console.error(`  ✗ Error: ${idx.name} - ${err.message}`);
        }
      }
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n=== Migration Summary ===');
    console.log(`✓ Created: ${results.created.length} indexes`);
    console.log(`⊘ Already existed: ${results.existing.length} indexes`);
    console.log(`✗ Errors: ${results.errors.length} indexes`);
    
    if (results.errors.length > 0) {
      console.error('\nErrors encountered:');
      results.errors.forEach(err => console.error(`  - ${err}`));
    }
    
    if (results.errors.length === 0) {
      console.log('\n✓ All critical indexes are in place');
    }
    
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
  }
}

// Run migration
ensureProductionIndexes();
