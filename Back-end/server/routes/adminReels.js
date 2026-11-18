/**
 * Reels moderation (/api/v1/admin/reels). Admins, and active marketing staff — the
 * same gate as the rest of the marketing content areas (adminOrMarketing).
 * Logic: services/reelService.js.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, adminOrMarketing } from '../middleware/authMiddleware.js';
import reelService from '../services/reelService.js';
import { buildUploadSignature } from '../services/reelMediaService.js';

const router = express.Router();
router.use(protect, adminOrMarketing);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

// GET /admin/reels?status=pending|approved|rejected|removed&cursor=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const page = await reelService.adminList({
    status: req.query.status || 'pending',
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.json({ success: true, ...page });
}));

// POST /admin/reels/upload-signature — team uploads go to the shared team folder
router.post('/upload-signature', asyncHandler(async (req, res) => {
  res.json({ success: true, ...buildUploadSignature({ userId: req.user._id, team: true }) });
}));

// POST /admin/reels { publicId, productId, caption, creatorUserId? } — approved immediately
router.post('/', asyncHandler(async (req, res) => {
  const { publicId, productId, caption, creatorUserId } = req.body || {};
  const { reel, created } = await reelService.teamUpload({
    staffId: req.user._id, creatorUserId, publicId, productId, caption,
  });
  res.status(created ? 201 : 200).json({ success: true, reel });
}));

router.post('/:id/approve', asyncHandler(async (req, res) => {
  res.json({ success: true, reel: await reelService.approveReel(req.params.id, req.user._id) });
}));

router.post('/:id/reject', asyncHandler(async (req, res) => {
  res.json({ success: true, reel: await reelService.rejectReel(req.params.id, req.user._id, req.body?.reason) });
}));

router.post('/:id/remove', asyncHandler(async (req, res) => {
  res.json({ success: true, reel: await reelService.removeReel(req.params.id, req.user._id) });
}));

export default router;
