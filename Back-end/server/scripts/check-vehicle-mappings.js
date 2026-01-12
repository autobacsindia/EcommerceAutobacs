import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function checkMappings() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    const Product = (await import('../models/Product.js')).default;
    const Vehicle = (await import('../models/Vehicle.js')).default;

    // Check total products
    const totalProducts = await Product.countDocuments();
    console.log(`Total products in database: ${totalProducts}`);

    // Check products with vehicle mappings
    const productsWithMappings = await Product.countDocuments({
      compatibleVehicles: { $exists: true, $ne: [] }
    });
    console.log(`Products with vehicle mappings: ${productsWithMappings}`);

    // Check total vehicles
    const totalVehicles = await Vehicle.countDocuments();
    console.log(`Total vehicles in database: ${totalVehicles}\n`);

    if (totalVehicles > 0) {
      // Get sample vehicle
      const sampleVehicle = await Vehicle.findOne().limit(1);
      console.log(`Sample vehicle: ${sampleVehicle.make} ${sampleVehicle.model} (${sampleVehicle.slug})`);
      
      // Check products for this vehicle
      const vehicleProducts = await Product.countDocuments({
        compatibleVehicles: sampleVehicle._id
      });
      console.log(`Products compatible with ${sampleVehicle.slug}: ${vehicleProducts}\n`);
    }

    if (productsWithMappings === 0) {
      console.log('⚠️  No vehicle-product mappings found!');
      console.log('   Run the migration script to populate mappings:');
      console.log('   node scripts/migrate-vehicle-product-mappings.js --dry-run');
      console.log('   node scripts/migrate-vehicle-product-mappings.js\n');
    }

    await mongoose.connection.close();
    console.log('✓ Database connection closed');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkMappings();
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function checkMappings() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    const Product = (await import('../models/Product.js')).default;
    const Vehicle = (await import('../models/Vehicle.js')).default;

    // Check total products
    const totalProducts = await Product.countDocuments();
    console.log(`Total products in database: ${totalProducts}`);

    // Check products with vehicle mappings
    const productsWithMappings = await Product.countDocuments({
      compatibleVehicles: { $exists: true, $ne: [] }
    });
    console.log(`Products with vehicle mappings: ${productsWithMappings}`);

    // Check total vehicles
    const totalVehicles = await Vehicle.countDocuments();
    console.log(`Total vehicles in database: ${totalVehicles}\n`);

    if (totalVehicles > 0) {
      // Get sample vehicle
      const sampleVehicle = await Vehicle.findOne().limit(1);
      console.log(`Sample vehicle: ${sampleVehicle.make} ${sampleVehicle.model} (${sampleVehicle.slug})`);
      
      // Check products for this vehicle
      const vehicleProducts = await Product.countDocuments({
        compatibleVehicles: sampleVehicle._id
      });
      console.log(`Products compatible with ${sampleVehicle.slug}: ${vehicleProducts}\n`);
    }

    if (productsWithMappings === 0) {
      console.log('⚠️  No vehicle-product mappings found!');
      console.log('   Run the migration script to populate mappings:');
      console.log('   node scripts/migrate-vehicle-product-mappings.js --dry-run');
      console.log('   node scripts/migrate-vehicle-product-mappings.js\n');
    }

    await mongoose.connection.close();
    console.log('✓ Database connection closed');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkMappings();
