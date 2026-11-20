import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import { rateLimit } from '../middleware/rate-limit/core.js';
import { getClientIp } from '../middleware/rate-limit/clientIp.js';
import {
  concurrentUploadGuard, attachmentSizeGuard, uploadSlipToRead, handleAttachmentError,
} from '../middleware/uploadMiddleware.js';
import { slipReaderConfig, SLIP_READS_PER_HOUR } from '../config/slipReader.js';
import { readSlip } from '../services/slipReader/slipReaderService.js';

const router = express.Router();

router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// Every read is a paid API call: a per-person cap (the real client IP when there is no user).
export const slipReadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: SLIP_READS_PER_HOUR,
  message: 'You have read a lot of slips in the last hour. Please type the details for now.',
  keyGenerator: (req) => `rate_limit:slip-read:${req.user?.id || getClientIp(req)}`,
});

// GET /slip-reader/status → { enabled } — so a form only offers reading when it is switched on
router.get('/status', (req, res) => {
  res.json({ success: true, enabled: slipReaderConfig().enabled });
});

// POST /slip-reader/read — multipart: slip (one photo or PDF), expectedAmount?, excludeId?
//   → { status: 'read'|'unreadable'|'failed'|'off', fields?, warnings?, token?, message? }
// Suggestions only: nothing is stored, saved or approved here.
router.post('/read', slipReadRateLimit, concurrentUploadGuard, attachmentSizeGuard, uploadSlipToRead, handleAttachmentError,
  asyncHandler(async (req, res) => {
    const { expectedAmount, excludeId } = req.body || {};
    res.json({ success: true, ...(await readSlip(req.user, req.file, { expectedAmount, excludeId })) });
  }));

export default router;
