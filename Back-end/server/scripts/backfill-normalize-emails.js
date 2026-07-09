/**
 * Normalize existing `User.email` values to trimmed lowercase.
 *
 * Background — `User.email` now carries `lowercase:true, trim:true` at the schema
 * level (audit DB-1), so all NEW writes are normalized. This repairs EXISTING rows
 * that predate the change (e.g. `John@X.com `, mixed-case WooCommerce imports).
 *
 * Why run this BEFORE relying on the schema change: once `lowercase:true` is live,
 * the first ordinary write to a legacy mixed-case user (a profile edit, an admin
 * update) silently lowercases its email — and if a lowercase twin already exists,
 * the unique index rejects the save. This script surfaces those collisions up front
 * instead of letting them surprise a user mid-update.
 *
 * Behavior (per user whose email !== trimmed-lowercase):
 *   - No existing row owns the normalized email  →  update in place.
 *   - Another row already owns it (a case/space twin)  →  REPORT as a conflict and
 *     SKIP. These need a manual account merge (orders/leads/karma consolidation);
 *     this script never merges or deletes.
 *
 * Idempotent. Safe to re-run. Dry-run by default.
 *
 * Usage:
 *   node --import=dotenv/config scripts/backfill-normalize-emails.js            # dry run (no writes)
 *   node --import=dotenv/config scripts/backfill-normalize-emails.js --apply    # apply changes
 *   railway run node --import=dotenv/config scripts/backfill-normalize-emails.js --apply
 *
 * Requires MONGODB_URI (or MONGO_URI) in the environment.
 */

import mongoose from 'mongoose';
import User from '../models/User.js';

const APPLY = process.argv.includes('--apply');

const normalize = (email) => String(email ?? '').trim().toLowerCase();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[backfill-normalize-emails] connected. mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const cursor = User.find({}, { email: 1 }).lean().cursor();

  const stats = { scanned: 0, alreadyNormalized: 0, updated: 0, conflicts: [] };

  for await (const u of cursor) {
    stats.scanned++;
    const current = u.email;
    const normalized = normalize(current);

    if (current === normalized) {
      stats.alreadyNormalized++;
      continue;
    }

    // Would normalizing collide with an existing (already-normalized) row?
    const twin = await User.findOne(
      { _id: { $ne: u._id }, email: normalized },
      { _id: 1, email: 1 },
    ).lean();

    if (twin) {
      stats.conflicts.push({ id: String(u._id), from: current, to: normalized, twinId: String(twin._id) });
      continue;
    }

    if (APPLY) {
      await User.updateOne({ _id: u._id }, { $set: { email: normalized } });
    }
    stats.updated++;
    console.log(`  ${APPLY ? 'updated' : 'would update'}: "${current}" -> "${normalized}"`);
  }

  console.log('\n── Summary ─────────────────────────────');
  console.log(`  scanned:            ${stats.scanned}`);
  console.log(`  already normalized: ${stats.alreadyNormalized}`);
  console.log(`  ${APPLY ? 'updated' : 'to update'}:          ${stats.updated}`);
  console.log(`  conflicts (manual): ${stats.conflicts.length}`);

  if (stats.conflicts.length > 0) {
    console.log('\n⚠ Conflicts — normalized email already taken by another account.');
    console.log('  These need a manual merge (do NOT run --apply expecting these to resolve):');
    for (const c of stats.conflicts) {
      console.log(`   - user ${c.id} "${c.from}" → "${c.to}" collides with user ${c.twinId}`);
    }
  }

  await mongoose.disconnect();
  console.log(`\n[backfill-normalize-emails] done (${APPLY ? 'APPLIED' : 'DRY-RUN — no writes'}).`);
}

main().catch((err) => {
  console.error('[backfill-normalize-emails] failed:', err);
  process.exit(1);
});
