/**
 * /api/v1/hr/* — HR system (docs/ADR-hr-system.md).
 *
 * `protect` verifies the token AND its sessionVersion (stale → 401), then the
 * HR limiter keys on the user (cf-connecting-ip fallback). Each sub-router
 * applies its own role checks (middleware/hrAuth.js) on EVERY route.
 * Sub-router files are owned by one build session each — add routes there,
 * not here.
 */
import express from 'express';
import { protect } from '../../middleware/authMiddleware.js';
import { hrRateLimit } from '../../middleware/rate-limit/index.js';
import employeeRoutes from './employees.js';
import settingsRoutes from './settings.js';
import attendanceRoutes from './attendance.js';
import leaveRoutes from './leave.js';
import payrollRoutes from './payroll.js';

const router = express.Router();

router.use(protect, hrRateLimit);
router.use(employeeRoutes);
router.use(settingsRoutes);
router.use(attendanceRoutes);
router.use(leaveRoutes);
router.use(payrollRoutes);

export default router;
