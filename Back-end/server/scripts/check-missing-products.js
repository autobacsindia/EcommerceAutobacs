// Check if there are new products in WordPress that need to be imported to MongoDB

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';

// Load environment variables
dotenv.config();

const WP_BASE = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
const AUTH = {
  username: process.env.WORDPRESS_API_KEY,
  password: process.env.WORDPRESS_API_SECRET
};

async function checkProducts() {
  console.log('🔍 Checking for missing products...\n');

  try {
    // 1. Check WordPress product count
    console.log('1️⃣ Checking WordPress...');
    
    const wpResponse = await axios.get(`${WP_BASE}/wp-json/wc/v3/products`, {
      auth: AUTH,
      params: { per_page: 1, status: 'publish' }
    });
    
    const wpTotal = parseInt(wpResponse.headers['x-wp-total']);
    console.log(`✅ WordPress products: ${wpTotal}\n`);

    // 2. Check MongoDB product count
    console.log('2️⃣ Checking MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const Product = mongoose.models.Product || mongoose.model('Product', new mongoose.Schema({}, { strict: false }));
    const mongoCount = await Product.countDocuments();
    console.log(`✅ MongoDB products: ${mongoCount}\n`);

    // 3. Compare
    console.log('3️⃣ Comparison:');
    console.log(`   WordPress: ${wpTotal}`);
    console.log(`   MongoDB:   ${mongoCount}`);
    
    const difference = wpTotal - mongoCount;
    
    if (difference === 0) {
      console.log('\n✅ PERFECT SYNC! No missing products.');
    } else if (difference > 0) {
      console.log(`\n⚠️  MISSING ${difference} product(s) in MongoDB!`);
      console.log('\n📝 To import missing products, run:');
      console.log('   node find-and-import-missing.js\n');
    } else {
      console.log(`\nℹ️  MongoDB has ${Math.abs(difference)} more product(s) than WordPress`);
      console.log('   (This might be intentional - manually added products)\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);
  }
}

checkProducts();
