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
import {
  listOpenPostings,
  getOpenPostingBySlug,
  listAllPostings,
  getPostingById,
  createPosting,
  updatePosting,
  deletePosting,
} from '../controllers/jobPostingController.js';

const router = express.Router();

// ── Admin (declared before the public "/postings/:slug" so literal paths win) ──
router.get('/admin/postings', protect, admin, asyncHandler(listAllPostings));
router.get('/admin/postings/:id', protect, admin, asyncHandler(getPostingById));
router.post('/admin/postings', protect, admin, asyncHandler(createPosting));
router.put('/admin/postings/:id', protect, admin, asyncHandler(updatePosting));
router.delete('/admin/postings/:id', protect, admin, asyncHandler(deletePosting));

// ── Public ──
router.get('/postings', cacheMiddleware('static-data'), asyncHandler(listOpenPostings));
router.get('/postings/:slug', cacheMiddleware('static-data'), asyncHandler(getOpenPostingBySlug));

export default router;
