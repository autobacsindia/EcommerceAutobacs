/**
 * Repair the production `carts` indexes so they match models/Cart.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * `autoIndex` is off in production (config/db.js — correctly, so a deploy can't
 * trigger a foreground index build), and nothing reconciled schema changes
 * against the live cluster. Production drifted:
 *
 *   1. `recentChanges.createdAt_1`  expireAfterSeconds:300   <-- DATA LOSS
 *   2. `recentChanges_1`            expireAfterSeconds:300   <-- inert but costly
 *      Neither is in the schema. A TTL index over an array of dates expires on
 *      the MINIMUM value and deletes the WHOLE document, so any cart that
 *      recorded a REMOVED_OUT_OF_STOCK / PRICE_UPDATED note (routes/cart.js
 *      pushes one, then saves) was deleted ~5 minutes later — the shopper's
 *      entire basket, silently. 0 carts in prod currently hold a recentChanges
 *      entry, which is consistent with this reaping them.
 *      models/Cart.js:93 already documents that TTL cannot work on a subdocument
 *      array and uses a pre-save prune instead; these indexes predate that.
 *
 *   3. `sessionId_1` is `sparse` where the schema says partial. This one was not
 *      carelessness: the schema declared
 *      `partialFilterExpression: { sessionId: { $exists: true, $ne: null } }`,
 *      and MongoDB REJECTS `$ne` inside a partial filter ("Expression not
 *      supported in partial index"). The declaration could never be built, so the
 *      older `sparse` index survived and the schema quietly disagreed with
 *      reality. Both are now `{ $type: ... }`, which is supported and expresses
 *      the actual intent — index only documents holding a real value.
 *      Sparse is NOT equivalent: it skips only MISSING fields, so a document with
 *      `sessionId: null` IS indexed and a unique index then permits only ONE such
 *      document cluster-wide. Nothing writes `sessionId: null` today (verified).
 *
 *   4. `user_1` had the same unbuildable `$ne: null` filter.
 *
 * It also ADDS the new `guest_cart_ttl` index (30-day expiry, guests only).
 *
 * SAFETY
 *   - Dry-run by default. Pass --apply to make changes.
 *   - Index builds are backgrounded.
 *   - Dropping and recreating a UNIQUE index leaves a sub-second window where a
 *     duplicate could be inserted. Run off-peak. The script re-checks for
 *     duplicates before recreating and aborts rather than failing halfway.
 *
 * Usage:
 *   node scripts/fix-cart-indexes-v2.js            # report only
 *   node scripts/fix-cart-indexes-v2.js --apply    # execute
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');

/** Indexes that must NOT exist. */
const ORPHAN_INDEXES = ['recentChanges.createdAt_1', 'recentChanges_1'];

/** Target state, matching models/Cart.js exactly. */
const DESIRED = [
  {
    name: 'sessionId_1',
    key: { sessionId: 1 },
    options: {
      unique: true,
      partialFilterExpression: { sessionId: { $type: 'string' } },
      background: true,
    },
  },
  {
    name: 'user_1',
    key: { user: 1 },
    options: {
      unique: true,
      partialFilterExpression: { user: { $type: 'objectId' } },
      background: true,
    },
  },
  {
    name: 'guest_cart_ttl',
    key: { updatedAt: 1 },
    options: {
      expireAfterSeconds: 30 * 24 * 60 * 60,
      partialFilterExpression: { sessionId: { $type: 'string' } },
      background: true,
      name: 'guest_cart_ttl',
    },
  },
];

const log = (...a) => console.log(...a);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Does the live index already match what we want? */
function matches(live, desired) {
  if (!same(live.key, desired.key)) return false;
  if (Boolean(live.unique) !== Boolean(desired.options.unique)) return false;
  if (live.expireAfterSeconds !== desired.options.expireAfterSeconds) return false;
  if (live.sparse) return false; // schema uses partial, never sparse
  return same(live.partialFilterExpression, desired.options.partialFilterExpression);
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');

  await mongoose.connect(uri, { autoIndex: false });
  const carts = mongoose.connection.db.collection('carts');

  log(`\n=== carts index repair ${APPLY ? '(APPLY)' : '(DRY RUN — pass --apply to execute)'} ===\n`);

  const live = await carts.listIndexes().toArray();
  log('Current production indexes:');
  for (const i of live) {
    const bits = [
      i.unique ? 'unique' : null,
      i.sparse ? 'sparse' : null,
      i.expireAfterSeconds != null ? `ttl=${i.expireAfterSeconds}s` : null,
      i.partialFilterExpression ? `partial=${JSON.stringify(i.partialFilterExpression)}` : null,
    ].filter(Boolean).join(' ');
    log(`  ${i.name.padEnd(28)} ${JSON.stringify(i.key)} ${bits}`);
  }

  const plan = [];

  // 1. Orphan TTL indexes — the data-loss bug.
  for (const name of ORPHAN_INDEXES) {
    if (live.some((i) => i.name === name)) {
      plan.push({ action: 'drop', name, reason: 'orphan TTL index — deletes whole cart documents' });
    }
  }

  // 2/3. Reconcile the rest.
  for (const d of DESIRED) {
    const existing = live.find((i) => i.name === d.name);
    if (!existing) {
      plan.push({ action: 'create', name: d.name, desired: d, reason: 'missing' });
    } else if (!matches(existing, d)) {
      plan.push({
        action: 'recreate',
        name: d.name,
        desired: d,
        reason: existing.sparse ? 'sparse, schema wants partial' : 'options differ from schema',
      });
    }
  }

  if (plan.length === 0) {
    log('\n✓ carts indexes already match the schema. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  log('\nPlanned changes:');
  for (const p of plan) log(`  [${p.action.toUpperCase().padEnd(8)}] ${p.name} — ${p.reason}`);

  if (!APPLY) {
    log('\nDry run complete. Re-run with --apply to execute.\n');
    await mongoose.disconnect();
    return;
  }

  log('');
  let aborted = 0;
  for (const p of plan) {
    if (p.action === 'drop') {
      await carts.dropIndex(p.name);
      log(`  ✓ dropped ${p.name}`);
      continue;
    }

    // A unique index is briefly absent between drop and create. Verify the data
    // can satisfy uniqueness first, so we fail before dropping rather than after.
    if (p.desired.options.unique) {
      const field = Object.keys(p.desired.key)[0];
      const dupes = await carts.aggregate([
        { $match: { [field]: { $exists: true, $ne: null } } },
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $limit: 5 },
      ]).toArray();
      if (dupes.length > 0) {
        log(`  ✗ ABORT ${p.name}: duplicate ${field} values exist, unique index would fail:`);
        for (const d of dupes) log(`      ${d._id} x${d.n}`);
        log('    Resolve the duplicates, then re-run.');
        aborted += 1;
        continue;
      }
    }

    if (p.action === 'recreate') {
      await carts.dropIndex(p.name);
      log(`  ✓ dropped ${p.name} (for rebuild)`);
    }
    await carts.createIndex(p.desired.key, p.desired.options);
    log(`  ✓ created ${p.name}`);
  }

  log('\nFinal index state:');
  for (const i of await carts.listIndexes().toArray()) {
    log(`  ${i.name.padEnd(28)} ${JSON.stringify(i.key)}`);
  }
  log('');
  await mongoose.disconnect();

  // Exit non-zero if any index was skipped. Printing "Final index state" and
  // returning 0 after an abort made a partial failure read as a clean success.
  if (aborted > 0) {
    console.error(`✗ ${aborted} index(es) NOT applied — see the ABORT lines above.\n`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('\n✗ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
