import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

dotenv.config();

async function organizeProductCategories() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/autobacs');
    console.log('✅ Connected to MongoDB');

    console.log('\n🔍 Starting product organization process...');
    
    // Get all products with their categories populated
    const allProducts = await Product.find({}).populate('categories', 'name slug _id');
    
    // Group products by their normalized name to identify duplicates
    const productGroups = {};
    
    for (const product of allProducts) {
      // Normalize the product name for grouping
      const normalizedName = product.name.trim().toLowerCase();
      
      if (!productGroups[normalizedName]) {
        productGroups[normalizedName] = [];
      }
      
      productGroups[normalizedName].push(product);
    }
    
    // Identify groups with multiple products (duplicates to be merged)
    const duplicateGroups = Object.entries(productGroups).filter(([name, products]) => products.length > 1);
    
    console.log(`\n📊 Found ${duplicateGroups.length} groups of duplicate products to merge`);
    
    let mergedProductsCount = 0;
    let totalDuplicatesRemoved = 0;
    
    // Process each group of duplicate products
    for (const [normalizedName, products] of duplicateGroups) {
      if (products.length <= 1) continue;
      
      // Keep the first product as the "master" product and merge others into it
      const masterProduct = products[0];
      const duplicates = products.slice(1);
      
      console.log(`\nMerging ${duplicates.length} duplicates for: "${masterProduct.name}"`);
      
      // Collect all unique categories from all duplicate products
      const allCategoryIds = new Set();
      const allCategoryNames = new Set();
      
      for (const product of products) {
        // Add all categories from this product
        if (product.categories && Array.isArray(product.categories)) {
          product.categories.forEach(cat => {
            allCategoryIds.add(cat._id.toString());
            allCategoryNames.add(cat.name);
          });
        }
      }
      
      // Update the master product with all unique categories
      const updatedCategories = Array.from(allCategoryIds).map(id => new mongoose.Types.ObjectId(id));
      masterProduct.categories = updatedCategories;
      
      // Preserve the best values for other fields (prefer non-empty values)
      for (const duplicate of duplicates) {
        // Update brand if master doesn't have one
        if (!masterProduct.brand && duplicate.brand) {
          masterProduct.brand = duplicate.brand;
        }
        
        // Update description if master doesn't have one or if duplicate has better description
        if (!masterProduct.description && duplicate.description) {
          masterProduct.description = duplicate.description;
        }
        
        // Update price if master doesn't have one or if duplicate has better price info
        if (duplicate.price && (!masterProduct.price || masterProduct.price === 0)) {
          masterProduct.price = duplicate.price;
        }
        
        // Update other important fields
        if (!masterProduct.originalPrice && duplicate.originalPrice) {
          masterProduct.originalPrice = duplicate.originalPrice;
        }
        if (!masterProduct.shortDescription && duplicate.shortDescription) {
          masterProduct.shortDescription = duplicate.shortDescription;
        }
        if (!masterProduct.sku && duplicate.sku) {
          masterProduct.sku = duplicate.sku;
        }
        if (duplicate.stock > masterProduct.stock) {
          masterProduct.stock = duplicate.stock;
        }
        
        // Merge tags
        if (duplicate.tags && Array.isArray(duplicate.tags)) {
          if (!masterProduct.tags) masterProduct.tags = [];
          duplicate.tags.forEach(tag => {
            if (!masterProduct.tags.includes(tag)) {
              masterProduct.tags.push(tag);
            }
          });
        }
        
        // Merge features
        if (duplicate.features && Array.isArray(duplicate.features)) {
          if (!masterProduct.features) masterProduct.features = [];
          duplicate.features.forEach(feature => {
            if (!masterProduct.features.includes(feature)) {
              masterProduct.features.push(feature);
            }
          });
        }
        
        // Merge specifications
        if (duplicate.specifications && Array.isArray(duplicate.specifications)) {
          if (!masterProduct.specifications) masterProduct.specifications = [];
          duplicate.specifications.forEach(spec => {
            const existingSpec = masterProduct.specifications.find(s => s.key === spec.key);
            if (!existingSpec) {
              masterProduct.specifications.push(spec);
            } else if (!existingSpec.value && spec.value) {
              existingSpec.value = spec.value;
            }
          });
        }
        
        // Merge images (avoid duplicates based on URL)
        if (duplicate.images && Array.isArray(duplicate.images)) {
          if (!masterProduct.images) masterProduct.images = [];
          duplicate.images.forEach(img => {
            const existingImg = masterProduct.images.find(i => i.url === img.url);
            if (!existingImg) {
              masterProduct.images.push(img);
            }
          });
        }
      }
      
      // Save the updated master product
      await masterProduct.save();
      console.log(`   ✅ Updated master product with ${allCategoryNames.size} categories: [${Array.from(allCategoryNames).join(', ')}]`);
      
      // Mark duplicate products as inactive (soft delete) instead of removing them completely
      for (const duplicate of duplicates) {
        duplicate.isActive = false;
        await duplicate.save();
        console.log(`   🚫 Deactivated duplicate product: ${duplicate._id}`);
      }
      
      mergedProductsCount++;
      totalDuplicatesRemoved += duplicates.length;
    }
    
    console.log(`\n📈 Summary:`);
    console.log(`   ✅ Products merged: ${mergedProductsCount}`);
    console.log(`   🚫 Duplicates deactivated: ${totalDuplicatesRemoved}`);
    
    // Now let's check for products that should be in brand slider instead of main shop
    console.log('\n🔍 Identifying brand products that should go to brand slider...');
    
    // Find products with brand information
    const productsWithBrands = await Product.find({ 
      brand: { $exists: true, $ne: null, $ne: '', $ne: 'Unknown' },
      isActive: true 
    });
    
    console.log(`   Found ${productsWithBrands.length} products with brand information`);
    
    // Update brand information to be more consistent
    for (const product of productsWithBrands) {
      // Clean up brand name (capitalize properly, remove extra spaces)
      if (product.brand && typeof product.brand === 'string') {
        const cleanBrand = product.brand.trim()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
        
        if (product.brand !== cleanBrand) {
          product.brand = cleanBrand;
          await product.save();
          console.log(`   🏷️ Updated brand for "${product.name}": "${product.brand}"`);
        }
      }
    }
    
    // Get final counts
    const finalActiveProducts = await Product.countDocuments({ isActive: true });
    const finalTotalProducts = await Product.countDocuments({});
    
    console.log(`\n📊 Final counts:`);
    console.log(`   Active products: ${finalActiveProducts}`);
    console.log(`   Total products (including inactive): ${finalTotalProducts}`);
    
    // Check if we're close to the target of ~852 products
    if (finalActiveProducts > 1000) {  // Using 1000 as buffer around 852
      console.log(`\n⚠️  Active product count (${finalActiveProducts}) is still higher than target (~852)`);
      console.log(`   This may be due to legitimately different products that happen to have similar names.`);
    } else {
      console.log(`\n✅ Active product count (${finalActiveProducts}) is close to target (~852)`);
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Product organization completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during product organization:', error.message);
    console.error(error.stack);
  }
}

organizeProductCategories();