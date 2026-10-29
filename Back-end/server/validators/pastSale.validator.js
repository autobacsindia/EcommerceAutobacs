/**
 * Past (offline) sales validation (express-validator). Pair each chain with
 * `validateRequest`.
 *
 * Shape and bounds only. The sale itself (dates, amounts, phone, GSTIN…) is
 * checked by services/pastSaleInput.cleanSale — the same rules the spreadsheet
 * upload uses — and WHO may do what lives in services/pastSaleService.
 */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

export const validatePastSaleId = [
  param('id').custom(isObjectId).withMessage('Invalid sale id'),
];

export const validatePastSaleBatch = [
  param('batchId').matches(/^[a-f0-9]{16,40}$/).withMessage('Invalid upload id'),
];

const rangeQuery = [
  query('from').optional().custom(isYmd).withMessage('Invalid start date'),
  query('to').optional().custom(isYmd).withMessage('Invalid end date'),
  query('seller').optional().custom((v) => v === 'none' || isObjectId(v)).withMessage('Invalid salesman'),
];

export const validatePastSaleTotals = rangeQuery;

export const validatePastSaleList = [
  ...rangeQuery,
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
  query('q').optional().isString().isLength({ max: 100 }).withMessage('Search is too long'),
  query('deleted').optional().isIn(['0', '1']).withMessage('Invalid filter'),
  query('batch').optional().matches(/^[a-f0-9]{16,40}$/).withMessage('Invalid upload id'),
];

export const validatePastSaleBody = [
  body('items').isArray({ min: 1, max: 100 }).withMessage('Add 1 to 100 items'),
  body('customer').isObject().withMessage('Enter the customer'),
  body('salesUserId').optional({ values: 'null' }).custom((v) => v === 'none' || v === '' || isObjectId(v)).withMessage('Invalid salesman'),
  body('version').optional().isISO8601().withMessage('Invalid version'),
];

export const validatePastSaleUpload = [
  body('salesUserId').optional().custom((v) => v === 'none' || v === '' || isObjectId(v)).withMessage('Invalid salesman'),
];
