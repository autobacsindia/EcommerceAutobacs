/**
 * /api/v1/hr — salary, payroll runs, adjustments and payslips
 * (docs/ADR-hr-system.md §4 Payroll). `protect` (token + sessionVersion → 401)
 * and the HR rate limit run in routes/hr/index.js; every route here adds its own
 * role check from middleware/hrAuth.js.
 *
 *   HR or admin : prepare, recompute, lock, unlock, adjustments, salary rows
 *   admin only  : approve, re-open, payouts
 *   self        : own salary rows and own RELEASED payslips (+ PDF)
 *   anyone else : 404 (same as "doesn't exist")
 *
 * No route reads a money figure from the body except an HR adjustment's amount
 * and the salary components HR types; every total is computed on the server.
 */
import express from 'express';
import { asyncHandler } from '../../middleware/errorMiddleware.js';
import {
  hrOrAdmin, adminOnly, requireEmployeeAccess, loadSelfEmployee, isHrOrAdmin,
} from '../../middleware/hrAuth.js';
import {
  prepareRun, recomputeRun, lockRun, unlockRun, approveRun, reopenRun, getRun, listRuns,
  addAdjustment, cancelAdjustment, listAdjustments, createPayouts,
  addSalaryStructure, listSalaryStructures,
  listPayslips, getPayslip, renderPayslipPdf, shapePayslip,
} from '../../services/hr/payroll/index.js';
import { payslipNumber } from '../../services/hr/payroll/payouts.js';

const router = express.Router();
const page = (req) => ({ cursor: req.query.cursor, limit: req.query.limit });
const noStore = (res) => res.set('Cache-Control', 'private, no-store');

async function sendPdf(res, p) {
  const pdf = await renderPayslipPdf(p);
  noStore(res);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${payslipNumber(p)}.pdf"`);
  res.send(pdf);
}

// ── Self (the app) ────────────────────────────────────────────────────────────
router.get('/me/salary', loadSelfEmployee, asyncHandler(async (req, res) => {
  noStore(res);
  res.json({ success: true, ...(await listSalaryStructures(req.employee._id, page(req))) });
}));
router.get('/me/payslips', loadSelfEmployee, asyncHandler(async (req, res) => {
  noStore(res);
  res.json({ success: true, ...(await listPayslips(req.employee._id, { releasedOnly: true, ...page(req) })) });
}));
router.get('/me/payslips/:id', loadSelfEmployee, asyncHandler(async (req, res) => {
  noStore(res);
  res.json({ success: true, payslip: shapePayslip(await getPayslip(req.employee._id, req.params.id, { releasedOnly: true })) });
}));
router.get('/me/payslips/:id/pdf', loadSelfEmployee, asyncHandler(async (req, res) => {
  await sendPdf(res, await getPayslip(req.employee._id, req.params.id, { releasedOnly: true }));
}));

// ── One employee (scope 'salary': self, HR, admin — never a team head) ───────
router.get('/employees/:employeeId/salary', requireEmployeeAccess('salary'), asyncHandler(async (req, res) => {
  noStore(res);
  res.json({ success: true, ...(await listSalaryStructures(req.employee._id, page(req))) });
}));
router.post('/employees/:employeeId/salary', hrOrAdmin, requireEmployeeAccess('salary'), asyncHandler(async (req, res) => {
  const { structure, replay } = await addSalaryStructure(req.user, req.employee, req.body || {}, req);
  res.status(replay ? 200 : 201).json({ success: true, structure, replay });
}));
router.get('/employees/:employeeId/payslips', requireEmployeeAccess('salary'), asyncHandler(async (req, res) => {
  noStore(res);
  res.json({ success: true, ...(await listPayslips(req.employee._id, { releasedOnly: !isHrOrAdmin(req.user), ...page(req) })) });
}));
router.get('/employees/:employeeId/payslips/:id', requireEmployeeAccess('salary'), asyncHandler(async (req, res) => {
  noStore(res);
  const p = await getPayslip(req.employee._id, req.params.id, { releasedOnly: !isHrOrAdmin(req.user) });
  res.json({ success: true, payslip: shapePayslip(p) });
}));
router.get('/employees/:employeeId/payslips/:id/pdf', requireEmployeeAccess('salary'), asyncHandler(async (req, res) => {
  await sendPdf(res, await getPayslip(req.employee._id, req.params.id, { releasedOnly: !isHrOrAdmin(req.user) }));
}));

// ── Adjustments (HR/admin) ────────────────────────────────────────────────────
router.post('/adjustments/:id/cancel', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await cancelAdjustment(req.user, req.params.id, { reason: req.body?.reason, req })) });
}));

// ── Runs ──────────────────────────────────────────────────────────────────────
router.get('/payroll', hrOrAdmin, asyncHandler(async (req, res) => {
  noStore(res);
  res.json({ success: true, ...(await listRuns(page(req))) });
}));
router.get('/payroll/:month', hrOrAdmin, asyncHandler(async (req, res) => {
  noStore(res);
  res.json({ success: true, run: await getRun(req.params.month) });
}));
router.get('/payroll/:month/adjustments', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listAdjustments(req.params.month)) });
}));
router.post('/payroll/:month/adjustments', hrOrAdmin, asyncHandler(async (req, res) => {
  const { adjustment, replay } = await addAdjustment(req.user, req.params.month, req.body || {}, req);
  res.status(replay ? 200 : 201).json({ success: true, adjustment, replay });
}));
router.post('/payroll/:month/prepare', hrOrAdmin, asyncHandler(async (req, res) => {
  const { run, created } = await prepareRun(req.user, req.params.month, { req });
  res.status(created ? 201 : 200).json({ success: true, run, created });
}));
router.post('/payroll/:month/recompute', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, run: await recomputeRun(req.user, req.params.month, { rev: req.body?.rev, req }) });
}));
router.post('/payroll/:month/lock', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, run: await lockRun(req.user, req.params.month, { rev: req.body?.rev, req }) });
}));
router.post('/payroll/:month/unlock', hrOrAdmin, asyncHandler(async (req, res) => {
  const { rev, reason } = req.body || {};
  res.json({ success: true, run: await unlockRun(req.user, req.params.month, { rev, reason, req }) });
}));
router.post('/payroll/:month/approve', adminOnly, asyncHandler(async (req, res) => {
  const { rev, fingerprint } = req.body || {};
  res.json({ success: true, ...(await approveRun(req.user, req.params.month, { rev, fingerprint, req })) });
}));
router.post('/payroll/:month/reopen', adminOnly, asyncHandler(async (req, res) => {
  const { rev, reason } = req.body || {};
  res.json({ success: true, run: await reopenRun(req.user, req.params.month, { rev, reason, req }) });
}));
router.post('/payroll/:month/payouts', adminOnly, asyncHandler(async (req, res) => {
  res.json({ success: true, payouts: await createPayouts(req.user, req.params.month, { req }) });
}));

export default router;
