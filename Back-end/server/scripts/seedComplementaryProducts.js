/**
 * Seed script: populate complementaryProducts for every active product using
 * name-based ecosystem matching (product name → complementary product name keywords).
 *
 * Run: node scripts/seedComplementaryProducts.js
 *
 * This is the source of truth for Priority 1 (manual curation) in searchService.js.
 * Re-run whenever the product catalog changes significantly.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const Product  = (await import('../models/Product.js')).default;

// ── Mirrors SearchService.INSTALLATION_ECOSYSTEM ─────────────────────────────
// trigger: keywords checked against product.name (lowercase)
// complement: keywords used to find complementary products by name regex
const INSTALLATION_ECOSYSTEM = [
  { trigger: ['light mount', 'mount bracket', 'bonnet mount', 'pod mount', 'bracket', 'holder', 'clamp', 'bar mount'], complement: ['led', 'auxiliary', 'driving light', 'pod light', 'spot light', 'light bar', 'wiring harness', 'harness', 'switch', 'relay', 'fog light'] },
  { trigger: ['led bar', 'light bar', 'auxiliary light', 'driving light', 'pod light', 'spot light', 'work light', 'offroad light'], complement: ['wiring harness', 'harness', 'switch', 'relay', 'bracket', 'mount', 'bar mount', 'mount bracket'] },
  { trigger: ['wiring harness', 'wire harness', 'harness', 'wire loom'], complement: ['switch', 'relay', 'led', 'auxiliary', 'driving light', 'bracket', 'mount'] },
  { trigger: ['switch panel', 'switch box', 'switch', 'relay'], complement: ['wiring harness', 'harness', 'led', 'auxiliary', 'driving light', 'bracket'] },
  { trigger: ['bull bar', 'nudge bar', 'push bar', 'front bar'], complement: ['led', 'driving light', 'fog light', 'auxiliary', 'wiring harness', 'winch', 'recovery'] },
  { trigger: ['roof rack', 'roof rail', 'luggage carrier', 'crossbar', 'cross bar'], complement: ['led', 'light', 'bracket', 'mount', 'canopy', 'storage', 'portable', 'bag'] },
  { trigger: ['roll bar', 'roll cage', 'sports bar', 'grab bar'], complement: ['led', 'light', 'spotlight', 'storage', 'bag', 'mount', 'bracket'] },
  { trigger: ['canopy', 'hardtop', 'truck cap'], complement: ['rack', 'light', 'led', 'storage', 'bed liner', 'organizer', 'lock'] },
  { trigger: ['seat cover', 'seat back'], complement: ['floor mat', 'carpet', 'armrest', 'steering', 'organizer', 'storage'] },
  { trigger: ['floor mat', 'carpet liner', 'boot mat'], complement: ['seat cover', 'armrest', 'organizer', 'storage', 'cleaning'] },
  { trigger: ['spoiler', 'trunk lip', 'boot lip', 'rear wing'], complement: ['diffuser', 'skirt', 'fender', 'grille', 'bumper'] },
  { trigger: ['front bumper', 'bumper', 'front guard'], complement: ['fog light', 'led', 'driving light', 'grille', 'camera', 'winch', 'recovery'] },
  { trigger: ['winch', 'recovery winch'], complement: ['recovery board', 'snatch', 'rope', 'tow', 'bull bar', 'bumper'] },
  { trigger: ['suspension', 'lift kit', 'shock absorber', 'coilover'], complement: ['wheel', 'tyre', 'brake', 'spacer', 'fender flare'] },
  { trigger: ['android screen', 'head unit', 'multimedia', 'car stereo'], complement: ['camera', 'speaker', 'amplifier', 'subwoofer', 'cable', 'usb'] },
  { trigger: ['dashcam', 'dash cam', 'dvr'], complement: ['mount', 'bracket', 'cable', 'power', 'gps'] },
  { trigger: ['exhaust', 'muffler', 'catback'], complement: ['intake', 'air filter', 'performance', 'turbo', 'intercooler'] },
  { trigger: ['air intake', 'cold air intake', 'air filter'], complement: ['exhaust', 'turbo', 'intercooler', 'performance'] },
];

// Common vehicle makes/models — used to find "different vehicle" fallback
const VEHICLE_KEYWORDS = [
  'thar roxx', 'scorpio n', 'innova crysta',
  'thar', 'scorpio', 'fortuner', 'hilux', 'innova', 'endeavour',
  'nexon', 'harrier', 'safari', 'creta', 'venue', 'brezza', 'jimny',
  'wrangler', 'pajero', 'triton', 'duster', 'xuv700',
];

function getComplementaryNameRegex(productName) {
  const lower = productName.toLowerCase();
  for (const { trigger, complement } of INSTALLATION_ECOSYSTEM) {
    if (trigger.some(t => lower.includes(t))) {
      return complement.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    }
  }
  return null;
}

function extractVehicle(productName) {
  const lower = productName.toLowerCase();
  return VEHICLE_KEYWORDS.find(v => lower.includes(v)) || null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function seedComplementaryProducts() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected\n');

  const [total, active] = await Promise.all([
    Product.countDocuments({}),
    Product.countDocuments({ isActive: true }),
  ]);
  console.log(`Inventory: ${total} total, ${active} active\n`);

  const products = await Product.find({}).select('_id name').lean();
  console.log(`Seeding ${products.length} products...\n`);

  let updated = 0;
  let skipped = 0;
  const examples = [];

  for (const product of products) {
    const complementRegex = getComplementaryNameRegex(product.name);
    let complementaryDocs = [];

    // Step 1: ecosystem name matching
    if (complementRegex) {
      complementaryDocs = await Product.find({
        _id: { $ne: product._id },
        isActive: true,
        name: { $regex: complementRegex, $options: 'i' }
      })
        .sort({ averageRating: -1, totalReviews: -1 })
        .limit(6)
        .select('_id name')
        .lean();
    }

    // Step 2: different-vehicle products as fallback
    if (complementaryDocs.length === 0) {
      const vehicle = extractVehicle(product.name);
      const vehicleFilter = vehicle
        ? { name: { $not: new RegExp(vehicle, 'i') } }
        : {};
      complementaryDocs = await Product.find({
        _id: { $ne: product._id },
        isActive: true,
        ...vehicleFilter
      })
        .sort({ averageRating: -1, totalReviews: -1 })
        .limit(6)
        .select('_id name')
        .lean();
    }

    // Step 3: absolute last resort
    if (complementaryDocs.length === 0) {
      complementaryDocs = await Product.find({ _id: { $ne: product._id }, isActive: true })
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

    if (examples.length < 8) {
      examples.push({ product: product.name, complementary: complementaryDocs.map(d => d.name) });
    }

    if (updated % 50 === 0 || updated === 1) {
      process.stdout.write(`\r  Progress: ${updated}/${products.length}...`);
    }
  }

  console.log(`\n\nResults: ${updated} updated, ${skipped} skipped\n`);

  console.log('Sample results:');
  for (const ex of examples) {
    console.log(`  "${ex.product}"`);
    ex.complementary.slice(0, 3).forEach(n => console.log(`    → ${n}`));
  }

  // Clear Redis cache so live site picks up new data immediately
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
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) { await redis.del(...keys); cleared += keys.length; }
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

seedComplementaryProducts().catch(err => { console.error(err); process.exit(1); });
