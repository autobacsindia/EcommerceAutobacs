/**
 * Build the OrderRating indexes on a cluster (prod runs autoIndex off, so a
 * deploy never builds them). The collection is new and starts empty, so this is
 * instant and safe while the site is live. Safe to run more than once.
 *
 *   order_1                      unique — one rating per order (the single-use guarantee)
 *   salesperson_1_createdAt_-1   the incentive engine's read
 *
 * Run AFTER the code is deployed; it can also run before, the old code ignores the
 * collection. Without the unique index, two submits at the same instant could
 * write two ratings for one order — so do run it.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node --import=dotenv/config scripts/create-order-rating-indexes.js           # dry run
 *   node --import=dotenv/config scripts/create-order-rating-indexes.js --apply   # build
 *
 * Rollback: db.orderratings.dropIndex('salesperson_1_createdAt_-1') (and 'order_1').
 */
import mongoose from 'mongoose';
import OrderRating from '../models/OrderRating.js';

const APPLY = process.argv.includes('--apply');

export const INDEXES = [
  [{ order: 1 }, { unique: true, name: 'order_1' }],
  [{ salesperson: 1, createdAt: -1 }, { name: 'salesperson_1_createdAt_-1' }],
];

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = OrderRating.collection;
  const existing = new Set((await coll.indexes().catch(() => [])).map((i) => i.name));
  const out = [];
  for (const [keys, options] of INDEXES) {
    if (existing.has(options.name)) {
      out.push([options.name, 'already there']);
    } else if (apply) {
      await coll.createIndex(keys, options);
      out.push([options.name, 'built']);
    } else {
      out.push([options.name, 'would build']);
    }
  }
  for (const [name, state] of out) log(`[order-rating-indexes] ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`[order-rating-indexes] ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('[order-rating-indexes] failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
