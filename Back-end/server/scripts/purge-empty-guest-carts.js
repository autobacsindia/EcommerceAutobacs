/**
 * Delete abandoned EMPTY guest carts from `carts`.
 *
 * ── Why these exist ─────────────────────────────────────────────────────────
 * `GET /cart` used to PRE-CREATE a cart row for any caller presenting an
 * `x-session-id`, before anything had been added. Crawlers (AdsBot-Google among
 * them) hit the storefront, each got a session, and each session minted an empty
 * cart. That is ~58.7k rows of pure noise against ~440 real guest carts.
 *
 * The write path is already fixed — reading no longer pre-creates the row (see
 * the E11000 race comment in routes/cart.js). This script only clears the
 * BACKLOG that bug left behind; it is not a recurring job.
 *
 * ── Why it is worth doing at all ────────────────────────────────────────────
 * The 30-day TTL (`guest_cart_ttl`) will expire these on its own. Running this
 * shrinks the collection ~65x now rather than over the next three weeks, which
 * matters because every cart read pays for collection size — that is what made
 * the missing-index COLLSCAN cost 59,638 documents and ~31ms per request and
 * tripped the Atlas query-targeting alert.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * A cart is only deleted when ALL of these hold:
 *   • it is a GUEST cart (`sessionId` is a string) — user carts are never touched
 *   • `items` is empty — nothing to lose, and the API already returns a synthetic
 *     empty cart when no row exists, so deletion is invisible to the shopper
 *   • no `couponCode` — a bare coupon on an empty cart is still intent
 *   • untouched for --older-than days (default 7) so a live session mid-browse
 *     is never raced
 *
 * There is no rollback for a delete, which is why the filter is this narrow: the
 * rows carry no information. If you want one anyway, take an Atlas snapshot
 * first (Atlas UI → Backup) — restoring 58k empty carts has no business value,
 * so the snapshot is really there for peace of mind.
 *
 * Usage:
 *   node scripts/purge-empty-guest-carts.js                  # DRY RUN (default)
 *   node scripts/purge-empty-guest-carts.js --apply
 *   node scripts/purge-empty-guest-carts.js --older-than=14 --apply
 *   node scripts/purge-empty-guest-carts.js --batch=5000 --apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');

/** Parse `--flag=value` with a default and a validity floor. */
function numericArg(name, fallback, min) {
  const raw = ARGS.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number.parseInt(raw.split('=')[1], 10);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`--${name} must be an integer >= ${min} (got "${raw.split('=')[1]}")`);
  }
  return n;
}

const OLDER_THAN_DAYS = numericArg('older-than', 7, 1);
// Batched so a single delete never holds a long-running operation against the
// primary; deleteMany over a big match is one oplog entry per document either way.
const BATCH = numericArg('batch', 2000, 100);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');

  // autoIndex MUST be false — see CLAUDE.md. This script does not import models,
  // but the flag stays so a future import cannot silently build prod indexes.
  await mongoose.connect(uri, { autoIndex: false });
  const carts = mongoose.connection.db.collection('carts');

  const cutoff = new Date(Date.now() - OLDER_THAN_DAYS * 24 * 60 * 60 * 1000);

  // `$type: 'string'` (not just `{ $ne: null }`) so this uses `sessionId_1`, and
  // so the guest/user axes stay unambiguous. See repositories/cartRepository.js.
  const filter = {
    sessionId: { $type: 'string' },
    items: { $size: 0 },
    couponCode: null,
    updatedAt: { $lt: cutoff },
  };

  const [total, doomed, guestNonEmpty, userCarts] = await Promise.all([
    carts.estimatedDocumentCount(),
    carts.countDocuments(filter),
    carts.countDocuments({ sessionId: { $type: 'string' }, 'items.0': { $exists: true } }),
    carts.countDocuments({ user: { $type: 'objectId' } }),
  ]);

  console.log('\n=== Empty guest cart purge ===');
  console.log(`  mode              : ${APPLY ? 'APPLY (destructive)' : 'DRY RUN'}`);
  console.log(`  untouched since   : ${cutoff.toISOString()} (${OLDER_THAN_DAYS}d)`);
  console.log(`  carts total       : ${total}`);
  console.log(`  → to delete       : ${doomed}`);
  console.log(`  PRESERVED — guest carts with items : ${guestNonEmpty}`);
  console.log(`  PRESERVED — user carts             : ${userCarts}`);
  console.log(`  projected remaining               : ${total - doomed}\n`);

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to delete.\n');
    await mongoose.disconnect();
    return;
  }

  if (doomed === 0) {
    console.log('Nothing to delete.\n');
    await mongoose.disconnect();
    return;
  }

  let deleted = 0;
  // Delete by explicit _id batches rather than one unbounded deleteMany so
  // progress is visible and an interrupted run leaves a consistent partial state
  // that simply re-runs (the filter is idempotent).
  for (;;) {
    const batch = await carts
      .find(filter, { projection: { _id: 1 } })
      .limit(BATCH)
      .toArray();
    if (batch.length === 0) break;

    const res = await carts.deleteMany({ _id: { $in: batch.map((d) => d._id) } });
    deleted += res.deletedCount;
    console.log(`  deleted ${deleted}/${doomed}`);
  }

  const remaining = await carts.estimatedDocumentCount();
  console.log(`\n✓ Deleted ${deleted}. carts now holds ~${remaining} documents.\n`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\n✗ Purge failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
