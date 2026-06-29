/**
 * sync-local-to-atlas.js
 * Exports all collections from local MongoDB and imports them into Atlas.
 * Usage: node sync-local-to-atlas.js <ATLAS_MONGO_URI>
 * Example: node sync-local-to-atlas.js "mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/autobacs"
 */

import { MongoClient } from 'mongodb';

const LOCAL_URI = 'mongodb://localhost:27017/autobacs';
const ATLAS_URI = process.argv[2];

if (!ATLAS_URI) {
  console.error('Usage: node sync-local-to-atlas.js "<ATLAS_MONGO_URI>"');
  console.error('Get the MONGO_URI from Railway → Backend service → Variables');
  process.exit(1);
}

// Collections to skip (runtime/log data that shouldn't be synced)
const SKIP_COLLECTIONS = ['rate_limit_events', 'auditlogs', 'notificationlogs'];

// Collections to sync (in order — dependencies first)
const PRIORITY_COLLECTIONS = [
  'categories', 'brands', 'vehicles', 'products',
  'users', 'warehouses', 'deliveryzones',
  'orders', 'carts', 'wishlists', 'payments',
  'userlocations', 'reviews', 'contacts',
  'productquestions', 'returnrequests', 'importjobs',
  'warehouseinventories', 'adaptive_throttling_profiles'
];

async function sync() {
  console.log('Connecting to local MongoDB...');
  const localClient = await MongoClient.connect(LOCAL_URI);
  const localDb = localClient.db('autobacs');

  console.log('Connecting to Atlas...');
  const atlasClient = await MongoClient.connect(ATLAS_URI);
  const atlasDb = atlasClient.db(); // uses db name from URI

  const allCollections = await localDb.listCollections().toArray();
  const collectionNames = allCollections.map(c => c.name).filter(n => !SKIP_COLLECTIONS.includes(n));

  // Sort: priority collections first, rest after
  const sorted = [
    ...PRIORITY_COLLECTIONS.filter(n => collectionNames.includes(n)),
    ...collectionNames.filter(n => !PRIORITY_COLLECTIONS.includes(n))
  ];

  console.log(`\nCollections to sync: ${sorted.join(', ')}\n`);

  for (const name of sorted) {
    process.stdout.write(`Syncing ${name}... `);
    const docs = await localDb.collection(name).find({}).toArray();
    if (docs.length === 0) {
      console.log('(empty, skipped)');
      continue;
    }

    // Drop and re-import for a clean sync
    await atlasDb.collection(name).drop().catch(() => {}); // ignore if doesn't exist
    const result = await atlasDb.collection(name).insertMany(docs, { ordered: false }).catch(e => {
      console.log(`\n  Warning: ${e.message}`);
      return { insertedCount: 0 };
    });
    console.log(`${result.insertedCount}/${docs.length} docs`);
  }

  console.log('\n✓ Sync complete!');
  console.log('Now update your local .env MONGO_URI to point to Atlas so both environments share the same database.');

  await localClient.close();
  await atlasClient.close();
}

sync().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
