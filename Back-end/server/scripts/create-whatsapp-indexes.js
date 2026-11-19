/**
 * Build the index the WhatsApp delivery-status webhook needs (prod runs autoIndex
 * off, so a deploy never builds it).
 *
 *   notification_provider_id   NotificationLog { providerId: 1 }, sparse — the webhook
 *                              finds a message by Meta's `wamid`. Without it every status
 *                              (up to ~4 per message) scans the collection.
 *
 * The collection is small (90-day TTL) and the index sparse, so building it on the
 * live cluster is quick and safe. Safe to run more than once. The spec is read from
 * models/NotificationLog.js itself, so this script cannot drift from the schema.
 *
 * Run AFTER the code is deployed (the old code never queries by providerId, so running
 * it before is harmless too).
 *
 * Usage (from Back-end/server; prod via `railway run`, no dotenv):
 *   node scripts/create-whatsapp-indexes.js           # dry run
 *   node scripts/create-whatsapp-indexes.js --apply   # build
 *
 * Rollback: db.notificationlogs.dropIndex('notification_provider_id')
 */
import mongoose from 'mongoose';
import NotificationLog from '../models/NotificationLog.js';

const APPLY = process.argv.includes('--apply');
const NAMES = new Set(['notification_provider_id']);

/** [keys, options] for the WhatsApp indexes the schema declares. */
export const INDEXES = NotificationLog.schema.indexes().filter(([, o]) => NAMES.has(o?.name));

export async function buildIndexes({ apply = APPLY, log = console.log } = {}) {
  const coll = NotificationLog.collection;
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
  for (const [name, state] of out) log(`[whatsapp-indexes] ${name}: ${state}`);
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  // autoIndex off: importing the model must not build every declared index.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`[whatsapp-indexes] ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to build)'}`);
  await buildIndexes();
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error('[whatsapp-indexes] failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
