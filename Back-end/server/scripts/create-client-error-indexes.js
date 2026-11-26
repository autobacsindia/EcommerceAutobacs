/**
 * Build the ClientError indexes (customer-facing website errors) on a cluster.
 * Prod runs autoIndex off, so a deploy never builds them. The collection is new
 * and starts empty, so this is instant and safe while the site is live. Safe to
 * run more than once.
 *
 *   signature_1                                 unique — one record per different error
 *   lastSeenAt_-1__id_-1                        the panel list (newest first, cursor)
 *   feature_1_status_1_lastSeenAt_-1__id_-1     the list narrowed to a feature / status
 *   expireAt_ttl                                TTL: a record goes 30 days after it last happened.
 *                                               Partial filter `$type: 'date'` (never `$ne`).
 *
 * Run AFTER the code is deployed. Until it runs: there is no expiry (records stay; the
 * 2,000-record ceiling still bounds the collection) and two simultaneous first reports
 * of one new error may create two records. So do run it.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node --import=dotenv/config scripts/create-client-error-indexes.js           # dry run
 *   node --import=dotenv/config scripts/create-client-error-indexes.js --apply   # build
 *
 * Rollback: db.clienterrors.dropIndex('<name>') for each, or db.clienterrors.drop().
 */
import mongoose from 'mongoose';
import ClientError from '../models/ClientError.js';

const APPLY = process.argv.includes('--apply');

/** Read from the schema itself, so the script can never disagree with the model. */
export const INDEXES = ClientError.schema.indexes();

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = ClientError.collection;
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
  for (const [name, state] of out) log(`[client-error-indexes] ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`[client-error-indexes] ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('[client-error-indexes] failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
