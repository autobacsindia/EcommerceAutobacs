import express from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import { concurrentUploadGuard } from '../middleware/uploadMiddleware.js';
import {
  submit, verify, reject, listMine, listAll, getOne, getScreenshot, reviewPolicy, mayReview, maySubmit,
  SCREENSHOT_MAX_BYTES,
} from '../services/googleReviewService.js';

/**
 * Google review bonus (/api/v1/google-reviews). Staff and admins only; who may
 * do what is decided in services/googleReviewService.js on every call.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const SCREENSHOT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const uploadScreenshot = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SCREENSHOT_MAX_BYTES, files: 1, fields: 20, fieldSize: 8 * 1024 },
  fileFilter: (req, file, cb) => {
    if (SCREENSHOT_TYPES.has(String(file.mimetype).toLowerCase())) return cb(null, true);
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'type'), false);
  },
}).single('screenshot');

/** The bytes are checked again in the service (magic numbers); this only turns multer's errors into plain 400s. */
const handleUploadError = (err, req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);
  let message = 'That upload could not be read. Please try again.';
  if (err.code === 'LIMIT_FILE_SIZE') message = 'The screenshot is too large (5 MB maximum).';
  else if (err.code === 'LIMIT_FILE_COUNT' || (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field !== 'type')) message = 'Attach one screenshot.';
  else if (err.code === 'LIMIT_UNEXPECTED_FILE') message = 'The screenshot must be a JPG, PNG or WebP image.';
  return res.status(400).json({ success: false, message });
};

// GET /google-reviews/policy — what this person may do, and the points scale
router.get('/policy', asyncHandler(async (req, res) => {
  const policy = await reviewPolicy();
  res.json({ success: true, canSubmit: maySubmit(req.user), canReview: mayReview(req.user), ...policy, maxScreenshotBytes: SCREENSHOT_MAX_BYTES });
}));

// POST /google-reviews — multipart: screenshot, customerName?, customerPhone?, orderRef?, claimedStars?, notes?, submitId
router.post('/', concurrentUploadGuard, uploadScreenshot, handleUploadError, asyncHandler(async (req, res) => {
  const { review, created } = await submit(req.user, req.body || {}, req.file, req);
  res.status(created ? 201 : 200).json({ success: true, review });
}));

// GET /google-reviews/mine?status=&cursor= — my submissions
router.get('/mine', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listMine(req.user, req.query)) });
}));

// GET /google-reviews?status=pending|verified|rejected|all&person=&cursor= — all (reviewers)
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listAll(req.user, req.query)) });
}));

// GET /google-reviews/:id — one submission with its history
router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, review: await getOne(req.user, req.params.id) });
}));

// GET /google-reviews/:id/screenshot — the image (private)
router.get('/:id/screenshot', asyncHandler(async (req, res) => {
  const { buffer, contentType } = await getScreenshot(req.user, req.params.id);
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': 'inline; filename="google-review"',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}));

// POST /google-reviews/:id/verify { stars, points, expectedVersion } — verify, or change the points
router.post('/:id/verify', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await verify(req.user, req.params.id, req.body || {}, req)) });
}));

// POST /google-reviews/:id/reject { reason, expectedVersion } — reject, or unverify (points reversed)
router.post('/:id/reject', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reject(req.user, req.params.id, req.body || {}, req)) });
}));

export default router;
