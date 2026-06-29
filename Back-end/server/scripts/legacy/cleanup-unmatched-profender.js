// Cleanup unmatched Profender products
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';

// Load environment variables
dotenv.config();

async function cleanupUnmatchedProfenderProducts() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // List of actual Profender products from the live site
    const liveSiteProducts = [
      "Hilux Revo Policeman Bodykit",
      "Toyota Hilux Roof Rail with Cross Bar",
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
      "Adventure Metal Canopy V1 for Toyota Hilux",
      "Suzuki Swift (2018–2023) Carbon Fiber Hood",
      "M.A.R.K. SPORTS Snatch Strap 11000Kg",
      "M.A.R.K. SPORTS Side Awning",
      "M.A.R.K. SPORTS Fox Awning",
      "Mahindra Thar 2020 8 Inch Wide Fender Flares",
      "M.A.R.K. SPORTS Fox-wing 270° Awning Curtains model",
      "BMW 3 Series F30 / F35 M3 Body Kit",
      "M.A.R.K Sports Universal Cross bar and Roof box COMBO",
      "M.A.R.K. Sports Roof Box 480L",
      "M.A.R.K. Sports Roof Box 600L",
      "12th Gen Universal Carbon Fibre Rear Spoiler for Sedan (High Bracket)",
      "13 gen universal carbon fibre rear spoiler for sedan",
      "Prado Style Carbon Fibre Design Steering Wheel for Toyota Hilux, Fortuner & Crysta",
      "Mahindra Thar King Kong Style Headlight",
      "Armando Roll Bar for Toyota Hilux",
      "Toyota innova hycross maybach grill",
      "Universal Sedan Electric Retractable Spoiler",
      "Mahindra Thar 2020 overhead storage mesh",
      "Mahindra Thar 2020 Overhead Storage Net",
      "Roll Cage Storage Tubes (Pair)",
      "Mahindra Thar 2020 Trunk Storage Bag",
      "Mahindra Thar 2020 Roll Bar Cage Storage Bag",
      "Mahindra Thar 2020 Waterproof Canvas Seat Cover",
      "Mahindra Thar 2020 Convertible Soft Top",
      "Profender King Series Full Kit Suspension For Toyota fortuner",
      "profender king series full kit suspension for ford endeavour",
      "Volkswagen polo q2 smoke taillight",
      "Aftermarket Carbon Steering Wheel for Maruti Suzuki Swift"
    ];
    
    console.log(`📊 Found ${liveSiteProducts.length} Profender products on live site`);
    
    // Get all Profender products from our database
    const dbProducts = await Product.find({ brand: 'Profender' });
    console.log(`💾 Found ${dbProducts.length} Profender products in database`);
    
    // Identify unmatched products
    const unmatchedProducts = dbProducts.filter(dbProduct => {
      // Check if the product name exists in the live site list
      return !liveSiteProducts.some(liveProduct => 
        liveProduct.toLowerCase() === dbProduct.name.toLowerCase()
      );
    });
    
    console.log(`❌ Found ${unmatchedProducts.length} unmatched Profender products`);
    
    if (unmatchedProducts.length > 0) {
      console.log('\n🗑️ Unmatched products to be removed:');
      unmatchedProducts.forEach((product, index) => {
        console.log(`${index + 1}. ${product.name}`);
      });
      
      // Confirm removal
      console.log('\n⚠️  Removing unmatched products...');
      let removedCount = 0;
      
      for (const product of unmatchedProducts) {
        try {
          // Soft delete by setting isActive to false
          await Product.findByIdAndUpdate(product._id, { isActive: false });
          console.log(`   ✅ Removed: ${product.name}`);
          removedCount++;
        } catch (error) {
          console.error(`   ❌ Failed to remove ${product.name}:`, error.message);
        }
      }
      
      console.log(`\n🎉 Cleanup completed! Removed ${removedCount} unmatched products.`);
    } else {
      console.log('✅ All Profender products in database match the live site.');
    }
    
    // Final verification
    const remainingProducts = await Product.find({ brand: 'Profender', isActive: true });
    console.log(`\n📊 Final count of active Profender products: ${remainingProducts.length}`);
    
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error cleaning up unmatched Profender products:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run cleanup
cleanupUnmatchedProfenderProducts();