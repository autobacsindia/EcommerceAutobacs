/**
 * /api/v1/hr/employees + /api/v1/hr/me — employee profiles.
 * Auth (protect → sessionVersion) and the HR rate limit are applied in
 * routes/hr/index.js; per-route access is middleware/hrAuth.js.
 */
import express from 'express';
import { asyncHandler } from '../../middleware/errorMiddleware.js';
import { hrOrAdmin, requireEmployeeAccess, loadSelfEmployee } from '../../middleware/hrAuth.js';
import {
  listEmployees, createEmployee, updateEmployee, setOnboardingItem, shapeEmployee,
} from '../../services/hr/employeeService.js';

const router = express.Router();

// The caller's own profile (the app's "Me" tab).
router.get('/me', loadSelfEmployee, (req, res) => {
  res.json({ success: true, employee: shapeEmployee(req.employee) });
});

router.get('/employees', hrOrAdmin, asyncHandler(async (req, res) => {
  const { status, team, q, cursor, limit } = req.query;
  res.json({ success: true, ...(await listEmployees({ status, team, q, cursor, limit })) });
}));

router.post('/employees', hrOrAdmin, asyncHandler(async (req, res) => {
  const employee = await createEmployee(req.user, req.body || {}, req);
  res.status(201).json({ success: true, employee });
}));

router.get('/employees/:employeeId', requireEmployeeAccess('profile'), (req, res) => {
  res.json({ success: true, employee: shapeEmployee(req.employee) });
});

router.patch('/employees/:employeeId', hrOrAdmin, requireEmployeeAccess('profile'), asyncHandler(async (req, res) => {
  const { rev, reason, ...input } = req.body || {};
  const employee = await updateEmployee(req.user, req.employee._id, input, { rev, reason, req });
  res.json({ success: true, employee });
}));

router.put('/employees/:employeeId/onboarding/:key', hrOrAdmin, requireEmployeeAccess('profile'), asyncHandler(async (req, res) => {
  const employee = await setOnboardingItem(req.user, req.employee._id, req.params.key, req.body?.done === true, req);
  res.json({ success: true, employee });
}));

export default router;
