import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { getSlugRedirectMap } from '../services/slugRedirectService.js';

const router = express.Router();

// @route   GET /redirects/slugs
// @desc    Old slug → current slug for renamed products/categories/brands/blog
//          posts. Read by the frontend middleware, which 301s the old URL.
// @access  Public — it only exposes old URLs of pages that are public anyway.
//
// Short shared cache: the middleware refreshes its copy every few minutes, so a
// rename starts redirecting within ~5 min with no purge wiring to keep in step.
router.get('/slugs', asyncHandler(async (_req, res) => {
  const map = await getSlugRedirectMap();
  res.set('Cache-Control', 'public, max-age=120');
  res.json({ success: true, ...map });
}));

export default router;
