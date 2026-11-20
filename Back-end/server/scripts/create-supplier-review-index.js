/**
 * Build the "supplier change waiting for accounts" index on a cluster. Production
 * runs with autoIndex off, so a deploy never builds schema indexes; this script is
 * the explicit, checkable way to do it (or to confirm it is there).
 *
 *   workflow_review_pending   { 'workflow.reviewPendingAt': 1, _id: 1 },
 *                             partial { 'workflow.reviewPendingAt': { $type: 'date' } }
 *                             — accounts' "Waiting for your approval" → Supplier changes.
 *
 * No order has `workflow.reviewPendingAt` before this code ships, so the partial
 * index starts empty: building it is instant and safe while the panel is live.
 * Without it the list still works, but scans every order. Safe to run more than once.
 * Run it right after the code is deployed.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/create-supplier-review-index.js           # dry run: says what it would do
 *   node scripts/create-supplier-review-index.js --apply   # build it
 * Then: npm run audit-index-drift
 *
 * Rollback: db.orders.dropIndex('workflow_review_pending') — harmless: the list falls back to a scan.
 */
import mongoose from 'mongoose';
import Order from '../models/Order.js';

const APPLY = process.argv.includes('--apply');
const TAG = '[supplier-review-index]';

export const INDEXES = [
  [{ 'workflow.reviewPendingAt': 1, _id: 1 }, { partialFilterExpression: { 'workflow.reviewPendingAt': { $type: 'date' } }, name: 'workflow_review_pending' }],
];

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = Order.collection;
  const existing = new Set((await coll.indexes().catch(() => [])).map((i) => i.name));
  const out = [];
  for (const [keys, options] of INDEXES) {
    if (existing.has(options.name)) out.push([options.name, 'already there']);
    else if (apply) {
      await coll.createIndex(keys, options);
      out.push([options.name, 'built']);
    } else out.push([options.name, 'would build']);
  }
  for (const [name, state] of out) log(`${TAG} ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
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
