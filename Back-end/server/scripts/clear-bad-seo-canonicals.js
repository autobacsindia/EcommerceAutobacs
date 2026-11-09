/**
 * Clear the wrong `seo.canonical` overrides found by audit-seo-canonicals.js, so
 * those pages canonicalise to themselves again:
 *   - products pointing at an old WooCommerce https://autobacsindia.com/product/… URL
 *   - the one article pointing at an address that 404s
 *
 * Uses a conditional $unset on the exact value read, so an admin edit made in
 * between is never overwritten. Does not touch updatedAt (no sitemap lastmod churn).
 *
 * Run from a folder with NO .env so Railway's URI is the one used:
 *   railway run node scripts/clear-bad-seo-canonicals.js                 # dry run
 *   railway run node scripts/clear-bad-seo-canonicals.js --apply --backup=<file>
 *   railway run node scripts/clear-bad-seo-canonicals.js --rollback=<file>
 *
 * Then flush Redis: railway ssh -- npm run flush-cache
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

export const LEGACY_PRODUCT_CANONICAL = /^https?:\/\/(www\.)?autobacsindia\.com\/product\//i;

export const DEAD_ARTICLE_CANONICALS = Object.freeze([{
  slug: 'car-aftermarket-trends-in-india-2026-6-upgrades-owners-are-actually-buying',
  canonical: 'https://www.autobacsindia.com/car-aftermarket-trends-india-2026',
}]);

export async function findTargets(db) {
  const products = await db.collection('products')
    .find({ 'seo.canonical': { $regex: LEGACY_PRODUCT_CANONICAL } })
    .project({ slug: 1, 'seo.canonical': 1 })
    .toArray();
  const articles = await db.collection('articles')
    .find({ $or: DEAD_ARTICLE_CANONICALS.map((a) => ({ slug: a.slug, 'seo.canonical': a.canonical })) })
    .project({ slug: 1, 'seo.canonical': 1 })
    .toArray();
  const row = (coll) => (d) => ({ coll, id: d._id, slug: d.slug, canonical: d.seo.canonical });
  return [...products.map(row('products')), ...articles.map(row('articles'))];
}

export async function applyClears(db, targets) {
  let cleared = 0;
  for (const t of targets) {
    const res = await db.collection(t.coll).updateOne(
      { _id: t.id, 'seo.canonical': t.canonical },
      { $unset: { 'seo.canonical': '' } },
    );
    cleared += res.modifiedCount;
  }
  return cleared;
}

/** Restores a value only where the field is still empty. */
export async function rollback(db, targets) {
  let restored = 0;
  for (const t of targets) {
    const res = await db.collection(t.coll).updateOne(
      { _id: new mongoose.Types.ObjectId(String(t.id)), 'seo.canonical': { $exists: false } },
      { $set: { 'seo.canonical': t.canonical } },
    );
    restored += res.modifiedCount;
  }
  return restored;
}

const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('No MONGODB_URI / MONGO_URI in the environment');
  const apply = process.argv.includes('--apply');
  const backup = option('backup');
  const rollbackFile = option('rollback');
  if (apply && !backup) throw new Error('--apply needs --backup=<file>');

  await mongoose.connect(uri, { autoIndex: false });
  const { db } = mongoose.connection;
  console.log(`target: ${mongoose.connection.host} / ${db.databaseName}`);

  if (rollbackFile) {
    const restored = await rollback(db, JSON.parse(fs.readFileSync(rollbackFile, 'utf8')));
    console.log(`restored ${restored}`);
    return;
  }

  const targets = await findTargets(db);
  for (const t of targets) console.log(`${t.coll}\t${t.slug}\t${t.canonical}`);
  console.log(`\n${targets.length} override(s) to clear`);
  if (!apply) {
    console.log('DRY RUN: nothing changed. Re-run with --apply --backup=<file>.');
    return;
  }
  fs.writeFileSync(backup, JSON.stringify(targets, null, 1));
  console.log(`cleared ${await applyClears(db, targets)}`);
  console.log(`ROLLBACK: railway run node scripts/clear-bad-seo-canonicals.js --rollback=${backup}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
