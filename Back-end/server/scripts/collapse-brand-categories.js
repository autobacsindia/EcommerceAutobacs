// Collapse the duplicate "Brands" category subtree into the Brand model.
//
//   node scripts/collapse-brand-categories.js          # DRY RUN
//   node scripts/collapse-brand-categories.js --apply    # writes
//
// Brands were imported BOTH as a dedicated Brand collection AND as ~74 categories under
// a "Brands" parent — redundant. 816/835 products already carry a brand string, so this
// is mostly detach + delete:
//   1. Direct children of "Brands" are brand names -> soft-delete (after step 2-4).
//   2. For products in the subtree with an EMPTY brand, populate brand/brandSlug from the
//      brand ancestor and ensure a Brand doc exists (never overwrite an existing brand).
//   3. Product-type categories mis-nested under a brand (e.g. 70mai -> cablle-kit) are
//      SURVIVORS: re-home them directly under a real hub (classify, fallback Accessories),
//      flattened to 2 levels.
//   4. Detach the brand categories from every product; if that empties a product's
//      categories, add the Accessories hub so it stays browsable.
// Idempotent; refreshes the category cache on apply.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Minimal hub classifier for surviving product-type categories (fallback: accessories).
const HUB_RULES = [
  ['lighting', /\b(light\w*|lamp\w*|led|bulb\w*)\b/],
  ['accessories', /\b(cam\w*|camera|charger|battery|batteries|jump\s*starter|cable|cabl\w*|filter\w*|accessor\w*|kit)\b/],
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;
  const Brand = (await import('../models/Brand.js')).default;
  const categoryMappingService = (await import('../services/categoryMappingService.js')).default;

  const cats = await Category.find({}).select('name slug parent isActive').lean();
  const bySlug = new Map(cats.map(c => [c.slug, c]));
  const byId = new Map(cats.map(c => [String(c._id), c]));
  const root = bySlug.get('brands') || cats.find(c => c.name.toLowerCase() === 'brands');
  if (!root) { console.log('No "Brands" category — nothing to do.'); await mongoose.disconnect(); return; }

  const accessories = bySlug.get('accessories');

  // Subtree
  const subtree = new Set([String(root._id)]);
  let add = true;
  while (add) {
    add = false;
    for (const c of cats) {
      const p = c.parent ? String(c.parent) : null;
      if (p && subtree.has(p) && !subtree.has(String(c._id))) { subtree.add(String(c._id)); add = true; }
    }
  }
  subtree.delete(String(root._id));

  const directBrands = cats.filter(c => c.parent && String(c.parent) === String(root._id)); // brand names
  const directBrandIds = new Set(directBrands.map(c => String(c._id)));
  const survivors = cats.filter(c => subtree.has(String(c._id)) && !directBrandIds.has(String(c._id))); // product-types

  // For a brand-subtree category, find the brand NAME (the direct child of root above it).
  const brandNameFor = (catId) => {
    let cur = byId.get(String(catId));
    const guard = new Set();
    while (cur && cur.parent && !guard.has(String(cur._id))) {
      guard.add(String(cur._id));
      if (String(cur.parent) === String(root._id)) return cur.name;
      cur = byId.get(String(cur.parent));
    }
    return null;
  };

  const existingBrandSlugs = new Set((await Brand.find({}).select('slug').lean()).map(b => b.slug));
  const brandsToCreate = new Map(); // slug -> name

  // Products touching the subtree
  const subtreeObjIds = [...subtree].map(x => new mongoose.Types.ObjectId(x));
  const prods = await Product.find({ categories: { $in: subtreeObjIds } }).select('brand brandSlug categories').lean();

  let brandPopulated = 0, detached = 0, fallbackAdded = 0;
  const productOps = [];
  for (const p of prods) {
    const inSubtree = (p.categories || []).filter(c => subtree.has(String(c)));
    const keep = (p.categories || []).filter(c => !directBrandIds.has(String(c))); // drop brand-name cats, keep survivors/others

    const set = {};
    if (!p.brand || !p.brand.trim()) {
      const bn = brandNameFor(inSubtree[0]);
      if (bn) {
        set.brand = bn;
        set.brandSlug = slugify(bn);
        brandPopulated++;
        if (!existingBrandSlugs.has(set.brandSlug)) brandsToCreate.set(set.brandSlug, bn);
      }
    }
    if (keep.length !== (p.categories || []).length) detached++;
    let finalCats = keep;
    if (finalCats.length === 0 && accessories) { finalCats = [accessories._id]; fallbackAdded++; }

    productOps.push({ _id: p._id, set, categories: finalCats });
  }

  // Survivors -> hub (flatten to depth 2)
  const rehome = survivors.map(s => {
    const text = `${s.name} ${s.slug}`.toLowerCase();
    let hubSlug = 'accessories';
    for (const [h, re] of HUB_RULES) if (re.test(text)) { hubSlug = h; break; }
    return { cat: s, hub: bySlug.get(hubSlug) || accessories };
  });

  console.log(`\n=== COLLAPSE BRAND-CATEGORIES (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Brand-name categories to soft-delete: ${directBrands.length}`);
  console.log(`Survivor product-type categories to re-home: ${survivors.length}`);
  survivors.forEach(s => console.log(`  survivor: ${s.slug} -> ${rehome.find(r => r.cat._id === s._id).hub.slug}`));
  console.log(`Products touched: ${prods.length}  | brand populated (was empty): ${brandPopulated}  | detached from brand cats: ${detached}  | given Accessories fallback: ${fallbackAdded}`);
  console.log(`New Brand docs to create: ${brandsToCreate.size}${brandsToCreate.size ? ' -> ' + [...brandsToCreate.values()].join(', ') : ''}`);

  if (APPLY) {
    for (const [slug, name] of brandsToCreate) await Brand.create({ name, slug, isActive: true });
    for (const r of rehome) await Category.updateOne({ _id: r.cat._id }, { $set: { parent: r.hub._id } });
    for (const op of productOps) {
      const update = { $set: { categories: op.categories, ...op.set } };
      await Product.updateOne({ _id: op._id }, update);
    }
    await Category.updateMany({ _id: { $in: directBrands.map(c => c._id) } }, { $set: { isActive: false } });
    await Category.updateOne({ _id: root._id }, { $set: { isActive: false } });
    categoryMappingService.refresh();
    console.log(`\n✓ Collapsed ${directBrands.length} brand categories; root "Brands" soft-deleted.`);
  } else {
    console.log('\n(dry run — re-run with --apply to write)');
  }

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
