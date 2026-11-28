/**
 * SalaryStructure (models/hr/SalaryStructure.js): effective-dated rows, one per
 * (employee, effectiveFrom month). Data access only — rules live in
 * services/hr/payroll/salaryService.js.
 */
import SalaryStructure from '../../models/hr/SalaryStructure.js';

const FIELDS = '-__v';

const salaryRepository = {
  create: async (doc, session = null) => (await SalaryStructure.create([doc], { session }))[0].toObject(),
  findOne: (employeeId, effectiveFrom) => SalaryStructure.findOne({ employee: employeeId, effectiveFrom }).select(FIELDS).lean(),
  findById: (id) => SalaryStructure.findById(id).select(FIELDS).lean(),
  /** Newest first; keyset on effectiveFrom (unique per employee). */
  listForEmployee: (employeeId, { before, limit }) => SalaryStructure
    .find({ employee: employeeId, ...(before ? { effectiveFrom: { $lt: before } } : {}) })
    .select(FIELDS).sort({ effectiveFrom: -1 }).limit(limit).lean(),
  /** The row in force for `month` per employee: the latest effectiveFrom ≤ month. */
  inForce: async (employeeIds, month) => {
    const rows = await SalaryStructure
      .find({ employee: { $in: employeeIds }, effectiveFrom: { $lte: month } })
      .select(FIELDS).sort({ employee: 1, effectiveFrom: -1 }).lean();
    const out = new Map();
    for (const r of rows) if (!out.has(String(r.employee))) out.set(String(r.employee), r);
    return out;
  },
  validate: (doc) => new SalaryStructure(doc).validate(),
};

export default salaryRepository;
