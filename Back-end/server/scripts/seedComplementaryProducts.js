/**
 * Seed script: populate complementaryProducts for every active product using
 * ecosystem keyword matching (product name + tags → complementary categories → top-rated products).
 *
 * Run: node scripts/seedComplementaryProducts.js
 *
 * After running, the "Frequently Bought Together" section on product pages will show
 * contextually appropriate products (e.g. bonnet bracket → LED lights, wiring harness, switch).
 * The script also clears Redis cache so changes are visible immediately.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const Product = (await import('../models/Product.js')).default;
const Category = (await import('../models/Category.js')).default;

// ── Ecosystem map ────────────────────────────────────────────────────────────
// Mirrors the logic in searchService.js so seeded data and runtime fallback stay in sync.
// keyword match on (product.name + product.tags) → complementary category slugs
const ECOSYSTEM_MAP = [
  { keywords: ['bonnet', 'bracket', 'mount', 'mounting', 'holder', 'clamp', 'bar'], categories: ['lighting', 'electrical', 'wiring', 'switch'] },
  { keywords: ['led', 'headlight', 'fog', 'spotlight', 'driving light', 'work light', 'offroad light'], categories: ['wiring', 'switch', 'relay', 'electrical'] },
  { keywords: ['light', 'lamp', 'bulb', 'beam'], categories: ['wiring', 'switch', 'electrical'] },
  { keywords: ['wiring', 'harness', 'wire', 'cable', 'loom'], categories: ['switch', 'relay', 'lighting', 'electrical'] },
  { keywords: ['switch', 'relay', 'controller', 'dimmer'], categories: ['wiring', 'lighting', 'electrical'] },
  { keywords: ['horn', 'siren', 'alarm', 'buzzer'], categories: ['electrical', 'wiring', 'switch'] },
  { keywords: ['camera', 'dashcam', 'dash cam', 'dvr', 'recorder', 'cctv'], categories: ['electronics', 'accessories', 'mounting'] },
  { keywords: ['seat', 'seat cover', 'cushion', 'lumbar'], categories: ['interior', 'accessories', 'cleaning'] },
  { keywords: ['floor mat', 'mat', 'carpet', 'liner'], categories: ['interior', 'cleaning', 'accessories'] },
  { keywords: ['bumper', 'spoiler', 'body kit', 'skirt', 'diffuser', 'splitter'], categories: ['paint', 'tools', 'maintenance', 'exterior'] },
  { keywords: ['wheel', 'tyre', 'tire', 'rim', 'alloy'], categories: ['maintenance', 'cleaning', 'tools', 'accessories'] },
  { keywords: ['suspension', 'shock', 'absorber', 'spring', 'strut', 'coilover'], categories: ['tools', 'maintenance', 'performance'] },
  { keywords: ['exhaust', 'muffler', 'silencer', 'pipe', 'header'], categories: ['performance', 'tools', 'maintenance'] },
  { keywords: ['roof rack', 'rack', 'cargo', 'luggage carrier', 'crossbar'], categories: ['accessories', 'mounting', 'tools'] },
  { keywords: ['dash', 'dashboard', 'console', 'panel', 'cluster'], categories: ['electronics', 'accessories', 'interior'] },
  { keywords: ['air filter', 'intake', 'cold air'], categories: ['performance', 'maintenance', 'tools'] },
  { keywords: ['oil', 'lubricant', 'grease', 'fluid'], categories: ['maintenance', 'tools', 'performance'] },
  { keywords: ['cleaner', 'polish', 'wax', 'detailing', 'shampoo'], categories: ['maintenance', 'exterior', 'tools'] },
  { keywords: ['tool', 'socket', 'spanner', 'wrench', 'jack'], categories: ['maintenance', 'performance', 'accessories'] },
];

// Category-level fallback for products that don't match any keyword
const CATEGORY_FALLBACK_MAP = {
  exterior: ['cleaning', 'maintenance', 'tools'],
  interior: ['cleaning', 'accessories', 'electronics'],
  suspension: ['tools', 'maintenance', 'performance'],
  performance: ['maintenance', 'tools', 'lubricants'],
  'body-kit': ['paint', 'tools', 'maintenance'],
  lighting: ['electrical', 'wiring', 'switch', 'tools'],
  wheels: ['maintenance', 'tools', 'accessories'],
  electrical: ['wiring', 'switch', 'lighting', 'relay'],
  accessories: ['cleaning', 'maintenance', 'tools'],
  'car-care': ['cleaning', 'maintenance', 'tools'],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveSlugsToIds(slugs, excludeCategoryIds = []) {
  if (!slugs.length) return [];
  const docs = await Category.find({
    $or: [
      { slug: { $in: slugs } },
      { name: { $regex: slugs.join('|'), $options: 'i' } }
    ],
    _id: { $nin: excludeCategoryIds }
  }).select('_id').lean();
  return docs.map(c => c._id);
}

async function getEcosystemCategoryIds(product) {
  const text = [product.name || '', ...(product.tags || [])].join(' ').toLowerCase();
  const matched = new Set();

  for (const { keywords, categories } of ECOSYSTEM_MAP) {
    if (keywords.some(k => text.includes(k))) {
      categories.forEach(s => matched.add(s));
    }
  }

  if (matched.size > 0) {
    const ids = await resolveSlugsToIds(Array.from(matched), product.ownCategoryIds);
    if (ids.length > 0) return ids;
  }

  // Fallback: derive from the product's own category slugs
  const fallbackSlugs = new Set();
  for (const slug of product.ownCategorySlugs) {
    for (const [key, values] of Object.entries(CATEGORY_FALLBACK_MAP)) {
      if (slug.includes(key)) values.forEach(v => fallbackSlugs.add(v));
    }
  }

  if (fallbackSlugs.size > 0) {
    return resolveSlugsToIds(Array.from(fallbackSlugs), product.ownCategoryIds);
  }

  return [];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function seedComplementaryProducts() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected\n');

  // Diagnostic — show inventory state before proceeding
  const [totalCount, activeCount, inStockCount] = await Promise.all([
    Product.countDocuments({}),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: true, stock: { $gt: 0 } }),
  ]);
  console.log('Inventory snapshot:');
  console.log(`  Total products : ${totalCount}`);
  console.log(`  Active         : ${activeCount}`);
  console.log(`  Active+InStock : ${inStockCount}`);
  console.log('');

  // Iterate ALL products so complementaryProducts is populated even for
  // inactive / zero-stock items (they may go live later).
  // Candidates assigned AS complementary are still filtered to active+in-stock.
  const products = await Product.find({})
    .select('_id name categories tags')
    .populate('categories', 'slug name')
    .lean();

  console.log(`Seeding complementary products for all ${products.length} products...\n`);

  let updated = 0;
  let skipped = 0;
  const examples = [];

  for (const product of products) {
    // Normalise category data into plain arrays for query use
    const categoryDocs = product.categories || [];
    product.ownCategoryIds = categoryDocs.map(c => c._id);
    product.ownCategorySlugs = categoryDocs.map(c => (c.slug || c.name || '').toLowerCase());

    // Step 1: resolve ecosystem complement categories
    const ecosystemCatIds = await getEcosystemCategoryIds(product);

    let complementaryDocs = [];

    if (ecosystemCatIds.length > 0) {
      // Find top-rated products in the ecosystem categories (not the product itself)
      complementaryDocs = await Product.find({
        _id: { $ne: product._id },
        categories: { $in: ecosystemCatIds },
        isActive: true
      })
        .sort({ averageRating: -1, totalReviews: -1 })
        .limit(6)
        .select('_id name')
        .lean();
    }

    // Step 2: fallback — any product from a different category
    if (complementaryDocs.length === 0 && product.ownCategoryIds.length > 0) {
      complementaryDocs = await Product.find({
        _id: { $ne: product._id },
        categories: { $nin: product.ownCategoryIds },
        isActive: true
      })
        .sort({ averageRating: -1, totalReviews: -1 })
        .limit(6)
        .select('_id name')
        .lean();
    }

    // Step 3: last resort — any active product (even same category)
    if (complementaryDocs.length === 0) {
      complementaryDocs = await Product.find({
        _id: { $ne: product._id },
        isActive: true
      })
        .sort({ averageRating: -1, totalReviews: -1 })
        .limit(6)
        .select('_id name')
        .lean();
    }

    if (complementaryDocs.length === 0) {
      skipped++;
      continue;
    }

    await Product.updateOne(
      { _id: product._id },
      { $set: { complementaryProducts: complementaryDocs.map(d => d._id) } }
    );

    updated++;

    // Collect first 5 examples for the summary
    if (examples.length < 5) {
      examples.push({
        product: product.name,
        complementary: complementaryDocs.map(d => d.name)
      });
    }

    if (updated % 20 === 0 || updated === 1) {
      process.stdout.write(`\r  Progress: ${updated}/${products.length} products updated...`);
    }
  }

  console.log(`\n\nResults:`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped} (no complementary candidates found)`);

  // Print examples
  if (examples.length > 0) {
    console.log('\nExamples:');
    for (const ex of examples) {
      console.log(`  "${ex.product}"`);
      ex.complementary.slice(0, 3).forEach(name => console.log(`    → ${name}`));
    }
  }

  // Clear Redis cache so the live site picks up new data immediately
  console.log('\nClearing Redis cache...');
  try {
    const { default: Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
    await redis.connect();

    const patterns = ['*:products:similar:*', '*:products:complementary:*'];
    let cleared = 0;

    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
          cleared += keys.length;
        }
      } while (cursor !== '0');
    }

    console.log(`  Cleared ${cleared} cached API responses`);
    await redis.quit();
  } catch {
    console.log('  Redis not reachable — cache will expire naturally (5-min TTL)');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
  process.exit(0);
}

seedComplementaryProducts().catch(err => {
  console.error(err);
  process.exit(1);
});
