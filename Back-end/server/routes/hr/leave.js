/**
 * /api/v1/hr — leave, holidays and employee documents (docs/ADR-hr-system.md §4).
 * `protect` (token + sessionVersion) and the HR rate limit run in routes/hr/index.js;
 * every route here adds its own role check from middleware/hrAuth.js.
 */
import express from 'express';
import { asyncHandler } from '../../middleware/errorMiddleware.js';
import {
  hrOrAdmin, requireEmployeeAccess, loadSelfEmployee, isHrOrAdmin, isAdminUser, isActiveStaffUser,
} from '../../middleware/hrAuth.js';
import {
  listLeaveTypes, createLeaveType, updateLeaveType, seedDefaultLeaveTypes,
} from '../../services/hr/leave/types.js';
import { listHolidays, createHoliday, deleteHoliday } from '../../services/hr/leave/holidays.js';
import {
  getBalances, adjustBalance, yearlyGrant, monthlyGrant, yearEndClose, ledgerFor,
} from '../../services/hr/leave/balances.js';
import {
  applyLeave, cancelLeave, decideLeave, leaveInbox, listEmployeeLeave, getLeaveRequest,
} from '../../services/hr/leave/requests.js';
import { istToday, yearOf } from '../../services/hr/leave/calendar.js';
import {
  uploadHrDocument, uploadDocument, listDocuments, documentUrl, deleteDocument,
} from '../../services/hr/documents/index.js';

const router = express.Router();

/** Staff (active) or admin — the people who use the HR app. Customers get 403. */
const staffOrAdmin = (req, res, next) => {
  if (isAdminUser(req.user) || isActiveStaffUser(req.user)) return next();
  return res.status(403).json({ success: false, message: 'Only staff can do this' });
};
const yearParam = (req) => (req.query.year === undefined ? yearOf(istToday()) : Number(req.query.year));
const pageOpts = (req) => ({ cursor: req.query.cursor, limit: req.query.limit });

// ── Leave types ───────────────────────────────────────────────────────────────
router.get('/leave-types', staffOrAdmin, asyncHandler(async (req, res) => {
  // Employees see the active types they can apply for; HR/admin see all.
  const items = await listLeaveTypes({ activeOnly: !isHrOrAdmin(req.user) });
  res.json({ success: true, items, nextCursor: null });
}));
router.post('/leave-types', hrOrAdmin, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, leaveType: await createLeaveType(req.user, req.body || {}, req) });
}));
router.post('/leave-types/seed-defaults', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await seedDefaultLeaveTypes(req.user, req)) });
}));
router.patch('/leave-types/:id', hrOrAdmin, asyncHandler(async (req, res) => {
  const { rev, reason, ...input } = req.body || {};
  res.json({ success: true, leaveType: await updateLeaveType(req.user, req.params.id, input, { rev, reason, req }) });
}));

// ── Holidays ──────────────────────────────────────────────────────────────────
router.get('/holidays', staffOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listHolidays({ year: yearParam(req), ...pageOpts(req) })) });
}));
router.post('/holidays', hrOrAdmin, asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, holiday: await createHoliday(req.user, req.body || {}, req) });
}));
router.delete('/holidays/:id', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, holiday: await deleteHoliday(req.user, req.params.id, req) });
}));

// ── My leave (the app) ────────────────────────────────────────────────────────
router.get('/me/leave/balances', loadSelfEmployee, asyncHandler(async (req, res) => {
  res.json({ success: true, items: await getBalances(req.employee._id, yearParam(req)), nextCursor: null });
}));
router.get('/me/leave', loadSelfEmployee, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listEmployeeLeave(req.employee._id, pageOpts(req))) });
}));
router.post('/me/leave', loadSelfEmployee, asyncHandler(async (req, res) => {
  const { request, replay } = await applyLeave(req.user, req.employee, req.body || {}, { req });
  res.status(replay ? 200 : 201).json({ success: true, request, replay });
}));
router.post('/me/leave/:id/cancel', loadSelfEmployee, asyncHandler(async (req, res) => {
  const result = await cancelLeave(req.user, req.params.id, { reason: req.body?.reason, req });
  res.json({ success: true, ...result });
}));

// ── One employee's leave (HR/admin; head for own team; self) ─────────────────
router.get('/employees/:employeeId/leave/balances', requireEmployeeAccess('leave'), asyncHandler(async (req, res) => {
  res.json({ success: true, items: await getBalances(req.employee._id, yearParam(req)), nextCursor: null });
}));
router.get('/employees/:employeeId/leave/ledger', requireEmployeeAccess('leave'), asyncHandler(async (req, res) => {
  res.json({ success: true, items: await ledgerFor(req.employee._id, yearParam(req)), nextCursor: null });
}));
router.get('/employees/:employeeId/leave', requireEmployeeAccess('leave'), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listEmployeeLeave(req.employee._id, pageOpts(req))) });
}));
router.post('/employees/:employeeId/leave', hrOrAdmin, requireEmployeeAccess('leave'), asyncHandler(async (req, res) => {
  const { request, replay } = await applyLeave(req.user, req.employee, req.body || {}, { onBehalf: true, req });
  res.status(replay ? 200 : 201).json({ success: true, request, replay });
}));
router.post('/employees/:employeeId/leave/adjust', hrOrAdmin, requireEmployeeAccess('leave'), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await adjustBalance(req.user, req.employee, req.body || {}, req)) });
}));

// ── Decisions ─────────────────────────────────────────────────────────────────
router.get('/leave/inbox', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await leaveInbox(req.user, pageOpts(req))) });
}));
router.post('/leave/grants', hrOrAdmin, asyncHandler(async (req, res) => {
  const { year, month } = req.body || {};
  const result = month !== undefined ? await monthlyGrant(month) : await yearlyGrant(year);
  res.json({ success: true, ...result });
}));
router.post('/leave/year-end', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await yearEndClose(req.body?.year)) });
}));
router.get('/leave/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, request: await getLeaveRequest(req.user, req.params.id) });
}));
router.post('/leave/:id/decide', asyncHandler(async (req, res) => {
  const { decision, note, rev } = req.body || {};
  res.json({ success: true, ...(await decideLeave(req.user, req.params.id, { decision, note, rev }, { req })) });
}));
router.post('/leave/:id/cancel', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await cancelLeave(req.user, req.params.id, { asHr: true, reason: req.body?.reason, req })) });
}));

// ── Documents (scope `documents`: self, HR, admin — never a team head) ───────
router.get('/employees/:employeeId/documents', requireEmployeeAccess('documents'), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listDocuments(req.employee._id, pageOpts(req))) });
}));
router.post('/employees/:employeeId/documents', requireEmployeeAccess('documents'), uploadHrDocument, asyncHandler(async (req, res) => {
  const { kind, note } = req.body || {};
  res.status(201).json({ success: true, document: await uploadDocument(req.user, req.employee, req.file, { kind, note }, req) });
}));
router.get('/documents/:docId/url', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await documentUrl(req.user, req.params.docId)) });
}));
router.delete('/documents/:docId', hrOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, document: await deleteDocument(req.user, req.params.docId, { reason: req.body?.reason, req }) });
}));

export default router;
