import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "./models/Product.js";
import { generateProducts } from "./helpers/generate-products.js";

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function importProducts() {
  try {
    // Generate sample products
    const products = generateProducts();
    
    console.log(`Generated ${products.length} sample products`);
    
    // Clear existing products
    await Product.deleteMany({});
    console.log('Cleared existing products');
    
    // Insert new products
    const insertedProducts = await Product.insertMany(products);
    console.log(`Successfully imported ${insertedProducts.length} products`);
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error importing products:', error.message);
    mongoose.connection.close();
  }
}

importProducts();