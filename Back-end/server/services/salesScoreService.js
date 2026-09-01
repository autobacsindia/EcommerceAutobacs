/**
 * Trailing-sales popularity score for search ranking.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * Until 2026-09-01 the only commercial signals in relevance ranking were
 * `totalReviews`, `averageRating` and an `isFastMoving` boolean. Measured against
 * production: 5 of 931 active products have ANY review or rating, and exactly 3
 * carry `isFastMoving` (a dead feature whose section is never rendered). So the
 * ranking had effectively no commercial input for 99.5% of the catalogue — a
 * product that has never sold ranked identically to the best seller.
 *
 * This computes what every mature storefront ranks on instead: how much a product
 * has actually sold recently.
 *
 * ── Design notes ──────────────────────────────────────────────────────────────
 *
 * - Gated on `paymentStatus: 'paid'`, NOT on order status and NOT on
 *   `purchaseCounted` — the latter is set on a tiny minority of orders and would
 *   silently score almost nothing.
 *
 * - EXPONENTIAL TIME DECAY rather than a flat 90-day count. A flat window makes
 *   ranking lurch every time the window edge crosses a big order; decay makes
 *   yesterday's sale worth meaningfully more than one 80 days ago and changes
 *   smoothly. HALF_LIFE_DAYS is the tuning knob: a sale is worth half as much
 *   after that many days.
 *
 * - Writes with `bulkWrite`, which bypasses Mongoose middleware. That is normally
 *   the bug that drifts a denormalized field, but it is safe here for a specific
 *   reason: Atlas Search indexes the collection itself via change streams, so
 *   there is no separate index to enqueue, and `salesScore` is derived from orders
 *   rather than from anything a hook maintains.
 */
import productRepository from '../repositories/productRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import cacheService from './cacheService.js';

/** A sale is worth half as much after this many days. */
export const HALF_LIFE_DAYS = 30;

/** How far back to look. Beyond ~3 half-lives a sale contributes almost nothing. */
export const LOOKBACK_DAYS = 90;

/**
 * Decay multiplier for a sale `ageInDays` old. Pure so the curve is testable
 * without a database.
 *
 * @param {number} ageInDays
 * @returns {number} 1 for a sale today, 0.5 at one half-life, →0 beyond
 */
export function decayFactor(ageInDays) {
  if (!Number.isFinite(ageInDays) || ageInDays <= 0) return 1;
  return Math.pow(0.5, ageInDays / HALF_LIFE_DAYS);
}

/**
 * Recompute `salesScore` for every product with recent paid sales, and zero it for
 * everything else.
 *
 * Zeroing matters: without it a product that sold well six months ago keeps its
 * score forever and outranks something currently selling. The score is a measure
 * of CURRENT demand, so it has to be able to fall.
 *
 * @returns {Promise<{scored: number, cleared: number, orders: number}>}
 */
export async function recomputeSalesScores() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const rows = await orderRepository.aggregate([
    { $match: { paymentStatus: 'paid', createdAt: { $gte: since } } },
    { $unwind: '$items' },
    // Historical/imported lines may reference a product that no longer exists.
    { $match: { 'items.product': { $ne: null } } },
    {
      $project: {
        product: '$items.product',
        quantity: { $ifNull: ['$items.quantity', 1] },
        ageInDays: {
          $divide: [{ $subtract: [new Date(), '$createdAt'] }, 1000 * 60 * 60 * 24],
        },
      },
    },
    {
      $group: {
        _id: '$product',
        // Decay applied per LINE, inside the aggregation, so the whole computation
        // stays on the server rather than pulling every order line into Node.
        score: {
          $sum: {
            $multiply: [
              '$quantity',
              { $pow: [0.5, { $divide: ['$ageInDays', HALF_LIFE_DAYS] }] },
            ],
          },
        },
      },
    },
  ]);

  const scored = rows.filter((r) => r._id);
  const scoredIds = scored.map((r) => r._id);

  if (scored.length > 0) {
    await productRepository.bulkWriteSalesScores(
      scored.map((r) => ({
        updateOne: {
          filter: { _id: r._id },
          // Rounded: the ranking clause takes log1p of this, so precision beyond a
          // couple of decimals cannot change an ordering and only churns the
          // change stream that feeds the Atlas index.
          update: { $set: { salesScore: Math.round(r.score * 100) / 100 } },
        },
      }))
    );
  }

  // Everything else falls back to zero. Scoped to documents that currently have a
  // non-zero score so this is a small targeted write, not a full-collection update
  // that would churn the change stream on every run.
  const cleared = await productRepository.clearSalesScoresExcept(scoredIds);

  // Ranking changed, so cached listings are now stale. Leaving them to TTL would
  // serve yesterday's ordering for a full cache lifetime.
  try {
    await cacheService.invalidateTags('products');
  } catch (error) {
    console.warn('[SalesScore] Cache invalidation failed:', error.message);
  }

  return {
    scored: scored.length,
    cleared: cleared.modifiedCount ?? 0,
    orders: rows.length,
  };
}

export default { recomputeSalesScores, decayFactor, HALF_LIFE_DAYS, LOOKBACK_DAYS };
