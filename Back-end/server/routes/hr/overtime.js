/**
 * /api/v1/hr — overtime approval queue (owner decision 2026-11-26: overtime is
 * paid only once HR or the employee's team head approves it).
 *
 *   GET  /overtime/pending?cursor=&limit=&team=           queue, oldest first
 *   POST /attendance/:dayId/overtime/decide               { decision: 'approve'|'reject', minutes?, note?, overtimeMinutes? }
 *        200 { day, replay }  — replay: true when the same decision was already there
 *
 * `protect` + the HR rate limit run in routes/hr/index.js. Who may decide is
 * checked in services/hr/attendance/overtimeService.js (HR/admin, or the
 * employee's own team head; never your own overtime); everyone else gets 404.
 */
import express from 'express';
import { asyncHandler } from '../../middleware/errorMiddleware.js';
import { listPendingOvertime, decideOvertime } from '../../services/hr/attendance/overtimeService.js';

const router = express.Router();

const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
router.use(['/overtime', '/attendance/:dayId/overtime'], noStore);

router.get('/overtime/pending', asyncHandler(async (req, res) => {
  const { cursor, limit, team } = req.query;
  res.json({ success: true, ...(await listPendingOvertime(req.user, { cursor, limit, team: typeof team === 'string' ? team : undefined })) });
}));

router.post('/attendance/:dayId/overtime/decide', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await decideOvertime(req.user, req.params.dayId, req.body || {}, req)) });
}));

export default router;
