import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';
import Category from './models/Category.js';

dotenv.config();

async function findCategoryDuplicates() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/autobacs');
    console.log('✅ Connected to MongoDB');

    // Find products that might have category prefixes in their names
    console.log('\n🔍 Looking for products with potential category prefixes in names...');

    // Get all products with their categories populated
    const allProducts = await Product.find({}).populate('categories', 'name slug');
    
    // Create a map to group products by their "cleaned" name (without obvious category prefixes)
    const productGroups = {};
    
    for (const product of allProducts) {
      // Clean the product name by removing common category prefixes
      let cleanName = product.name.trim();
      
      // Common category prefixes that might be added to product names
      const categoryNames = product.categories.map(cat => cat.name.trim());
      
      // Remove category names from the product name to find base product name
      for (const catName of categoryNames) {
        if (cleanName.startsWith(catName + ' ')) {
          cleanName = cleanName.substring(catName.length + 1).trim();
        }
        // Also check for variations like "Category - Product Name" or "Category | Product Name"
        if (cleanName.startsWith(catName + ' - ')) {
          cleanName = cleanName.substring(catName.length + 4).trim();
        }
        if (cleanName.startsWith(catName + ' | ')) {
          cleanName = cleanName.substring(catName.length + 4).trim();
        }
        if (cleanName.startsWith(catName + ': ')) {
          cleanName = cleanName.substring(catName.length + 2).trim();
        }
      }
      
      // Normalize the clean name for comparison
      const normalizedCleanName = cleanName.toLowerCase().replace(/\s+/g, ' ').trim();
      
      if (!productGroups[normalizedCleanName]) {
        productGroups[normalizedCleanName] = [];
      }
      
      productGroups[normalizedCleanName].push({
        id: product._id,
        originalName: product.name,
        cleanName: cleanName,
        categories: product.categories.map(cat => cat.name),
        brand: product.brand
      });
    }
    
    // Find groups with multiple products (potential duplicates)
    const duplicateGroups = Object.entries(productGroups).filter(([name, products]) => products.length > 1);
    
    console.log(`\n📊 Found ${duplicateGroups.length} groups of potential duplicate products:`);
    
    // Show the first 10 groups of duplicates
    for (let i = 0; i < Math.min(10, duplicateGroups.length); i++) {
      const [cleanName, products] = duplicateGroups[i];
      console.log(`\n${i + 1}. Base name: "${cleanName}" (${products.length} variations)`);
      
      products.forEach((product, idx) => {
        console.log(`   ${idx + 1}. ID: ${product.id}`);
        console.log(`      Original: "${product.originalName}"`);
        console.log(`      Clean: "${product.cleanName}"`);
        console.log(`      Categories: ${product.categories.join(', ')}`);
        if (product.brand) console.log(`      Brand: ${product.brand}`);
      });
    }
    
    if (duplicateGroups.length > 10) {
      console.log(`\n... and ${duplicateGroups.length - 10} more duplicate groups`);
    }
    
    // Also look for the specific example mentioned in the requirements
    console.log('\n🔍 Looking for specific example: "Option 4WD Rear Bumper Fighter"');
    const specificExample = allProducts.filter(product => 
      product.name.toLowerCase().includes('option 4wd rear bumper fighter'.toLowerCase())
    );
    
    if (specificExample.length > 0) {
      console.log(`\nFound ${specificExample.length} products matching the example:`);
      specificExample.forEach((product, idx) => {
        console.log(`   ${idx + 1}. "${product.name}"`);
        console.log(`      Categories: ${product.categories.map(cat => cat.name).join(', ')}`);
      });
    } else {
      console.log('No products found matching the specific example.');
    }

    // Get a count of products by brand to see if there are brand-related duplicates
    console.log('\n📊 Product count by brand (top 10):');
    const brandCounts = {};
    allProducts.forEach(product => {
      const brand = product.brand || 'Unknown';
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;
    });
    
    const sortedBrands = Object.entries(brandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    sortedBrands.forEach(([brand, count], idx) => {
      console.log(`   ${idx + 1}. ${brand}: ${count} products`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Analysis completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

findCategoryDuplicates();