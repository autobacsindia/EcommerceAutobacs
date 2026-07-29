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
} from '../controllers/jobApplicationController.js';

const router = express.Router();

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

export default router;
