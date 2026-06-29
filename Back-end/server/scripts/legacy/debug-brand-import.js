import dotenv from 'dotenv';
import mongoose from 'mongoose';
import BrandProductImportService from '../../services/brandProductImportService.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    console.log('Testing Profender brand product import...');
    
    const importService = new BrandProductImportService();
    
    // Test fetching products first
    console.log('Testing fetch of Profender products...');
    const products = await importService.fetchProductsByBrandFromWordPress('Profender', 1, 5);
    console.log(`Found ${products.length} Profender products`);
    
    if (products.length > 0) {
      console.log('First product:', products[0].name);
    }
    
    // Test getting total count
    console.log('Testing total product count for Profender...');
    const totalCount = await importService.getTotalProductCountByBrand('Profender');
    console.log(`Total Profender products: ${totalCount}`);
    
    // Close the database connection
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error testing Profender import:', error.message);
    console.error(error.stack);
    
    // Close the database connection
    mongoose.connection.close();
  }
});