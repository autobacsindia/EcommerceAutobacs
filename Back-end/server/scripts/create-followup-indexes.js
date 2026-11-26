/**
 * Build the FollowUpDelay indexes on a cluster (prod runs autoIndex off, so a
 * deploy never builds them). The collection is new and starts empty, so this is
 * instant and safe while the site is live. Safe to run more than once.
 *
 *   followup_key         unique — one row per order step, however many sweeps,
 *                        replicas or retries create it. WITHOUT IT two replicas
 *                        could each create a row and alert twice: run this
 *                        before FOLLOWUP_MODE=live (shadow is safe, it sends nothing).
 *   followup_open        the sweep's walk over open rows
 *   followup_owner_late / followup_team_late / followup_late   delay lists
 *   followup_order       one order's rows
 *
 * The specs are read from models/FollowUpDelay.js itself, so this script cannot
 * drift from the schema.
 *
 * Run AFTER the code is deployed.
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node --import=dotenv/config scripts/create-followup-indexes.js           # dry run
 *   node --import=dotenv/config scripts/create-followup-indexes.js --apply   # build
 *
 * Rollback: db.followupdelays.dropIndex('<name>') for each name above. The rows
 * are the delay history — do not drop the collection once the engine has run.
 */
import mongoose from 'mongoose';
import FollowUpDelay from '../models/FollowUpDelay.js';

const APPLY = process.argv.includes('--apply');

/** [keys, options] for every named index the schema declares. */
export const INDEXES = FollowUpDelay.schema.indexes().filter(([, o]) => o?.name);

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = FollowUpDelay.collection;
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
  for (const [name, state] of out) log(`[followup-indexes] ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`[followup-indexes] ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('[followup-indexes] failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
