/**
 * The migration's preflight — the guard that stands between this change and every
 * affiliate code becoming an unlimited discount.
 *
 * ── WHY THIS DESERVES ITS OWN SUITE ─────────────────────────────────────────────
 * Before the migration the discount had TWO independent gates: `firstOrderOnly`, which
 * counted the buyer's own orders, and the CouponUserUsage per-user counter. Afterwards
 * there is ONE. That counter only fails closed because a guarded upsert collides with
 * the unique {coupon, user} index and gets E11000 — without the index it silently
 * inserts a second counter document and the cap becomes unlimited, logging nothing.
 *
 * `autoIndex` is OFF in production, so that index exists only because config/db.js
 * builds it at boot. The migration therefore checks the LIVE cluster rather than
 * trusting that it happened, and this suite proves the check actually discriminates.
 */

import mongoose from 'mongoose';
import { hasUniqueCouponUserIndex } from '../scripts/migrate-affiliate-repeat-commission.js';

const COLL = 'couponuserusages';

const freshCollection = async () => {
  const db = mongoose.connection.db;
  await db.collection(COLL).drop().catch(() => {});   // may not exist yet
  await db.createCollection(COLL);
  return db;
};

describe('hasUniqueCouponUserIndex', () => {
  it('is FALSE on a collection with no such index', async () => {
    const db = await freshCollection();
    expect(await hasUniqueCouponUserIndex(db)).toBe(false);
  });

  it('is TRUE once the unique index exists', async () => {
    const db = await freshCollection();
    await db.collection(COLL).createIndex({ coupon: 1, user: 1 }, { unique: true });

    expect(await hasUniqueCouponUserIndex(db)).toBe(true);
  });

  /*
    ⚠️ A NON-UNIQUE index on the same keys is the dangerous near-miss: every query still
    goes fast, the collection looks correctly indexed to a casual glance, and the guarded
    upsert never collides — so the cap silently does nothing. It must NOT satisfy this.
  */
  it('is FALSE for a NON-unique index on the very same keys', async () => {
    const db = await freshCollection();
    await db.collection(COLL).createIndex({ coupon: 1, user: 1 });

    expect(await hasUniqueCouponUserIndex(db)).toBe(false);
  });

  it('is FALSE for a unique index on only ONE of the two keys', async () => {
    const db = await freshCollection();
    await db.collection(COLL).createIndex({ coupon: 1 }, { unique: true });

    expect(await hasUniqueCouponUserIndex(db)).toBe(false);
  });

  /*
    Matched on the KEY, not the name. ensureCriticalIndexes and mongoose's autoIndex
    generate different names for the same index, so a name comparison would report a
    false MISS on a perfectly protected production cluster — and this check refuses to
    run the migration when it fails, so a false miss blocks a correct deploy.
  */
  it('is TRUE regardless of what the index is NAMED', async () => {
    const db = await freshCollection();
    await db.collection(COLL).createIndex(
      { coupon: 1, user: 1 },
      { unique: true, name: 'some_hand_rolled_name' },
    );

    expect(await hasUniqueCouponUserIndex(db)).toBe(true);
  });

  it('is FALSE rather than throwing when the collection does not exist at all', async () => {
    const db = mongoose.connection.db;
    await db.collection(COLL).drop().catch(() => {});

    expect(await hasUniqueCouponUserIndex(db)).toBe(false);
  });
});
