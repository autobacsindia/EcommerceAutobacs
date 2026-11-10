import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { validatePastMemberList, validatePastMemberId, validatePastMemberPage } from '../validators/staffPastMember.validator.js';
import { listPastMembers, getPastMember, listPastMemberTasks, listPastMemberOrders } from '../services/staffPastMemberService.js';

/** Past team members and their work history (/api/v1/staff/past-members). Mounted after routes/staff.js's signed-in gate. */
const router = express.Router();
const v = (...chains) => [...chains.flat(), validateRequest];
// Per-person staff history: never kept by a browser or shared cache.
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', v(validatePastMemberList), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPastMembers(req.user, req.query)) });
}));
router.get('/:userId', v(validatePastMemberId), asyncHandler(async (req, res) => {
  res.json({ success: true, member: await getPastMember(req.user, req.params.userId) });
}));
router.get('/:userId/tasks', v(validatePastMemberPage), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPastMemberTasks(req.user, req.params.userId, req.query)) });
}));
router.get('/:userId/orders', v(validatePastMemberPage), asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listPastMemberOrders(req.user, req.params.userId, req.query)) });
}));

export default router;
