import mongoose from 'mongoose';
import dotenv from 'dotenv';
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

// Function to export products from a specific category
const exportCategoryProducts = async (categorySlug) => {
  try {
    // Find the category by slug
    const category = await Category.findOne({ slug: categorySlug, isActive: true });
    
    if (!category) {
      console.log(`Category with slug '${categorySlug}' not found`);
      return;
    }
    
    console.log(`Found category: ${category.name} (${category.slug})`);
    
    // Find all products in this category
    const products = await Product.find({ 
      category: category._id, 
      isActive: true 
    })
    .populate('categories', 'name slug')
    .sort({ name: 1 });
    
    console.log(`Found ${products.length} products in category '${category.name}'`);
    
    // Create CSV header
    let csvContent = 'ID,Name,SKU,Brand,Price,Stock,Category,CreatedAt\n';
    
    // Add product data to CSV
    products.forEach(product => {
      const row = [
        product._id,
        `"${product.name.replace(/"/g, '""')}"`,
        product.sku || '',
        product.brand || '',
        product.price,
        product.stock,
        product.category ? product.category.name : '',
        product.createdAt.toISOString()
      ].join(',');
      
      csvContent += row + '\n';
    });
    
    // Save to file
    const fs = await import('fs');
    const fileName = `exported-${categorySlug}-products-${new Date().toISOString().slice(0, 10)}.csv`;
    fs.writeFileSync(fileName, csvContent);
    
    console.log(`Products exported to ${fileName}`);
    
    // Also log some sample products for quick inspection
    console.log('\nSample products:');
    products.slice(0, 5).forEach(product => {
      console.log(`- ${product.name} (${product.brand || 'No brand'}) - ₹${product.price} (SKU: ${product.sku || 'No SKU'})`);
    });
    
    return products;
  } catch (error) {
    console.error('Error exporting products:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  // Export accessories category products
  await exportCategoryProducts('accessories');
  
  // Disconnect from database
  mongoose.connection.close();
  console.log('Database connection closed');
};

main();