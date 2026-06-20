// Merge duplicate categories created by the WooCommerce migration (slug suffixing
// like `-2` / `-3`, or spelling variants). For each duplicate group:
//   1. choose a canonical "keeper"
//   2. move every product from the duplicates onto the keeper (dedup-safe)
//   3. re-parent any children of a duplicate onto the keeper
//   4. soft-delete the duplicate (isActive: false) so it leaves nav/listings
//
//   node scripts/merge-duplicate-categories.js          # DRY RUN (default)
//   node scripts/merge-duplicate-categories.js --apply   # writes
//
// Idempotent: already-merged duplicates (inactive, no products, no children) are skipped.
// Keeper rule:
//   1. prefer a slug WITHOUT a trailing `-<number>` (clean canonical URL)
//   2. else the category with MORE products
//   3. tiebreak: shorter slug, then alphabetical
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const isSuffixed = slug => /-\d+$/.test(slug);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;

  const cats = await Category.find({ isActive: true }).select('name slug parent').lean();

  const counts = await Product.aggregate([
    { $unwind: '$categories' },
    { $group: { _id: '$categories', n: { $sum: 1 } } },
  ]);
  const productCount = new Map(counts.map(r => [String(r._id), r.n]));
  const childCount = new Map();
  for (const c of cats) {
    if (c.parent) childCount.set(String(c.parent), (childCount.get(String(c.parent)) || 0) + 1);
  }

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const c of cats) {
    const k = norm(c.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const dupes = [...groups.values()].filter(g => g.length > 1);

  const pickKeeper = (group) =>
    [...group].sort((a, b) => {
      const sa = isSuffixed(a.slug) ? 1 : 0;
      const sb = isSuffixed(b.slug) ? 1 : 0;
      if (sa !== sb) return sa - sb;                                   // clean slug first
      const pa = productCount.get(String(a._id)) || 0;
      const pb = productCount.get(String(b._id)) || 0;
      if (pa !== pb) return pb - pa;                                   // more products
      if (a.slug.length !== b.slug.length) return a.slug.length - b.slug.length;
      return a.slug.localeCompare(b.slug);
    })[0];

  console.log(`\n=== DUPLICATE MERGE (${APPLY ? 'APPLY' : 'DRY RUN'}) — ${dupes.length} groups ===`);
  let totalMovedProducts = 0;
  let totalDropped = 0;

  for (const group of dupes) {
    const keeper = pickKeeper(group);
    const drops = group.filter(c => String(c._id) !== String(keeper._id));
    const fmt = c => `${c.slug}[p${productCount.get(String(c._id)) || 0}${childCount.get(String(c._id)) ? ',c' + childCount.get(String(c._id)) : ''}]`;
    console.log(`  keep ${fmt(keeper)}  <=  ${drops.map(fmt).join(', ')}`);

    for (const drop of drops) {
      const moved = productCount.get(String(drop._id)) || 0;
      totalMovedProducts += moved;
      totalDropped += 1;

      if (APPLY) {
        // 1) add keeper to products currently in the duplicate (dedup-safe), then remove duplicate
        await Product.updateMany({ categories: drop._id }, { $addToSet: { categories: keeper._id } });
        await Product.updateMany({ categories: drop._id }, { $pull: { categories: drop._id } });
        // 2) re-parent any children of the duplicate onto the keeper
        await Category.updateMany({ parent: drop._id }, { $set: { parent: keeper._id } });
        // 3) soft-delete the duplicate
        await Category.updateOne({ _id: drop._id }, { $set: { isActive: false } });
      }
    }
  }

  console.log(`\n${APPLY ? '✓ Applied' : 'Would'} merge ${totalDropped} duplicate(s), moving ${totalMovedProducts} product link(s) to keepers.`);
  if (!APPLY) console.log('(dry run — re-run with --apply to write)');

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
