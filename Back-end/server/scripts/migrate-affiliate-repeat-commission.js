/**
 * Move existing affiliates onto the one-discount-per-person rule + the repeat rate.
 *
 * THE PROBLEM
 * -----------
 * Affiliate-managed coupons were minted with `firstOrderOnly: true` and no per-user
 * cap. That gated only the COUPON, never the commission, so the same returning buyer
 * produced two opposite outcomes:
 *
 *   - arriving by tracking link  → full commission paid, no discount given
 *   - typing the code            → checkout HARD-FAILED with a 400, no order at all
 *
 * It also blocked affiliates from winning back a lapsed customer, because anyone who
 * had ever bought from Autobacs was refused outright.
 *
 * WHAT THIS DOES
 *   0. PREFLIGHT: verify the unique {coupon, user} index is actually present on the
 *      cluster this is pointed at, and REFUSE to apply if it is not (see below).
 *   1. Coupons owned by an affiliate → `firstOrderOnly: false`, `usageLimitPerUser: 1`.
 *      The discount becomes one per person, per code, enforced by that index.
 *   2. Active/suspended affiliates with no `repeatCommissionPercent` → set it from
 *      AFFILIATE_DEFAULT_REPEAT_COMMISSION_PERCENT.
 *
 * ⚠️ RUN THIS *AFTER* THE CODE IS LIVE, NOT BEFORE.
 * The old code writes `firstOrderOnly` back on any terms edit, and its
 * assertCouponApplied still hard-400s the soft refusal. Migrating first means the old
 * code quietly undoes step 1 and step 2 produces a rate nothing reads yet.
 *
 * ⚠️ WHY THE PREFLIGHT IS NOT OPTIONAL.
 * Before this migration the discount had TWO independent gates: `firstOrderOnly`, which
 * counted the buyer's own orders, and the per-user counter. Afterwards there is ONE —
 * the CouponUserUsage row. That counter fails closed only because the guarded upsert
 * hits a unique {coupon, user} index and gets E11000; WITHOUT the index the upsert
 * silently inserts a second counter document and the "one discount per person" rule
 * becomes unlimited, with nothing logged and nothing to notice.
 *
 * `autoIndex` is OFF in production, so that index exists only because
 * config/db.js ensureCriticalIndexes creates it at boot. This script therefore checks
 * the live cluster rather than trusting that, because removing the second gate while the
 * first one is unenforced would hand every affiliate code out as an unlimited discount.
 *
 * ⚠️ STEP 2 IS THE ONE THAT CHANGES WHAT PEOPLE ARE PAID.
 * Until it runs, attribution falls back to the FULL rate for repeat orders — deliberately,
 * so nobody is quietly paid less than they agreed to. Running this applies the lower rate
 * to FUTURE orders only (every order snapshots its own rate at creation, so nothing
 * already placed is repriced). Tell your affiliates before you run it; the approval email
 * states both rates for everyone approved from now on.
 *
 * ROLLBACK
 *   node scripts/migrate-affiliate-repeat-commission.js --apply --rollback
 *
 * The forward run WRITES A RUN RECORD to `migration_runs` listing the exact documents it
 * modified, and rollback reads it. It does not re-derive the set by value — matching on
 * "repeat rate == the default" would also revert a rate an admin had deliberately CHOSEN
 * that happens to equal the default, and would silently target the wrong rows entirely if
 * AFFILIATE_DEFAULT_REPEAT_COMMISSION_PERCENT changed between the two runs.
 *
 * Rows an admin has edited since the migration are left alone: rollback restores only
 * where the stored value is still exactly what this script wrote.
 *
 * Orders already placed keep their snapshots either way, which is what the snapshot is
 * for — no rollback can or should reprice them.
 *
 * Usage:
 *   node scripts/migrate-affiliate-repeat-commission.js             # dry run, changes nothing
 *   node scripts/migrate-affiliate-repeat-commission.js --apply     # execute
 *   node scripts/migrate-affiliate-repeat-commission.js --rollback  # undo (needs --apply too)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';

dotenv.config();

/** Identifies this script's rows in `migration_runs`. Never change it — rollback keys on it. */
const SCRIPT = 'migrate-affiliate-repeat-commission';

const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has('--apply');
const ROLLBACK = ARGS.has('--rollback');

const REPEAT_DEFAULT = (() => {
  const raw = process.env.AFFILIATE_DEFAULT_REPEAT_COMMISSION_PERCENT;
  if (raw === undefined || String(raw).trim() === '') return 2;
  const n = Number(raw);
  // Mirrors percentFromEnv in config/affiliate.js: 0 is a legitimate value here and
  // must NOT be swallowed by a falsy check.
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 2;
})();

/**
 * Is the money-critical unique index actually built here?
 *
 * Matched on the KEY, not the name: ensureCriticalIndexes and mongoose's autoIndex
 * generate different names for the same key, so a name comparison would report a false
 * miss on a perfectly protected cluster — and this check refuses to run when it fails.
 */
export async function hasUniqueCouponUserIndex(db) {
  const existing = await db.collection('couponuserusages').indexes().catch(() => []);
  return existing.some((ix) => {
    const k = ix.key || {};
    const keys = Object.keys(k);
    return ix.unique === true
      && keys.length === 2
      && k.coupon === 1
      && k.user === 1;
  });
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) is not set');

  /*
    ⚠️ autoIndex: false is MANDATORY in any script that touches models. It defaults to
    true, so merely connecting would build every declared index against whatever cluster
    this points at — which in this repo is production, because the local .env points at
    prod Mongo.
  */
  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;

  const coupons = db.collection('coupons');
  const affiliates = db.collection('affiliates');
  const runs = db.collection('migration_runs');

  console.log(`\n${ROLLBACK ? 'ROLLBACK' : 'MIGRATE'} — affiliate discount rule + repeat rate`);
  console.log(`Mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log(`Cluster: ${mongoose.connection.host}/${mongoose.connection.name}\n`);

  /*
    ── PREFLIGHT ──────────────────────────────────────────────────────────────
    Checked on the forward run only: rollback RESTORES the second gate, so it is
    safe (and desirable) even on a cluster where the index is missing.
  */
  if (!ROLLBACK) {
    const ok = await hasUniqueCouponUserIndex(db);
    console.log(`0. Unique {coupon, user} index on couponuserusages: ${ok ? '✓ present' : '✗ MISSING'}`);
    if (!ok) {
      throw new Error(
        'REFUSING TO RUN: the unique {coupon, user} index is not present on this cluster.\n'
        + '   It is the ONLY thing that will enforce one-discount-per-person after this\n'
        + '   migration, and without it every affiliate code becomes an unlimited discount.\n'
        + '   Restart the backend (config/db.js ensureCriticalIndexes builds it), confirm\n'
        + '   with `npm run audit-index-drift`, then re-run this script.',
      );
    }
    console.log();
  }

  if (ROLLBACK) {
    const run = await runs.findOne({ script: SCRIPT }, { sort: { runAt: -1 } });
    if (!run) {
      throw new Error(
        'No run record found in `migration_runs` — there is nothing to roll back on this\n'
        + '   cluster. (If the forward run was made by an older version of this script that\n'
        + '   did not record one, roll back by hand: set firstOrderOnly=true and unset\n'
        + '   usageLimitPerUser on affiliate-owned coupons.)',
      );
    }

    console.log(`Rolling back the run of ${new Date(run.runAt).toISOString()}`);
    console.log(`   it set repeatCommissionPercent = ${run.repeatDefault}%\n`);

    const couponFilter = { _id: { $in: run.couponIds || [] } };
    const couponCount = await coupons.countDocuments(couponFilter);
    console.log(`1. Managed coupons to restore to firstOrderOnly: ${couponCount}`);

    /*
      Only where the value is STILL what we wrote. An admin who has since chosen a rate
      made a deliberate decision about money, and a rollback of OUR change must not
      quietly undo THEIRS.
    */
    const rateFilter = {
      _id: { $in: run.affiliateIds || [] },
      repeatCommissionPercent: run.repeatDefault,
    };
    const rateCount = await affiliates.countDocuments(rateFilter);
    const edited = (run.affiliateIds || []).length - rateCount;
    console.log(`2. Repeat rates to unset: ${rateCount}`);
    if (edited > 0) {
      console.log(`   (${edited} left alone — an admin has since edited them)`);
    }

    if (!APPLY) {
      console.log('\nDry run. Re-run with --apply --rollback to execute.\n');
      return;
    }

    const r1 = await coupons.updateMany(couponFilter, {
      $set: { firstOrderOnly: true },
      $unset: { usageLimitPerUser: '' },
    });
    const r2 = await affiliates.updateMany(rateFilter, {
      $unset: { repeatCommissionPercent: '' },
    });
    await runs.updateOne({ _id: run._id }, { $set: { rolledBackAt: new Date() } });

    console.log(`\n✓ Coupons restored:  ${r1.modifiedCount}`);
    console.log(`✓ Repeat rates unset: ${r2.modifiedCount}\n`);
    return;
  }

  // ── 1. The discount rule ──────────────────────────────────────────────────
  const couponFilter = {
    affiliate: { $exists: true, $ne: null },
    $or: [
      { firstOrderOnly: true },
      { usageLimitPerUser: { $ne: 1 } },
    ],
  };
  const couponCount = await coupons.countDocuments(couponFilter);
  const totalManaged = await coupons.countDocuments({ affiliate: { $exists: true, $ne: null } });
  console.log(`1. Affiliate-managed coupons:        ${totalManaged}`);
  console.log(`   needing the one-per-person rule:  ${couponCount}`);

  // ── 2. The repeat rate ────────────────────────────────────────────────────
  /*
    `$exists: false` and an explicit null both mean "never agreed". A rate of 0 is NOT
    swept up here: 0 is a deliberate "no commission on repeats" and overwriting it with
    the default would start paying commission nobody agreed to — the same trap the
    `== null` checks in affiliateService guard against.
  */
  const rateFilter = {
    status: { $in: ['active', 'suspended'] },
    $or: [
      { repeatCommissionPercent: { $exists: false } },
      { repeatCommissionPercent: null },
    ],
  };
  const rateCount = await affiliates.countDocuments(rateFilter);
  const totalAffiliates = await affiliates.countDocuments({ status: { $in: ['active', 'suspended'] } });
  console.log(`\n2. Active/suspended affiliates:      ${totalAffiliates}`);
  console.log(`   with no repeat rate agreed:       ${rateCount}`);
  console.log(`   will be set to:                   ${REPEAT_DEFAULT}%`);

  if (rateCount > 0) {
    const sample = await affiliates
      .find(rateFilter, { projection: { code: 1, name: 1, commissionPercent: 1 } })
      .limit(10).toArray();
    console.log('\n   Sample (full rate → repeat rate):');
    for (const a of sample) {
      console.log(`     ${String(a.code || '—').padEnd(14)} ${a.commissionPercent}% → ${REPEAT_DEFAULT}%   ${a.name || ''}`);
    }
    if (rateCount > sample.length) console.log(`     …and ${rateCount - sample.length} more`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply to execute.');
    console.log('Rollback: node scripts/migrate-affiliate-repeat-commission.js --apply --rollback\n');
    return;
  }

  /*
    Capture the exact ids BEFORE writing. After the update these documents no longer
    match their own filters, so the set is unrecoverable — and re-deriving it later by
    value is precisely the bug this replaces (it would sweep up rates an admin chose
    deliberately, and target the wrong rows entirely if the configured default moved).
  */
  const couponIds = (await coupons.find(couponFilter, { projection: { _id: 1 } }).toArray())
    .map((d) => d._id);
  const affiliateIds = (await affiliates.find(rateFilter, { projection: { _id: 1 } }).toArray())
    .map((d) => d._id);

  const r1 = await coupons.updateMany(couponFilter, {
    $set: { firstOrderOnly: false, usageLimitPerUser: 1 },
  });
  const r2 = await affiliates.updateMany(rateFilter, {
    $set: { repeatCommissionPercent: REPEAT_DEFAULT },
  });

  // Written AFTER the updates succeed: a record of work that did not happen would send
  // a later rollback at documents this script never touched.
  await runs.insertOne({
    script: SCRIPT,
    runAt: new Date(),
    repeatDefault: REPEAT_DEFAULT,
    couponIds,
    affiliateIds,
    couponsModified: r1.modifiedCount,
    affiliatesModified: r2.modifiedCount,
  });

  console.log(`\n✓ Coupons switched to one-per-person: ${r1.modifiedCount}`);
  console.log(`✓ Repeat rates set:                   ${r2.modifiedCount}`);
  console.log(`✓ Run recorded in migration_runs (${couponIds.length} + ${affiliateIds.length} ids)`);
  console.log('\nRollback: node scripts/migrate-affiliate-repeat-commission.js --apply --rollback\n');
}

/*
  Only run when invoked directly, never on import. The preflight below is money-critical
  — it is the one thing standing between this migration and handing out unlimited
  discounts — so it has to be reachable from a test without the module connecting to a
  cluster as a side effect of being imported.
*/
const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main()
    .catch((err) => {
      console.error('\n✗ FAILED:', err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
