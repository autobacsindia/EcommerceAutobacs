/**
 * Public surface of payroll for other HR sessions (docs/ADR-hr-system.md §4).
 */
export {
  prepareRun, recomputeRun, lockRun, unlockRun, approveRun, reopenRun, getRun, listRuns,
  addAdjustment, cancelAdjustment, listAdjustments,
} from './runService.js';
export { createPayouts } from './payouts.js';
export { addSalaryStructure, listSalaryStructures } from './salaryService.js';
export { listPayslips, getPayslip, renderPayslipPdf, shapePayslip } from './payslipService.js';
export { computePayslip } from './calculate.js';
