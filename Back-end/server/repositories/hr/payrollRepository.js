/**
 * PayrollRun, Payslip and PayrollAdjustment (models/hr/). Data access only —
 * services/hr/payroll/* own the rules. Every status change is a compare-and-set
 * on { status, rev }, so two clicks or two people can never both win.
 */
import PayrollRun from '../../models/hr/PayrollRun.js';
import Payslip from '../../models/hr/Payslip.js';
import PayrollAdjustment from '../../models/hr/PayrollAdjustment.js';
import EmployeeProfile from '../../models/hr/EmployeeProfile.js';

const PAYSLIP_LIST_FIELDS = 'run month kind employee snapshot.name snapshot.employeeCode grossPaise deductionsPaise netPaise releasedAt payoutRequest warnings';

const payrollRepository = {
  // ── Runs ───────────────────────────────────────────────────────────────────
  findRun: (month, session = null) => PayrollRun.findOne({ month }).session(session).select('-__v').lean(),
  /** One run per month: creates the draft only if none exists (unique month). */
  ensureRun: (month, set) => PayrollRun.findOneAndUpdate(
    { month },
    { $setOnInsert: { month, status: 'draft', ...set } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean(),
  /** CAS: only when status ∈ from and rev matches. Returns the new run or null. */
  transitionRun: (id, { from, rev }, set, history, session = null) => PayrollRun.findOneAndUpdate(
    { _id: id, status: { $in: from }, rev },
    { $set: set, $inc: { rev: 1 }, ...(history ? { $push: { history } } : {}) },
    { new: true, session, runValidators: true },
  ).lean(),
  pushRunHistory: (id, set, history, session = null) => PayrollRun.findOneAndUpdate(
    { _id: id },
    { $set: set, $push: { history } },
    { new: true, session },
  ).lean(),
  /** Newest month first; keyset on month (unique). */
  listRuns: ({ before, limit }) => PayrollRun.find(before ? { month: { $lt: before } } : {})
    .select('month status employeeCount totals blockedCount computedAt lockedAt approvedAt payoutsCount rev')
    .sort({ month: -1 }).limit(limit).lean(),

  // ── Payslips ───────────────────────────────────────────────────────────────
  deleteRunPayslips: (runId, session = null) => Payslip.deleteMany({ run: runId, kind: 'monthly' }, { session }),
  insertPayslips: (docs, session = null) => (docs.length ? Payslip.insertMany(docs, { session, ordered: true }) : []),
  listRunPayslips: (runId, session = null) => Payslip.find({ run: runId }).session(session)
    .select(PAYSLIP_LIST_FIELDS).sort({ 'snapshot.name': 1, _id: 1 }).lean(),
  findPayslip: (id) => Payslip.findById(id).select('-__v').lean(),
  findEmployeePayslip: (id, employeeId, { releasedOnly }) => Payslip.findOne({
    _id: id, employee: employeeId, ...(releasedOnly ? { releasedAt: { $type: 'date' } } : {}),
  }).select('-__v').lean(),
  findEmployeePayslipByMonth: (month, employeeId, { releasedOnly }) => Payslip.findOne({
    employee: employeeId, month, kind: 'monthly', ...(releasedOnly ? { releasedAt: { $type: 'date' } } : {}),
  }).select('-__v').lean(),
  /** Newest month first; keyset (month, _id). */
  listEmployeePayslips: (employeeId, { releasedOnly, after, limit }) => Payslip.find({
    employee: employeeId,
    ...(releasedOnly ? { releasedAt: { $type: 'date' } } : {}),
    ...(after ? { $or: [{ month: { $lt: after.month } }, { month: after.month, _id: { $lt: after.id } }] } : {}),
  }).select(PAYSLIP_LIST_FIELDS).sort({ month: -1, _id: -1 }).limit(limit).lean(),
  setRunReleased: (runId, releasedAt, session = null) => Payslip.updateMany({ run: runId }, { $set: { releasedAt } }, { session }),
  /** CAS: links the payment request only if the payslip has none yet. */
  claimPayout: (payslipId, requestId, session = null) => Payslip.findOneAndUpdate(
    { _id: payslipId, payoutRequest: null },
    { $set: { payoutRequest: requestId } },
    { new: true, session },
  ).lean(),
  countPayouts: (runId) => Payslip.countDocuments({ run: runId, payoutRequest: { $type: 'objectId' } }),

  // ── Adjustments ────────────────────────────────────────────────────────────
  createAdjustment: async (doc, session = null) => (await PayrollAdjustment.create([doc], { session }))[0].toObject(),
  findAdjustment: (id) => PayrollAdjustment.findById(id).lean(),
  findAdjustmentByKey: (key) => PayrollAdjustment.findOne({ key: { $type: 'string', $eq: key } }).lean(),
  listAdjustments: (month, session = null) => PayrollAdjustment.find({ month }).session(session)
    .sort({ createdAt: 1, _id: 1 }).lean(),
  cancelAdjustment: (id, actorId, at, session = null) => PayrollAdjustment.findOneAndUpdate(
    { _id: id, cancelledAt: null },
    { $set: { cancelledAt: at, cancelledBy: actorId } },
    { new: true, session },
  ).lean(),

  // ── Employee pay details for the payout (encrypted fields, read once) ──────
  employeePayee: (employeeId) => EmployeeProfile.findById(employeeId)
    .select('name bank.holderName bank.ifsc bank.accountLast4 +bank.accountEnc +bank.upiEnc').lean(),
};

export default payrollRepository;
