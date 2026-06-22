// Reviewed cleanup of the leftover junk top-level + deep-junk categories after the
// canonical re-parenting and brand collapse. Every action is listed explicitly below
// so it can be reviewed before --apply.
//
//   node scripts/cleanup-junk-categories.js          # DRY RUN
//   node scripts/cleanup-junk-categories.js --apply    # writes
//
// Action types:
//   rehome  -> set category.parent = hub (keep the category as a leaf, products stay)
//   move    -> move this category's products into `target`, then soft-delete this category
//              (used for typo-merges and flattening junk umbrellas)
//   brand   -> for products: fill brand from the category name if empty + ensure a Brand doc;
//              detach the category; soft-delete it (brand lives in the Brand model)
//   delete  -> soft-delete an empty junk category
// Idempotent (skips already-inactive); refreshes the category cache on apply.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---- Explicit decision table (slug -> action) ------------------------------------
const DECISIONS = {
  // Big real category: keep, just file under Exterior.
  'exterior-accessories': { action: 'rehome', hub: 'exterior' },

  // Typo merges into the correct existing category.
  'facelifrt': { action: 'move', target: 'facelift' },
  'sof-cover': { action: 'move', target: 'soft-cover' },
  'metal-bumber': { action: 'move', target: 'bumper' },
  'mirros': { action: 'delete' }, // empty typo of "mirrors"

  // Brand / product-line names -> Brand model.
  'coasta': { action: 'brand' },
  'unicorn': { action: 'brand' },
  'gecko-racing': { action: 'brand' },
  'rugged-ridge': { action: 'brand' },

  // Junk umbrella chains -> move products into a hub, delete the umbrella.
  'vehicles-parts': { action: 'move', target: 'accessories' },
  'vehicle-parts-accessories': { action: 'move', target: 'accessories' },
  'motor-vehicle-parts': { action: 'move', target: 'accessories' },
  'motor-vehicle-frame-body-parts': { action: 'move', target: 'exterior' },
  'vehicle-maintenance': { action: 'move', target: 'accessories' },
  'care-decor': { action: 'move', target: 'accessories' },
  'vehicle-covers': { action: 'move', target: 'accessories' },
  'vehicle-decor': { action: 'move', target: 'accessories' },
  'vehicle-air-fresheners': { action: 'move', target: 'accessories' },
  'vehicle-paint': { action: 'move', target: 'accessories' },
  'vehicle-safety-security': { action: 'move', target: 'accessories' },
  'vehicle-alarms-locks': { action: 'move', target: 'accessories' },
  'vehicle-door-locks-parts': { action: 'move', target: 'accessories' },
  'vehicle-safety-equipment': { action: 'move', target: 'accessories' },
  'off-road-accessories': { action: 'move', target: 'accessories' },

  // Orphan product-types -> file under the right hub (kept as leaves).
  'conversion-trims': { action: 'rehome', hub: 'exterior' },
  'door-hinge': { action: 'rehome', hub: 'exterior' },
  'front-back-protection-kit': { action: 'rehome', hub: 'protection-kit' },
  'convertible-soft-top': { action: 'rehome', hub: 'roof-top' },
  'gr-door-beading': { action: 'rehome', hub: 'exterior' },
  'interior-carbon-trims': { action: 'rehome', hub: 'interior' },
  'mud-tracks': { action: 'rehome', hub: 'roof-top' },
  'quick-step': { action: 'rehome', hub: 'exterior' },
  'trailer-arm': { action: 'rehome', hub: 'accessories' },
  'universal-mount': { action: 'rehome', hub: 'accessories' },
  'wind-screen-bar': { action: 'rehome', hub: 'exterior' },
  'wiring-system': { action: 'rehome', hub: 'accessories' },

  // Empty junk -> soft-delete.
  'strellar': { action: 'delete' },
  'urban-sports': { action: 'delete' },
  'back-cover-full-aluminium-box': { action: 'delete' },
  'revival-kit': { action: 'delete' },
  'single-drawer-system': { action: 'delete' },
  'engine-parts': { action: 'delete' },
  'electronics': { action: 'delete' },
  'filters': { action: 'delete' },
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;
  const Brand = (await import('../models/Brand.js')).default;
  const categoryMappingService = (await import('../services/categoryMappingService.js')).default;

  const cats = await Category.find({ isActive: true }).select('name slug parent').lean();
  const bySlug = new Map(cats.map(c => [c.slug, c]));
  const existingBrandSlugs = new Set((await Brand.find({}).select('slug').lean()).map(b => b.slug));

  const log = [];
  const ops = { rehome: 0, move: 0, brand: 0, delete: 0, skipped: 0, productsMoved: 0, brandsCreated: 0 };

  // Process deepest-first so children are handled before their (to-be-deleted) parents.
  const depth = (c) => { let d = 0, cur = c, g = new Set(); while (cur?.parent && !g.has(String(cur._id))) { g.add(String(cur._id)); d++; cur = cats.find(x => String(x._id) === String(cur.parent)); } return d; };
  const entries = Object.entries(DECISIONS)
    .map(([slug, dec]) => ({ slug, dec, cat: bySlug.get(slug) }))
    .sort((a, b) => (b.cat ? depth(b.cat) : 0) - (a.cat ? depth(a.cat) : 0));

  for (const { slug, dec, cat } of entries) {
    if (!cat) { log.push(`  (skip) not found / already inactive: ${slug}`); ops.skipped++; continue; }
    const id = cat._id;

    if (dec.action === 'rehome') {
      const hub = bySlug.get(dec.hub);
      if (!hub) { log.push(`  (warn) hub missing ${dec.hub} for ${slug}`); continue; }
      log.push(`  rehome: ${slug} -> under ${hub.slug}`);
      ops.rehome++;
      if (APPLY) await Category.updateOne({ _id: id }, { $set: { parent: hub._id } });

    } else if (dec.action === 'move') {
      const target = bySlug.get(dec.target);
      if (!target) { log.push(`  (warn) target missing ${dec.target} for ${slug}`); continue; }
      const n = await Product.countDocuments({ categories: id });
      log.push(`  move: ${slug} (${n} products) -> ${target.slug}, then delete`);
      ops.move++; ops.productsMoved += n;
      if (APPLY) {
        await Product.updateMany({ categories: id }, { $addToSet: { categories: target._id } });
        await Product.updateMany({ categories: id }, { $pull: { categories: id } });
        await Category.updateOne({ _id: id }, { $set: { isActive: false } });
      }

    } else if (dec.action === 'brand') {
      const n = await Product.countDocuments({ categories: id });
      const bslug = slugify(cat.name);
      const needBrand = !existingBrandSlugs.has(bslug);
      log.push(`  brand: ${slug} (${n} products) -> Brand "${cat.name}"${needBrand ? ' (create)' : ''}, detach + delete`);
      ops.brand++;
      if (APPLY) {
        if (needBrand) { await Brand.create({ name: cat.name, slug: bslug, isActive: true }); existingBrandSlugs.add(bslug); ops.brandsCreated++; }
        await Product.updateMany({ categories: id, $or: [{ brand: { $exists: false } }, { brand: '' }, { brand: null }] },
          { $set: { brand: cat.name, brandSlug: bslug } });
        await Product.updateMany({ categories: id }, { $pull: { categories: id } });
        await Category.updateOne({ _id: id }, { $set: { isActive: false } });
      }

    } else if (dec.action === 'delete') {
      const n = await Product.countDocuments({ categories: id });
      if (n > 0) { log.push(`  (skip delete) ${slug} has ${n} products — needs a home`); ops.skipped++; continue; }
      log.push(`  delete: ${slug} (empty)`);
      ops.delete++;
      if (APPLY) await Category.updateOne({ _id: id }, { $set: { isActive: false } });
    }
  }

  console.log(`\n=== JUNK CLEANUP (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  log.sort().forEach(l => console.log(l));
  console.log(`\nSummary: rehome=${ops.rehome} move=${ops.move} brand=${ops.brand} delete=${ops.delete} skipped=${ops.skipped} | products moved=${ops.productsMoved} brands created=${ops.brandsCreated}`);

  if (APPLY) { categoryMappingService.refresh(); console.log('\n✓ Applied.'); }
  else console.log('\n(dry run — re-run with --apply to write)');

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
