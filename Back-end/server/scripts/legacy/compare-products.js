// Compare database products with live site products
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('✅ Connected to MongoDB');
  
  try {
    // Find all Profender products in database
    console.log('🔍 Finding all Profender products in database...');
    const dbProducts = await Product.find({ brand: 'Profender' }).sort({ name: 1 });
    console.log(`📊 Found ${dbProducts.length} Profender products in database`);
    
    console.log('\n📦 Database Profender Products:');
    dbProducts.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name}`);
      console.log(`   Price: ${product.price}`);
      console.log(`   SKU: ${product.sku}`);
    });
    
    // Check if these match the live site products we found earlier
    console.log('\n🔍 Comparing with live site products...');
    
    // Get the live site products (hardcoded from our previous analysis)
    const liveSiteProducts = [
      "Toyota Hilux Comfort Shackles",
      "Toyota Hilux Smoked LED Tail Light",
      "Scorpio N bonnet light mount",
      "Snorkel for Hilux",
      "GR Sport Tailgate Cover for Toyota Hilux",
      "Armando Style Hilux Rear Bumper",
      "Wrangler style hood for mahindra thar and thar roxx",
      "Mahindra Thar Roxx Front Grill",
      "BMW 7 Series F01 to G70 Facelift Conversion Kit",
      "Fortuner Type 1 (2009–2012) Lexus Style Headlights",
      "Toyota Hilux Tundra Kit Full Upgrade Bundle",
      "Auxbeam 5D Series Combo Curved Dual Row LED Light Bars",
      "BMW X6 E71 2006-2013 to G06 LCI F96 Upgrade Facelift Conversion Kit",
      "Honda Civic Type R Bodykit – Premium Conversion Kit for 2019–2020 Civic",
      "Mini Cooper JCW Body kit with spoiler",
      "Lumma Wide Body Kit for Land Rover Defender 110",
      "BMW 3 Series GT F34 Body Kit with M4 style Front Bumper, Rear Bumper & Side Skirts",
      "Toyota Hilux to LC300 Front Conversion Kit",
      "Toyota Fortuner Type 3/4 to LC300 Front Conversion Kit",
      "Adventure Metal Canopy V1 for Toyota Hilux"
    ];
    
    console.log('\n✅ Database vs Live Site Comparison:');
    let matchCount = 0;
    
    liveSiteProducts.forEach((liveProduct, index) => {
      const foundInDb = dbProducts.some(dbProduct => 
        dbProduct.name.toLowerCase() === liveProduct.toLowerCase()
      );
      
      if (foundInDb) {
        matchCount++;
        console.log(`  ✅ ${index + 1}. ${liveProduct}`);
      } else {
        console.log(`  ❌ ${index + 1}. ${liveProduct}`);
      }
    });
    
    console.log(`\n📈 Match Summary: ${matchCount}/${liveSiteProducts.length} products match`);
    
    if (matchCount === liveSiteProducts.length) {
      console.log('🎉 Perfect match! All live site Profender products are in the database.');
    } else if (matchCount > 0) {
      console.log('⚠️ Partial match. Some products may need to be imported or updated.');
    } else {
      console.log('❌ No matches found. The database products are completely different.');
    }
    
    mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error comparing products:', error.message);
    mongoose.connection.close();
  }
});