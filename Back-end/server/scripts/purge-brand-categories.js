// Hard-delete the redundant "Brands" category subtree.
//
//   node scripts/purge-brand-categories.js          # DRY RUN
//   node scripts/purge-brand-categories.js --apply   # writes
//
// Context: brands were imported BOTH as a dedicated Brand collection AND as a
// "Brands" category tree (~68 docs). `collapse-brand-categories.js` already
// migrated product brand data and soft-deleted (isActive:false) the tree, but
// the admin categories screen lists inactive categories too, so the dupes still
// clutter it. This finishes the job by HARD-deleting the subtree.
//
// Safety:
//   1. Removes every subtree category id from products' `categories` arrays.
//   2. If that would leave a product with NO active category, it first gets the
//      Accessories hub so it stays browsable (mirrors collapse-brand-categories).
//   3. Only then are the subtree categories physically deleted.
// Idempotent (no "Brands" root => nothing to do); refreshes the category cache.
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
  const categoryMappingService = (await import('../services/categoryMappingService.js')).default;

  const all = await Category.find({}).select('name slug parent isActive').lean();
  const root = all.find((c) => c.slug === 'brands') || all.find((c) => c.name.toLowerCase() === 'brands');
  if (!root) {
    console.log('No "Brands" category — nothing to purge.');
    await mongoose.disconnect();
    return;
  }

  // Collect the full subtree under "Brands".
  const subtree = new Set([String(root._id)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      const p = c.parent ? String(c.parent) : null;
      if (p && subtree.has(p) && !subtree.has(String(c._id))) {
        subtree.add(String(c._id));
        grew = true;
      }
    }
  }
  const subtreeIds = [...subtree].map((id) => new mongoose.Types.ObjectId(id));
  const subtreeSet = new Set([...subtree]);
  const activeIds = new Set(all.filter((c) => c.isActive).map((c) => String(c._id)));
  const accessories = all.find((c) => c.slug === 'accessories' && !c.parent);

  // Find products that would lose their only active category once we strip the
  // brand cats — they need the Accessories fallback so they stay browsable.
  const affected = await Product.find({ categories: { $in: subtreeIds } })
    .select('name categories')
    .lean();

  const needFallback = [];
  for (const p of affected) {
    const cats = (p.categories || []).map(String);
    const survivingActive = cats.filter((c) => !subtreeSet.has(c) && activeIds.has(c));
    if (survivingActive.length === 0) needFallback.push(p);
  }

  console.log(`=== PURGE BRAND-CATEGORIES (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Subtree categories to delete: ${subtreeIds.length}`);
  console.log(`Products referencing the subtree: ${affected.length}`);
  console.log(`Products needing Accessories fallback: ${needFallback.length}`);
  if (needFallback.length && !accessories) {
    console.error('\n✗ Aborting: some products would be orphaned but no "Accessories" hub exists to catch them.');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\n(dry run — re-run with --apply to write)');
    await mongoose.disconnect();
    return;
  }

  // 1. Give the fallback hub to products that would otherwise be orphaned.
  if (needFallback.length) {
    await Product.updateMany(
      { _id: { $in: needFallback.map((p) => p._id) } },
      { $addToSet: { categories: accessories._id } }
    );
  }

  // 2. Detach the subtree categories from every product.
  const pull = await Product.updateMany(
    { categories: { $in: subtreeIds } },
    { $pull: { categories: { $in: subtreeIds } } }
  );

  // 3. Physically delete the subtree categories.
  const del = await Category.deleteMany({ _id: { $in: subtreeIds } });

  categoryMappingService.refresh();

  console.log(`\n✓ Detached from ${pull.modifiedCount} product(s); hard-deleted ${del.deletedCount} categor${del.deletedCount === 1 ? 'y' : 'ies'} (incl. "Brands" root).`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
