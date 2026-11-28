/**
 * Careers domain — job postings (roles) and, later, applications.
 *
 * Public read is uncached at the app layer (short list, rate-limited) but sends
 * `static-data` cache-control headers so the CDN/browser can hold it briefly;
 * admin writes bust the `careers` cache tag. The `/admin/*` routes are guarded
 * in-route with protect + careersManager (the router is mounted under the public
 * browsing rate limit).
 *
 * careersManager = an admin (through the full `admin` gate, device-anomaly
 * detection included) OR an active HR-team staff member (hrAuth.isHrUser) —
 * HR runs hiring from the HR panel. Every other role/team is a 403; no token or
 * a revoked one is a 401 from `protect`.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { isAdminUser, hrOrAdmin } from '../middleware/hrAuth.js';
import { cacheMiddleware } from '../middleware/cacheControl.js';
import { contactFormRateLimit, consultationRateLimit } from '../middleware/rateLimitMiddleware.js';
import {
  listOpenPostings,
  getOpenPostingBySlug,
  listAllPostings,
  getPostingById,
  createPosting,
  updatePosting,
  deletePosting,
} from '../controllers/jobPostingController.js';
import {
  getUploadSignature,
  submitApplication,
  listApplications,
  getApplication,
  updateApplication,
  replyToApplication,
  cleanupOrphanedUploads,
} from '../controllers/jobApplicationController.js';
import {
  listCategories,
  createCategory,
  updateCategory,
  reorderCategories,
  deleteCategory,
} from '../controllers/careerCategoryController.js';

const router = express.Router();

// Admin keeps the full `admin` gate; anyone else must pass the HR check.
export const careersManager = (req, res, next) =>
  (isAdminUser(req.user) ? admin(req, res, next) : hrOrAdmin(req, res, next));

// ── Admin categories (managed section vocabulary for grouping roles) ──
// "/reorder" is declared before "/:id" so the literal wins over the param.
router.get('/admin/categories', protect, careersManager, asyncHandler(listCategories));
router.post('/admin/categories', protect, careersManager, asyncHandler(createCategory));
router.put('/admin/categories/reorder', protect, careersManager, asyncHandler(reorderCategories));
router.put('/admin/categories/:id', protect, careersManager, asyncHandler(updateCategory));
router.delete('/admin/categories/:id', protect, careersManager, asyncHandler(deleteCategory));

// ── Admin postings (declared before public "/postings/:slug" so literals win) ──
router.get('/admin/postings', protect, careersManager, asyncHandler(listAllPostings));
router.get('/admin/postings/:id', protect, careersManager, asyncHandler(getPostingById));
router.post('/admin/postings', protect, careersManager, asyncHandler(createPosting));
router.put('/admin/postings/:id', protect, careersManager, asyncHandler(updatePosting));
router.delete('/admin/postings/:id', protect, careersManager, asyncHandler(deletePosting));

// ── Admin applications (review inbox) ──
router.get('/admin/applications', protect, careersManager, asyncHandler(listApplications));
router.get('/admin/applications/:id', protect, careersManager, asyncHandler(getApplication));
router.patch('/admin/applications/:id', protect, careersManager, asyncHandler(updateApplication));
router.post('/admin/applications/:id/reply', protect, careersManager, asyncHandler(replyToApplication));

// ── Public postings ──
router.get('/postings', cacheMiddleware('static-data'), asyncHandler(listOpenPostings));
router.get('/postings/:slug', cacheMiddleware('static-data'), asyncHandler(getOpenPostingBySlug));

// ── Public applications (unauthenticated → stricter, per-endpoint rate limits) ──
// Signature is fetched once per submission; the submit itself is heavily capped.
router.post('/applications/upload-signature', contactFormRateLimit, asyncHandler(getUploadSignature));
router.post('/applications', consultationRateLimit, asyncHandler(submitApplication));
/*
  Cleanup for uploads whose submission never completed. Public because the
  careers form is, and safe because the handler only ever deletes assets under
  autobacs/careers/ that NO application references — see cleanupOrphanedUploads.
  Shares the signature endpoint's limiter: it is called on the same failure path.
*/
router.post('/applications/cleanup', contactFormRateLimit, asyncHandler(cleanupOrphanedUploads));

export default router;
