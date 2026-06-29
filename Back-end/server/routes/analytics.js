// Autobacs/Back-end/server/routes/analytics.js
//
// Historical analytics REST API — admin only, period/date-range parameterised, Redis-cached
// in the service layer. Architecturally separate from the real-time SSE dashboard
// (routes/dashboard.js): heavy windowed aggregations don't belong on a live 15s tick.
import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { validateAnalyticsQuery } from '../middleware/validators/analytics.js';
import { resolvePeriod } from '../utils/analyticsPeriod.js';
import analyticsReportService from '../services/analyticsReportService.js';

const router = express.Router();

// Every analytics endpoint is admin-gated and shares the same query contract.
router.use(protect, admin);

/**
 * Wrap a service method as a GET handler: resolve the window, run the report, and either
 * return JSON or stream a flat CSV when `?format=csv` and `csvRows` is provided.
 * @param {(window) => Promise<object>} compute
 * @param {{ csvRows?: (data) => Array<object>, csvName?: string }} [opts]
 */
function report(compute, opts = {}) {
  return asyncHandler(async (req, res) => {
    const window = resolvePeriod(req.query);
    const data = await compute(window);

    if (req.query.format === 'csv' && opts.csvRows) {
      const rows = opts.csvRows(data) || [];
      const csv = toCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${opts.csvName || 'analytics'}-${window.label}.csv"`
      );
      return res.send(csv);
    }

    return res.json({ success: true, window: windowMeta(window), data });
  });
}

const svc = analyticsReportService;

router.get('/overview', validateAnalyticsQuery, report((w) => svc.getOverview(w)));

router.get(
  '/sales',
  validateAnalyticsQuery,
  report((w) => svc.getSalesTrends(w), {
    csvName: 'sales-trends',
    csvRows: (d) => d.series,
  })
);

router.get(
  '/revenue-breakdown',
  validateAnalyticsQuery,
  report((w) => svc.getRevenueBreakdown(w))
);

router.get(
  '/products',
  validateAnalyticsQuery,
  report((w) => svc.getProductPerformance(w), {
    csvName: 'top-products',
    csvRows: (d) => d.topByRevenue,
  })
);

router.get(
  '/customers',
  validateAnalyticsQuery,
  report((w) => svc.getCustomerInsights(w))
);

router.get('/geo', validateAnalyticsQuery, report((w) => svc.getGeoDistribution(w), {
  csvName: 'geo-distribution',
  csvRows: (d) => d.byState,
}));

router.get(
  '/loyalty',
  validateAnalyticsQuery,
  report((w) => svc.getLoyaltyAndCoupons(w), {
    csvName: 'top-coupons',
    csvRows: (d) => d.coupons.top,
  })
);

router.get(
  '/returns-payments',
  validateAnalyticsQuery,
  report((w) => svc.getReturnsAndPayments(w))
);

function windowMeta(w) {
  return { from: w.from, to: w.to, label: w.label, days: w.days, granularity: w.granularity };
}

// Minimal, dependency-free CSV serialiser for flat row objects.
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','));
  return lines.join('\n');
}

export default router;
