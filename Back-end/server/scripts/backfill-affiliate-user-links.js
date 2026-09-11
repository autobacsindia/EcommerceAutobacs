/**
 * Backfill `Affiliate.user` for applications that were never linked to an account.
 *
 * ── THE BUG THIS REPAIRS ─────────────────────────────────────────────────────────
 * `Affiliate.user` was written in exactly one place — at application time, and only when
 * the applicant happened to be signed in. Nothing backfilled it: not approval, not
 * registration, not login. `GET /affiliates/me` resolves by `user` id alone, so anyone
 * who applied from the public (deliberately unauthenticated) form while logged out was
 * orphaned PERMANENTLY from their own dashboard, commission ledger and payout history.
 *
 * The live paths are fixed (application, email verification, approval). This sweeps up
 * the rows created before that, and anything the automatic paths could not reach.
 *
 * ── THE OWNERSHIP RULE ───────────────────────────────────────────────────────────
 * Only a user whose email is VERIFIED may be linked. Logging in does not prove you own
 * an address — nothing in the auth path gates on `isVerified` — so linking on a bare
 * email match would hand an affiliate's earnings, and later their bank details, to
 * whoever registered that address first. This script applies exactly the same rule as
 * the runtime code and never relaxes it, no matter what flags you pass.
 *
 * Rows whose email has no account, or an unverified one, are reported as BLOCKED. That
 * is not a failure — it is the correct outcome, and it resolves itself the moment that
 * person verifies. `/affiliates/me` tells them so.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────
 * ⚠️ RUN LOCALLY, THIS TARGETS **PRODUCTION**. The committed .env's MONGODB_URI is the
 * prod cluster, so `npm run backfill-affiliate-user-links` on your laptop reads prod.
 * That is harmless in the default dry run — it writes nothing — but it is NOT the test
 * cluster, and the host banner it prints is the only thing that tells you so. Read it.
 *
 *   # Dry run against PROD (read-only, safe):
 *   npm run backfill-affiliate-user-links
 *
 *   # Dry run / apply against TEST — `railway run` injects that environment's URI:
 *   railway run --environment test npm run backfill-affiliate-user-links
 *   railway run --environment test npm run backfill-affiliate-user-links -- \
 *     --apply --confirm-cluster=autobacstest
 *
 *   # Apply against PROD, deliberately:
 *   npm run backfill-affiliate-user-links -- --apply --confirm-cluster=autobacs-prod
 *
 * Dry run by default. Writing requires --confirm-cluster=<substring of the host printed
 * in the banner>, because "I ran it locally" is not a safeguard when local IS prod.
 *
 * ── ROLLBACK ─────────────────────────────────────────────────────────────────────
 * The script prints an unset command for exactly the ids it touched. Unlinking is safe:
 * it restores the prior (broken) state and grants nobody anything.
 *
 *   db.affiliates.updateMany({ _id: { $in: [<printed ids>] } }, { $unset: { user: '' } })
 */

import mongoose from 'mongoose';

// Never let an imported module construct a cache/queue client against a real host.
delete process.env.REDIS_URL;
delete process.env.QUEUE_REDIS_URL;

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const APPLY = Boolean(flag('apply'));
const CONFIRM_CLUSTER = flag('confirm-cluster');

const line = (s = '') => console.log(s);

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');

  // Show WHERE before doing anything, so a wrong target is visible immediately.
  const host = (uri.match(/@([^/?]+)/) || [])[1] || '(unparsed host)';
  const dbName = (uri.match(/\/([^/?]+)(\?|$)/) || [])[1] || '(default db)';

  // autoIndex:false is not optional — connecting with models imported builds every
  // declared index against whatever cluster this points at.
  await mongoose.connect(uri, { autoIndex: false });

  line('─'.repeat(74));
  line(`  cluster : ${host}`);
  line(`  database: ${dbName}`);
  line(`  mode    : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  line('─'.repeat(74));

  if (APPLY) {
    if (!CONFIRM_CLUSTER) {
      throw new Error(
        'Writing requires --confirm-cluster=<substring of the host printed above>. '
        + 'This exists so a production cluster cannot be written to by accident.'
      );
    }
    if (!host.includes(String(CONFIRM_CLUSTER))) {
      throw new Error(
        `--confirm-cluster="${CONFIRM_CLUSTER}" does not appear in the host "${host}". `
        + 'Refusing, because you are not pointed where you think you are.'
      );
    }
  }

  const { default: Affiliate } = await import('../models/Affiliate.js');
  const { default: User } = await import('../models/User.js');

  /*
    ⚠️ `$exists: false`, NOT `user: null`.

    On an account-less application the field is ABSENT rather than null — deliberately,
    because the sparse unique index on `user` indexes stored nulls and a null would block
    the second such application. A `$eq: null` predicate would match nothing here and the
    script would cheerfully report "0 to link" on a database full of orphans.
  */
  const orphans = await Affiliate.find(
    { user: { $exists: false } },
    { email: 1, code: 1, status: 1, createdAt: 1 },
  ).sort({ createdAt: 1 }).lean();

  const total = await Affiliate.estimatedDocumentCount();
  line(`\n  ${total} affiliates, ${orphans.length} with no linked account\n`);

  if (!orphans.length) {
    line('  Nothing to do.');
    return;
  }

  const linkable = [];
  const blocked = [];

  for (const a of orphans) {
    const user = await User.findOne(
      { email: String(a.email).trim().toLowerCase() },
      { _id: 1, isVerified: 1 },
    ).lean();

    if (user?.isVerified) linkable.push({ affiliate: a, user });
    else blocked.push({ affiliate: a, reason: user ? 'account NOT verified' : 'no account' });
  }

  const label = (a) => `${(a.code || '(no code)').padEnd(18)} ${a.status.padEnd(10)} ${a.email}`;

  if (linkable.length) {
    line(`  LINKABLE (${linkable.length}) — email is verified:`);
    for (const { affiliate, user } of linkable) line(`    ✓ ${label(affiliate)} → ${user._id}`);
    line();
  }

  if (blocked.length) {
    line(`  BLOCKED (${blocked.length}) — cannot prove ownership, correctly left alone:`);
    for (const { affiliate, reason } of blocked) line(`    · ${label(affiliate)}  (${reason})`);
    line();
    line('    These resolve themselves the moment that person verifies their email.');
    line('    Until then /affiliates/me tells them exactly that, rather than claiming');
    line('    they are not an affiliate. An affiliate whose payout email will never');
    line('    match a login needs an admin to link them by hand.');
    line();
  }

  if (!APPLY) {
    line(`  DRY RUN — nothing written. Re-run with --apply --confirm-cluster=<part of "${host}">`);
    return;
  }

  if (!linkable.length) {
    line('  Nothing linkable. No writes.');
    return;
  }

  const touched = [];
  for (const { affiliate, user } of linkable) {
    // Re-assert `$exists: false` at write time: between the read above and here, the
    // verify-email hook may have linked this very row. The guard makes that a no-op
    // rather than a redundant write, and makes re-running the script idempotent.
    const res = await Affiliate.updateOne(
      { _id: affiliate._id, user: { $exists: false } },
      { $set: { user: user._id } },
    );
    if (res.modifiedCount) touched.push(affiliate._id);
  }

  line(`  ✓ Linked ${touched.length} of ${linkable.length}`
    + `${touched.length < linkable.length ? ' (the rest were already linked — harmless)' : ''}`);

  if (touched.length) {
    line('\n  ROLLBACK:');
    line(`    db.affiliates.updateMany({ _id: { $in: [${touched
      .map((id) => `ObjectId("${id}")`).join(', ')}] } }, { $unset: { user: '' } })`);
  }
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`\n✗ ${err.message}\n`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
