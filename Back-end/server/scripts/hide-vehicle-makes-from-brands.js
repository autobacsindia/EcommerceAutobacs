/**
 * Take vehicle makes out of the storefront's brand list.
 *
 * THE PROBLEM
 * -----------
 * `Brand` holds manufacturers of the parts we sell (Bushranger, Auxbeam,
 * Lightforce…). A car make is a different axis entirely — it belongs to
 * `Vehicle`, which already drives the "shop by vehicle" journey. At least one
 * make leaked into `Brand`, so "Jeep" sat in "Shop by brand" between Ironman 4x4
 * and Lightforce, telling a shopper that Jeep makes accessories.
 *
 * WHAT IT DOES
 * ------------
 * For every Brand whose name matches a make in the live `Vehicle` collection
 * (case-insensitive, trimmed), set `isActive: false`.
 *
 * `getBrandsWithCounts` reads `Brand.find({ isActive: true })`, so the row drops
 * out of every brand listing immediately. Nothing else is touched:
 *
 *   • Products keep their own `brand` string, so a product filed under "Jeep"
 *     stays live, searchable and shows its brand on its own page. Hiding the
 *     Brand row is a catalogue-navigation change, not a product change.
 *   • The row is deactivated, not deleted, so this is reversible and any logo,
 *     description or SEO copy on it survives.
 *
 * WHY NOT A CODE FILTER
 * ---------------------
 * A permanent "reject brands that match a vehicle make" rule would be wrong the
 * first time a genuine parts brand shares a name with a carmaker. This is one
 * bad row; it is a data fix. Re-run the script if another one appears.
 *
 * CACHE
 * -----
 * The brand list is cached under the `brands` tag, and the CDN caches the pages
 * that render it. Both are purged after a successful --apply, because leaving a
 * removed brand visible until a TTL lapses is exactly the stale-catalogue
 * failure the house rules forbid.
 *
 * ROLLBACK
 * --------
 * The script prints a ready-to-paste mongosh line setting `isActive: true` back
 * on precisely the ids it changed.
 *
 * Usage:
 *   node scripts/hide-vehicle-makes-from-brands.js            # dry run (default)
 *   node scripts/hide-vehicle-makes-from-brands.js --apply    # write
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');

/** Compare names the way a human would: trimmed, case- and spacing-insensitive. */
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('No MONGODB_URI / MONGO_URI in the environment.');
    process.exit(1);
  }

  // autoIndex MUST be off: it defaults to true, and merely connecting would
  // build every declared index against whatever cluster this points at — which
  // for the committed local .env is production.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`Connected${APPLY ? ' — APPLY mode' : ' — dry run (no writes)'}\n`);

  try {
    const db = mongoose.connection.db;
    const brands = await db.collection('brands')
      .find({ isActive: true }, { projection: { name: 1 } })
      .toArray();
    const makes = await db.collection('vehicles').distinct('make');

    const makeSet = new Set(makes.map(norm).filter(Boolean));
    const offenders = brands.filter((b) => makeSet.has(norm(b.name)));

    console.log(`Active brands: ${brands.length}`);
    console.log(`Vehicle makes: ${makeSet.size}`);
    console.log(`Brands that are really vehicle makes: ${offenders.length}\n`);

    if (offenders.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    for (const b of offenders) {
      const used = await db.collection('products').countDocuments({ brand: b.name });
      console.log(`  • ${b.name}  (_id ${b._id})  — ${used} product(s) keep this brand name`);
    }

    const ids = offenders.map((b) => b._id);
    console.log(
      `\nROLLBACK:\n  db.brands.updateMany({ _id: { $in: [${ids
        .map((id) => `ObjectId("${id}")`)
        .join(', ')}] } }, { $set: { isActive: true } })\n`,
    );

    if (!APPLY) {
      console.log('Dry run — nothing written. Re-run with --apply to deactivate the rows above.');
      return;
    }

    const res = await db.collection('brands').updateMany(
      { _id: { $in: ids } },
      { $set: { isActive: false } },
    );
    console.log(`Deactivated ${res.modifiedCount} brand row(s).`);

    // Purge in the same operation as the write — a removed brand must not keep
    // being served from Redis or the edge.
    const { default: cacheService } = await import('../services/cacheService.js');
    await cacheService.invalidateTags('brands', 'products');
    console.log('Purged Redis tags: brands, products.');

    try {
      const { default: cdnPurgeService } = await import('../services/cdnPurgeService.js');
      await cdnPurgeService.purgeEverything();
      console.log('Requested a CDN purge.');
    } catch (err) {
      console.warn(`CDN purge skipped (${err.message}). Purge the edge manually.`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
