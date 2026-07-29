/**
 * Public marketing feeds (Meta / Google Merchant style catalogue feeds).
 *
 * These are pulled on a schedule by external platforms (Meta Commerce Manager),
 * not by browsers, so they are cached in-process for META_FEED_CACHE_SECONDS to
 * shield Mongo from a burst of pulls across instances. The document is the full
 * current catalogue every time, so serving a slightly stale copy is harmless.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { publicBrowsingRateLimit } from '../middleware/rateLimitMiddleware.js';
import productRepository from '../repositories/productRepository.js';
import { buildMetaCatalogFeed } from '../services/metaFeedService.js';

const router = express.Router();

const CACHE_TTL_MS = (parseInt(process.env.META_FEED_CACHE_SECONDS, 10) || 1800) * 1000;
let cache = { xml: null, builtAt: 0 };

// @route   GET /feeds/meta-catalog.xml
// @desc    Meta (Facebook/Instagram) product catalogue feed (RSS 2.0, g: namespace)
// @access  Public (consumed by Meta Commerce Manager on a schedule)
router.get(
  '/meta-catalog.xml',
  publicBrowsingRateLimit,
  asyncHandler(async (_req, res) => {
    const now = Date.now();
    if (!cache.xml || now - cache.builtAt > CACHE_TTL_MS) {
      const products = await productRepository.findForFeed();
      cache = { xml: buildMetaCatalogFeed(products), builtAt: now };
    }
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`);
    res.send(cache.xml);
  })
);

// Test/ops hook: drop the in-process cache so the next pull rebuilds immediately.
export function _resetFeedCache() {
  cache = { xml: null, builtAt: 0 };
}

export default router;
