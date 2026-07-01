// Reconcile the 3 stray top-level "hubs" that aren't real categories, leaving the
// clean 12-hub taxonomy.
//
//   node scripts/reconcile-stray-hubs.js          # DRY RUN
//   node scripts/reconcile-stray-hubs.js --apply   # writes
//
// 1. X-JACK  — a brand mis-modelled as a category. Ensure a Brand doc exists, then
//    detach it from products and delete the category.
// 2. Other   — an empty catch-all hub. Detach from products and delete.
// 3. portable fridge / Portable Fridge — a case/slug duplicate. Keep the ACTIVE one
//    (real subcats + product + clean slug `portable-fridge`), rename it to the proper
//    "Portable Fridge", and delete the empty inactive `portable-fridge-2` dup.
//
// Safety: any product left with NO active category after a detach first gets the
// Accessories hub (mirrors collapse/purge scripts). Idempotent; refreshes the cache.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;
  const Brand = (await import('../models/Brand.js')).default;
  const categoryMappingService = (await import('../services/categoryMappingService.js')).default;

  const log = (...a) => console.log(...a);
  log(`=== RECONCILE STRAY HUBS (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);

  const accessories = await Category.findOne({ slug: 'accessories', parent: null, isActive: true }).lean();
  if (!accessories) {
    console.error('✗ Aborting: no active "accessories" hub to use as an orphan fallback.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const activeIds = new Set(
    (await Category.find({ isActive: true }).select('_id').lean()).map((c) => String(c._id))
  );

  // Detach a category from all products, adding the Accessories fallback to any
  // product that would otherwise be left with no active category.
  const detachCategory = async (cat) => {
    const prods = await Product.find({ categories: cat._id }).select('categories').lean();
    const needFallback = prods.filter((p) => {
      const others = (p.categories || [])
        .map(String)
        .filter((c) => c !== String(cat._id) && activeIds.has(c));
      return others.length === 0;
    });
    log(`  · "${cat.name}" (${cat.slug}): ${prods.length} product(s), ${needFallback.length} need Accessories fallback`);
    if (!APPLY) return;
    if (needFallback.length) {
      await Product.updateMany(
        { _id: { $in: needFallback.map((p) => p._id) } },
        { $addToSet: { categories: accessories._id } }
      );
    }
    await Product.updateMany({ categories: cat._id }, { $pull: { categories: cat._id } });
    await Category.deleteOne({ _id: cat._id });
  };

  // 1. X-JACK -> Brand
  const xjack = await Category.findOne({ slug: 'x-jack' }).lean();
  if (xjack) {
    const existing = await Brand.findOne({ slug: 'x-jack' }).lean();
    log(`\n[X-JACK] Brand doc ${existing ? 'already exists' : 'will be created'}.`);
    if (APPLY && !existing) {
      await Brand.create({ name: 'X-JACK', slug: 'x-jack', type: 'manufacturer' });
    }
    await detachCategory(xjack);
  } else {
    log('\n[X-JACK] category not found — skipping (idempotent).');
  }

  // 2. Other -> delete
  const other = await Category.findOne({ slug: 'other', parent: null }).lean();
  if (other) {
    log('\n[Other] deleting empty catch-all hub.');
    await detachCategory(other);
  } else {
    log('\n[Other] not found — skipping.');
  }

  // 3. portable fridge / Portable Fridge -> single canonical hub
  const dup = await Category.findOne({ slug: 'portable-fridge-2' }).lean();      // inactive empty dup
  const real = await Category.findOne({ slug: 'portable-fridge' }).lean();       // active, real subcats
  log('\n[Portable Fridge] merge case/slug duplicate.');
  if (dup) {
    // Delete the empty dup FIRST — Category.name is uniquely indexed, so the rename
    // below would otherwise collide with dup's name "Portable Fridge".
    const dupProducts = await Product.countDocuments({ categories: dup._id });
    log(`  · deleting empty dup "${dup.name}" (${dup.slug}), products=${dupProducts}`);
    if (APPLY) {
      if (dupProducts > 0) {
        // Move any stragglers onto the surviving hub before deleting.
        await Product.updateMany({ categories: dup._id }, { $addToSet: { categories: real?._id } });
        await Product.updateMany({ categories: dup._id }, { $pull: { categories: dup._id } });
      }
      await Category.deleteOne({ _id: dup._id });
    }
  } else {
    log('  · no `portable-fridge-2` dup — skipping.');
  }
  if (real && real.name !== 'Portable Fridge') {
    log(`  · renaming "${real.name}" -> "Portable Fridge" (keeps slug ${real.slug})`);
    if (APPLY) await Category.updateOne({ _id: real._id }, { $set: { name: 'Portable Fridge' } });
  } else if (real) {
    log('  · active hub already named "Portable Fridge".');
  }

  if (APPLY) {
    categoryMappingService.refresh();
    log('\n✓ Applied. Remember to flush Redis route:*/public:* and restart the server.');
  } else {
    log('\n(dry run — re-run with --apply to write)');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
