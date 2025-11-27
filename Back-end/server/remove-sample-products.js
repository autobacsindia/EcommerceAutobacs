import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function removeSampleProducts() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Define the sample product SKUs that were added
    const sampleProductSkus = [
      'BP-001',    // Premium Brake Pads
      'EOF-001',   // Engine Oil Filter
      'CB-001',    // Car Battery
      'AF-001',    // Air Filter
      'SP-001',    // Spark Plugs
      'FF-001',    // Fuel Filter
      'CAF-001',   // Cabin Air Filter
      'SA-001',    // Shock Absorbers
      'MUF-001',   // Muffler
      'O2S-001',   // Oxygen Sensor
      'ALT-001',   // Alternator
      'RAD-001',   // Radiator
      'BR-001',    // Brake Rotors
      'TF-001',    // Transmission Filter
      'SR-001',    // Steering Rack
      'BP-CSV-001' // Premium Brake Pads (CSV version)
    ];
    
    console.log('Removing sample products...');
    
    // Remove products with these SKUs
    const result = await Product.deleteMany({
      sku: { $in: sampleProductSkus }
    });
    
    console.log(`Removed ${result.deletedCount} sample products`);
    
    // Also remove any products that might have been created without SKUs but match the sample names
    const sampleProductNames = [
      'Premium Brake Pads',
      'Engine Oil Filter',
      'Car Battery',
      'Air Filter',
      'Spark Plugs',
      'Fuel Filter',
      'Cabin Air Filter',
      'Shock Absorbers',
      'Muffler',
      'Oxygen Sensor',
      'Alternator',
      'Radiator',
      'Brake Rotors',
      'Transmission Filter',
      'Steering Rack'
    ];
    
    const result2 = await Product.deleteMany({
      name: { $in: sampleProductNames },
      sku: { $exists: false }
    });
    
    if (result2.deletedCount > 0) {
      console.log(`Removed ${result2.deletedCount} additional sample products without SKUs`);
    }
    
    // Final count
    const totalProducts = await Product.countDocuments({});
    console.log(`Total products remaining in database: ${totalProducts}`);
    
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error removing sample products:', error.message);
    console.error('Error stack:', error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

removeSampleProducts();