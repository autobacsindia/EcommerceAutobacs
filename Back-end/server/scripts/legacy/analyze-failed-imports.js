import ProductImportService from '../../services/productImportService.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

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

class FailedImportAnalyzer {
  constructor() {
    this.importService = new ProductImportService();
  }

  async analyzeFailedImports() {
    try {
      console.log('Analyzing failed imports...');
      
      // Get total product count
      const totalProducts = await this.importService.getTotalProductCount();
      console.log(`Total products on WordPress site: ${totalProducts}`);
      
      // Try to fetch a few products to see what might be causing failures
      console.log('\n=== Testing Product Fetching ===');
      
      // Try to fetch the first few products
      for (let i = 1; i <= 5; i++) {
        try {
          console.log(`\nFetching page ${i}...`);
          const products = await this.importService.fetchProductsFromWordPress(i, 5);
          console.log(`Successfully fetched ${products.length} products from page ${i}`);
          
          // Show details of first product on this page
          if (products.length > 0) {
            const product = products[0];
            console.log(`Sample product: ${product.name}`);
            console.log(`SKU: ${product.sku || 'N/A'}`);
            console.log(`Price: ${product.regular_price || 'N/A'}`);
            console.log(`Categories: ${product.categories ? product.categories.length : 0}`);
            console.log(`Images: ${product.images ? product.images.length : 0}`);
          }
        } catch (error) {
          console.log(`Failed to fetch page ${i}: ${error.message}`);
        }
      }
      
      // Try to transform a sample product
      console.log('\n=== Testing Product Transformation ===');
      try {
        const sampleProducts = await this.importService.fetchProductsFromWordPress(1, 1);
        if (sampleProducts.length > 0) {
          const wpProduct = sampleProducts[0];
          console.log(`Transforming product: ${wpProduct.name}`);
          
          const transformedProduct = this.importService.transformProductData(wpProduct);
          console.log('Transformed product:');
          console.log('- Name:', transformedProduct.name);
          console.log('- Price:', transformedProduct.price);
          console.log('- Stock:', transformedProduct.stock);
          console.log('- Images:', transformedProduct.images ? transformedProduct.images.length : 0);
          console.log('- Specifications:', transformedProduct.specifications ? transformedProduct.specifications.length : 0);
        }
      } catch (error) {
        console.log(`Failed to transform sample product: ${error.message}`);
      }
      
    } catch (error) {
      console.error('Error analyzing failed imports:', error.message);
    } finally {
      await mongoose.connection.close();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run the analysis
const run = async () => {
  await connectDB();
  
  const analyzer = new FailedImportAnalyzer();
  await analyzer.analyzeFailedImports();
  
  console.log('\nAnalysis completed.');
};

run();