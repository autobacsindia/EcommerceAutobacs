import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Function to verify the final state of accessories category
const finalVerification = async () => {
  try {
    // Find the accessories category
    const category = await Category.findOne({ slug: 'accessories', isActive: true });
    
    if (!category) {
      console.log('Accessories category not found');
      return;
    }
    
    console.log(`=== FINAL VERIFICATION REPORT ===`);
    console.log(`Accessories Category: ${category.name}`);
    
    // Count total products in accessories category
    const totalProducts = await Product.countDocuments({ 
      category: category._id
    });
    
    console.log(`Total products (active + inactive): ${totalProducts}`);
    
    // Count active products
    const activeProducts = await Product.countDocuments({ 
      category: category._id, 
      isActive: true 
    });
    
    console.log(`Active products: ${activeProducts}`);
    
    // Count inactive products
    const inactiveProducts = await Product.countDocuments({ 
      category: category._id, 
      isActive: false 
    });
    
    console.log(`Inactive products: ${inactiveProducts}`);
    
    // Count products without SKU
    const productsWithoutSKU = await Product.countDocuments({ 
      category: category._id,
      $or: [{ sku: { $exists: false } }, { sku: null }, { sku: "" }]
    });
    
    console.log(`Products without SKU: ${productsWithoutSKU}`);
    
    // Verify that active product count matches expected value
    if (activeProducts === 69) {
      console.log(`✅ SUCCESS: Active product count matches expected value (69)`);
    } else {
      console.log(`❌ FAILURE: Active product count (${activeProducts}) does not match expected value (69)`);
    }
    
    // Show some sample active products
    console.log(`\n=== SAMPLE ACTIVE PRODUCTS ===`);
    const sampleProducts = await Product.find({ 
      category: category._id, 
      isActive: true 
    })
    .limit(5)
    .select('name sku price');
    
    sampleProducts.forEach(product => {
      console.log(`- ${product.name} | SKU: ${product.sku || 'None'} | Price: ₹${product.price}`);
    });
    
    // Show some sample inactive products (mismatched ones)
    console.log(`\n=== SAMPLE INACTIVE (MISMATCHED) PRODUCTS ===`);
    const sampleInactiveProducts = await Product.find({ 
      category: category._id, 
      isActive: false,
      notes: { $regex: "Deactivated: Not present on live site" }
    })
    .limit(5)
    .select('name sku price notes');
    
    if (sampleInactiveProducts.length > 0) {
      sampleInactiveProducts.forEach(product => {
        console.log(`- ${product.name} | SKU: ${product.sku || 'None'} | ${product.notes}`);
      });
    } else {
      console.log("No mismatched products found");
    }
    
  } catch (error) {
    console.error('Error during final verification:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  await finalVerification();
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('\nDatabase connection closed');
};

main();