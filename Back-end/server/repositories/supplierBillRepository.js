import SupplierBill from '../models/SupplierBill.js';
import PaymentRequest from '../models/PaymentRequest.js';

/**
 * Supplier bills we pay later (models/SupplierBill.js). Data access only — who may
 * do what, and the money rules, live in services/supplierBillService.js.
 */
const supplierBillRepository = {
  create: async (doc) => (await SupplierBill.create(doc)).toObject(),
  findById: (id) => SupplierBill.findById(id).lean(),
  findByClientId: (createdBy, clientId) => SupplierBill.findOne({ createdBy, clientId }).lean(),
  findOpenByKey: (supplier, billKey) => SupplierBill.findOne({ supplier, status: 'open', billKey }).lean(),

  /** A page of bills (keyset: the caller passes the cursor clause and sort). Served by supplier_bill_due / supplier_bill_supplier. */
  page: (query, { sort, limit }) => SupplierBill.find(query).sort(sort).limit(limit).lean(),

  /** How many bills match, and what is still owed on them (paise), capped. */
  summary: async (query, cap) => {
    const [row] = await SupplierBill.aggregate([
      { $match: query },
      { $limit: cap + 1 },
      { $group: { _id: null, count: { $sum: 1 }, owed: { $sum: { $subtract: ['$amountPaise', '$paidPaise'] } } } },
    ]);
    const count = row?.count || 0;
    return count > cap ? { count: cap, capped: true, owedPaise: null } : { count, capped: false, owedPaise: row?.owed || 0 };
  },

  /**
   * What we owe each supplier: bills still open and not settled, grouped by supplier.
   * `today` ('YYYY-MM-DD') splits off what is overdue. Bounded: suppliers with bills
   * owed are a few dozen; `cap` stops a runaway.
   */
  owedBySupplier: (today, cap) => SupplierBill.aggregate([
    { $match: { status: 'open', settled: false } },
    { $group: {
      _id: '$supplier',
      name: { $last: '$supplierName' },
      bills: { $sum: 1 },
      // Bills whose amount is not known yet: counted here, left out of every rupee total.
      noAmountBills: { $sum: { $cond: [{ $isNumber: '$amountPaise' }, 0, 1] } },
      owedPaise: { $sum: { $subtract: ['$amountPaise', '$paidPaise'] } },
      overdueBills: { $sum: { $cond: [{ $lt: ['$dueDate', today] }, 1, 0] } },
      overduePaise: { $sum: { $cond: [{ $lt: ['$dueDate', today] }, { $subtract: ['$amountPaise', '$paidPaise'] }, 0] } },
      nextDue: { $min: '$dueDate' },
    } },
    { $sort: { overduePaise: -1, nextDue: 1 } },
    { $limit: cap },
  ]),

  /** Bills owed and past due, oldest due first (the daily reminder). */
  findOverdue: (today, limit) => SupplierBill.find({ status: 'open', settled: false, dueDate: { $lt: today } })
    .sort({ dueDate: 1, _id: 1 }).limit(limit).lean(),

  /** Compare-and-set update: `filter` is added to the _id match. Null when it did not match. */
  updateIf: (id, filter, update) => SupplierBill.findOneAndUpdate({ _id: id, ...filter }, update, { new: true, runValidators: true }).lean(),

  /**
   * Take `paise` of the bill, only if it still fits and the bill is open. Returns the
   * bill as it was BEFORE, or null when it would go over (or it is not open).
   */
  reserve: (id, paise) => SupplierBill.findOneAndUpdate(
    // `$type`: a bill whose amount is not known yet (null) can never be reserved against.
    { _id: id, status: 'open', amountPaise: { $type: 'number' }, $expr: { $lte: [{ $add: ['$reservedPaise', paise] }, '$amountPaise'] } },
    { $inc: { reservedPaise: paise } },
    { new: false },
  ).lean(),

  /** Give `paise` back; never below zero. */
  release: (id, paise) => SupplierBill.updateOne(
    { _id: id, reservedPaise: { $gte: paise } },
    { $inc: { reservedPaise: -paise } },
  ),

  /** Set the paid cache (re-computed from the requests, so setting it again is harmless). */
  setPaid: (id, paidPaise, settled) => SupplierBill.findOneAndUpdate(
    { _id: id },
    [{ $set: {
      paidPaise,
      settled,
      // Keep the first settledAt; clear it if the bill is no longer settled.
      settledAt: settled ? { $ifNull: ['$settledAt', '$$NOW'] } : null,
    } }],
    { new: true },
  ).lean(),

  /** The payment requests on these bills (oldest first). Bounded by the caller (a page of bills). */
  // `$type` repeats the partial index's filter so the planner can use payment_request_supplier_bill
  // (an `$in` alone does not prove it, and the plan would scan every payment request).
  requestsFor: (billIds) => PaymentRequest.find({ supplierBill: { $in: billIds, $type: 'objectId' } })
    .select('number status amount currency supplierBill requestedByName createdAt payment.paidAt payment.transactionAt')
    .sort({ createdAt: 1 })
    .lean(),
};

export default supplierBillRepository;
