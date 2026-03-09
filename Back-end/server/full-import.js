// Full import script with hierarchy support and brand extraction
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from './models/Product.js';
import Category from './models/Category.js';
import Brand from './models/Brand.js';
import categoryMappingService from './services/categoryMappingService.js';

dotenv.config();

async function fullImport() {
  try {
    console.log('🚀 Starting hierarchy-aware WordPress import...');

    await mongoose.connect('mongodb://localhost:27017/autobacs');
    console.log('✅ Connected to MongoDB');

    console.log('🧹 Clearing collections for a clean restore...');
    await Product.deleteMany({});
    await Category.deleteMany({});
    await Brand.deleteMany({});
    const Vehicle = (await import('./models/Vehicle.js')).default;
    await Vehicle.deleteMany({});
    console.log('✅ Collections cleared');

    await categoryMappingService.initialize();
    await categoryMappingService.ensureStandardCategories();

    // 1. Fetch all categories from WordPress
    console.log('🌳 Fetching all categories from WordPress...');
    let wpCategories = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      console.log(`   📄 Fetching categories page ${page}...`);
      const res = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products/categories`, {
        auth: { username: process.env.WORDPRESS_API_KEY, password: process.env.WORDPRESS_API_SECRET },
        params: { per_page: 100, page: page }
      });
      wpCategories.push(...res.data);
      if (res.data.length < 100) hasMore = false;
      else page++;
    }
    console.log(`✅ Retrieved ${wpCategories.length} categories from WordPress`);

    // 2. Sync categories to MongoDB (preserving hierarchy)
    const wpIdToMongoId = new Map();
    const brandCategoryIds = new Set();
    const BRAND_PARENT_ID = 1590; // From diagnostic

    async function syncCategory(wpCat) {
      if (wpIdToMongoId.has(wpCat.id)) return wpIdToMongoId.get(wpCat.id);

      let mongoParentId = null;
      if (wpCat.parent !== 0) {
        const parentWpCat = wpCategories.find(c => c.id === wpCat.parent);
        if (parentWpCat) {
          mongoParentId = await syncCategory(parentWpCat);
          if (wpCat.parent === BRAND_PARENT_ID) brandCategoryIds.add(wpCat.id);
          else if (brandCategoryIds.has(wpCat.parent)) brandCategoryIds.add(wpCat.id); // Nested brands
        }
      }

      const mongoCat = await categoryMappingService.createCategory(wpCat.name, mongoParentId, wpCat.id);
      wpIdToMongoId.set(wpCat.id, mongoCat._id);
      return mongoCat._id;
    }

    console.log('🏗️ Building category tree...');
    for (const cat of wpCategories) {
      await syncCategory(cat);
    }
    console.log('✅ Category tree synced');

    // 3. Import Products
    console.log('🔍 Getting total product count...');
    const countRes = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
      auth: { username: process.env.WORDPRESS_API_KEY, password: process.env.WORDPRESS_API_SECRET },
      params: { per_page: 1 }
    });
    const totalProducts = parseInt(countRes.headers['x-wp-total']) || 0;
    const totalPages = Math.ceil(totalProducts / 50);
    console.log(`📊 Total products: ${totalProducts} (${totalPages} pages)`);

    let processedCount = 0;
    let createdCount = 0;

    for (let p = 1; p <= totalPages; p++) {
      console.log(`\n📄 Page ${p} of ${totalPages}...`);
      const res = await axios.get(`${process.env.WORDPRESS_SITE_URL}/wp-json/wc/v3/products`, {
        auth: { username: process.env.WORDPRESS_API_KEY, password: process.env.WORDPRESS_API_SECRET },
        params: { per_page: 50, page: p, status: 'publish' }
      });

      for (const wpP of res.data) {
        processedCount++;
        try {
          // Identify Brand and Categories
          let brandName = 'Unknown';
          let categoryIds = [];

          if (wpP.categories) {
            for (const cat of wpP.categories) {
              const mongoId = wpIdToMongoId.get(cat.id);
              if (mongoId) {
                categoryIds.push(mongoId);
                // Check if this category or any parent is a Brand category
                if (brandCategoryIds.has(cat.id)) {
                  brandName = cat.name;
                }
              }
            }
          }

          // Also check attributes as fallback for brand
          if (brandName === 'Unknown' && wpP.attributes) {
            const bAttr = wpP.attributes.find(a => a.name.toLowerCase().includes('brand') || a.name.toLowerCase().includes('manufacture'));
            if (bAttr && bAttr.options && bAttr.options.length > 0) brandName = bAttr.options[0];
          }

          // Create Brand document if needed
          if (brandName !== 'Unknown') {
            const brandSlug = brandName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            let brandDoc = await Brand.findOne({ slug: brandSlug });
            if (!brandDoc) {
              brandDoc = new Brand({ name: brandName, slug: brandSlug, isActive: true });
              await brandDoc.save();
              console.log(`   🏷️ Created brand: ${brandName}`);
            }
          }

          const productData = {
            name: wpP.name,
            slug: wpP.slug || wpP.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
            description: wpP.description ? wpP.description.replace(/<[^>]*>/g, '').trim() : '',
            shortDescription: wpP.short_description
              ? wpP.short_description.replace(/<[^>]*>/g, '').trim().substring(0, 197) + (wpP.short_description.length > 197 ? '...' : '')
              : wpP.name.substring(0, 197),
            price: parseFloat(wpP.price) || 0,
            originalPrice: parseFloat(wpP.regular_price) || null,
            sku: wpP.sku || `WP-${wpP.id}`,
            stock: wpP.stock_quantity || 0,
            brand: brandName,
            categories: categoryIds,
            images: wpP.images.map(img => ({ url: img.src, alt: img.alt || wpP.name })),
            isActive: true,
            isFeatured: wpP.featured || false,
            externalId: wpP.id.toString(),
            tags: wpP.tags ? wpP.tags.map(t => t.name) : [],
            specifications: wpP.attributes ? wpP.attributes.map(a => ({ name: a.name, value: Array.isArray(a.options) ? a.options.join(', ') : a.options })) : []
          };

          const product = new Product(productData);
          await product.save();
          createdCount++;
          if (processedCount % 10 === 0) console.log(`   ✅ Processed ${processedCount}/${totalProducts}...`);
        } catch (err) {
          console.error(`   ❌ Failed product ${wpP.id}: ${err.message}`);
        }
      }
    }

    console.log(`\n🎉 Completed! Created ${createdCount} products`);
    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Fatal Error:', error.message);
    process.exit(1);
  }
}

fullImport();