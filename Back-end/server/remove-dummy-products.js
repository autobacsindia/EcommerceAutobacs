import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';

dotenv.config();

async function listAndRemoveDummyProducts() {
  try {
    console.log('🔍 Finding dummy products (no images or placeholder URLs)...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ Connected to MongoDB\n');

    // Find all products
    const allProducts = await Product.find({});
    console.log(`📊 Total products in database: ${allProducts.length}\n`);

    // Identify dummy products (placeholder image URLs or no images)
    const dummyProducts = allProducts.filter(p => {
      const hasNoImages = !p.images || p.images.length === 0;
      const hasPlaceholderImage = p.images && p.images.some(img => 
        img.url && img.url.includes('placeholder.com')
      );
      return hasNoImages || hasPlaceholderImage;
    });

    if (dummyProducts.length === 0) {
      console.log('✅ No dummy products found!');
      process.exit(0);
    }

    console.log(`⚠️  Found ${dummyProducts.length} dummy products:\n`);
    
    dummyProducts.forEach((p, index) => {
      const imageUrl = p.images?.[0]?.url || 'NO IMAGE';
      const isPlaceholder = imageUrl.includes('placeholder.com') ? '(PLACEHOLDER)' : '';
      console.log(`${index + 1}. ${p.name}`);
      console.log(`   Slug: ${p.slug}`);
      console.log(`   Price: ₹${p.price}`);
      console.log(`   Image: ${imageUrl.substring(0, 60)}... ${isPlaceholder}`);
      console.log(`   Category: ${p.category || 'None'}`);
      console.log('');
    });

    // Remove dummy products
    console.log('\n🗑️  Removing dummy products...\n');
    
    for (const product of dummyProducts) {
      await Product.findByIdAndDelete(product._id);
      console.log(`   ✅ Deleted: ${product.name}`);
    }

    console.log('\n✨ ====================================');
    console.log('✨ Dummy product removal complete!');
    console.log('✨ ====================================');
    console.log(`\n📈 Summary:`);
    console.log(`   Products removed: ${dummyProducts.length}`);
    console.log(`   Products remaining: ${allProducts.length - dummyProducts.length}`);
    console.log('\n✅ All dummy/placeholder products deleted!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

listAndRemoveDummyProducts();

