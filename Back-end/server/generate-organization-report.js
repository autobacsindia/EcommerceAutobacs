// Generate comprehensive report of category and product organization
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Category from './models/Category.js';
import Product from './models/Product.js';
import fs from 'fs';

// Load environment variables
dotenv.config();

async function generateReport() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\n📊 Generating comprehensive organization report...');
    
    // 1. Category Hierarchy Report
    console.log('\n=== CATEGORY HIERARCHY REPORT ===');
    const topLevelCategories = await Category.find({ parent: null }).sort({ name: 1 });
    console.log(`Total top-level categories: ${topLevelCategories.length}`);
    
    for (const mainCat of topLevelCategories) {
      console.log(`\n🏛️ ${mainCat.name} (slug: ${mainCat.slug})`);
      const subCats = await Category.find({ parent: mainCat._id }).sort({ name: 1 });
      if (subCats.length > 0) {
        subCats.forEach(subCat => {
          console.log(`   📁 ${subCat.name} (slug: ${subCat.slug})`);
        });
      } else {
        console.log('   (No subcategories)');
      }
    }
    
    // 2. Profender Product Organization Report
    console.log('\n=== PROFENDER PRODUCT ORGANIZATION REPORT ===');
    const profenderProducts = await Product.find({ brand: 'Profender' })
      .populate('category', 'name slug parent')
      .sort({ name: 1 });
    
    console.log(`Total Profender products: ${profenderProducts.length}`);
    
    // Group products by category hierarchy
    const productOrganization = {};
    
    for (const product of profenderProducts) {
      if (product.category) {
        // Get the full category path
        let categoryPath = product.category.name;
        if (product.category.parent) {
          const parentCategory = await Category.findById(product.category.parent);
          if (parentCategory) {
            categoryPath = `${parentCategory.name} > ${product.category.name}`;
          }
        }
        
        if (!productOrganization[categoryPath]) {
          productOrganization[categoryPath] = [];
        }
        productOrganization[categoryPath].push(product.name);
      } else {
        if (!productOrganization['Uncategorized']) {
          productOrganization['Uncategorized'] = [];
        }
        productOrganization['Uncategorized'].push(product.name);
      }
    }
    
    // Display organized products
    Object.entries(productOrganization).forEach(([categoryPath, productNames]) => {
      console.log(`\n📁 ${categoryPath}: ${productNames.length} products`);
      productNames.forEach(name => {
        console.log(`   • ${name}`);
      });
    });
    
    // 3. Category Coverage Report
    console.log('\n=== CATEGORY COVERAGE REPORT ===');
    
    // Read the live site data
    const wpData = JSON.parse(fs.readFileSync('complete-wp-data.json', 'utf8'));
    const liveSiteCategories = wpData.allCategories;
    const liveSiteProducts = wpData.products;
    
    console.log(`Live site categories: ${liveSiteCategories.length}`);
    console.log(`Live site Profender products: ${liveSiteProducts.length}`);
    
    // Check which live site categories we have
    const dbCategories = await Category.find({});
    const dbCategoryNames = dbCategories.map(cat => cat.name);
    
    const coveredCategories = liveSiteCategories.filter(cat => dbCategoryNames.includes(cat));
    const missingCategories = liveSiteCategories.filter(cat => !dbCategoryNames.includes(cat));
    
    console.log(`\n✅ Covered categories: ${coveredCategories.length}/${liveSiteCategories.length}`);
    console.log(`❌ Missing categories: ${missingCategories.length}/${liveSiteCategories.length}`);
    
    if (missingCategories.length > 0) {
      console.log('\n📋 Missing categories:');
      missingCategories.forEach((cat, index) => {
        console.log(`   ${index + 1}. ${cat}`);
      });
    }
    
    // 4. Product Completeness Report
    console.log('\n=== PRODUCT COMPLETENESS REPORT ===');
    
    const dbProfenderProducts = await Product.find({ brand: 'Profender' });
    const dbProductNames = dbProfenderProducts.map(prod => prod.name);
    
    const liveSiteProductNames = liveSiteProducts.map(prod => prod.name);
    
    const coveredProducts = liveSiteProductNames.filter(name => dbProductNames.includes(name));
    const missingProducts = liveSiteProductNames.filter(name => !dbProductNames.includes(name));
    
    console.log(`Live site Profender products: ${liveSiteProductNames.length}`);
    console.log(`Database Profender products: ${dbProductNames.length}`);
    console.log(`✅ Covered products: ${coveredProducts.length}/${liveSiteProductNames.length}`);
    console.log(`❌ Missing products: ${missingProducts.length}/${liveSiteProductNames.length}`);
    
    if (missingProducts.length > 0) {
      console.log('\n📋 Missing products:');
      missingProducts.forEach((name, index) => {
        console.log(`   ${index + 1}. ${name}`);
      });
    }
    
    // 5. Summary
    console.log('\n=== SUMMARY ===');
    console.log(`✅ Category coverage: ${Math.round((coveredCategories.length / liveSiteCategories.length) * 100)}%`);
    console.log(`✅ Product coverage: ${Math.round((coveredProducts.length / liveSiteProductNames.length) * 100)}%`);
    
    if (coveredCategories.length === liveSiteCategories.length && coveredProducts.length === liveSiteProductNames.length) {
      console.log('\n🎉 PERFECT MATCH! Database organization matches live site structure.');
    } else {
      console.log('\n⚠️  Some discrepancies found. Review the missing categories/products above.');
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
  } catch (error) {
    console.error('💥 Error generating report:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

generateReport();