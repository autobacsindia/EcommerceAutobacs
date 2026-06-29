import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../../models/Product.js";

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

async function clearProducts() {
  try {
    const totalCount = await Product.countDocuments();
    console.log(`Found ${totalCount} total products in database`);
    
    const activeCount = await Product.countDocuments({ isActive: true });
    console.log(`Active products: ${activeCount}`);
    
    const inactiveCount = await Product.countDocuments({ isActive: false });
    console.log(`Inactive products: ${inactiveCount}`);
    
    if (totalCount > 0) {
      console.log('Clearing all products...');
      // Use deleteMany with an empty filter to delete all documents
      const result = await Product.deleteMany({});
      console.log(`Deleted ${result.deletedCount} products`);
      
      // Wait a moment to ensure the deletion is complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check count again
      const newTotalCount = await Product.countDocuments();
      const newActiveCount = await Product.countDocuments({ isActive: true });
      const newInactiveCount = await Product.countDocuments({ isActive: false });
      
      console.log(`Remaining products: ${newTotalCount}`);
      console.log(`Remaining active products: ${newActiveCount}`);
      console.log(`Remaining inactive products: ${newInactiveCount}`);
    } else {
      console.log('No products to delete');
    }
    
    mongoose.connection.close();
  } catch (error) {
    console.error('Error clearing products:', error.message);
    mongoose.connection.close();
  }
}

clearProducts();