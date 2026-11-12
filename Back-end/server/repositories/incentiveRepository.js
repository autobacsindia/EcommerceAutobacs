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
