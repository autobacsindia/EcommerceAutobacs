import { query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';

// Shared query validator for the historical analytics endpoints.
// Accepts a named `period` OR an explicit `from`/`to` ISO date range, plus an optional
// `format` for CSV export. The resolver (utils/analyticsPeriod.js) clamps the range —
// this layer just screens obviously-malformed input.
export const validateAnalyticsQuery = [
  query('period')
    .optional()
    .isIn(['7d', '30d', '90d', '12m'])
    .withMessage('period must be one of 7d, 30d, 90d, 12m'),
  query('from')
    .optional()
    .isISO8601()
    .withMessage('from must be an ISO 8601 date'),
  query('to')
    .optional()
    .isISO8601()
    .withMessage('to must be an ISO 8601 date'),
  query('format')
    .optional()
    .isIn(['json', 'csv'])
    .withMessage('format must be json or csv'),
  validateRequest,
];
