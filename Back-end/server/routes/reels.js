/**
 * Shoppable reels — public + signed-in endpoints (/api/v1/reels).
 * Contract: side-session notes `reels-plan.md`. Logic: services/reelService.js.
 *
 * Mounted with publicBrowsingRateLimit + optionalAuth (routes/index.js), so `req.user`
 * is set when the caller is signed in; routes that need an account add `protect`.
 * Every action carries its own tighter limiter, keyed on the account or on the real
 * client IP (cf-connecting-ip) — never `req.ip`.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect } from '../middleware/authMiddleware.js';
import { canModerateReels } from '../config/reels.js';
import {
  reelUploadRateLimit,
  reelEngageRateLimit,
  reelViewRateLimit,
  reelAttributeRateLimit,
} from '../middleware/rateLimitMiddleware.js';
import { getClientIp } from '../middleware/rate-limit/clientIp.js';
import reelService from '../services/reelService.js';
import { buildUploadSignature } from '../services/reelMediaService.js';
import { REF_COOKIE_NAME, ATTRIBUTION_WINDOW_DAYS } from '../config/affiliate.js';

const router = express.Router();

const viewerOf = (req) => req.user?._id || null;

/*
  The feed varies by viewer (`viewerLiked`) and by moderation, so it is never cached
  at the edge under a shared key. `private, no-store` until a measured cache earns its
  place (see reels-backend notes).
*/
const noStore = (res) => res.set('Cache-Control', 'private, no-store');

// GET /reels?cursor=&limit= — the public feed
router.get('/', asyncHandler(async (req, res) => {
  noStore(res);
  const page = await reelService.listFeed({ cursor: req.query.cursor, limit: req.query.limit, viewerId: viewerOf(req) });
  res.json({ success: true, ...page });
}));

// GET /reels/mine — the caller's own reels, any status (with reject reason)
router.get('/mine', protect, asyncHandler(async (req, res) => {
  noStore(res);
  const page = await reelService.listMine({ userId: req.user._id, cursor: req.query.cursor, limit: req.query.limit });
  res.json({ success: true, ...page });
}));

// POST /reels/upload-signature — signed params for a direct client → Cloudinary upload
// Body { team: true } asks for the shared team folder (admin panel's team upload) —
// only for the same people who may moderate reels; anyone else gets a 403.
router.post('/upload-signature', protect, reelUploadRateLimit, asyncHandler(async (req, res) => {
  noStore(res);
  const team = req.body?.team === true;
  if (team && !canModerateReels(req.user)) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  res.json({ success: true, ...buildUploadSignature({ userId: req.user._id, team }) });
}));

// POST /reels { publicId, productId, caption } — submit an uploaded video for review
router.post('/', protect, reelUploadRateLimit, asyncHandler(async (req, res) => {
  const { publicId, productId, caption } = req.body || {};
  const { reel, created } = await reelService.createReel({ uploaderId: req.user._id, publicId, productId, caption });
  res.status(created ? 201 : 200).json({ success: true, reel });
}));

// GET /reels/:id — one public reel
router.get('/:id', asyncHandler(async (req, res) => {
  noStore(res);
  const reel = await reelService.getPublicReel(req.params.id, { viewerId: viewerOf(req) });
  res.json({ success: true, reel });
}));

router.post('/:id/like', protect, reelEngageRateLimit, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reelService.likeReel(req.params.id, req.user._id)) });
}));

router.delete('/:id/like', protect, reelEngageRateLimit, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reelService.unlikeReel(req.params.id, req.user._id)) });
}));

router.post('/:id/report', protect, reelEngageRateLimit, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reelService.reportReel(req.params.id, req.user._id, req.body?.reason)) });
}));

// POST /reels/:id/view — public; Redis counter, one per IP per reel per hour
router.post('/:id/view', reelViewRateLimit, asyncHandler(async (req, res) => {
  await reelService.recordView(req.params.id, getClientIp(req));
  res.status(202).json({ success: true });
}));

/*
  POST /reels/:id/attribute — the shopper tapped Add to cart / Buy now on this reel.

  Behaves EXACTLY like clicking the creator's affiliate link: if the creator is an
  active affiliate and is not this shopper, set the same `ab_ref` cookie, with the same
  lifetime and flags, that Front-end/web/src/middleware.ts sets on `?ref=CODE`. Order
  time (affiliateAttributionService.resolveAttribution) then applies the usual
  precedence and re-checks every guard. See reelService.attributionCodeFor for why.

  Takes NO body: nothing the client sends here can name an affiliate or an amount.
  The response is the same whether or not anyone was credited, so it cannot be used
  to discover who is an affiliate.
*/
router.post('/:id/attribute', reelAttributeRateLimit, asyncHandler(async (req, res) => {
  noStore(res);
  const code = await reelService.attributionCodeFor(req.params.id, { viewerId: viewerOf(req) });
  if (code) {
    res.cookie(REF_COOKIE_NAME, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    });
  }
  res.json({ success: true });
}));

export default router;
