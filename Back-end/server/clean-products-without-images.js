import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';

dotenv.config();

const MONGO_URI= process.env.MONGO_URI;

async function cleanProducts() {
  try {
    await mongoose.connect(MONGO_URI);
   console.log('✓ Connected to MongoDB');

   const Product = mongoose.model('Product');

    // Count products without images
   const beforeCount= await Product.countDocuments({
      $or: [
        { images: { $size: 0 } },
        { images: null },
        { images: [] }
      ]
    });
   console.log(`📊 Products without images: ${beforeCount}`);

    if (beforeCount === 0) {
     console.log('✓ All products have images!');
      await mongoose.disconnect();
     return;
    }

    // Show sample of affected products
   const sampleProducts = await Product.find({
      $or: [
        { images: { $size: 0 } },
        { images: null },
        { images: [] }
      ]
    }).limit(5).select('name sku');

   console.log('\nSample products that will be updated:');
    sampleProducts.forEach((p, i) => {
     console.log(`  ${i + 1}. ${p.name || 'Unnamed'} (${p.sku || 'No SKU'})`);
    });

    // Add placeholder images to all products without images
   const updateResult= await Product.updateMany(
      {
        $or: [
          { images: { $size: 0 } },
          { images: null },
          { images: [] }
        ]
      },
      {
        $set: {
         images: [{
            url: '/images/fallback-product.png',
           alt: 'Product image',
           isPrimary: true
          }]
        }
      }
    );
   console.log(`\n✓ Added placeholder images to ${updateResult.modifiedCount} products`);

    // Verify cleanup was successful
   const afterCount = await Product.countDocuments({
      $or: [
        { images: { $size: 0 } },
        { images: null },
        { images: [] }
      ]
    });
   console.log(`\n📊 Remaining products without images: ${afterCount}`);

    if (afterCount === 0) {
     console.log('\n✅ SUCCESS! All products now have images.');
    } else {
     console.log(`\n⚠️ Warning: ${afterCount} products still missing images`);
    }

    await mongoose.disconnect();
   console.log('✓ Disconnected from MongoDB');
  } catch (error) {
   console.error('❌ Error:', error.message);
   console.error(error);
    process.exit(1);
  }
}

cleanProducts();
