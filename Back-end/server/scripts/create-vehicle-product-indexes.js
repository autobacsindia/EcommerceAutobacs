/**
 * Create Database Indexes for Vehicle-Product Mapping
 * 
 * This script creates optimized indexes for efficient vehicle-product queries
 * as per the design document specifications.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import Vehicle from '../models/Vehicle.js';

dotenv.config();

async function createIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB\n');
    
    // Product Collection Indexes
    console.log('Creating Product collection indexes...');
    
    // Index on compatibleVehicles array field for $in queries
    await Product.collection.createIndex(
      { compatibleVehicles: 1 },
      { name: 'compatibleVehicles_1', background: true }
    );
    console.log('✓ Created index: compatibleVehicles_1');
    
    // Note: Cannot create compound index with multiple array fields (categories + compatibleVehicles)
    // Using separate indexes instead
    
    // Compound index for filtered queries (vehicle + active status)
    await Product.collection.createIndex(
      { compatibleVehicles: 1, isActive: 1 },
      { name: 'vehicle_active', background: true }
    );
    console.log('✓ Created index: vehicle_active');
    
    // Compound index for price-filtered queries
    await Product.collection.createIndex(
      { compatibleVehicles: 1, price: 1 },
      { name: 'vehicle_price', background: true }
    );
    console.log('✓ Created index: vehicle_price');
    
    // Compound index for stock filtering
    await Product.collection.createIndex(
      { compatibleVehicles: 1, stock: 1 },
      { name: 'vehicle_stock', background: true }
    );
    console.log('✓ Created index: vehicle_stock');
    
    // Vehicle Collection Indexes
    console.log('\nCreating Vehicle collection indexes...');
    
    // Unique index on slug for URL resolution (may already exist)
    try {
      await Vehicle.collection.createIndex(
        { slug: 1 },
        { name: 'slug_unique', unique: true, background: true }
      );
      console.log('✓ Created index: slug_unique');
    } catch (error) {
      if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
        console.log('✓ Index slug_unique already exists');
      } else {
        throw error;
      }
    }
    
    // Compound index for vehicle browsing
    try {
      await Vehicle.collection.createIndex(
        { make: 1, model: 1, year: 1 },
        { name: 'make_model_year', background: true }
      );
      console.log('✓ Created index: make_model_year');
    } catch (error) {
      if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
        console.log('✓ Index make_model_year already exists');
      } else {
        throw error;
      }
    }
    
    // Index on isActive for filtering
    await Vehicle.collection.createIndex(
      { isActive: 1 },
      { name: 'isActive_1', background: true }
    );
    console.log('✓ Created index: isActive_1');
    
    // List all indexes to verify
    console.log('\n--- Product Collection Indexes ---');
    const productIndexes = await Product.collection.indexes();
    productIndexes.forEach(index => {
      console.log(`  ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log('\n--- Vehicle Collection Indexes ---');
    const vehicleIndexes = await Vehicle.collection.indexes();
    vehicleIndexes.forEach(index => {
      console.log(`  ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log('\n✓ All indexes created successfully!');
    
  } catch (error) {
    console.error('Error creating indexes:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

// Run the script
createIndexes();
