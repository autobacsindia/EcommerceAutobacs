import mongoose from 'mongoose';
import { PAYSLIP_KINDS, MONTH_RE } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One employee's pay for one month — a SNAPSHOT. Everything a payslip shows is
 * copied in at compute time (name, code, designation, masked PAN/bank, the salary
 * components used, the attendance counts, each line with how it was worked out),
 * so editing the employee or their salary later never rewrites a past payslip.
 *
 * Written only by the payroll service while the run is draft; frozen after the
 * run is approved. `payoutRequest` links the PaymentRequest that pays it.
 */
const LineSchema = new mongoose.Schema({
  code: { type: String, required: true, maxlength: 40 },
  label: { type: String, required: true, maxlength: 80 },
  kind: { type: String, enum: ['earning', 'deduction', 'employer'], required: true },
  amountPaise: { type: Number, required: true, min: 0 },
  calc: { type: String, default: '', maxlength: 300 }, // "30 of 31 days × ₹15,000"
  // The counts behind the figure (days, marks, minutes, rate…), so every line can be
  // explained and re-checked: { lopDays: 2.5, perDayPaise: 50000, … }.
  basis: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { _id: false, minimize: false });

const PayslipSchema = new mongoose.Schema({
  run: { type: ObjectId, ref: 'PayrollRun', required: true },
  month: { type: String, required: true, match: MONTH_RE },
  kind: { type: String, enum: PAYSLIP_KINDS, default: 'monthly' },
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  snapshot: {
    type: new mongoose.Schema({
      name: String,
      employeeCode: String,
      designation: String,
      team: String,
      joinDate: String,
      exitDate: String,
      panLast4: String,
      uan: String,
      bankLast4: String,
      salaryStructure: { type: ObjectId, ref: 'SalaryStructure' },
    }, { _id: false }),
    required: true,
  },
  attendance: {
    type: new mongoose.Schema({
      daysInMonth: Number,
      paidDays: Number, // may be fractional (x.5)
      lopDays: Number,
      presentDays: Number,
      leaveDays: Number,
      lateMarks: Number,
      overtimeMinutes: Number,
      // Owner rules 2026-11-26 (late + early leaving = marks; marks → ½-day LOP).
      marks: Number,
      lateCount: Number,
      earlyCount: Number,
      marksLopDays: Number,
      absentUnapproved: Number,
      notEmployedDays: Number, // before the join date / after the last day
      dayDivisor: Number, // calendar days or 30 (HrSettings.monthDayBasis)
      shiftMinutes: Number,
    }, { _id: false }),
    required: true,
  },
  lines: { type: [LineSchema], default: [] },
  grossPaise: { type: Number, required: true, min: 0 },
  deductionsPaise: { type: Number, required: true, min: 0 },
  netPaise: { type: Number, required: true, min: 0 },
  employerPaise: { type: Number, default: 0, min: 0 }, // employer PF + ESI (not paid to the employee)
  // Problems HR must fix before the run can lock (e.g. deductions above earnings).
  warnings: { type: [String], default: [] },
  payoutRequest: { type: ObjectId, ref: 'PaymentRequest', default: null },
  releasedAt: { type: Date, default: null }, // visible to the employee from here
}, { timestamps: true });

PayslipSchema.index({ employee: 1, month: 1, kind: 1 }, { name: 'hr_payslip_employee_month_kind_unique', unique: true });
PayslipSchema.index({ run: 1, employee: 1 }, { name: 'hr_payslip_run_employee' });
PayslipSchema.index({ employee: 1, month: -1 }, { name: 'hr_payslip_employee_month' });

export default mongoose.models.Payslip || mongoose.model('Payslip', PayslipSchema);
