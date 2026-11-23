import mongoose from 'mongoose';
import { SALARY_COMPONENT_KINDS, MONTH_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * An employee's salary, EFFECTIVE-DATED: a raise is a NEW row from a month, never
 * an edit of the old one, so any past month can be recomputed exactly and the
 * history of pay is the history of rows. The row in force for month M is the
 * latest `effectiveFrom <= M`.
 *
 * Components are monthly amounts in PAISE at full attendance. Payroll pro-rates
 * them by paid days. Statutory (PF/ESI/PT/TDS) are computed by payroll from the
 * flags here + HrSettings — never typed as amounts, except `tdsMonthlyPaise`,
 * which is HR's estimate from the employee's declaration until a TDS engine
 * exists.
 */
const ComponentSchema = new mongoose.Schema({
  code: { type: String, required: true, maxlength: 30 }, // basic, hra, special, conveyance…
  label: { type: String, required: true, maxlength: 60 },
  kind: { type: String, enum: SALARY_COMPONENT_KINDS, required: true },
  monthlyPaise: { type: Number, required: true, min: 0 },
  // Pro-rated by paid days (false = fixed, e.g. a fixed phone allowance).
  prorate: { type: Boolean, default: true },
}, { _id: false });

const SalaryStructureSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  effectiveFrom: { type: String, required: true, match: MONTH_RE },
  components: { type: [ComponentSchema], required: true },
  pfApplicable: { type: Boolean, default: true },
  // PF on basic capped at the statutory wage ceiling (HrSettings.pfWageCeilingPaise).
  pfCapAtCeiling: { type: Boolean, default: true },
  esiApplicable: { type: Boolean, default: true }, // still subject to the gross threshold
  ptState: { type: String, default: '', maxlength: 40 }, // key into HrSettings.ptSlabs
  overtimeEligible: { type: Boolean, default: true },
  overtimeMultiplier: { type: Number, default: 1.5, min: 1, max: 3 },
  tdsMonthlyPaise: { type: Number, default: 0, min: 0 },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  createdBy: { type: ObjectId, ref: 'User', required: true },
}, { timestamps: true });

SalaryStructureSchema.index({ employee: 1, effectiveFrom: -1 }, { name: 'hr_salary_employee_from_unique', unique: true });

// Rows are history: changing pay = a new row. Corrections of a row nobody has been
// paid on yet go through the service (which checks no approved run used it).
export default mongoose.models.SalaryStructure || mongoose.model('SalaryStructure', SalaryStructureSchema);
