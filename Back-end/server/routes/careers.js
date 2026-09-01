/**
 * Careers domain — job postings (roles) and, later, applications.
 *
 * Public read is uncached at the app layer (short list, rate-limited) but sends
 * `static-data` cache-control headers so the CDN/browser can hold it briefly;
 * admin writes bust the `careers` cache tag. Admin CRUD is guarded in-route with
 * protect + admin (the router is mounted under the public browsing rate limit).
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
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

// ── Admin categories (managed section vocabulary for grouping roles) ──
// "/reorder" is declared before "/:id" so the literal wins over the param.
router.get('/admin/categories', protect, admin, asyncHandler(listCategories));
router.post('/admin/categories', protect, admin, asyncHandler(createCategory));
router.put('/admin/categories/reorder', protect, admin, asyncHandler(reorderCategories));
router.put('/admin/categories/:id', protect, admin, asyncHandler(updateCategory));
router.delete('/admin/categories/:id', protect, admin, asyncHandler(deleteCategory));

// ── Admin postings (declared before public "/postings/:slug" so literals win) ──
router.get('/admin/postings', protect, admin, asyncHandler(listAllPostings));
router.get('/admin/postings/:id', protect, admin, asyncHandler(getPostingById));
router.post('/admin/postings', protect, admin, asyncHandler(createPosting));
router.put('/admin/postings/:id', protect, admin, asyncHandler(updatePosting));
router.delete('/admin/postings/:id', protect, admin, asyncHandler(deletePosting));

// ── Admin applications (review inbox) ──
router.get('/admin/applications', protect, admin, asyncHandler(listApplications));
router.get('/admin/applications/:id', protect, admin, asyncHandler(getApplication));
router.patch('/admin/applications/:id', protect, admin, asyncHandler(updateApplication));

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
