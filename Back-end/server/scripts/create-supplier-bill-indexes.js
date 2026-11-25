/**
 * Build the "We owe suppliers" indexes (models/SupplierBill.js, and
 * PaymentRequest.payment_request_supplier_bill). Production runs with autoIndex
 * off, so a deploy never builds them; this script does, from the schemas
 * themselves (declared == built, no hand-copied specs to drift).
 *
 * supplierbills is new and empty when this first runs (instant). The
 * PaymentRequest index is partial on `supplierBill` (no existing request has
 * one), so it is small; the build still reads the collection once.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/create-supplier-bill-indexes.js           # dry run
 *   node scripts/create-supplier-bill-indexes.js --apply   # build
 * Then: npm run audit-index-drift
 *
 * Rollback: drop the named `supplier_bill_*` indexes and
 * `payment_request_supplier_bill` — nothing else reads them.
 */
import mongoose from 'mongoose';
import SupplierBill from '../models/SupplierBill.js';
import PaymentRequest from '../models/PaymentRequest.js';

const APPLY = process.argv.includes('--apply');
const TAG = '[supplier-bill-indexes]';

/** [Model, only these index names (null: all of the model's)] */
export const TARGETS = [
  [SupplierBill, null],
  [PaymentRequest, ['payment_request_supplier_bill']],
];

export async function buildIndexes({ apply = APPLY, log = console.log, targets = TARGETS } = {}) {
  const out = [];
  for (const [Model, only] of targets) {
    const coll = Model.collection;
    const existing = new Set((await coll.indexes().catch(() => [])).map((i) => i.name));
    for (const [keys, options] of Model.schema.indexes()) {
      const { name } = options;
      if (!name) throw new Error(`${Model.modelName}: every index must be named`);
      if (only && !only.includes(name)) continue;
      let state;
      if (existing.has(name)) state = 'already there';
      else if (apply) {
        await coll.createIndex(keys, options);
        state = 'built';
      } else state = 'would build';
      out.push([`${coll.collectionName}.${name}`, state]);
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
