/**
 * Every database read and write Roav Points makes (services/incentives/).
 * Reads of orders, payments, transfers and returns are lean, projected and
 * batched by order id; the ledger is insert-only.
 */
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import BankTransfer from '../models/BankTransfer.js';
import ReturnRequest from '../models/ReturnRequest.js';
import SalesRep from '../models/SalesRep.js';
import User from '../models/User.js';
import IncentiveLedgerEntry from '../models/IncentiveLedgerEntry.js';
import IncentiveMonth from '../models/IncentiveMonth.js';
import IncentiveOrderFlag from '../models/IncentiveOrderFlag.js';
import IncentiveRuleSet from '../models/IncentiveRuleSet.js';
import mongoose from 'mongoose';

export const ORDER_FIELDS = 'wpId salesUser salesRep items._id items.product items.variantId items.quantity items.price items.listPrice '
  + 'discount tax totalAmount gatewayOffer buyer.type paymentStatus status paidAt listDate cancellations updatedAt';

// ── Source rows (read-only) ──────────────────────────────────────────────────

/** One keyset page of sales orders, oldest payment first. */
export function salesOrdersPage({ from, to = null, after = null, limit }) {
  const q = {
    paymentStatus: { $in: ['paid', 'refunded'] },
    listDate: to ? { $gte: from, $lt: to } : { $gte: from },
    $or: [{ salesUser: { $type: 'objectId' } }, { salesRep: { $type: 'objectId' } }],
  };
  if (after) q.$and = [{ $or: [{ listDate: { $gt: after.listDate } }, { listDate: after.listDate, _id: { $gt: after._id } }] }];
  return Order.find(q).select(ORDER_FIELDS).sort({ listDate: 1, _id: 1 }).limit(limit).lean();
}

export const orderById = (id) => Order.findById(id).select(ORDER_FIELDS).lean();

export const paymentsFor = (ids) => Payment.find({ order: { $in: ids } })
  .select('order amount status paymentGateway gatewayPaymentId createdAt').lean();
export const confirmedTransfersFor = (ids) => BankTransfer.find({ order: { $in: ids }, status: 'confirmed' })
  .select('order amount status extraCharge reviewedAt updatedAt paidOn').lean();
export const refundedReturnsFor = (ids) => ReturnRequest.find({ order: { $in: ids }, status: 'refunded' })
  .select('order status createdAt updatedAt items refund.completedAt').lean();

export const userName = (id) => User.findById(id).select('name').lean().then((u) => u?.name || '');
export const salesRepById = (id) => SalesRep.findById(id).select('name user').lean();
export const activeTeamMemberIds = (team, limit = 500) =>
  User.find({ role: 'staff', 'staff.active': true, 'staff.team': team }).select('_id').limit(limit).lean();

// ── A salesperson's own statement page (routes /incentives/me/*) ────────────

/** Customer name + dates for the orders on one statement page. No phone/email/address. */
export const orderCardsFor = (ids) => Order.find({ _id: { $in: ids } })
  .select('wpId listDate paidAt createdAt shippingAddress.fullName').lean();
/**
 * Paid orders this person listed in [start, end), newest first — the candidates
 * for "waiting for the payment check". Index: staff_sales_by_list_date.
 */
// `$type` restates the partial filter so the planner can use that partial index;
// a bare equality does not imply it, and the planner fell back to the global
// listDate index (measured: 30,000 docs examined for 50 results).
export const paidSalesOrdersOf = (userId, start, end, limit) => Order.find({
  salesUser: { $eq: userId, $type: 'objectId' }, paymentStatus: 'paid', listDate: { $gte: start, $lt: end },
}).select('wpId listDate shippingAddress.fullName').sort({ listDate: -1, _id: -1 }).limit(limit).lean();
/** Which of these orders already have any ledger row (for anyone). Index: incentive_ledger_order. */
export const ordersWithLedger = (ids) => IncentiveLedgerEntry.distinct('order', { order: { $in: ids } });
/*
 * Ratings are read from the raw `orderratings` collection, the same way
 * monthService.ratingsByEarner does: the OrderRating model belongs to another
 * workstream and importing it here would tie Roav Points to its load order.
 */
const ratingsColl = () => mongoose.models.OrderRating?.collection || mongoose.connection.db.collection('orderratings');
const RATING_FIELDS = { order: 1, stars: 1, comment: 1, sameNetworkAsSender: 1, createdAt: 1 };
/** Ratings credited to `userId` on these orders. Index: order_1 (unique). */
export const ratingsForOrders = (ids, userId) => ratingsColl()
  .find({ order: { $in: ids }, salesperson: userId }, { projection: RATING_FIELDS }).limit(ids.length).toArray();
/** One salesperson's ratings in [start, end), newest first. Index: salesperson_1_createdAt_-1. */
export const ratingsOf = (userId, start, end, limit) => ratingsColl().find(
  { salesperson: userId, createdAt: { $gte: start, $lt: end }, stars: { $gte: 1, $lte: 5 } },
  { projection: RATING_FIELDS },
).sort({ createdAt: -1 }).limit(limit).toArray();
export const excludedRatingCount = (userId, start, end) => ratingsColl().countDocuments({
  salesperson: userId, createdAt: { $gte: start, $lt: end }, stars: { $gte: 1, $lte: 5 }, sameNetworkAsSender: true,
});

// ── Order flags ──────────────────────────────────────────────────────────────

export const flagsFor = (ids) => IncentiveOrderFlag.find({ order: { $in: ids } }).lean();
export const flagFor = (orderId) => IncentiveOrderFlag.findOne({ order: orderId }).lean();
/** Set the flag and bump its revision, only if the value changes. Throws 11000 if it raced. */
export const changeFlag = (orderId, value, set) => IncentiveOrderFlag.findOneAndUpdate(
  { order: orderId, specialSourcing: { $ne: value } },
  { $set: { specialSourcing: value, ...set }, $inc: { rev: 1 } },
  { upsert: true, new: true }
).lean();

// ── Ledger (insert-only) ─────────────────────────────────────────────────────

export const ledgerForOrder = (orderId, limit = 2000) =>
  IncentiveLedgerEntry.find({ order: orderId }).sort({ _id: 1 }).limit(limit).lean();
/** Every ledger row for a batch of orders (the sweep's one read per batch). Indexed on { order, type }. */
export const ledgerForOrders = (ids) => IncentiveLedgerEntry.find({ order: { $in: ids } }).lean();
export const insertLedgerRows = (rows) => IncentiveLedgerEntry.insertMany(rows, { ordered: false });
export const ledgerAggregate = (pipeline) => IncentiveLedgerEntry.aggregate(pipeline);
export const ledgerPage = (query, select, limit) =>
  IncentiveLedgerEntry.find(query).select(select).sort({ _id: -1 }).limit(limit).lean();

// ── Months ───────────────────────────────────────────────────────────────────

export const monthDoc = (month, select = null) => {
  const q = IncentiveMonth.findOne({ month });
  if (select) q.select(select);
  return q.lean();
};
export const monthDocWhere = (filter, select = null) => {
  const q = IncentiveMonth.findOne(filter);
  if (select) q.select(select);
  return q.lean();
};
export const updateMonth = (filter, update, opts = {}) =>
  IncentiveMonth.findOneAndUpdate(filter, update, { new: true, ...opts }).lean();
export const listMonthDocs = (limit) => IncentiveMonth.find({})
  .select('month status rulesVersion lockedAt approvedAt totalPayoutPaise champion').sort({ month: -1 }).limit(limit).lean();

// ── Rule versions ────────────────────────────────────────────────────────────

export const ruleVersion = (version) => IncentiveRuleSet.findOne({ version }).lean();
export const latestRuleVersion = () => IncentiveRuleSet.findOne({}).sort({ version: -1 }).lean();
export const ruleForMonth = (month) => IncentiveRuleSet.findOne({ effectiveFrom: { $lte: month } })
  .sort({ effectiveFrom: -1, version: -1 }).lean();
export const createRuleVersion = (doc) => IncentiveRuleSet.create(doc).then((d) => d.toObject());
export const listRuleVersions = (limit = 100) => IncentiveRuleSet.find({}).sort({ version: -1 }).limit(limit).lean();
