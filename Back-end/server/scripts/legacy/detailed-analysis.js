import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function detailedAnalysis() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n🔍 Detailed Product Analysis...');
    
    // Total products
    const totalCount = await Product.countDocuments();
    console.log(`Total products: ${totalCount}`);
    
    // Products with WP- prefixed SKUs
    const wpProductCount = await Product.countDocuments({ sku: { $regex: '^WP-' } });
    console.log(`Products with WP- prefixed SKUs: ${wpProductCount}`);
    
    // Products with external IDs
    const withExternalIdCount = await Product.countDocuments({ externalId: { $exists: true } });
    console.log(`Products WITH externalId: ${withExternalIdCount}`);
    
    // Products with WP SKUs but without external IDs
    const wpWithoutExternalId = await Product.countDocuments({ 
      sku: { $regex: '^WP-' },
      externalId: { $exists: false }
    });
    console.log(`WP products WITHOUT externalId: ${wpWithoutExternalId}`);
    
    // Products with WP SKUs AND with external IDs
    const wpWithExternalId = await Product.countDocuments({ 
      sku: { $regex: '^WP-' },
      externalId: { $exists: true }
    });
    console.log(`WP products WITH externalId: ${wpWithExternalId}`);
    
    // Sample WP products without external IDs
    console.log('\n📋 Sample WP products WITHOUT externalId:');
    const sampleWPWithoutExternalId = await Product.find({ 
      sku: { $regex: '^WP-' },
      externalId: { $exists: false }
    }).limit(5);
    
    sampleWPWithoutExternalId.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (SKU: ${product.sku})`);
    });
    
    // Sample WP products with external IDs
    console.log('\n📋 Sample WP products WITH externalId:');
    const sampleWPWithExternalId = await Product.find({ 
      sku: { $regex: '^WP-' },
      externalId: { $exists: true }
    }).limit(5);
    
    sampleWPWithExternalId.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (SKU: ${product.sku}, External ID: ${product.externalId})`);
    });
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

detailedAnalysis();