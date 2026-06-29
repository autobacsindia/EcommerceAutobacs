import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

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

// Function to verify the current state of accessories category
const verifyAccessoriesUpdate = async () => {
  try {
    // Find the accessories category
    const category = await Category.findOne({ slug: 'accessories', isActive: true });
    
    if (!category) {
      console.log('Accessories category not found');
      return;
    }
    
    console.log(`Accessories Category: ${category.name}`);
    
    // Count total products in accessories category
    const totalProducts = await Product.countDocuments({ 
      category: category._id, 
      isActive: true 
    });
    
    console.log(`Total active products: ${totalProducts}`);
    
    // Count products without SKU
    const productsWithoutSKU = await Product.countDocuments({ 
      category: category._id, 
      isActive: true,
      $or: [{ sku: { $exists: false } }, { sku: null }, { sku: "" }]
    });
    
    console.log(`Products without SKU: ${productsWithoutSKU}`);
    
    // Count inactive products (should match the duplicates we removed)
    const inactiveProducts = await Product.countDocuments({ 
      category: category._id, 
      isActive: false 
    });
    
    console.log(`Inactive products (duplicates): ${inactiveProducts}`);
    
    // Show some sample products
    const sampleProducts = await Product.find({ 
      category: category._id, 
      isActive: true 
    })
    .limit(5)
    .select('name sku price');
    
    console.log('\nSample products:');
    sampleProducts.forEach(product => {
      console.log(`- ${product.name} | SKU: ${product.sku || 'None'} | Price: ₹${product.price}`);
    });
    
  } catch (error) {
    console.error('Error verifying accessories update:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  await verifyAccessoriesUpdate();
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('\nDatabase connection closed');
};

main();