import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

dotenv.config();

console.log('Removing sample products from MongoDB...');

const sampleSkus = [
  'BP-001', 'EOF-001', 'CB-001', 'AF-001', 'SP-001', 
  'FF-001', 'CAF-001', 'SA-001', 'MUF-001', 'O2S-001', 
  'ALT-001', 'RAD-001', 'BR-001', 'TF-001', 'SR-001'
];

async function removeSampleProducts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
    
    console.log('✓ Connected to MongoDB');
    console.log('Database name:', mongoose.connection.name);
    
    // Delete products with matching SKUs
    const result = await Product.deleteMany({ sku: { $in: sampleSkus } });
    
    console.log(`Deleted ${result.deletedCount} sample products.`);
    
    // Verify count
    const totalProducts = await Product.countDocuments({});
    console.log(`Total products remaining in database: ${totalProducts}`);
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error removing sample products:', error.message);
    process.exit(1);
  }
}

removeSampleProducts();
