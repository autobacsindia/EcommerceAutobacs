/*
 * Analytics aggregation reads models directly (like services/dashboardAnalyticsService.js)
 * so each pipeline can carry an explicit `.option({ maxTimeMS })` guard — baseRepository's
 * generic aggregate() executes immediately and can't attach per-call options. These are
 * read-only reporting aggregations, never writes, so the repository write-path guarantees
 * (transactions, soft-delete) don't apply.
 */
/* eslint-disable no-restricted-imports */
import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import KarmaLedger from '../models/KarmaLedger.js';
import CouponRedemption from '../models/CouponRedemption.js';
import cacheService from './cacheService.js';
import { QUERY_TIMEOUTS } from '../config/db.js';
import { STOCK_STATUS } from '../utils/stockStatus.js';

// Statuses that count as a realised sale (money made). Mirrors dashboardAnalyticsService
// so revenue figures stay consistent across the operational dashboard and these historical
// reports, and so the many cancelled/failed historical WooCommerce orders (ADR-005) are excluded.
const SALE_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered'];

const CACHE_TTL_SECONDS = 300; // 5 min — analytics tolerate staleness; protects the DB.

// MongoDB $dateTrunc unit per chart granularity.
const TRUNC_UNIT = { day: 'day', week: 'week', month: 'month' };

const r2 = (n) => Math.round((n || 0) * 100) / 100;

/**
 * Historical analytics service.
 *
 * Distinct from dashboardAnalyticsService (real-time SSE "now" view): every method here is
 * window-parameterised and Redis-cached. Pipelines are guarded with maxTimeMS and matched on
 * the indexed { status, createdAt } prefix where possible. All money is in rupees, matching
 * Order.totalAmount / items[].price (paise lives in pricingService, not here).
 */
class AnalyticsReportService {
  /**
   * Cache wrapper. Falls back to computing directly if the cache layer throws, so a Redis
   * outage degrades to "slower", never "broken".
   * @param {string} domain
   * @param {{from: Date, to: Date}} window
   * @param {Function} fn
   */
  async cached(domain, window, fn) {
    const key = cacheService.generateKey(`analytics:${domain}`, {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      g: window.granularity,
    });
    try {
      return await cacheService.wrap(key, fn, { ttl: CACHE_TTL_SECONDS, tags: ['analytics'] });
    } catch (err) {
      console.warn(`[analytics] cache wrap failed for ${domain}, computing direct:`, err.message);
      return fn();
    }
  }

  agg(model, pipeline) {
    return model.aggregate(pipeline).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });
  }

  // Sum of realised revenue + order count for a window. Used for KPI totals and deltas.
  async revenueTotals(from, to) {
    const [row] = await this.agg(Order, [
      { $match: { status: { $in: SALE_STATUSES }, createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: null, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
    ]);
    const revenue = row?.revenue || 0;
    const orders = row?.orders || 0;
    return { revenue: r2(revenue), orders, aov: orders ? r2(revenue / orders) : 0 };
  }

  // ── Sales & revenue trends ────────────────────────────────────────────────
  async getSalesTrends(window) {
    return this.cached('sales', window, async () => {
      const unit = TRUNC_UNIT[window.granularity];
      const [series, current, previous] = await Promise.all([
        this.agg(Order, [
          {
            $match: {
              status: { $in: SALE_STATUSES },
              createdAt: { $gte: window.from, $lt: window.to },
            },
          },
          {
            $group: {
              _id: { $dateTrunc: { date: '$createdAt', unit } },
              revenue: { $sum: '$totalAmount' },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              _id: 0,
              bucket: '$_id',
              revenue: { $round: ['$revenue', 2] },
              orders: 1,
              aov: {
                $cond: [{ $gt: ['$orders', 0] }, { $round: [{ $divide: ['$revenue', '$orders'] }, 2] }, 0],
              },
            },
          },
        ]),
        this.revenueTotals(window.from, window.to),
        this.revenueTotals(window.prevFrom, window.prevTo),
      ]);

      return {
        granularity: window.granularity,
        series,
        totals: current,
        previous,
        deltas: {
          revenuePct: pctChange(current.revenue, previous.revenue),
          ordersPct: pctChange(current.orders, previous.orders),
          aovPct: pctChange(current.aov, previous.aov),
        },
      };
    });
  }

  // ── Revenue breakdown by category & brand ─────────────────────────────────
  async getRevenueBreakdown(window) {
    return this.cached('breakdown', window, async () => {
      const matchSale = {
        status: { $in: SALE_STATUSES },
        createdAt: { $gte: window.from, $lt: window.to },
      };

      const [byCategory, byBrand] = await Promise.all([
        this.agg(Order, [
          { $match: matchSale },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.product',
              revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
              units: { $sum: '$items.quantity' },
            },
          },
          { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
          { $unwind: '$product' },
          { $unwind: { path: '$product.categories', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: '$product.categories',
              revenue: { $sum: '$revenue' },
              units: { $sum: '$units' },
            },
          },
          { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
          {
            $project: {
              _id: 0,
              name: { $ifNull: [{ $first: '$cat.name' }, 'Uncategorised'] },
              revenue: { $round: ['$revenue', 2] },
              units: 1,
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: 12 },
        ]),
        this.agg(Order, [
          { $match: matchSale },
          { $unwind: '$items' },
          { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'product' } },
          { $unwind: '$product' },
          {
            $group: {
              _id: { $ifNull: ['$product.brand', 'Unbranded'] },
              revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
              units: { $sum: '$items.quantity' },
            },
          },
          { $project: { _id: 0, name: '$_id', revenue: { $round: ['$revenue', 2] }, units: 1 } },
          { $sort: { revenue: -1 } },
          { $limit: 12 },
        ]),
      ]);

      return { byCategory, byBrand };
    });
  }

  // ── Product performance ───────────────────────────────────────────────────
  async getProductPerformance(window) {
    return this.cached('products', window, async () => {
      const matchSale = {
        status: { $in: SALE_STATUSES },
        createdAt: { $gte: window.from, $lt: window.to },
      };

      const topPipeline = (sortField) => [
        { $match: matchSale },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
            units: { $sum: '$items.quantity' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { [sortField]: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            productId: '$_id',
            name: 1,
            revenue: { $round: ['$revenue', 2] },
            units: 1,
            orders: 1,
          },
        },
      ];

      const [topByRevenue, topByUnits, stockMix] = await Promise.all([
        this.agg(Order, topPipeline('revenue')),
        this.agg(Order, topPipeline('units')),
        this.agg(Product, [
          { $match: { isActive: true } },
          { $group: { _id: '$stock', count: { $sum: 1 } } },
        ]),
      ]);

      const stock = {
        [STOCK_STATUS.IN]: 0,
        [STOCK_STATUS.LOW]: 0,
        [STOCK_STATUS.OUT]: 0,
        [STOCK_STATUS.BACKORDER]: 0,
      };
      stockMix.forEach((row) => {
        if (row._id in stock) stock[row._id] = row.count;
      });

      return { topByRevenue, topByUnits, stock };
    });
  }

  // ── Customer insights ─────────────────────────────────────────────────────
  async getCustomerInsights(window) {
    return this.cached('customers', window, async () => {
      const matchSale = {
        status: { $in: SALE_STATUSES },
        createdAt: { $gte: window.from, $lt: window.to },
        user: { $ne: null },
      };
      const unit = TRUNC_UNIT[window.granularity];

      const [perCustomer, cohorts, totalCustomers] = await Promise.all([
        // Orders per identified customer within the window → new vs returning + AOV/customer.
        this.agg(Order, [
          { $match: matchSale },
          { $group: { _id: '$user', orders: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
          {
            $group: {
              _id: null,
              customers: { $sum: 1 },
              returning: { $sum: { $cond: [{ $gt: ['$orders', 1] }, 1, 0] } },
              revenue: { $sum: '$revenue' },
            },
          },
        ]),
        // Registration cohorts in the window.
        this.agg(User, [
          { $match: { role: { $ne: 'admin' }, createdAt: { $gte: window.from, $lt: window.to } } },
          { $group: { _id: { $dateTrunc: { date: '$createdAt', unit } }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, bucket: '$_id', count: 1 } },
        ]),
        User.countDocuments({ role: { $ne: 'admin' } }),
      ]);

      const pc = perCustomer[0] || { customers: 0, returning: 0, revenue: 0 };
      return {
        activeCustomers: pc.customers,
        returningCustomers: pc.returning,
        newCustomers: pc.customers - pc.returning,
        repeatRatePct: pc.customers ? r2((pc.returning / pc.customers) * 100) : 0,
        revenuePerCustomer: pc.customers ? r2(pc.revenue / pc.customers) : 0,
        totalCustomers,
        registrationCohorts: cohorts,
      };
    });
  }

  // ── Geographic distribution ───────────────────────────────────────────────
  async getGeoDistribution(window) {
    return this.cached('geo', window, async () => {
      const matchSale = {
        status: { $in: SALE_STATUSES },
        createdAt: { $gte: window.from, $lt: window.to },
      };
      const [byState, topCities] = await Promise.all([
        this.agg(Order, [
          { $match: matchSale },
          {
            $group: {
              _id: { $ifNull: ['$shippingAddress.state', 'Unknown'] },
              orders: { $sum: 1 },
              revenue: { $sum: '$totalAmount' },
            },
          },
          { $project: { _id: 0, state: '$_id', orders: 1, revenue: { $round: ['$revenue', 2] } } },
          { $sort: { revenue: -1 } },
          { $limit: 20 },
        ]),
        this.agg(Order, [
          { $match: matchSale },
          {
            $group: {
              _id: { $ifNull: ['$shippingAddress.city', 'Unknown'] },
              orders: { $sum: 1 },
              revenue: { $sum: '$totalAmount' },
            },
          },
          { $project: { _id: 0, city: '$_id', orders: 1, revenue: { $round: ['$revenue', 2] } } },
          { $sort: { revenue: -1 } },
          { $limit: 10 },
        ]),
      ]);
      return { byState, topCities };
    });
  }

  // ── Loyalty, coupons & discount impact ────────────────────────────────────
  async getLoyaltyAndCoupons(window) {
    return this.cached('loyalty', window, async () => {
      const inWindow = { createdAt: { $gte: window.from, $lt: window.to } };
      const matchSale = { status: { $in: SALE_STATUSES }, ...inWindow };

      const [topCoupons, couponTotals, karmaByType, discountImpact] = await Promise.all([
        this.agg(CouponRedemption, [
          { $match: inWindow },
          {
            $group: {
              _id: '$code',
              uses: { $sum: 1 },
              discount: { $sum: '$discountAmount' },
            },
          },
          {
            $project: {
              _id: 0,
              code: '$_id',
              uses: 1,
              discount: { $round: ['$discount', 2] },
              avgDiscount: { $round: [{ $divide: ['$discount', '$uses'] }, 2] },
            },
          },
          { $sort: { uses: -1 } },
          { $limit: 10 },
        ]),
        this.agg(CouponRedemption, [
          { $match: inWindow },
          { $group: { _id: null, uses: { $sum: 1 }, discount: { $sum: '$discountAmount' } } },
        ]),
        // Karma velocity: points moved by ledger type.
        this.agg(KarmaLedger, [
          { $match: inWindow },
          { $group: { _id: '$type', points: { $sum: '$points' }, entries: { $sum: 1 } } },
          { $project: { _id: 0, type: '$_id', points: 1, entries: 1 } },
        ]),
        // Discount impact on realised orders: coupon vs karma vs gross.
        this.agg(Order, [
          { $match: matchSale },
          {
            $group: {
              _id: null,
              gross: { $sum: '$subtotal' },
              couponDiscount: { $sum: '$couponDiscount' },
              karmaDiscount: { $sum: '$karmaDiscount' },
              net: { $sum: '$totalAmount' },
            },
          },
        ]),
      ]);

      const ct = couponTotals[0] || { uses: 0, discount: 0 };
      const di = discountImpact[0] || { gross: 0, couponDiscount: 0, karmaDiscount: 0, net: 0 };
      const totalDiscount = (di.couponDiscount || 0) + (di.karmaDiscount || 0);

      const karma = { earn: 0, redeem: 0, expire: 0, reverse: 0, adjust: 0 };
      karmaByType.forEach((row) => {
        if (row.type in karma) karma[row.type] = row.points;
      });

      return {
        coupons: {
          totalUses: ct.uses,
          totalDiscount: r2(ct.discount),
          avgDiscount: ct.uses ? r2(ct.discount / ct.uses) : 0,
          top: topCoupons,
        },
        karma: {
          earned: karma.earn,
          redeemed: Math.abs(karma.redeem),
          expired: Math.abs(karma.expire),
          byType: karmaByType,
        },
        discountImpact: {
          gross: r2(di.gross),
          couponDiscount: r2(di.couponDiscount),
          karmaDiscount: r2(di.karmaDiscount),
          totalDiscount: r2(totalDiscount),
          discountRatePct: di.gross ? r2((totalDiscount / di.gross) * 100) : 0,
        },
      };
    });
  }

  // ── Returns, refunds, payments & fulfilment SLA ───────────────────────────
  async getReturnsAndPayments(window) {
    return this.cached('returns', window, async () => {
      const inWindow = { createdAt: { $gte: window.from, $lt: window.to } };

      const [returnReasons, refundMethods, payments, sla, saleCount] = await Promise.all([
        this.agg(Order, [
          { $match: { 'returnRequest.requestedAt': { $gte: window.from, $lt: window.to } } },
          { $group: { _id: { $ifNull: ['$returnRequest.reason', 'unspecified'] }, count: { $sum: 1 } } },
          { $project: { _id: 0, reason: '$_id', count: 1 } },
          { $sort: { count: -1 } },
        ]),
        this.agg(Order, [
          { $match: { 'refundDetails.requestedAt': { $gte: window.from, $lt: window.to } } },
          {
            $group: {
              _id: { $ifNull: ['$refundDetails.refundMethod', 'unspecified'] },
              count: { $sum: 1 },
              amount: { $sum: '$refundDetails.amount' },
            },
          },
          { $project: { _id: 0, method: '$_id', count: 1, amount: { $round: ['$amount', 2] } } },
          { $sort: { count: -1 } },
        ]),
        // Payment method / gateway mix + success rate.
        this.agg(Payment, [
          { $match: inWindow },
          {
            $group: {
              _id: { method: '$paymentMethod', gateway: '$paymentGateway' },
              count: { $sum: 1 },
              completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
              amount: { $sum: '$amount' },
            },
          },
          {
            $project: {
              _id: 0,
              method: '$_id.method',
              gateway: '$_id.gateway',
              count: 1,
              completed: 1,
              amount: { $round: ['$amount', 2] },
              successRatePct: {
                $cond: [{ $gt: ['$count', 0] }, { $round: [{ $multiply: [{ $divide: ['$completed', '$count'] }, 100] }, 1] }, 0],
              },
            },
          },
          { $sort: { count: -1 } },
        ]),
        // Fulfilment SLA: average hours to ship / deliver for orders delivered in the window.
        this.agg(Order, [
          {
            $match: {
              'fulfillmentMetrics.deliveredAt': { $gte: window.from, $lt: window.to },
            },
          },
          {
            $group: {
              _id: null,
              avgTimeToShip: { $avg: '$fulfillmentMetrics.timeToShip' },
              avgTimeToDeliver: { $avg: '$fulfillmentMetrics.timeToDeliver' },
              delivered: { $sum: 1 },
            },
          },
        ]),
        Order.countDocuments({ status: { $in: SALE_STATUSES }, ...inWindow }),
      ]);

      const totalReturns = returnReasons.reduce((s, r) => s + r.count, 0);
      const slaRow = sla[0] || {};

      return {
        returns: {
          total: totalReturns,
          returnRatePct: saleCount ? r2((totalReturns / saleCount) * 100) : 0,
          reasons: returnReasons,
        },
        refunds: { methods: refundMethods },
        payments,
        fulfillment: {
          avgTimeToShipHours: r2(slaRow.avgTimeToShip || 0),
          avgTimeToDeliverHours: r2(slaRow.avgTimeToDeliver || 0),
          deliveredCount: slaRow.delivered || 0,
        },
      };
    });
  }

  // ── KPI overview (lightweight summary for the page header) ─────────────────
  async getOverview(window) {
    return this.cached('overview', window, async () => {
      const [current, previous] = await Promise.all([
        this.revenueTotals(window.from, window.to),
        this.revenueTotals(window.prevFrom, window.prevTo),
      ]);
      return {
        window: { from: window.from, to: window.to, label: window.label, days: window.days },
        revenue: { value: current.revenue, deltaPct: pctChange(current.revenue, previous.revenue) },
        orders: { value: current.orders, deltaPct: pctChange(current.orders, previous.orders) },
        aov: { value: current.aov, deltaPct: pctChange(current.aov, previous.aov) },
      };
    });
  }
}

/**
 * Percentage change from previous→current, rounded to 1dp. Returns null when there is no
 * prior baseline (avoids a misleading "+100%" / divide-by-zero).
 */
function pctChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export { SALE_STATUSES, pctChange };
export default new AnalyticsReportService();
