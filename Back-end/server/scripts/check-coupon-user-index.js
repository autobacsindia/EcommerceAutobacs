/**
 * Verify the CouponUserUsage {coupon,user} unique index — the sole enforcement point
 * for a coupon's per-user usage limit. Reports whether it exists and whether any
 * duplicate counter docs are already present (which would both prove the limit has
 * been bypassed and block the index build until deduped).
 *
 * Read-only. Run against any environment:
 *   MONGODB_URI='<uri>' node --import=dotenv/config scripts/check-coupon-user-index.js
 */
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Set MONGODB_URI (or MONGO_URI).');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
console.log(`Connected to db: ${db.databaseName}\n`);

const coll = db.collection('couponuserusages');

const indexes = await coll.indexes();
const unique = indexes.find(
  (i) => i.unique && i.key && i.key.coupon === 1 && i.key.user === 1
);

console.log('Indexes on couponuserusages:');
for (const i of indexes) {
  console.log(`  ${i.name}  key=${JSON.stringify(i.key)}  unique=${!!i.unique}`);
}

// Duplicates mean the guarded upsert already inserted extra counter docs, i.e. the
// per-user cap has been bypassed for these pairs.
const dupes = await coll
  .aggregate([
    { $group: { _id: { coupon: '$coupon', user: '$user' }, n: { $sum: 1 }, counts: { $push: '$count' } } },
    { $match: { n: { $gt: 1 } } }
  ])
  .toArray();

console.log('');
if (unique) {
  console.log('PASS: unique {coupon,user} index present — per-user limit is enforced.');
} else {
  console.log('FAIL: unique {coupon,user} index MISSING — per-user coupon limit is NOT enforced.');
}

if (dupes.length) {
  console.log(`\nFAIL: ${dupes.length} duplicate {coupon,user} pair(s) found. The cap was already bypassed.`);
  console.log('These must be deduped (keep the max count) before the unique index can build:');
  for (const d of dupes) console.log(`  coupon=${d._id.coupon} user=${d._id.user} docs=${d.n} counts=${JSON.stringify(d.counts)}`);
} else {
  console.log('No duplicate {coupon,user} counter docs.');
}

await mongoose.disconnect();
process.exit(unique && !dupes.length ? 0 : 1);
