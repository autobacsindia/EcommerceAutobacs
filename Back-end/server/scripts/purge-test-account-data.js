/**
 * Purge the data trail of TEST accounts from PRODUCTION, and roll back every
 * denormalised counter those documents contributed to.
 *
 * Written for the case where real transactions were placed on live prod using
 * internal addresses (info@ / devops@autobacsindia.com) purely to exercise the
 * checkout, and that noise now pollutes orders, revenue, the CRM pipeline and
 * product ratings.
 *
 * ── What "analytics" means here ──────────────────────────────────────────────
 * There is no analytics *table* in this stack — the numbers the admin dashboard
 * and the storefront show are DENORMALISED COUNTERS living on other documents.
 * Deleting the orders alone would leave every one of them permanently inflated.
 * So after the cascade this script RECOMPUTES (never blind-zeroes) :
 *
 *   User.paidOrderCount / totalSpentPaise / hasPurchased / firstPurchaseAt /
 *        lastOrderAt        ← re-derived from the user's SURVIVING paid orders
 *                             (same net-revenue rule as reconcile-user-ltv.js)
 *   User.karmaPoints        ← re-summed from the surviving KarmaLedger rows
 *   User.wallet.balance     ← re-summed after dropping txns that pointed at
 *                             deleted orders / returns
 *   User.claimedOrders[]    ← $pull of deleted order ids
 *   Coupon.usedCount        ← decremented by the redemptions actually removed
 *                             (floored at 0 — never goes negative)
 *   Product.averageRating /
 *           totalReviews    ← recomputed from the SURVIVING approved reviews
 *
 * Recompute-don't-zero matters: if one of these mailboxes ever placed a genuine
 * order that you keep, or a coupon was also used by a real customer, zeroing
 * would corrupt real data. Recomputing is correct in both cases and is idempotent.
 *
 * ── What it deliberately does NOT touch ──────────────────────────────────────
 *   • The User documents themselves (default). These are company mailboxes and
 *     devops@ may be an admin login — deleting it can lock you out and orphan
 *     AuditLog.adminId / PageSeo.updatedBy / SalesRep.createdBy / ImportJob.
 *     Opt in with --purge-users once you have confirmed neither is an admin.
 *   • AuditLog / RateLimitEvent / AdaptiveThrottlingProfile — security & audit
 *     trail. Destroying audit records to tidy up metrics is the wrong trade.
 *   • WebhookEvent — 24h TTL, and it is the Razorpay replay-idempotency guard.
 *     Deleting a row lets an old webhook re-process. It expires on its own.
 *   • Counter (order-number sequence) — gaps are harmless; REUSING a number is
 *     not (it would collide with the invoice already emailed).
 *
 * ── Money warning ────────────────────────────────────────────────────────────
 * These were real captures on live Razorpay. This script only touches MongoDB —
 * it cannot and does not refund anything. If a matched order is still `paid` and
 * not refunded, the script REFUSES to run: refund it in the Razorpay dashboard
 * first, let the refund webhook land, then re-run. Override with --force-paid
 * only if you have reconciled those payments by hand, and understand that you
 * are deleting your local record of a real settlement.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *   • DRY-RUN by default. Needs BOTH --apply AND --yes to write.
 *   • Emails are matched EXACTLY (lowercased), never by regex/prefix.
 *   • Writes a full JSON backup of every document *before* the first delete.
 *     If the backup cannot be written, nothing is deleted.
 *   • --max-orders tripwire (default 100) aborts on a fat-fingered address that
 *     resolves to a high-volume real customer.
 *   • Idempotent — safe to re-run; a second pass finds nothing and recomputes
 *     to the same values.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   cd Back-end/server
 *
 *   # 1. dry run against prod (prints the plan, writes nothing)
 *   railway run node --import=dotenv/config scripts/purge-test-account-data.js
 *
 *   # 2. inspect the plan, refund any still-paid orders in Razorpay, then:
 *   railway run node --import=dotenv/config scripts/purge-test-account-data.js --apply --yes
 *
 *   # options
 *   --emails=a@x.com,b@x.com   override the target list (default: info@, devops@)
 *   --since=YYYY-MM-DD         only purge order-linked data created on/after this
 *                              date. STRONGLY recommended: these are long-lived
 *                              company mailboxes, so their history can contain
 *                              genuine pre-cutover / migrated WooCommerce orders
 *                              that must NOT be deleted. Scope to your test window.
 *   --until=YYYY-MM-DD         upper bound (exclusive), same purpose
 *   --include-forms            also delete Contact / Consultation / ArticleComment
 *                              / JobApplication rows from these addresses
 *   --purge-users              also delete the User documents themselves
 *   --force-paid               proceed even with unrefunded paid orders
 *   --max-orders=N             tripwire ceiling (default 100)
 *   --backup-dir=PATH          default ./purge-backups
 *   --flush-cache              flush the Redis response caches afterwards (needs REDIS_URL)
 *
 * Requires MONGODB_URI (or MONGO_URI).
 */

import fs from 'node:fs';
import path from 'node:path';

import mongoose from 'mongoose';

import User from '../models/User.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import ReturnRequest from '../models/ReturnRequest.js';
import Cart from '../models/Cart.js';
import Wishlist from '../models/Wishlist.js';
import Review from '../models/Review.js';
import ProductQuestion from '../models/ProductQuestion.js';
import KarmaLedger from '../models/KarmaLedger.js';
import CouponRedemption from '../models/CouponRedemption.js';
import CouponUserUsage from '../models/CouponUserUsage.js';
import Coupon from '../models/Coupon.js';
import NotificationLog from '../models/NotificationLog.js';
import StockNotificationRequest from '../models/StockNotificationRequest.js';
import UserLocation from '../models/UserLocation.js';
import Lead from '../models/Lead.js';
import Contact from '../models/Contact.js';
import Consultation from '../models/Consultation.js';
import ArticleComment from '../models/ArticleComment.js';
import JobApplication from '../models/JobApplication.js';
import Product from '../models/Product.js';

// ── CLI ───────────────────────────────────────────────────────────────────────

const ARGV = process.argv.slice(2);
const has = (flag) => ARGV.includes(flag);
const val = (name, fallback) => {
  const hit = ARGV.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const APPLY = has('--apply');
const YES = has('--yes');
const WRITE = APPLY && YES;

const DEFAULT_EMAILS = ['info@autobacsindia.com', 'devops@autobacsindia.com'];
const EMAILS = val('--emails', DEFAULT_EMAILS.join(','))
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Optional date window. Applied to every order-derived collection so a long-lived
// mailbox keeps its genuine (e.g. migrated WooCommerce) history.
function parseDate(raw, label) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) die(`${label} is not a valid date: "${raw}" (use YYYY-MM-DD)`);
  return d;
}
const SINCE = parseDate(val('--since', null), '--since');
const UNTIL = parseDate(val('--until', null), '--until');

// Dry-run lists every matched document so the plan can be eyeballed before applying.
// Suppress with --no-detail; force it on during --apply with --detail.
const DETAIL = has('--detail') || (!has('--no-detail') && !(has('--apply') && has('--yes')));

const INCLUDE_FORMS = has('--include-forms');
const PURGE_USERS = has('--purge-users');
const FORCE_PAID = has('--force-paid');
const MAX_ORDERS = Number(val('--max-orders', '100'));
const BACKUP_DIR = val('--backup-dir', path.resolve(process.cwd(), 'purge-backups'));
const FLUSH_CACHE = has('--flush-cache');

// Money-returned states — an order in one of these no longer counts toward LTV.
const REFUNDED_STATES = ['cancelled', 'returned'];

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const pad = (n) => String(n).padStart(6);

function die(msg) {
  console.error(`\n[ABORT] ${msg}\n`);
  process.exit(1);
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const short = (id) => String(id).slice(-8);
const trim = (s, n = 48) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * One human-readable line per document, so the dry-run plan can be audited by
 * eye rather than trusted. Falls back to the raw _id for anything unmapped.
 */
function describe(label, d) {
  switch (label) {
    case 'Order':
      return `${d.orderNumber || short(d._id)}  ${String(d.status).padEnd(16)} pay=${String(d.paymentStatus).padEnd(9)} ₹${d.totalAmount}  ${day(d.createdAt)}  items=${d.items?.length ?? 0}${d.guestEmail ? `  guest:${d.guestEmail}` : ''}`;
    case 'Payment':
      return `${short(d._id)}  order=${short(d.order)}  ${String(d.status || '—').padEnd(10)} ₹${d.amount ?? '—'}  ${d.gatewayOrderId || d.gatewayPaymentId || '—'}  ${day(d.createdAt)}`;
    case 'ReturnRequest':
      return `${short(d._id)}  order=${short(d.order)}  ${String(d.status).padEnd(14)} refund=${d.refund?.status || '—'} ₹${d.refund?.amount ?? '—'}  ${day(d.createdAt)}`;
    case 'CouponRedemption':
      return `${short(d._id)}  code=${d.code}  order=${short(d.order)}  −₹${d.discountAmount}  ${day(d.createdAt)}`;
    case 'CouponUserUsage':
      return `${short(d._id)}  coupon=${short(d.coupon)}  used=${d.usedCount ?? d.count ?? '—'}  ${day(d.createdAt)}`;
    case 'KarmaLedger':
      return `${short(d._id)}  ${String(d.type).padEnd(8)} ${d.points > 0 ? '+' : ''}${d.points}pts  balAfter=${d.balanceAfter}  order=${d.order ? short(d.order) : '—'}  ${day(d.createdAt)}`;
    case 'NotificationLog':
      return `${short(d._id)}  ${String(d.type || '').padEnd(6)} ${String(d.event || d.template || '').padEnd(24)} order=${d.orderId ? short(d.orderId) : '—'}  ${day(d.createdAt)}`;
    case 'Cart':
      return `${short(d._id)}  items=${d.items?.length ?? 0}  coupon=${d.couponCode || '—'}  updated=${day(d.updatedAt)}`;
    case 'Wishlist':
      return `${short(d._id)}  "${trim(d.name, 24)}"  items=${d.items?.length ?? 0}  ${day(d.createdAt)}`;
    case 'Review':
      return `${short(d._id)}  product=${short(d.product)}  ${d.rating}★  approved=${!!d.isApproved}  "${trim(d.comment, 40)}"  ${day(d.createdAt)}`;
    case 'ProductQuestion':
      return `${short(d._id)}  product=${short(d.product)}  "${trim(d.question, 44)}"  ${day(d.createdAt)}`;
    case 'StockNotificationRequest':
      return `${short(d._id)}  ${String(d.kind).padEnd(9)} product=${short(d.product)}  ${String(d.status).padEnd(9)} ${d.email}  ${day(d.createdAt)}`;
    case 'UserLocation':
      return `${short(d._id)}  ${trim(d.city || d.pincode || d.address, 30)}  active=${!!d.isActive}  ${day(d.createdAt)}`;
    case 'Lead':
      return `${short(d._id)}  ${String(d.identityKey).padEnd(34)} ${String(d.status).padEnd(10)} score=${String(d.leadScore ?? 0).padStart(3)} src=${d.primarySource || '—'}  purchased=${!!d.hasPurchased}  converted=${d.convertedOrder ? short(d.convertedOrder) : '—'}  activities=${d.activities?.length ?? 0}  ${day(d.createdAt)}`;
    case 'Contact':
      return `${short(d._id)}  ${d.email}  "${trim(d.subject || d.message, 40)}"  ${day(d.createdAt)}`;
    case 'Consultation':
      return `${short(d._id)}  ${d.email}  ${trim(d.name, 20)}  ${day(d.createdAt)}`;
    case 'ArticleComment':
      return `${short(d._id)}  ${d.email}  "${trim(d.content || d.comment, 40)}"  ${day(d.createdAt)}`;
    case 'JobApplication':
      return `${short(d._id)}  ${d.email}  ${trim(d.name, 20)}  ${day(d.createdAt)}`;
    case 'User':
      return `${short(d._id)}  ${d.email}  role=${d.role}`;
    default:
      return short(d._id);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) die('MONGODB_URI (or MONGO_URI) not set in environment.');
  if (!EMAILS.length) die('No target emails resolved.');
  if (!Number.isFinite(MAX_ORDERS) || MAX_ORDERS <= 0) die('--max-orders must be a positive number.');
  if (EMAILS.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
    die(`--emails contains a malformed address: ${EMAILS.join(', ')}`);
  }

  await mongoose.connect(uri);

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(` purge-test-account-data    mode=${WRITE ? 'APPLY (DESTRUCTIVE)' : 'DRY-RUN (no writes)'}`);
  console.log(` db=${mongoose.connection.name}   host=${mongoose.connection.host}`);
  console.log(` targets: ${EMAILS.join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── 1. Resolve the accounts ────────────────────────────────────────────────
  const users = await User.find({ email: { $in: EMAILS } })
    .select('_id email name role isSalesRep isGuest karmaPoints wallet paidOrderCount totalSpentPaise claimedOrders')
    .lean();

  const userIds = users.map((u) => u._id);

  console.log(`Accounts matched: ${users.length}`);
  for (const u of users) {
    console.log(
      `  • ${u.email}  name="${u.name || ''}"  role=${u.role}` +
        `  salesRep=${!!u.isSalesRep}  karma=${u.karmaPoints || 0}` +
        `  LTV=${rupees(u.totalSpentPaise || 0)} over ${u.paidOrderCount || 0} order(s)`
    );
  }
  const missing = EMAILS.filter((e) => !users.some((u) => u.email === e));
  if (missing.length) console.log(`  (no account for: ${missing.join(', ')} — guest data still purged by email)`);
  console.log('');

  // Belt-and-braces: the cascade keys off userIds, so make sure nothing but the
  // requested addresses ever got in.
  const stray = users.filter((u) => !EMAILS.includes(u.email));
  if (stray.length) die(`resolved a user outside the target list: ${stray.map((u) => u.email).join(', ')}`);

  const admins = users.filter((u) => u.role === 'admin');
  if (admins.length && PURGE_USERS) {
    die(
      `--purge-users would delete ADMIN account(s): ${admins.map((u) => u.email).join(', ')}. ` +
        'Deleting an admin can lock you out of /admin and orphans AuditLog/PageSeo/SalesRep authorship. ' +
        'Drop --purge-users (the data still gets purged; only the login survives).'
    );
  }
  if (admins.length) {
    console.log(`NOTE: ${admins.map((u) => u.email).join(', ')} ${admins.length > 1 ? 'are' : 'is'} an ADMIN account — kept (data purged, login preserved).\n`);
  }

  // ── 2. Resolve the order set (authenticated + guest checkout) ──────────────
  // Narrows every filter to the test window when --since/--until are given, so a
  // mailbox that also carries genuine (or migrated WooCommerce) history keeps it.
  const windowClause = {};
  if (SINCE) windowClause.$gte = SINCE;
  if (UNTIL) windowClause.$lt = UNTIL;
  const HAS_WINDOW = Object.keys(windowClause).length > 0;
  const withWindow = (filter) => (HAS_WINDOW ? { $and: [filter, { createdAt: windowClause }] } : filter);

  if (HAS_WINDOW) {
    console.log(
      `Window: createdAt ${SINCE ? `>= ${SINCE.toISOString()}` : '(open)'} ` +
        `${UNTIL ? `< ${UNTIL.toISOString()}` : '(open)'} — anything older/newer is left alone.\n`
    );
  } else {
    console.log('Window: NONE — the entire history of these addresses is in scope. Consider --since=YYYY-MM-DD.\n');
  }

  const orderFilterRaw = {
    $or: [
      ...(userIds.length ? [{ user: { $in: userIds } }] : []),
      { guestEmail: { $in: EMAILS } },
    ],
  };
  const orderFilter = withWindow(orderFilterRaw);
  const orders = await Order.find(orderFilter)
    .select('_id orderNumber user guestEmail status paymentStatus totalAmount createdAt refundDetails')
    .lean();
  const orderIds = orders.map((o) => o._id);

  console.log(`Orders matched: ${orders.length}`);
  for (const o of orders) {
    console.log(
      `  • ${o.orderNumber || o._id}  ${String(o.status).padEnd(16)} pay=${String(o.paymentStatus).padEnd(9)}` +
        ` ₹${o.totalAmount}  ${new Date(o.createdAt).toISOString().slice(0, 10)}` +
        `${o.guestEmail ? `  guest:${o.guestEmail}` : ''}`
    );
  }
  console.log('');

  // ── 3. Tripwires ───────────────────────────────────────────────────────────
  if (orders.length > MAX_ORDERS) {
    die(
      `matched ${orders.length} orders, over the --max-orders=${MAX_ORDERS} ceiling. ` +
        'That usually means an address resolved to a real customer. Verify, then raise the ceiling deliberately.'
    );
  }

  // Real money still sitting with the gateway.
  const unrefundedPaid = orders.filter(
    (o) => o.paymentStatus === 'paid' && !REFUNDED_STATES.includes(o.status)
  );
  if (unrefundedPaid.length) {
    console.log('⚠️  UNREFUNDED PAID ORDERS — real money was captured on live Razorpay:');
    for (const o of unrefundedPaid) console.log(`      ${o.orderNumber || o._id}  ₹${o.totalAmount}`);
    console.log(
      '\n    Refund these in the Razorpay dashboard FIRST and let the refund webhook land.\n' +
        '    Deleting the order now destroys your only local record of a real settlement,\n' +
        '    and a late refund.processed webhook will arrive with nothing to attach to.\n'
    );
    if (!FORCE_PAID) {
      if (WRITE) {
        die('refusing to delete unrefunded paid orders. Refund them, or pass --force-paid if already reconciled by hand.');
      }
      // In dry-run keep going so the operator still sees the full plan; the
      // block only bites on --apply.
      console.log('    (dry-run — continuing so you can see the rest of the plan; --apply would stop here.)\n');
    } else {
      console.log('    --force-paid given — proceeding anyway.\n');
    }
  }

  // ── 4. Deletion plan ───────────────────────────────────────────────────────
  const byUser = { $in: userIds };
  const byOrder = { $in: orderIds };
  const byEmail = { $in: EMAILS };
  const anyUser = userIds.length > 0;
  const anyOrder = orderIds.length > 0;

  /** @type {[string, import('mongoose').Model<any>, object][]} */
  const plan = [
    ['Order', Order, orderFilterRaw],
    ['Payment', Payment, { $or: [...(anyOrder ? [{ order: byOrder }] : []), ...(anyUser ? [{ user: byUser }] : [])] }],
    ['ReturnRequest', ReturnRequest, { $or: [...(anyOrder ? [{ order: byOrder }] : []), ...(anyUser ? [{ user: byUser }] : [])] }],
    ['CouponRedemption', CouponRedemption, { $or: [...(anyOrder ? [{ order: byOrder }] : []), ...(anyUser ? [{ user: byUser }] : [])] }],
    ['CouponUserUsage', CouponUserUsage, anyUser ? { user: byUser } : null],
    ['KarmaLedger', KarmaLedger, { $or: [...(anyUser ? [{ user: byUser }] : []), ...(anyOrder ? [{ order: byOrder }] : [])] }],
    ['NotificationLog', NotificationLog, { $or: [...(anyUser ? [{ userId: byUser }] : []), ...(anyOrder ? [{ orderId: byOrder }] : [])] }],
    ['Cart', Cart, anyUser ? { user: byUser } : null],
    ['Wishlist', Wishlist, anyUser ? { $or: [{ user: byUser }, { userId: byUser }] } : null],
    ['Review', Review, anyUser ? { user: byUser } : null],
    ['ProductQuestion', ProductQuestion, { $or: [...(anyUser ? [{ user: byUser }] : []), { email: byEmail }] }],
    ['StockNotificationRequest', StockNotificationRequest, { $or: [...(anyUser ? [{ user: byUser }] : []), { email: byEmail }] }],
    ['UserLocation', UserLocation, anyUser ? { user: byUser } : null],
    // CRM: person-centric, so one doc per address; also catch leads stitched to
    // the account or converted off one of these orders.
    ['Lead', Lead, { $or: [{ email: byEmail }, ...(anyUser ? [{ linkedUser: byUser }] : []), ...(anyOrder ? [{ convertedOrder: byOrder }] : [])] }],
  ];

  if (INCLUDE_FORMS) {
    plan.push(
      ['Contact', Contact, { $or: [...(anyUser ? [{ user: byUser }] : []), { email: byEmail }] }],
      ['Consultation', Consultation, { email: byEmail }],
      ['ArticleComment', ArticleComment, { email: byEmail }],
      ['JobApplication', JobApplication, { email: byEmail }]
    );
  }

  // Drop impossible filters (no users AND no orders ⇒ empty $or, which matches nothing
  // but is also invalid in Mongo), then scope what survives to the date window.
  const activePlan = plan
    .filter(([, , f]) => f && (!f.$or || f.$or.length > 0))
    .map(([label, Model, f]) => [label, Model, withWindow(f)]);

  // ── 5. Snapshot everything, then report ────────────────────────────────────
  const snapshot = {};
  let totalDocs = 0;
  for (const [label, Model, filter] of activePlan) {
    const docs = await Model.find(filter).lean();
    snapshot[label] = docs;
    totalDocs += docs.length;
  }
  if (PURGE_USERS && anyUser) {
    snapshot.User = users;
    totalDocs += users.length;
  }

  if (DETAIL) {
    console.log('───────────────────────────────────────────────────────────────────');
    console.log(`DOCUMENTS TARGETED  (${WRITE ? 'about to be deleted' : 'would be deleted'})`);
    console.log('───────────────────────────────────────────────────────────────────');
    for (const [label] of activePlan) {
      const docs = snapshot[label] || [];
      if (!docs.length) continue;
      console.log(`\n▸ ${label}  (${docs.length})`);
      for (const d of docs) console.log(`    ${describe(label, d)}`);
    }
    if (snapshot.User?.length) {
      console.log(`\n▸ User  (${snapshot.User.length})  ← --purge-users`);
      for (const d of snapshot.User) console.log(`    ${describe('User', d)}`);
    }
    const empty = activePlan.filter(([l]) => !(snapshot[l] || []).length).map(([l]) => l);
    if (empty.length) console.log(`\n▸ nothing matched in: ${empty.join(', ')}`);
    console.log('');
  }

  console.log(`${WRITE ? 'Deleting' : 'Would delete'}:`);
  for (const [label] of activePlan) {
    console.log(`  ${pad((snapshot[label] || []).length)}  ${label}`);
  }
  if (snapshot.User?.length) console.log(`  ${pad(snapshot.User.length)}  User  ← --purge-users`);
  console.log(`  ${'─'.repeat(6)}`);
  console.log(`  ${pad(totalDocs)}  total\n`);

  if (!INCLUDE_FORMS) {
    // Show what --include-forms would add, so the choice is informed rather than silent.
    const formCounts = await Promise.all([
      Contact.countDocuments(withWindow({ $or: [...(anyUser ? [{ user: byUser }] : []), { email: byEmail }] })),
      Consultation.countDocuments(withWindow({ email: byEmail })),
      ArticleComment.countDocuments(withWindow({ email: byEmail })),
      JobApplication.countDocuments(withWindow({ email: byEmail })),
    ]);
    const formTotal = formCounts.reduce((a, b) => a + b, 0);
    if (formTotal > 0) {
      console.log(
        `Not included (pass --include-forms to also delete): ` +
          `Contact=${formCounts[0]} Consultation=${formCounts[1]} ArticleComment=${formCounts[2]} JobApplication=${formCounts[3]}\n`
      );
    }
  }

  // Rollback inputs, computed from the snapshot BEFORE anything is deleted.
  const redemptionsByCoupon = new Map();
  for (const r of snapshot.CouponRedemption || []) {
    const key = String(r.coupon);
    redemptionsByCoupon.set(key, (redemptionsByCoupon.get(key) || 0) + 1);
  }
  const reviewProductIds = [...new Set((snapshot.Review || []).map((r) => String(r.product)))];
  const deletedRefIds = new Set([
    ...orderIds.map(String),
    ...(snapshot.ReturnRequest || []).map((r) => String(r._id)),
  ]);

  // ── 5b. Project every counter's post-purge value ───────────────────────────
  // Computed BEFORE the delete, by excluding the doomed _ids from each aggregate.
  // The same projections are what --apply writes, so this dry-run report is not an
  // estimate — it is literally the values that will be persisted.
  const deletedReviewIds = (snapshot.Review || []).map((r) => r._id);
  const deletedKarmaIds = (snapshot.KarmaLedger || []).map((k) => k._id);

  const couponProjections = [];
  for (const [couponId, n] of redemptionsByCoupon) {
    const c = await Coupon.findById(couponId).select('code usedCount usageLimit').lean();
    couponProjections.push({
      couponId,
      code: c?.code || String(couponId),
      released: n,
      before: c?.usedCount ?? 0,
      after: Math.max(0, (c?.usedCount || 0) - n),
      usageLimit: c?.usageLimit ?? null,
    });
  }

  const productProjections = [];
  for (const pid of reviewProductIds) {
    const p = await Product.findById(pid).select('name averageRating totalReviews').lean();
    const [agg] = await Review.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(pid), _id: { $nin: deletedReviewIds }, isApproved: true } },
      { $group: { _id: null, avg: { $avg: '$rating' }, total: { $sum: 1 } } },
    ]);
    productProjections.push({
      productId: pid,
      name: p?.name || String(pid),
      ratingBefore: p?.averageRating ?? 0,
      ratingAfter: agg?.avg ? parseFloat(agg.avg.toFixed(1)) : 0,
      reviewsBefore: p?.totalReviews ?? 0,
      reviewsAfter: agg?.total || 0,
    });
  }

  const userProjections = [];
  if (!PURGE_USERS) {
    for (const u of users) {
      // Net LTV: paid, not currently money-returned — same rule as reconcile-user-ltv.js.
      const [rev] = await Order.aggregate([
        {
          $match: {
            user: u._id,
            _id: { $nin: orderIds },
            purchaseCounted: true,
            status: { $nin: REFUNDED_STATES },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            paise: { $sum: { $round: [{ $multiply: ['$totalAmount', 100] }, 0] } },
            first: { $min: '$createdAt' },
            last: { $max: '$createdAt' },
          },
        },
      ]);
      const [karma] = await KarmaLedger.aggregate([
        { $match: { user: u._id, _id: { $nin: deletedKarmaIds } } },
        { $group: { _id: null, points: { $sum: '$points' } } },
      ]);

      const beforeTxns = u.wallet?.transactions || [];
      const txns = beforeTxns.filter((t) => !t.referenceId || !deletedRefIds.has(String(t.referenceId)));
      const balance = Math.max(
        0,
        txns.reduce((sum, t) => sum + (t.type === 'credit' ? t.amount : -t.amount), 0)
      );
      const claimedDropped = (u.claimedOrders || []).filter((id) => deletedRefIds.has(String(id))).length;

      userProjections.push({
        _id: u._id,
        email: u.email,
        paidOrderCount: rev?.count || 0,
        totalSpentPaise: Math.max(0, rev?.paise || 0),
        hasPurchased: (rev?.count || 0) > 0,
        firstPurchaseAt: rev?.first || null,
        lastOrderAt: rev?.last || null,
        karmaPoints: Math.max(0, karma?.points || 0),
        txns,
        balance,
        droppedTxns: beforeTxns.length - txns.length,
        claimedDropped,
        before: {
          paidOrderCount: u.paidOrderCount || 0,
          totalSpentPaise: u.totalSpentPaise || 0,
          karmaPoints: u.karmaPoints || 0,
          balance: u.wallet?.balance || 0,
        },
      });
    }
  }

  // ── 5c. Report the counter rollback, field by field ────────────────────────
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(`ANALYTICS / COUNTER ROLLBACK  (${WRITE ? 'will be written' : 'would be written'})`);
  console.log('───────────────────────────────────────────────────────────────────');

  console.log('\n▸ User purchase denorm — drives admin LTV, the CRM "already a customer"');
  console.log('  tag, dormant-lead filtering and the karma balance.');
  if (!userProjections.length) {
    console.log(PURGE_USERS ? '    (users are being deleted — nothing to recompute)' : '    (no accounts matched)');
  }
  for (const p of userProjections) {
    const arrow = (a, b) => (a === b ? `${a} (unchanged)` : `${a} → ${b}`);
    console.log(`\n    ${p.email}`);
    console.log(`      paidOrderCount   ${arrow(p.before.paidOrderCount, p.paidOrderCount)}`);
    console.log(`      totalSpentPaise  ${arrow(rupees(p.before.totalSpentPaise), rupees(p.totalSpentPaise))}`);
    console.log(`      hasPurchased     → ${p.hasPurchased}`);
    console.log(`      firstPurchaseAt  → ${day(p.firstPurchaseAt)}`);
    console.log(`      lastOrderAt      → ${day(p.lastOrderAt)}`);
    console.log(`      karmaPoints      ${arrow(p.before.karmaPoints, p.karmaPoints)}`);
    console.log(`      wallet.balance   ${arrow(`₹${p.before.balance}`, `₹${p.balance}`)}${p.droppedTxns ? `  (−${p.droppedTxns} stale txn)` : ''}`);
    console.log(`      claimedOrders    −${p.claimedDropped} ref(s)`);
  }

  console.log('\n▸ Coupon.usedCount — the global atomic redemption counter.');
  if (!couponProjections.length) console.log('    (no coupon was redeemed by these accounts — nothing to release)');
  for (const c of couponProjections) {
    console.log(`    ${c.code.padEnd(16)} usedCount ${c.before} → ${c.after}  (−${c.released})${c.usageLimit != null ? `  limit=${c.usageLimit}` : ''}`);
  }

  console.log('\n▸ Product.averageRating / totalReviews — storefront rating badges,');
  console.log('  rating filters and the ratings-sorted listings (mirrored into Elasticsearch).');
  if (!productProjections.length) console.log('    (these accounts left no reviews — every product rating is untouched)');
  for (const p of productProjections) {
    console.log(`    ${trim(p.name, 40).padEnd(40)} ${p.ratingBefore}★→${p.ratingAfter}★   reviews ${p.reviewsBefore}→${p.reviewsAfter}`);
  }

  console.log('\n▸ Lead dangling refs — leads surviving the window that point at a deleted order.');
  if (anyOrder) {
    const [dangConv, dangSrc] = await Promise.all([
      Lead.countDocuments({ convertedOrder: byOrder, _id: { $nin: (snapshot.Lead || []).map((l) => l._id) } }),
      Lead.countDocuments({ 'sources.ref': byOrder, _id: { $nin: (snapshot.Lead || []).map((l) => l._id) } }),
    ]);
    console.log(
      dangConv || dangSrc
        ? `    ${dangConv} conversion ref(s) and ${dangSrc} source ref(s) will be cleared on surviving leads`
        : '    (none — every affected lead is itself being deleted)'
    );
  } else {
    console.log('    (no orders in scope)');
  }

  console.log('\n▸ Untouched by design: AuditLog, RateLimitEvent, AdaptiveThrottlingProfile');
  console.log('  (audit trail), WebhookEvent (24h TTL + Razorpay replay guard), Counter');
  console.log('  (order-number sequence — gaps are harmless, reuse would collide with an');
  console.log('  already-emailed invoice), Product stock (status enum, never per-unit');
  console.log('  decremented by an order — nothing to restore).');
  console.log('');

  if (!WRITE) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(' DRY-RUN — nothing was written. Every value above is exactly what');
    console.log(' --apply would persist.');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    printPostRunChecklist({ reviewProductIds, dryRun: true });
    await mongoose.connection.close();
    process.exit(0);
  }

  if (totalDocs === 0) {
    console.log('Nothing to delete — already clean.\n');
    await mongoose.connection.close();
    process.exit(0);
  }

  // ── 6. Backup BEFORE the first delete ──────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `purge-test-account-data-${stamp}.json`);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          db: mongoose.connection.name,
          targetEmails: EMAILS,
          options: { INCLUDE_FORMS, PURGE_USERS, FORCE_PAID, MAX_ORDERS },
          userDenormBefore: users,
          documents: snapshot,
        },
        null,
        2
      )
    );
  } catch (err) {
    die(`could not write the backup to ${backupFile} (${err.message}). Nothing was deleted.`);
  }
  const kb = (fs.statSync(backupFile).size / 1024).toFixed(1);
  console.log(`Backup written: ${backupFile}  (${kb} KB)\n`);

  // ── 7. Delete ──────────────────────────────────────────────────────────────
  console.log('Deleting…');
  for (const [label, Model, filter] of activePlan) {
    const res = await Model.deleteMany(filter);
    if (res.deletedCount) console.log(`  ${pad(res.deletedCount)}  ${label}`);
  }

  // ── 8. Roll the counters back ──────────────────────────────────────────────
  // Every value below was projected in §5b and already shown in the report, so the
  // report is a contract, not a forecast.
  console.log('\nRolling back denormalised counters…');

  // 8a. Coupon.usedCount — release exactly what we removed, floored at 0. Done as
  //     a guarded pipeline update rather than writing the projected literal, so a
  //     concurrent real redemption between the projection and now isn't clobbered.
  for (const c of couponProjections) {
    const res = await Coupon.updateOne({ _id: c.couponId }, [
      { $set: { usedCount: { $max: [0, { $subtract: [{ $ifNull: ['$usedCount', 0] }, c.released] }] } } },
    ]);
    if (res.matchedCount) console.log(`  Coupon ${c.code}: released ${c.released} use(s) → ${c.after}`);
  }

  // 8b. Product.averageRating / totalReviews — from surviving APPROVED reviews,
  //     mirroring services/wordpressReviewImportService.js.
  for (const p of productProjections) {
    await Product.findByIdAndUpdate(p.productId, {
      averageRating: p.ratingAfter,
      totalReviews: p.reviewsAfter,
    });
    console.log(`  Product ${trim(p.name, 32)}: ${p.ratingBefore}★→${p.ratingAfter}★  reviews ${p.reviewsBefore}→${p.reviewsAfter}`);
  }

  // 8b-bis. Leads that SURVIVED (older than the window, or belonging to another
  //         identity) but still point at an order we just deleted. Left alone they
  //         render as a broken "converted" badge in the CRM and skew won-rate.
  if (anyOrder) {
    const conv = await Lead.updateMany(
      { convertedOrder: byOrder },
      { $set: { convertedOrder: null, convertedAt: null } }
    );
    const src = await Lead.updateMany(
      { 'sources.ref': byOrder },
      { $pull: { sources: { ref: byOrder } } }
    );
    if (conv.modifiedCount || src.modifiedCount) {
      console.log(`  Lead: cleared ${conv.modifiedCount} dangling conversion(s), ${src.modifiedCount} dangling source ref(s)`);
    }
  }

  // 8c. Per-account denorms — the §5b projections, derived from what SURVIVED.
  for (const p of userProjections) {
    await User.updateOne(
      { _id: p._id },
      {
        $set: {
          paidOrderCount: p.paidOrderCount,
          totalSpentPaise: p.totalSpentPaise,
          hasPurchased: p.hasPurchased,
          firstPurchaseAt: p.firstPurchaseAt,
          lastOrderAt: p.lastOrderAt,
          karmaPoints: p.karmaPoints,
          'wallet.transactions': p.txns,
          'wallet.balance': p.balance,
        },
        ...(anyOrder ? { $pull: { claimedOrders: { $in: orderIds } } } : {}),
      }
    );

    console.log(
      `  ${p.email}: LTV ${rupees(p.before.totalSpentPaise)}→${rupees(p.totalSpentPaise)}` +
        `  orders ${p.before.paidOrderCount}→${p.paidOrderCount}` +
        `  karma ${p.before.karmaPoints}→${p.karmaPoints}` +
        `  wallet ₹${p.before.balance}→₹${p.balance}` +
        (p.droppedTxns ? `  (−${p.droppedTxns} stale txn)` : '')
    );
  }

  // ── 9. Optional cache flush ────────────────────────────────────────────────
  if (FLUSH_CACHE) {
    console.log('\nFlushing response caches…');
    try {
      const { default: Redis } = await import('ioredis');
      const { RESPONSE_CACHE_PATTERNS, flushPattern } = await import('../services/cache/flush.js');
      if (!process.env.REDIS_URL) throw new Error('REDIS_URL not set (run inside Railway)');
      const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 5000 });
      let n = 0;
      for (const p of RESPONSE_CACHE_PATTERNS) n += (await flushPattern(redis, p)).deleted;
      await redis.quit();
      console.log(`  deleted ${n} cache key(s)`);
    } catch (err) {
      console.log(`  SKIPPED — ${err.message}. Run \`npm run flush-cache\` inside Railway instead.`);
    }
  }

  console.log('\nDone.\n');
  printPostRunChecklist({ reviewProductIds, dryRun: false });

  await mongoose.connection.close();
  process.exit(0);
}

// ── Post-run: the parts a Mongo script cannot do ─────────────────────────────

function printPostRunChecklist({ reviewProductIds, dryRun }) {
  const verb = dryRun ? 'After you apply, you will still need to' : 'Still to do — this script cannot do these';
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(`${verb}:`);
  console.log('');
  console.log('  IN THIS STACK');
  if (reviewProductIds.length) {
    console.log('   1. Reindex Elasticsearch — averageRating/totalReviews are mirrored into the');
    console.log('      search index, so ratings-sorted/filtered results stay stale until then:');
    console.log('        railway run npm run reindex-products');
  }
  console.log(`   ${reviewProductIds.length ? '2' : '1'}. Flush Redis + the edge (product/rating payloads are cached):`);
  console.log('        railway run npm run flush-cache        (or pass --flush-cache above)');
  console.log('');
  console.log('  OUTSIDE THIS STACK — the pixels already fired, and no DB delete can recall them');
  console.log('   • Google Ads: the test purchases were sent as conversions from');
  console.log('     /order/[orderId]/success. Remove them in Google Ads → Goals → Conversions →');
  console.log('     Uploads/adjustments (retraction upload keyed on the order id / GCLID), or they');
  console.log('     keep skewing ROAS and Smart Bidding.');
  console.log('   • Meta: the same purchases went to the Pixel and the Conversions API');
  console.log('     (event_id = orderId). Meta has no per-event delete — use the Events Manager');
  console.log('     "Delete test events"/dataset filter if the window still allows it, otherwise');
  console.log('     annotate the dates so nobody reads the spike as real demand.');
  console.log('   • GA4 / any BI on top of it: apply a date-range annotation; historical hits');
  console.log('     cannot be deleted per-event either.');
  console.log('   • Razorpay: settlements are the accounting source of truth and stay as they are.');
  console.log('     Make sure Finance knows these were tests so the books reconcile.');
  console.log('   • Postmark: the order/invoice emails were really delivered. Nothing to undo,');
  console.log('     but expect them in the audit trail.');
  console.log('───────────────────────────────────────────────────────────────────\n');
}

main().catch(async (err) => {
  console.error('\n[purge-test-account-data] FAILED:', err);
  try {
    await mongoose.connection.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
