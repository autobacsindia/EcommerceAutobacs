/**
 * Reclaim the `rate_limit_events` collection.
 *
 * THE PROBLEM
 * -----------
 * Every allowed request wrote one document. That made this ONE collection 95% of
 * the entire database — 3,012,231 docs / 1.26 GB logical / 183.8 MB storage plus
 * 334.5 MB across 13 indexes, against a real business dataset (products, orders,
 * users) of 25.6 MB. 99.55% of the rows are `eventType: 'hit'`, which nothing
 * reads: rateLimitDashboardController only aggregates block/retry_* events. The
 * write load (~2.3 inserts/s, ~100% of all cluster inserts) pushed Atlas compute
 * auto-scaling from M10 to M20, roughly +$102/month.
 *
 * WHY RENAME-AND-SWAP, NOT deleteMany
 * -----------------------------------
 * `deleteMany({ eventType: 'hit' })` over 3M documents means 3M oplog entries and
 * ~13 index updates each — on the order of 39M index operations, hours of heavy
 * write load on a cluster already pinned at the top of its auto-scale range. That
 * is the same load we are trying to remove.
 *
 * `renameCollection` and `drop` are O(1) metadata operations. Same result, seconds
 * instead of hours, and the original data stays intact until you confirm.
 *
 * WHAT IT DOES
 *   1. Preflight — refuse to run unless the Pass 1 write-stop is already deployed
 *      (checks for recent `hit` rows). Renaming first would just let it refill.
 *   2. Rename  rate_limit_events -> rate_limit_events_old        [instant]
 *   3. Create a fresh rate_limit_events with only the 2 indexes the dashboard
 *      queries actually use (down from 13).
 *   4. Copy back the block, retry and threshold_change rows (~13.6k), keeping _id.
 *   5. Verify, then STOP. `_old` is left in place as the rollback path.
 *
 * ROLLBACK (before --drop-old): rename `rate_limit_events_old` back over the new
 * collection. Nothing is destroyed until you explicitly run --drop-old.
 *
 * Usage:
 *   node scripts/compact-rate-limit-events.js              # dry run, changes nothing
 *   node scripts/compact-rate-limit-events.js --apply      # do the swap
 *   node scripts/compact-rate-limit-events.js --drop-old   # after verifying, reclaim
 *   node scripts/compact-rate-limit-events.js --rollback   # undo the swap
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has('--apply');
const DROP_OLD = ARGS.has('--drop-old');
const ROLLBACK = ARGS.has('--rollback');

const LIVE = 'rate_limit_events';
const OLD = 'rate_limit_events_old';

/** Event types worth keeping. Everything else (i.e. `hit`) is discarded. */
const KEEP_TYPES = ['block', 'retry_success', 'retry_failure', 'threshold_change'];

/**
 * The only indexes the dashboard needs. Every query in
 * rateLimitDashboardController filters on `timestamp`, or on `eventType` +
 * `timestamp`. The other 11 served nothing and cost a write on every insert.
 */
const TARGET_INDEXES = [
  { key: { timestamp: 1 }, options: { expireAfterSeconds: 7776000, background: true } },
  { key: { eventType: 1, timestamp: -1 }, options: { background: true } },
];

const COPY_BATCH = 2000;
/** A hit within this window means the write-stop is not live yet. */
const PREFLIGHT_WINDOW_MS = 10 * 60 * 1000;

const fmt = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`);

async function collStats(db, name) {
  try {
    const [r] = await db.collection(name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
    return {
      count: r.storageStats.count,
      storage: r.storageStats.storageSize,
      indexes: r.storageStats.totalIndexSize,
      nindexes: r.storageStats.nindexes,
    };
  } catch {
    return null;
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');

  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;
  const names = new Set((await db.listCollections().toArray()).map((c) => c.name));

  // ---- rollback ----------------------------------------------------------
  if (ROLLBACK) {
    if (!names.has(OLD)) throw new Error(`${OLD} does not exist — nothing to roll back`);
    console.log(`Rolling back: ${OLD} -> ${LIVE}`);

    // Never blind-drop the new collection. Real `block` events may have been
    // written into it by the live application since the swap, and those are the
    // security signal this whole change set is protecting. Merge them back into
    // the restored collection instead of discarding them.
    if (names.has(LIVE)) {
      const salvage = await db.collection(LIVE)
        .find({ eventType: { $in: KEEP_TYPES } })
        .toArray();
      const oldIds = new Set(
        (await db.collection(OLD)
          .find({ _id: { $in: salvage.map((d) => d._id) } }, { projection: { _id: 1 } })
          .toArray()).map((d) => String(d._id))
      );
      const newRows = salvage.filter((d) => !oldIds.has(String(d._id)));
      if (newRows.length) {
        await db.collection(OLD).insertMany(newRows, { ordered: false });
        console.log(`  merged ${newRows.length} event(s) written since the swap back into ${OLD}`);
      }
      await db.collection(LIVE).drop();
    }

    await db.collection(OLD).rename(LIVE);
    console.log('✓ Rolled back.\n');
    await mongoose.disconnect();
    return;
  }

  // ---- drop-old ----------------------------------------------------------
  if (DROP_OLD) {
    if (!names.has(OLD)) {
      console.log(`${OLD} does not exist — nothing to drop.`);
      await mongoose.disconnect();
      return;
    }
    const s = await collStats(db, OLD);
    console.log(s
      ? `Dropping ${OLD} (${s.count} docs, ${fmt(s.storage + s.indexes)} reclaimed)…`
      : `Dropping ${OLD} (stats unavailable)…`);
    await db.collection(OLD).drop();
    console.log('✓ Dropped. Rollback is no longer possible.\n');
    await mongoose.disconnect();
    return;
  }

  // ---- report ------------------------------------------------------------
  console.log(`\n=== compact ${LIVE} ${APPLY ? '(APPLY)' : '(DRY RUN — pass --apply to execute)'} ===\n`);

  if (!names.has(LIVE)) {
    console.log(`${LIVE} does not exist. Nothing to do.`);
    await mongoose.disconnect();
    return;
  }
  if (names.has(OLD)) {
    throw new Error(`${OLD} already exists — a previous run was not finished. Verify it, then --drop-old or --rollback.`);
  }

  const before = await collStats(db, LIVE);
  console.log(`Current: ${before.count} docs, ${fmt(before.storage)} storage, ` +
              `${fmt(before.indexes)} across ${before.nindexes} indexes\n`);

  const byType = await db.collection(LIVE).aggregate([
    { $group: { _id: '$eventType', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ], { allowDiskUse: true }).toArray();
  console.log('By eventType:');
  for (const t of byType) {
    const verb = KEEP_TYPES.includes(t._id) ? 'KEEP   ' : 'DISCARD';
    console.log(`  ${verb} ${String(t._id).padEnd(18)} ${t.n}`);
  }

  const keepCount = byType.filter((t) => KEEP_TYPES.includes(t._id)).reduce((s, t) => s + t.n, 0);
  console.log(`\n=> keeping ${keepCount} of ${before.count} documents ` +
              `(${((keepCount / before.count) * 100).toFixed(2)}%)`);
  console.log(`=> indexes ${before.nindexes} -> ${TARGET_INDEXES.length + 1} (incl. _id)`);

  // ---- preflight ---------------------------------------------------------
  // Swapping before the write-stop is deployed just refills the new collection.
  const recentHits = await db.collection(LIVE).countDocuments({
    eventType: 'hit',
    timestamp: { $gte: new Date(Date.now() - PREFLIGHT_WINDOW_MS) },
  });
  console.log(`\nPreflight: ${recentHits} hit events in the last ${PREFLIGHT_WINDOW_MS / 60000} min`);
  if (recentHits > 0) {
    console.log('\n✗ ABORT — the application is still writing `hit` events.');
    console.log('  Deploy the Pass 1 change first (RATE_LIMIT_EVENT_PERSIST=blocks-only is the');
    console.log('  default, so a plain deploy is enough), confirm writes have stopped, then re-run.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('✓ No recent hit writes — the write-stop is live.');

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to execute.\n');
    await mongoose.disconnect();
    return;
  }

  // ---- swap --------------------------------------------------------------
  console.log(`\n1/4 renaming ${LIVE} -> ${OLD}…`);
  await db.collection(LIVE).rename(OLD);

  console.log(`2/4 creating a fresh ${LIVE}…`);
  await db.createCollection(LIVE);
  for (const idx of TARGET_INDEXES) {
    await db.collection(LIVE).createIndex(idx.key, idx.options);
    console.log(`    ✓ ${JSON.stringify(idx.key)}${idx.options.expireAfterSeconds ? ' (TTL 90d)' : ''}`);
  }

  console.log(`3/4 copying ${keepCount} retained documents back…`);
  const cursor = db.collection(OLD).find({ eventType: { $in: KEEP_TYPES } });
  let batch = [];
  let copied = 0;
  for await (const doc of cursor) {
    // `deviceInfo` duplicated `userAgent` on every row; drop it on the way through.
    delete doc.deviceInfo;
    batch.push(doc);
    if (batch.length >= COPY_BATCH) {
      await db.collection(LIVE).insertMany(batch, { ordered: false });
      copied += batch.length;
      batch = [];
      process.stdout.write(`\r    copied ${copied}/${keepCount}`);
    }
  }
  if (batch.length) {
    await db.collection(LIVE).insertMany(batch, { ordered: false });
    copied += batch.length;
  }
  process.stdout.write(`\r    copied ${copied}/${keepCount}\n`);

  console.log('4/4 verifying…');
  const finalCount = await db.collection(LIVE).countDocuments();
  // `>=`, not `===`. A genuine `block` can be written by the live application at
  // any point during the swap and lands in the NEW collection, so an exact match
  // is not the success condition — losing rows is the failure condition. Being
  // strict here was actively dangerous: it sent you to --rollback, which drops
  // the new collection and would have destroyed exactly those security events.
  if (finalCount < keepCount) {
    console.log(`    ✗ SHORTFALL: expected at least ${keepCount}, found ${finalCount}`);
    console.log(`    ${OLD} is intact — nothing was lost.`);
    console.log('    Re-run the copy, or use --rollback to restore the original.');
    await mongoose.disconnect();
    process.exit(1);
  }
  if (finalCount > keepCount) {
    console.log(`    note: ${finalCount - keepCount} event(s) arrived during the swap (expected)`);
  }

  const after = await collStats(db, LIVE);
  console.log(`    ✓ ${finalCount} documents\n`);
  console.log('Result:');
  console.log(`  docs     ${before.count} -> ${after.count}`);
  console.log(`  storage  ${fmt(before.storage)} -> ${fmt(after.storage)}`);
  console.log(`  indexes  ${fmt(before.indexes)} (${before.nindexes}) -> ${fmt(after.indexes)} (${after.nindexes})`);
  console.log(`\n${OLD} is retained for rollback.`);
  console.log('  verify the admin rate-limit dashboard, then:');
  console.log('    node scripts/compact-rate-limit-events.js --drop-old\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\n✗ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
