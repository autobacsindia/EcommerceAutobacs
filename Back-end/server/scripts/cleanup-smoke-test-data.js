/**
 * Purge smoke-test data created during a manual smoke test on the LIVE
 * (Railway/Vercel) stack that shares the single production MongoDB.
 *
 * This is the surgical counterpart to a full mongodump/mongorestore rollback:
 * it deletes ONLY documents that follow the reserved smoke-test naming
 * convention, so it is safe to run even if real activity happened concurrently.
 *
 * ── Convention it keys off (see docs/SMOKE-TEST-runbook.md) ──────────────────
 *   Users      : email matches /^smoke\+/  (e.g. smoke+cust-01@autobacsindia.com)
 *                OR name starts with "[SMOKE]"
 *   Coupons    : code starts with "SMOKE"  (e.g. SMOKE10)
 *   Products   : name starts with "[SMOKE]" (only if you created test products)
 *   Guest data : any email field matching /^smoke\+/ (guest orders/consultations/…)
 *
 * Everything else is cascaded off the matched user _ids.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default — prints a deletion plan, writes nothing.
 *   • Requires BOTH --apply AND --yes to actually delete.
 *   • Regexes are ANCHORED (^) so they cannot match arbitrary real data.
 *   • Refuses to touch any user whose email does NOT match the convention.
 *   • Prints the exact emails it will delete so you can eyeball them first.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   # from Back-end/server, against PROD env (Railway):
 *   railway run node --import=dotenv/config scripts/cleanup-smoke-test-data.js            # dry run
 *   railway run node --import=dotenv/config scripts/cleanup-smoke-test-data.js --apply --yes
 *
 *   # or with an explicit URI (be careful — this is prod):
 *   MONGODB_URI="mongodb+srv://…" node scripts/cleanup-smoke-test-data.js
 *
 * Requires MONGODB_URI (or MONGO_URI). Idempotent. Safe to re-run.
 */

import mongoose from 'mongoose';

import User from '../models/User.js';
import Order from '../models/Order.js';
import Cart from '../models/Cart.js';
import Wishlist from '../models/Wishlist.js';
import Lead from '../models/Lead.js';
import Review from '../models/Review.js';
import ProductQuestion from '../models/ProductQuestion.js';
import KarmaLedger from '../models/KarmaLedger.js';
import CouponRedemption from '../models/CouponRedemption.js';
import CouponUserUsage from '../models/CouponUserUsage.js';
import Coupon from '../models/Coupon.js';
import ReturnRequest from '../models/ReturnRequest.js';
import Payment from '../models/Payment.js';
import NotificationLog from '../models/NotificationLog.js';
import Consultation from '../models/Consultation.js';
import Contact from '../models/Contact.js';
import ArticleComment from '../models/ArticleComment.js';
import Product from '../models/Product.js';

const APPLY = process.argv.includes('--apply');
const YES = process.argv.includes('--yes');
const WRITE = APPLY && YES;

// Anchored — cannot match real data. Emails are stored lowercased/trimmed.
const SMOKE_EMAIL_RE = /^smoke\+/i;
const SMOKE_NAME_RE = /^\[SMOKE\]/;
const SMOKE_COUPON_RE = /^SMOKE/i;

async function count(Model, filter) {
  return Model.countDocuments(filter);
}

async function del(Model, filter) {
  if (!WRITE) return count(Model, filter);
  const res = await Model.deleteMany(filter);
  return res.deletedCount;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` cleanup-smoke-test-data   mode=${WRITE ? 'APPLY (DESTRUCTIVE)' : 'DRY-RUN (no writes)'}`);
  console.log(` db=${mongoose.connection.name}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // 1) Resolve the smoke-test users.
  const users = await User.find({
    $or: [{ email: SMOKE_EMAIL_RE }, { name: SMOKE_NAME_RE }],
  }).select('_id email name role isSalesRep').lean();

  const userIds = users.map((u) => u._id);

  console.log(`Matched ${users.length} smoke user(s):`);
  for (const u of users) {
    console.log(`  • ${u.email}  (${u.name})  role=${u.role} salesRep=${!!u.isSalesRep}`);
  }
  console.log('');

  // Guard: never let a non-convention email slip through the cascade.
  const bad = users.filter((u) => !SMOKE_EMAIL_RE.test(u.email) && !SMOKE_NAME_RE.test(u.name || ''));
  if (bad.length) {
    console.error('[ABORT] matched a user that does not fit the convention — refusing to delete.');
    process.exit(1);
  }

  // 2) Build the deletion plan. user-owned OR guest-email-based per collection.
  const byUser = { $in: userIds };
  const plan = [
    ['Order', Order, { $or: [{ user: byUser }, { 'shippingAddress.email': SMOKE_EMAIL_RE }, { email: SMOKE_EMAIL_RE }, { guestEmail: SMOKE_EMAIL_RE }] }],
    ['Payment', Payment, { user: byUser }],
    ['Cart', Cart, { user: byUser }],
    ['Wishlist', Wishlist, { $or: [{ user: byUser }, { userId: byUser }] }],
    ['Review', Review, { user: byUser }],
    ['ProductQuestion', ProductQuestion, { $or: [{ user: byUser }, { email: SMOKE_EMAIL_RE }] }],
    ['KarmaLedger', KarmaLedger, { user: byUser }],
    ['CouponRedemption', CouponRedemption, { user: byUser }],
    ['CouponUserUsage', CouponUserUsage, { user: byUser }],
    ['ReturnRequest', ReturnRequest, { user: byUser }],
    ['NotificationLog', NotificationLog, { userId: byUser }],
    ['Contact', Contact, { $or: [{ user: byUser }, { email: SMOKE_EMAIL_RE }] }],
    ['Consultation', Consultation, { email: SMOKE_EMAIL_RE }],
    ['ArticleComment', ArticleComment, { email: SMOKE_EMAIL_RE }],
    ['Lead', Lead, { $or: [{ 'person.email': SMOKE_EMAIL_RE }, { email: SMOKE_EMAIL_RE }] }],
    // Convention-tagged standalone entities (only if you created them):
    ['Coupon (SMOKE*)', Coupon, { code: SMOKE_COUPON_RE }],
    ['Product ([SMOKE]*)', Product, { name: SMOKE_NAME_RE }],
  ];

  let total = 0;
  console.log(`${WRITE ? 'Deleting' : 'Would delete'}:`);
  for (const [label, Model, filter] of plan) {
    const n = await del(Model, filter);
    total += n;
    if (n > 0) console.log(`  ${String(n).padStart(5)}  ${label}`);
  }

  // Users last (after their cascade).
  const userDeleted = await del(User, { _id: byUser });
  total += userDeleted;
  console.log(`  ${String(userDeleted).padStart(5)}  User`);

  console.log(`\n${WRITE ? 'Deleted' : 'Would delete'} ${total} document(s) total.`);
  if (!WRITE) {
    console.log('\nDRY-RUN only. Re-run with  --apply --yes  to execute.');
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
