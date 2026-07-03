// Strip redundant ANCESTOR category tags from products (keep the most specific).
//
//   node scripts/strip-redundant-category-tags.js          # DRY RUN (default)
//   node scripts/strip-redundant-category-tags.js --apply    # writes
//
// Why: search/facets expand a hub to its whole subtree, so tagging a product
// with a leaf sub-category is enough — the hub is derived. Products imported /
// edited before the grouped picker landed often carry BOTH a hub ("Accessories")
// AND a descendant ("Interior"). That's redundant data. It no longer inflates
// any count (the facet + admin rollups now union distinct product ids), so this
// is pure hygiene — safe to defer, safe to run.
//
// What it does, per product:
//   - Drop any category that is an ANCESTOR of another category on the SAME
//     product (a leaf is always kept; only its redundant ancestors go).
//   - Drop exact-duplicate ids.
//   - Leaves cross-hub tags alone: a product legitimately in two DIFFERENT hubs
//     (e.g. Interior AND Exterior) keeps both — many-to-many is intentional.
//   - Leaves orphan tags (category id no longer in the tree) untouched.
// Never empties a product's categories (only ancestors are removed, never the
// most specific node). Idempotent: a second run is a no-op.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const SAMPLE = 25; // how many changes to print in the dry-run preview

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI not set');
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;

  // Category tree — id → { parent } for ancestor walks, plus a readable label.
  const cats = await Category.find({}).select('name slug parent').lean();
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const label = (id) => {
    const c = byId.get(String(id));
    return c ? (c.slug || c.name || String(id)) : `«${String(id)}»`; // «…» = orphan
  };

  // Ancestor chain (parent, grandparent, …) with a depth cap so a corrupt cycle
  // can't spin forever. Memoized.
  const ancCache = new Map();
  const ancestorsOf = (id) => {
    const key = String(id);
    if (ancCache.has(key)) return ancCache.get(key);
    const acc = new Set();
    let cur = byId.get(key);
    let guard = 0;
    while (cur && cur.parent && guard++ < 32) {
      const pid = String(cur.parent);
      if (acc.has(pid) || pid === key) break;
      acc.add(pid);
      cur = byId.get(pid);
    }
    ancCache.set(key, acc);
    return acc;
  };

  const products = await Product.find({ 'categories.1': { $exists: true } }) // ≥ 2 categories
    .select('name slug categories')
    .lean();

  const ops = [];
  const changes = [];
  for (const p of products) {
    const cats = (p.categories || []).map(String);
    const present = new Set(cats);

    // Ancestors that are redundant because a descendant of theirs is also tagged.
    const redundant = new Set();
    for (const id of present) {
      for (const anc of ancestorsOf(id)) {
        if (present.has(anc)) redundant.add(anc);
      }
    }

    // Rebuild keeping order, dropping redundant ancestors + exact duplicates.
    const seen = new Set();
    const after = [];
    for (const c of p.categories) {
      const s = String(c);
      if (redundant.has(s) || seen.has(s)) continue;
      seen.add(s);
      after.push(c);
    }

    if (after.length !== p.categories.length) {
      // Distinct removed labels for the preview (redundant ancestors + dupes).
      const removedLabels = [...new Set(p.categories.map(String).filter((s, i, arr) => redundant.has(s) || arr.indexOf(s) !== i))];
      ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { categories: after } } } });
      changes.push({
        slug: p.slug || p.name,
        before: cats.map(label).join(', '),
        after: after.map(label).join(', '),
        removed: removedLabels.map(label).join(', '),
        removedCount: p.categories.length - after.length,
      });
    }
  }

  const totalRemoved = changes.reduce((n, c) => n + c.removedCount, 0);

  console.log(`\n=== STRIP REDUNDANT CATEGORY TAGS (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Products scanned (≥2 categories): ${products.length}`);
  console.log(`Products to update: ${changes.length}  |  redundant tags to remove: ${totalRemoved}`);
  changes.slice(0, SAMPLE).forEach((c) => {
    console.log(`  ${c.slug}`);
    console.log(`    - remove: ${c.removed}`);
    console.log(`      ${c.before}  →  ${c.after}`);
  });
  if (changes.length > SAMPLE) console.log(`  … and ${changes.length - SAMPLE} more`);

  if (APPLY && ops.length) {
    const res = await Product.bulkWrite(ops, { ordered: false });
    console.log(`\n✓ Updated ${res.modifiedCount} products.`);
    console.log('NOTE: flush Redis route:*/public:* so cached listings/facets refresh');
    console.log('      (e.g. node scripts/flush-public-cache.js). Counts are unchanged');
    console.log('      by this cleanup — the rollups already de-dupe — but the cached');
    console.log('      product payloads now carry the trimmed category arrays.');
  } else if (!APPLY) {
    console.log('\n(dry run — re-run with --apply to write)');
  } else {
    console.log('\nNothing to update.');
  }

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
