/**
 * Build the ChatCall indexes on a cluster (prod runs autoIndex off, so a deploy
 * never builds them). The collection is new and starts empty, so this is instant
 * and safe while the site is live. Safe to run more than once.
 *
 *   chat_call_live_channel  unique, live calls only — at most ONE live call per DM.
 *                           Without it, two people pressing "call" at the same
 *                           instant could open two calls; the service relies on
 *                           the duplicate-key error to settle that race.
 *   chat_call_live_caller / chat_call_live_callee   "is this person busy?"
 *   chat_call_live_status   the minute-by-minute sweep of rung-out / silent calls
 *
 * The specs are read from models/ChatCall.js itself, so this script cannot
 * drift from the schema.
 *
 * Run AFTER the code is deployed (the old code never touches the collection, so
 * running it before is harmless too).
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node --import=dotenv/config scripts/create-chat-call-indexes.js           # dry run
 *   node --import=dotenv/config scripts/create-chat-call-indexes.js --apply   # build
 *
 * Rollback: db.chatcalls.dropIndex('<name>') for each name above — or, since the
 * collection only holds call history, db.chatcalls.drop() removes everything.
 */
import mongoose from 'mongoose';
import ChatCall from '../models/ChatCall.js';

const APPLY = process.argv.includes('--apply');

/** [keys, options] for every named index the schema declares. */
export const INDEXES = ChatCall.schema.indexes().filter(([, o]) => o?.name);

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = ChatCall.collection;
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
  for (const [name, state] of out) log(`[chat-call-indexes] ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`[chat-call-indexes] ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('[chat-call-indexes] failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
