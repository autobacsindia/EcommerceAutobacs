/**
 * Dedup duplicate WP product pairs in MongoDB.
 *
 *   node scripts/dedup-wp-products.js            # dry run (default — no writes)
 *   node scripts/dedup-wp-products.js --apply    # perform the merge + delete
 *
 * Background: 13 products exist as two docs for one WP id —
 *   • DONOR : externalId set, suffixed slug (…-27118), HAS category links
 *   • THIN  : wpId set, clean WP slug, 0 categories  (customer-facing URL)
 * The category-linking importer attached categories to the suffixed-slug doc
 * because the clean slug was already taken. This merges them into ONE clean doc:
 *   keep the richer doc, give it the clean WP slug, union categories/images,
 *   converge externalId+wpId, delete the thin twin.
 *
 * Survivor = doc with more categories (tie → the one with externalId).
 * Idempotent: re-running after a successful merge finds no pairs.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Product from '../models/Product.js';

const APPLY = process.argv.includes('--apply');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const len = (a) => (Array.isArray(a) ? a.length : 0);
const idStr = (x) => String(x);

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`=== Dedup WP products ${APPLY ? '(APPLY — writing)' : '(dry run — no writes)'} ===\n`);

  // Group every product by its WP id (wpId ?? externalId).
  const docs = await Product.find(
    {},
    { externalId: 1, wpId: 1, slug: 1, name: 1, categories: 1, images: 1,
      description: 1, shortDescription: 1, specifications: 1, features: 1,
      whyChoose: 1, packageContents: 1, tags: 1, sku: 1 }
  ).lean();

  const byKey = new Map();
  for (const d of docs) {
    const key = d.wpId != null ? String(d.wpId) : (d.externalId != null ? String(d.externalId) : null);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(d);
  }
  const pairs = [...byKey.entries()].filter(([, v]) => v.length > 1);

  console.log(`Duplicate WP ids found: ${pairs.length}\n`);
  let merged = 0, deleted = 0;

  for (const [wpKey, group] of pairs) {
    if (group.length !== 2) {
      console.log(`⚠  WP ${wpKey}: ${group.length} docs — skipping (manual review needed)`);
      continue;
    }
    // Survivor: more categories, then the one carrying externalId.
    const [a, b] = group.sort((x, y) =>
      (len(y.categories) - len(x.categories)) ||
      ((y.externalId != null) - (x.externalId != null))
    );
    const survivor = a, loser = b;

    // Clean WP slug = whichever slug has no "-<wpId>" suffix; prefer the loser's
    // clean slug, else keep survivor's.
    const suffix = `-${wpKey}`;
    const cleanSlug = [loser.slug, survivor.slug].find(s => s && !s.endsWith(suffix)) || survivor.slug;

    const unionCats = [...new Set([...(survivor.categories || []), ...(loser.categories || [])].map(idStr))]
      .map(s => new mongoose.Types.ObjectId(s));
    const images = len(survivor.images) >= len(loser.images) ? survivor.images : loser.images;

    // Fill survivor blanks from loser (don't overwrite existing survivor data).
    const fill = {};
    for (const f of ['description', 'shortDescription', 'sku']) {
      if (!survivor[f] && loser[f]) fill[f] = loser[f];
    }
    for (const f of ['specifications', 'features', 'whyChoose', 'packageContents', 'tags']) {
      if (len(survivor[f]) === 0 && len(loser[f]) > 0) fill[f] = loser[f];
    }

    console.log(`WP ${wpKey}  "${(survivor.name || '').slice(0, 45)}"`);
    console.log(`  survivor ${survivor._id}  cats ${len(survivor.categories)}→${unionCats.length}  slug "${survivor.slug}"→"${cleanSlug}"`);
    console.log(`  delete   ${loser._id}  (cats ${len(loser.categories)}, slug "${loser.slug}")`);
    if (Object.keys(fill).length) console.log(`  fill from loser: ${Object.keys(fill).join(', ')}`);

    if (APPLY) {
      // Delete the loser first so the clean slug + wpId/externalId are free to claim.
      await Product.deleteOne({ _id: loser._id });
      await Product.findByIdAndUpdate(survivor._id, {
        $set: {
          ...fill,
          categories: unionCats,
          images,
          slug: cleanSlug,
          wpId: Number(wpKey),
          externalId: String(wpKey),
          syncedFromWordPress: true,
          lastSyncedAt: new Date(),
        },
      });
      merged++; deleted++;
    }
  }

  console.log(`\n${APPLY ? 'Merged' : 'Would merge'}: ${pairs.length} pair(s)${APPLY ? ` | deleted ${deleted} | updated ${merged}` : ''}`);
  await mongoose.connection.close();
}

run().catch(err => { console.error('✗', err.message); mongoose.connection.close(); process.exit(1); });
