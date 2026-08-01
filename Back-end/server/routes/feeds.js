/**
 * Public marketing feeds (Meta catalogue, Google Merchant Center).
 *
 * These are pulled on a schedule by external platforms (Meta Commerce Manager,
 * Google Merchant Center), not by browsers, so each is cached in-process for
 * *_FEED_CACHE_SECONDS to shield Mongo from a burst of pulls across instances.
 * The document is the full current catalogue every time, so serving a slightly
 * stale copy is harmless.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { publicBrowsingRateLimit } from '../middleware/rateLimitMiddleware.js';
import productRepository from '../repositories/productRepository.js';
import { buildMetaCatalogFeed } from '../services/metaFeedService.js';
import { buildGoogleMerchantFeed } from '../services/googleFeedService.js';

const router = express.Router();

const ttlMs = (envValue) => (parseInt(envValue, 10) || 1800) * 1000;

// One cache entry per feed, keyed by route. Both feeds derive from the same
// findForFeed() read but have independent TTLs and build costs, so they must not
// share a slot (the second feed would otherwise serve the first feed's XML).
const caches = new Map();

/**
 * Serve a cached feed document, rebuilding when its TTL has expired.
 * @param {string} key    cache slot (the feed's filename)
 * @param {number} ttl    milliseconds
 * @param {(products: Array) => string} build
 */
function serveFeed(key, ttl, build) {
  return asyncHandler(async (_req, res) => {
    const now = Date.now();
    const cached = caches.get(key);
    if (!cached || now - cached.builtAt > ttl) {
      const products = await productRepository.findForFeed();
      caches.set(key, { xml: build(products), builtAt: now });
    }
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', `public, max-age=${Math.floor(ttl / 1000)}`);
    res.send(caches.get(key).xml);
  });
}

// @route   GET /feeds/meta-catalog.xml
// @desc    Meta (Facebook/Instagram) product catalogue feed (RSS 2.0, g: namespace)
// @access  Public (consumed by Meta Commerce Manager on a schedule)
router.get(
  '/meta-catalog.xml',
  publicBrowsingRateLimit,
  serveFeed('meta-catalog.xml', ttlMs(process.env.META_FEED_CACHE_SECONDS), (products) =>
    buildMetaCatalogFeed(products)
  )
);

// @route   GET /feeds/google-merchant.xml
// @desc    Google Merchant Center product feed (RSS 2.0, g: namespace)
// @access  Public (consumed by Merchant Center scheduled fetch)
router.get(
  '/google-merchant.xml',
  publicBrowsingRateLimit,
  serveFeed('google-merchant.xml', ttlMs(process.env.GOOGLE_FEED_CACHE_SECONDS), (products) =>
    buildGoogleMerchantFeed(products)
  )
);

// Test/ops hook: drop the in-process caches so the next pull rebuilds immediately.
export function _resetFeedCache() {
  caches.clear();
}

export default router;
