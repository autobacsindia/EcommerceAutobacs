/**
 * Autobacs Team app helpers (/api/v1/hr/me/app, /me/push-token).
 * `protect` + hrRateLimit are applied by routes/hr/index.js.
 *
 *   GET    /me/app         what this login may do in the app (Approvals tab)
 *   PUT    /me/push-token  { deviceId, token, platform } — this install's Expo token
 *   DELETE /me/push-token  { deviceId } — on sign-out
 *
 * `canApprove` mirrors the server's real checks; it only decides whether the
 * app SHOWS the tab. Every decide route still checks on its own (404/403).
 */
import express from 'express';
import { asyncHandler } from '../../middleware/errorMiddleware.js';
import { loadSelfEmployee, isHrOrAdmin, isActiveStaffUser } from '../../middleware/hrAuth.js';
import { registerPushToken, unregisterPushToken } from '../../services/hr/notify/index.js';

const router = express.Router();

/** Pure so it is unit-tested with the route checks it mirrors. */
export function appCapabilities(user) {
  const hr = isHrOrAdmin(user);
  const head = isActiveStaffUser(user) && user.staff?.isHead === true;
  return {
    canApprove: {
      leave: hr || head, // GET /leave/inbox: head step for their team, HR step for HR
      fixDay: hr, // POST /corrections/:id/decide is HR/admin only
      overtime: hr || head, // OT approval: HR, or the employee's team head (contract)
    },
    isHr: hr,
    isHead: head,
  };
}

router.get('/me/app', (req, res) => {
  res.json({ success: true, ...appCapabilities(req.user) });
});

const send = (res, err, next) => (err?.statusCode && err.expose
  ? res.status(err.statusCode).json({ success: false, message: err.message })
  : next(err));

router.put('/me/push-token', loadSelfEmployee, asyncHandler(async (req, res, next) => {
  try {
    res.json({ success: true, ...await registerPushToken(req.employee, req.user, req.body || {}) });
  } catch (err) { send(res, err, next); }
}));

router.delete('/me/push-token', loadSelfEmployee, asyncHandler(async (req, res, next) => {
  try {
    res.json({ success: true, ...await unregisterPushToken(req.employee, req.body?.deviceId) });
  } catch (err) { send(res, err, next); }
}));

export default router;
