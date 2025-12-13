import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function checkProductCount() {
  try {
    const count = await Product.countDocuments();
    console.log(`Total products in database: ${count}`);
    
    // List first 5 products
    const products = await Product.find().limit(5);
    console.log('\nFirst 5 products:');
    products.forEach((product, index) => {
      console.log(`${index + 1}. ${product.name} (${product._id})`);
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error checking product count:', error.message);
    mongoose.connection.close();
  }
}

checkProductCount();