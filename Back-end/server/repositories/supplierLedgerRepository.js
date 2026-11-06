import mongoose from 'mongoose';
import SupplierLedgerEntry, { LEDGER_SIGN } from '../models/SupplierLedgerEntry.js';

export { LEDGER_SIGN };
import Supplier from '../models/Supplier.js';

/**
 * Supplier credit rows (models/SupplierLedgerEntry.js). Data access only — the
 * money rules and who may do what live in services/supplierLedgerService.js.
 */
const toId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v)));

/** Σ signed amounts of APPROVED rows, per currency. */
const BALANCE_STAGES = [
  {
    $group: {
      _id: '$currency',
      owedPaise: {
        $sum: {
          $cond: [
            { $eq: ['$status', 'approved'] },
            { $cond: [{ $in: ['$kind', ['refund_due', 'credit_restored']] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] },
            0,
          ],
        },
      },
      // Waiting for accounts: claims and repayments not yet approved (signed the same way).
      pendingPaise: {
        $sum: {
          $cond: [
            { $eq: ['$status', 'pending'] },
            { $cond: [{ $in: ['$kind', ['refund_due', 'credit_restored']] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] },
            0,
          ],
        },
      },
    },
  },
];

const supplierLedgerRepository = {
  create: async (doc, session = null) => (await SupplierLedgerEntry.create([doc], { session }))[0].toObject(),
  findById: (id, session = null) => SupplierLedgerEntry.findById(id).session(session).lean(),
  findByKey: (key, session = null) => SupplierLedgerEntry.findOne({ key }).session(session).lean(),

  /** A supplier's balance per currency → [{ _id: currency, owedPaise, pendingPaise }]. Served by supplier_ledger_supplier. */
  balances: (supplierId, session = null) => SupplierLedgerEntry.aggregate([
    { $match: { supplier: toId(supplierId), status: { $in: ['approved', 'pending'] } } },
    ...BALANCE_STAGES,
  ]).session(session),

  /** Balances for several suppliers at once (a directory page) → [{ _id: { supplier, currency }, … }]. */
  balancesFor: (supplierIds) => SupplierLedgerEntry.aggregate([
    { $match: { supplier: { $in: supplierIds.map(toId) }, status: { $in: ['approved', 'pending'] } } },
    { $group: { ...BALANCE_STAGES[0].$group, _id: { supplier: '$supplier', currency: '$currency' } } },
  ]),

  /** Every supplier with anything owed or waiting, biggest first. Bounded by `limit`. */
  owing: (limit) => SupplierLedgerEntry.aggregate([
    { $match: { status: { $in: ['approved', 'pending'] } } },
    { $group: { ...BALANCE_STAGES[0].$group, _id: { supplier: '$supplier', currency: '$currency' }, supplierName: { $last: '$supplierName' } } },
    { $match: { $or: [{ owedPaise: { $ne: 0 } }, { pendingPaise: { $ne: 0 } }] } },
    { $sort: { owedPaise: -1 } },
    { $limit: limit },
  ]).option({ maxTimeMS: 5000 }),

  /** Keyset page: `query` already carries the "after the cursor" clause. */
  page: (query, { sort, limit }) => SupplierLedgerEntry.find(query).sort(sort).limit(limit).lean(),

  /** The live (pending / approved) claim on each of these payments. */
  claimsFor: (requestIds) => SupplierLedgerEntry.find({
    paymentRequest: { $in: requestIds, $type: 'objectId' }, kind: 'refund_due', status: { $in: ['pending', 'approved'] },
  }).select('paymentRequest status amountPaise currency').lean(),

  /** Compare-and-set on status: `from` → the update. Null when it had already moved. */
  decide: (id, from, update, session = null) => SupplierLedgerEntry.findOneAndUpdate(
    { _id: id, status: { $in: from } }, update, { new: true, session },
  ).lean(),

  /**
   * Take the supplier's lock inside a transaction: a write to the supplier, so a
   * second transaction changing the same supplier's credit conflicts and is retried
   * (withTransaction) — and then sees this one's rows. Null when there is no such supplier.
   */
  lockSupplier: (supplierId, session) => Supplier.findOneAndUpdate(
    { _id: supplierId }, { $inc: { ledgerSeq: 1 } }, { new: true, session, projection: { name: 1, ledgerSeq: 1 } },
  ).lean(),

  inTransaction: async (fn) => {
    const session = await mongoose.startSession();
    try {
      let out;
      await session.withTransaction(async () => { out = await fn(session); });
      return out;
    } finally {
      await session.endSession();
    }
  },
};

export default supplierLedgerRepository;
