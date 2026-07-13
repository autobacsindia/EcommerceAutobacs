/**
 * Backfill the top-level `User.phone` convenience field for accounts that have
 * none, using a phone the customer already gave us elsewhere.
 *
 * Background — `User.phone` is an optional contact field. It's set on guest/OTP
 * signup and (now) when an offline order is created for a NEW customer, but a
 * phone captured against an EXISTING account only ever landed on the Lead, the
 * Order's shipping address, or a saved Address — never on `User.phone`. Result:
 * a lead shows a number the user account can't be found by. This repairs the
 * existing rows; the ongoing drift is closed in orderController (offline path).
 *
 * Source of the phone, in priority order (first real number wins):
 *   1. one of the user's saved `addresses[].phone`  (they entered it themselves)
 *   2. the shipping phone on their most recent Order
 *   3. the linked Lead's phone (matched by linkedUser, else by email)
 *
 * "Real number" = passes normalizePhone (>= 7 digits). The RAW value is stored
 * (matching how phones are stored elsewhere); admin search normalizes at query
 * time, so separators/prefixes don't matter. Never overwrites an existing phone.
 *
 * Idempotent. Safe to re-run. Dry-run by default.
 *
 * Usage:
 *   node --import=dotenv/config scripts/backfill-user-phone.js            # dry run
 *   node --import=dotenv/config scripts/backfill-user-phone.js --apply    # apply
 *   railway run node --import=dotenv/config scripts/backfill-user-phone.js --apply
 *
 * Requires MONGODB_URI (or MONGO_URI) in the environment.
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Lead from '../models/Lead.js';
import { normalizePhone } from '../utils/identity.js';

const APPLY = process.argv.includes('--apply');

/** First raw phone in the list that normalizes to a real number, else null. */
const firstRealPhone = (...candidates) =>
  candidates.find((p) => normalizePhone(p)) || null;

async function resolvePhone(user) {
  // 1. Saved addresses (already on the user doc — no extra query).
  const addrPhone = firstRealPhone(...(user.addresses || []).map((a) => a?.phone));
  if (addrPhone) return { phone: addrPhone, source: 'address' };

  // 2. Most recent order's shipping phone.
  const order = await Order.findOne({ user: user._id }, { 'shippingAddress.phone': 1 })
    .sort({ createdAt: -1 })
    .lean();
  const orderPhone = firstRealPhone(order?.shippingAddress?.phone);
  if (orderPhone) return { phone: orderPhone, source: 'order' };

  // 3. Linked lead (by explicit link, else by email).
  const lead = await Lead.findOne(
    user.email
      ? { $or: [{ linkedUser: user._id }, { email: user.email.toLowerCase() }] }
      : { linkedUser: user._id },
    { phone: 1 },
  ).lean();
  const leadPhone = firstRealPhone(lead?.phone);
  if (leadPhone) return { phone: leadPhone, source: 'lead' };

  return null;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[backfill-user-phone] connected. mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  // Only users with no usable top-level phone are candidates.
  const cursor = User.find(
    { $or: [{ phone: { $exists: false } }, { phone: null }, { phone: '' }] },
    { email: 1, name: 1, phone: 1, addresses: 1 },
  ).cursor();

  const stats = { scanned: 0, updated: 0, notFound: 0, bySource: { address: 0, order: 0, lead: 0 } };

  for await (const user of cursor) {
    stats.scanned++;
    const found = await resolvePhone(user);
    if (!found) {
      stats.notFound++;
      continue;
    }

    if (APPLY) {
      await User.updateOne({ _id: user._id }, { $set: { phone: found.phone } });
    }
    stats.updated++;
    stats.bySource[found.source]++;
    console.log(`  ${APPLY ? 'set' : 'would set'} ${user.email || user._id} phone="${found.phone}" (from ${found.source})`);
  }

  console.log('\n── Summary ─────────────────────────────');
  console.log(`  scanned (no phone): ${stats.scanned}`);
  console.log(`  ${APPLY ? 'updated' : 'to update'}:          ${stats.updated}`);
  console.log(`     from address:    ${stats.bySource.address}`);
  console.log(`     from order:      ${stats.bySource.order}`);
  console.log(`     from lead:       ${stats.bySource.lead}`);
  console.log(`  no phone anywhere:  ${stats.notFound}`);

  await mongoose.disconnect();
  console.log(`\n[backfill-user-phone] done (${APPLY ? 'APPLIED' : 'DRY-RUN — no writes'}).`);
}

main().catch((err) => {
  console.error('[backfill-user-phone] failed:', err);
  process.exit(1);
});
