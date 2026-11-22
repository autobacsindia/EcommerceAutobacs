/**
 * Build the Autobacs Partner (supplier app) indexes. Production runs with
 * autoIndex off, so a deploy never builds them; this script does, from the
 * schemas themselves (declared == built, no hand-copied specs to drift).
 *
 * All four collections are NEW and empty when this first runs, so every build is
 * instant. Safe to run more than once. Run it right after the code is deployed.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/create-supplier-portal-indexes.js           # dry run
 *   node scripts/create-supplier-portal-indexes.js --apply   # build
 * Then: npm run audit-index-drift
 *
 * Rollback: drop the named indexes (or the empty collections) — nothing else reads them.
 */
import mongoose from 'mongoose';
import SupplierAccount from '../models/SupplierAccount.js';
import SupplierListing from '../models/SupplierListing.js';
import SupplierPriceReview from '../models/SupplierPriceReview.js';
import MarginRule from '../models/MarginRule.js';

const APPLY = process.argv.includes('--apply');
const TAG = '[supplier-portal-indexes]';
export const MODELS = [SupplierAccount, SupplierListing, SupplierPriceReview, MarginRule];

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const out = [];
  for (const Model of MODELS) {
    const coll = Model.collection;
    const existing = new Set((await coll.indexes().catch(() => [])).map((i) => i.name));
    for (const [keys, options] of Model.schema.indexes()) {
      const name = options.name;
      if (!name) throw new Error(`${Model.modelName}: every index must be named`);
      let state;
      if (existing.has(name)) state = 'already there';
      else if (apply) {
        await coll.createIndex(keys, options);
        state = 'built';
      } else state = 'would build';
      out.push([`${Model.collection.collectionName}.${name}`, state]);
    }
  }
  for (const [name, state] of out) log(`${TAG} ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the models must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`${TAG} ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(`${TAG} failed:`, err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
