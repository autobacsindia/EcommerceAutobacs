/**
 * /api/v1/hr — attendance + face routes (docs/ADR-hr-system.md §4).
 *
 * `protect` (token + sessionVersion → 401) and the HR rate limit are applied in
 * routes/hr/index.js. EVERY route below adds its own access rule from
 * middleware/hrAuth.js: `loadSelfEmployee` for the app's /me routes, `hrOrAdmin`
 * for HR screens, `requireEmployeeAccess(scope)` for per-employee reads (a
 * caller who may not see that employee gets the same 404 as a missing one).
 * Punch and face routes add `hrPunchRateLimit`.
 *
 * Refused punches answer 422 { success:false, code, message, ...details }.
 */
import express from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/errorMiddleware.js';
import {
  hrOrAdmin, requireEmployeeAccess, loadSelfEmployee,
} from '../../middleware/hrAuth.js';
import { hrPunchRateLimit } from '../../middleware/rate-limit/index.js';
import { getClientIp } from '../../middleware/rate-limit/clientIp.js';
import { AttendanceRefusal } from '../../services/hr/attendance/errors.js';
import {
  listSites, createSite, updateSite, listShifts, createShift, updateShift,
} from '../../services/hr/attendance/setupService.js';
import { punch, requestReview, hrManualPunch } from '../../services/hr/attendance/punchService.js';
import {
  createCorrection, listCorrections, listMyCorrections, cancelMyCorrection, decideCorrection,
} from '../../services/hr/attendance/correctionService.js';
import {
  listReviewPunches, reviewPhotoUrl, decidePunch, approveOvertime,
} from '../../services/hr/attendance/reviewService.js';
import { monthView, todayBoard, myStatus } from '../../services/hr/attendance/viewService.js';
import { listDevices, approveDevice, revokeDevices } from '../../services/hr/attendance/devices.js';
import {
  issueChallenge, giveConsent, enrol, withdraw, allowReenrol, faceStatus,
} from '../../services/hr/face/faceService.js';
import { MAX_FRAMES, MAX_FRAME_BYTES } from '../../services/hr/face/constants.js';
import { istDate, monthOf } from '../../services/hr/attendance/time.js';

const router = express.Router();

// Attendance data is personal: never cached anywhere.
const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const frameUpload = (max) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FRAME_BYTES, files: max, fields: 30, fieldSize: 4 * 1024 },
  fileFilter: (req, file, cb) => (IMAGE_TYPES.has(String(file.mimetype).toLowerCase())
    ? cb(null, true) : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'type'), false)),
}).array('frames', max);

/** multer errors → plain 400s (bytes are checked again in the service). */
const uploadErrors = (err, req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);
  let message = 'The photos could not be read. Please try again.';
  if (err.code === 'LIMIT_FILE_SIZE') message = 'A face photo is too large (1.5 MB maximum).';
  else if (err.code === 'LIMIT_FILE_COUNT') message = `Send at most ${MAX_FRAMES} photos.`;
  else if (err.code === 'LIMIT_UNEXPECTED_FILE') message = 'Face photos must be JPG or PNG.';
  return res.status(400).json({ success: false, message });
};
const withFrames = (max) => [(req, res, next) => frameUpload(max)(req, res, (err) => (err ? uploadErrors(err, req, res, next) : next()))];
const frames = (req) => (req.files || []).map((f) => f.buffer);

/** Like asyncHandler, but a refusal becomes 422 with its reason code. */
const handle = (fn) => asyncHandler(async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err instanceof AttendanceRefusal) {
      return res.status(422).json({
        success: false, code: err.code, message: err.message, ...err.extra,
      });
    }
    throw err;
  }
});

router.use(['/sites', '/shifts', '/me/punches', '/me/attendance', '/me/face', '/me/corrections', '/corrections',
  '/punches', '/attendance', '/employees/:employeeId/attendance', '/employees/:employeeId/face',
  '/employees/:employeeId/devices', '/employees/:employeeId/punches'], noStore);

// ── Sites & shifts (HR/admin) ────────────────────────────────────────────────
router.get('/sites', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await listSites(req.query)) });
}));
router.post('/sites', hrOrAdmin, handle(async (req, res) => {
  res.status(201).json({ success: true, site: await createSite(req.user, req.body || {}, req) });
}));
router.patch('/sites/:id', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, site: await updateSite(req.user, req.params.id, req.body || {}, req) });
}));
router.get('/shifts', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await listShifts(req.query)) });
}));
router.post('/shifts', hrOrAdmin, handle(async (req, res) => {
  res.status(201).json({ success: true, shift: await createShift(req.user, req.body || {}, req) });
}));
router.patch('/shifts/:id', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, shift: await updateShift(req.user, req.params.id, req.body || {}, req) });
}));

// ── The app: status, face, punches, corrections ──────────────────────────────
router.get('/me/attendance/status', loadSelfEmployee, handle(async (req, res) => {
  res.json({ success: true, ...(await myStatus(req.employee)) });
}));
router.get('/me/attendance', loadSelfEmployee, handle(async (req, res) => {
  res.json({ success: true, ...(await monthView(req.employee, req.query.month || monthOf(istDate(new Date())))) });
}));

router.get('/me/face', loadSelfEmployee, handle(async (req, res) => {
  res.json({ success: true, face: await faceStatus(req.employee._id) });
}));
router.post('/me/face/challenge', hrPunchRateLimit, loadSelfEmployee, handle(async (req, res) => {
  res.status(201).json({ success: true, challenge: await issueChallenge(req.employee, req.body?.purpose || 'punch') });
}));
router.post('/me/face/consent', hrPunchRateLimit, loadSelfEmployee, handle(async (req, res) => {
  const face = await giveConsent(req.employee, {
    version: req.body?.version, deviceId: req.body?.deviceId, ip: getClientIp(req),
  }, req.user, req);
  res.json({ success: true, face });
}));
router.post('/me/face/enrol', hrPunchRateLimit, loadSelfEmployee, ...withFrames(MAX_FRAMES), handle(async (req, res) => {
  const face = await enrol(req.employee, {
    challengeId: req.body?.challengeId, frames: frames(req), mirrored: req.body?.mirrored === 'true' || req.body?.mirrored === true,
  }, req.user, req);
  res.json({ success: true, face });
}));
router.delete('/me/face', loadSelfEmployee, handle(async (req, res) => {
  res.json({ success: true, face: await withdraw(req.employee, req.user, req) });
}));

router.post('/me/punches', hrPunchRateLimit, loadSelfEmployee, ...withFrames(MAX_FRAMES), handle(async (req, res) => {
  const out = await punch(req.employee, req.body || {}, frames(req), { actor: req.user, req });
  res.status(out.replay ? 200 : 201).json({ success: true, punch: out.punch, day: out.day, replay: out.replay });
}));
router.post('/me/punches/:clientPunchId/review', hrPunchRateLimit, loadSelfEmployee, ...withFrames(1), handle(async (req, res) => {
  const out = await requestReview(req.employee, req.params.clientPunchId, frames(req)[0], { actor: req.user, req });
  res.status(out.replay ? 200 : 201).json({ success: true, punch: out.punch, day: out.day, replay: out.replay });
}));

router.get('/me/corrections', loadSelfEmployee, handle(async (req, res) => {
  res.json({ success: true, ...(await listMyCorrections(req.employee, req.query)) });
}));
router.post('/me/corrections', loadSelfEmployee, handle(async (req, res) => {
  const out = await createCorrection(req.employee, req.user, req.body || {}, req);
  res.status(out.replay ? 200 : 201).json({ success: true, correction: out.correction, replay: out.replay });
}));
router.post('/me/corrections/:id/cancel', loadSelfEmployee, handle(async (req, res) => {
  res.json({ success: true, correction: await cancelMyCorrection(req.employee, req.user, req.params.id, req) });
}));

// ── HR: corrections, review inbox, today ─────────────────────────────────────
router.get('/corrections', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await listCorrections(req.query)) });
}));
router.post('/corrections/:id/decide', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await decideCorrection(req.user, req.params.id, req.body || {}, req)) });
}));
router.get('/punches/review', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await listReviewPunches(req.query)) });
}));
router.get('/punches/:id/photo', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await reviewPhotoUrl(req.params.id)) });
}));
router.post('/punches/:id/decide', hrOrAdmin, handle(async (req, res) => {
  res.json({ success: true, ...(await decidePunch(req.user, req.params.id, req.body || {}, req)) });
}));
// HR/admin all; a team head their own team (decided in the service).
router.get('/attendance/today', handle(async (req, res) => {
  res.json({ success: true, ...(await todayBoard(req.user, req.query)) });
}));

// ── Per employee ─────────────────────────────────────────────────────────────
router.get('/employees/:employeeId/attendance', requireEmployeeAccess('attendance'), handle(async (req, res) => {
  res.json({ success: true, ...(await monthView(req.employee, req.query.month || monthOf(istDate(new Date())))) });
}));
router.post('/employees/:employeeId/attendance/:date/overtime', hrOrAdmin, requireEmployeeAccess('attendance'), handle(async (req, res) => {
  const day = await approveOvertime(req.user, req.employee._id, req.params.date, req.body || {}, req);
  res.json({ success: true, day });
}));
router.post('/employees/:employeeId/punches', hrOrAdmin, requireEmployeeAccess('attendance'), handle(async (req, res) => {
  const out = await hrManualPunch(req.user, req.employee, req.body || {}, req);
  res.status(out.replay ? 200 : 201).json({ success: true, punch: out.punch, day: out.day, replay: out.replay });
}));
router.get('/employees/:employeeId/face', requireEmployeeAccess('face'), handle(async (req, res) => {
  res.json({ success: true, face: await faceStatus(req.employee._id) });
}));
router.post('/employees/:employeeId/face/allow-reenrol', hrOrAdmin, requireEmployeeAccess('face'), handle(async (req, res) => {
  res.json({ success: true, face: await allowReenrol(req.employee, req.user, req) });
}));
router.get('/employees/:employeeId/devices', hrOrAdmin, requireEmployeeAccess('attendance'), handle(async (req, res) => {
  res.json({ success: true, items: await listDevices(req.employee._id) });
}));
router.post('/employees/:employeeId/devices/:deviceId/approve', hrOrAdmin, requireEmployeeAccess('attendance'), handle(async (req, res) => {
  res.json({ success: true, device: await approveDevice(req.user, req.employee, req.params.deviceId, req) });
}));
router.post('/employees/:employeeId/devices/revoke', hrOrAdmin, requireEmployeeAccess('attendance'), handle(async (req, res) => {
  res.json({ success: true, ...(await revokeDevices(req.employee._id, null, { actor: req.user, reason: String(req.body?.reason || 'revoked by HR') })) });
}));

export default router;
