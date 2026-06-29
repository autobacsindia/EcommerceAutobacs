import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function analyzeProductCounts() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n📊 Analyzing product counts...');
    
    // Total products
    const totalCount = await Product.countDocuments();
    console.log(`Total products in database: ${totalCount}`);
    
    // Active products
    const activeCount = await Product.countDocuments({ isActive: true });
    console.log(`Active products: ${activeCount}`);
    
    // Inactive products
    const inactiveCount = await Product.countDocuments({ isActive: false });
    console.log(`Inactive products: ${inactiveCount}`);
    
    // Products with stock
    const inStockCount = await Product.countDocuments({ stock: { $gt: 0 } });
    console.log(`Products in stock: ${inStockCount}`);
    
    // Out of stock products
    const outOfStockCount = await Product.countDocuments({ stock: 0 });
    console.log(`Out of stock products: ${outOfStockCount}`);
    
    // Products by brand
    const brands = await Product.distinct('brand');
    console.log(`\nUnique brands: ${brands.length}`);
    
    // Count products by brand
    console.log('\nProducts by brand:');
    for (const brand of brands) {
      const count = await Product.countDocuments({ brand: brand });
      console.log(`  ${brand}: ${count}`);
    }
    
    // Featured products
    const featuredCount = await Product.countDocuments({ isFeatured: true });
    console.log(`\nFeatured products: ${featuredCount}`);
    
    // Products without categories
    const noCategoryCount = await Product.countDocuments({ categories: { $exists: false } });
    console.log(`Products without categories: ${noCategoryCount}`);
    
    // Products with external ID
    const withExternalIdCount = await Product.countDocuments({ externalId: { $exists: true } });
    console.log(`Products with external ID: ${withExternalIdCount}`);
    
    // Products without external ID
    const withoutExternalIdCount = await Product.countDocuments({ externalId: { $exists: false } });
    console.log(`Products without external ID: ${withoutExternalIdCount}`);
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

analyzeProductCounts();