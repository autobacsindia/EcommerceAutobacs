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
        if (err.code === 85 || err.message.includes('already exists')) {
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
      }
    ];
    
    for (const idx of userIndexes) {
      try {
        await usersCol.createIndex(idx.spec, idx.options);
        results.created.push(`Users.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.message.includes('already exists')) {
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
          partialFilterExpression: { sessionId: { $exists: true, $ne: null } },
          background: true 
        },
        description: 'Guest cart lookup (unique per session, partial index)'
      },
      {
        name: 'user',
        spec: { user: 1 },
        options: { 
          unique: true, 
          partialFilterExpression: { user: { $exists: true, $ne: null } },
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
        if (err.code === 85 || err.message.includes('already exists')) {
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
          partialFilterExpression: { sessionId: { $exists: true, $ne: null } },
          background: true 
        },
        description: 'Guest order lookup (order confirmation, tracking, partial index)'
      }
    ];
    
    for (const idx of orderIndexes) {
      try {
        await ordersCol.createIndex(idx.spec, idx.options);
        results.created.push(`Orders.${idx.name} - ${idx.description}`);
        console.log(`  ✓ Created: ${idx.name}`);
      } catch (err) {
        if (err.code === 85 || err.message.includes('already exists')) {
          results.existing.push(`Orders.${idx.name}`);
          console.log(`  ⊘ Already exists: ${idx.name}`);
        } else {
          results.errors.push(`Orders.${idx.name}: ${err.message}`);
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
