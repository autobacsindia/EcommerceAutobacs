/**
 * Find and import any products from WordPress that are missing in the database.
 * Uses externalId (WooCommerce product ID) to compare.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';
import categoryMappingService from '../../services/categoryMappingService.js';

dotenv.config();

const WP_BASE = process.env.WORDPRESS_SITE_URL.replace(/\/$/, '');
const AUTH = {
  username: process.env.WORDPRESS_API_KEY,
  password: process.env.WORDPRESS_API_SECRET
};

async function fetchAllWpProductIds() {
  const ids = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const res = await axios.get(`${WP_BASE}/wp-json/wc/v3/products`, {
      auth: AUTH,
      params: { per_page: 100, page, status: 'publish', _fields: 'id,name' },
      timeout: 30000
    });
    totalPages = parseInt(res.headers['x-wp-totalpages']) || 1;
    res.data.forEach(p => ids.push({ id: p.id, name: p.name }));
    console.log(`  Fetched page ${page}/${totalPages} (${res.data.length} items)`);
    page++;
  }
  return ids;
}

async function fetchWpProduct(wpId) {
  const res = await axios.get(`${WP_BASE}/wp-json/wc/v3/products/${wpId}`, {
    auth: AUTH,
    timeout: 30000
  });
  return res.data;
}

async function transformAndSave(wpProduct) {
  // Categories
  let categoryIds = [];
  if (wpProduct.categories && wpProduct.categories.length > 0) {
    for (const wpCat of wpProduct.categories) {
      let cat = categoryMappingService.findCategory(wpCat.name);
      if (!cat) {
        cat = await categoryMappingService.createCategory(wpCat.name);
        console.log(`  Created new category: ${cat.name}`);
      }
      categoryIds.push(cat._id);
    }
  } else {
    const fallback = categoryMappingService.findCategory('Other');
    if (fallback) categoryIds.push(fallback._id);
  }

  // Brand
  let brand = 'Unknown';
  if (wpProduct.attributes) {
    const brandAttr = wpProduct.attributes.find(a =>
      ['brand', 'brands'].includes(a.name.toLowerCase())
    );
    if (brandAttr?.options?.length) {
      brand = Array.isArray(brandAttr.options) ? brandAttr.options[0] : brandAttr.options;
    }
  }

  // Images
  const images = (wpProduct.images || []).map((img, i) => ({
    url: img.src || img.url || '',
    alt: img.alt || img.name || wpProduct.name || '',
    isPrimary: i === 0
  })).filter(img => img.url);

  // Generate a unique slug from name
  const baseSlug = (wpProduct.name || 'untitled-product')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
  // Append WP ID to guarantee uniqueness
  const slug = `${baseSlug}-${wpProduct.id}`;

  const productData = {
    name: wpProduct.name || 'Untitled Product',
    slug,
    description: (wpProduct.description || '').replace(/<[^>]*>/g, '').trim(),
    shortDescription: ((wpProduct.short_description || wpProduct.name || '').replace(/<[^>]*>/g, '').substring(0, 200)),
    price: parseFloat(wpProduct.price || wpProduct.regular_price) || 0,
    originalPrice: parseFloat(wpProduct.sale_price) || null,
    sku: wpProduct.sku || `WP-${wpProduct.id}`,
    stock: parseInt(wpProduct.stock_quantity) || 0,
    brand,
    categories: categoryIds,
    images,
    isActive: wpProduct.status === 'publish',
    isFeatured: wpProduct.featured || false,
    externalId: wpProduct.id.toString(),
    externalUrl: wpProduct.permalink,
    tags: (wpProduct.tags || []).map(t => t.name),
    specifications: (wpProduct.attributes || []).map(a => ({
      name: a.name,
      value: Array.isArray(a.options) ? a.options.join(', ') : a.options
    }))
  };

  const existing = await Product.findOne({ externalId: productData.externalId });
  if (existing) {
    Object.assign(existing, productData);
    await existing.save();
    return 'updated';
  } else {
    await new Product(productData).save();
    return 'created';
  }
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  await categoryMappingService.initialize();
  console.log('Category mapping service initialized');

  // Get all WP product IDs
  console.log('\nFetching all WordPress product IDs...');
  const wpProducts = await fetchAllWpProductIds();
  console.log(`WordPress total: ${wpProducts.length} products`);

  // Get all DB external IDs
  const dbExternalIds = await Product.distinct('externalId');
  const dbIdSet = new Set(dbExternalIds.map(String));
  console.log(`Database total: ${dbIdSet.size} products`);

  // Find missing
  const missing = wpProducts.filter(p => !dbIdSet.has(String(p.id)));
  console.log(`\nMissing products: ${missing.length}`);

  if (missing.length === 0) {
    console.log('All products are already imported!');
    await mongoose.connection.close();
    return;
  }

  // Import each missing product
  let created = 0, updated = 0, failed = 0;
  for (const { id, name } of missing) {
    console.log(`\nImporting: "${name}" (WP ID: ${id})`);
    try {
      const wpProduct = await fetchWpProduct(id);
      const action = await transformAndSave(wpProduct);
      if (action === 'created') { created++; console.log('  ✅ Created'); }
      else { updated++; console.log('  🔄 Updated'); }
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed:  ${failed}`);

  const finalCount = await Product.countDocuments();
  console.log(`\nFinal DB product count: ${finalCount}`);

  await mongoose.connection.close();
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
