/**
 * Quick Vehicle-Product Mapping Script
 * Creates test mappings between vehicles and products
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

async function createTestMappings() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected\n');

    const Product = (await import('../models/Product.js')).default;
    const Vehicle = (await import('../models/Vehicle.js')).default;

    // Check what we have
    const totalProducts = await Product.countDocuments({ isActive: true });
    const totalVehicles = await Vehicle.countDocuments({ isActive: true });
    
    console.log(`Total active products: ${totalProducts}`);
    console.log(`Total active vehicles: ${totalVehicles}\n`);

    if (totalVehicles === 0) {
      console.log('⚠️  No vehicles found in database!');
      console.log('   You need to create vehicles first.\n');
      await mongoose.connection.close();
      return;
    }

    if (totalProducts === 0) {
      console.log('⚠️  No products found in database!');
      console.log('   You need to import products first.\n');
      await mongoose.connection.close();
      return;
    }

    // Get all vehicles
    const vehicles = await Vehicle.find({ isActive: true });
    console.log(`Found vehicles:`);
    vehicles.forEach(v => {
      console.log(`  - ${v.make} ${v.model} (${v.slug})`);
    });
    console.log('');

    // Strategy: Map ALL products to ALL vehicles (universal compatibility)
    // This is a quick way to populate the system for testing
    console.log('Creating universal product-vehicle mappings...');
    
    const vehicleIds = vehicles.map(v => v._id);
    
    const result = await Product.updateMany(
      { isActive: true },
      { $set: { compatibleVehicles: vehicleIds } }
    );

    console.log(`✓ Updated ${result.modifiedCount} products`);
    console.log(`  All active products are now compatible with all vehicles.\n`);

    // Verify
    const productsWithMappings = await Product.countDocuments({
      compatibleVehicles: { $exists: true, $ne: [] }
    });
    
    console.log(`Products with vehicle mappings: ${productsWithMappings}`);
    
    // Sample check
    const fortuner = await Vehicle.findOne({ slug: 'toyota-fortuner' });
    if (fortuner) {
      const fortunerProducts = await Product.countDocuments({
        compatibleVehicles: fortuner._id
      });
      console.log(`Products compatible with Toyota Fortuner: ${fortunerProducts}\n`);
    }

    await mongoose.connection.close();
    console.log('✓ Done!');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

createTestMappings();
