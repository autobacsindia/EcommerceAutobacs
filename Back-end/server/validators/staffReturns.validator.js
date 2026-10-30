/**
 * Shape checks for the team-panel return routes (/api/v1/staff/returns). Shape only:
 * who may act, the state machine and every rupee live in services/returnService.js,
 * which re-checks everything against the database.
 */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import {
  RETURN_REASONS, FAULTS, DISPOSITIONS, FAILED_INSPECTION_ACTIONS, SUPPLIER_SETTLEMENT_KINDS, SUPPLIER_MONEY_METHODS,
} from '../config/returnPolicy.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
/** multipart sends booleans as strings. */
const toBool = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : v);
/** multipart sends objects as JSON strings. */
const fromJson = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
};

const QUEUE_KEYS = ['review', 'pickup', 'inspect', 'supplier_pickup', 'refund', 'supplier', 'mine', 'all'];

export const validateReturnList = [
  query('queue').optional().isIn(QUEUE_KEYS).withMessage('Unknown list'),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];

export const validateOwedList = [
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];

export const validateReturnId = [
  param('id').custom(isObjectId).withMessage('Invalid return'),
];

export const validateOrderParam = [
  param('orderId').custom(isObjectId).withMessage('Invalid order'),
];

export const validateReturnFile = [
  param('id').custom(isObjectId).withMessage('Invalid return'),
  param('fileId').custom(isObjectId).withMessage('Invalid file'),
];

const assetRef = (field) => [
  body(`${field}.publicId`).optional().isString().isLength({ max: 300 }).withMessage('Invalid upload'),
];

export const validateRaise = [
  body('orderId').custom(isObjectId).withMessage('Choose the order'),
  body('items').isArray({ min: 1, max: 50 }).withMessage('Choose at least one item'),
  body('items.*.itemId').custom(isObjectId).withMessage('Invalid order line'),
  body('items.*.quantity').isInt({ min: 1, max: 1000 }).withMessage('Quantity must be at least 1'),
  body('items.*.reason').isIn(RETURN_REASONS).withMessage('Choose a reason for each item'),
  body('description').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('Describe the problem (up to 2000 characters)'),
  body('unusedDeclared').optional().isBoolean().withMessage('Invalid declaration'),
  body('images').optional().isArray({ max: 5 }).withMessage('Up to 5 photos'),
  body('images.*.publicId').optional().isString().isLength({ max: 300 }).withMessage('Invalid upload'),
  ...assetRef('video'),
  ...assetRef('proofOfPurchase'),
];

export const validateUploadTargets = [
  body('files').optional().isArray({ max: 10 }).withMessage('Too many files'),
];

const faultMap = (field) => body(field).optional().customSanitizer(fromJson).custom((v) => {
  if (v == null) return true;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid fault choices');
  for (const choice of Object.values(v)) {
    if (choice?.confirmed != null && !FAULTS.includes(choice.confirmed)) throw new Error('Invalid fault');
    if (choice?.note != null && (typeof choice.note !== 'string' || choice.note.length > 500)) throw new Error('Fault note is too long');
  }
  return true;
});

export const validateReview = [
  ...validateReturnId,
  body('decision').isIn(['approve', 'reject']).withMessage('Approve or reject'),
  body('rejectionReason').optional().isString().isLength({ max: 1000 }),
  body('notes').optional().isString().isLength({ max: 1000 }),
  body('destination.kind').optional().isIn(['warehouse', 'supplier']).withMessage('Choose where the item goes'),
  body('destination.supplierName').optional({ values: 'null' }).isString().isLength({ max: 120 }),
  faultMap('faults'),
];

export const validatePickup = [
  ...validateReturnId,
  body('provider').isString().trim().isLength({ min: 1, max: 80 }).withMessage('Enter the courier name'),
  body('trackingNumber').isString().trim().isLength({ min: 1, max: 80 }).withMessage('Enter the tracking / AWB number'),
  body('bookedBy').optional().isIn(['us', 'supplier']),
];

export const validateNote = [
  ...validateReturnId,
  body('note').optional().isString().isLength({ max: 500 }).withMessage('Note is too long'),
];

export const validateRequiredNote = [
  ...validateReturnId,
  body('note').isString().trim().isLength({ min: 1, max: 500 }).withMessage('Say what happened'),
];

export const validateInspection = [
  ...validateReturnId,
  body('passed').customSanitizer(toBool).isBoolean().withMessage('Pass or fail?'),
  body('notes').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('Add a note on what you found'),
  body('disposition').optional({ values: 'falsy' }).isIn(DISPOSITIONS).withMessage('Invalid disposition'),
  body('failAction').optional({ values: 'falsy' }).isIn(FAILED_INSPECTION_ACTIONS).withMessage('Invalid choice'),
  body('pickupCostRupees').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100000 }).withMessage('Enter a valid pickup cost'),
  body('pickupCostReason').optional().isString().isLength({ max: 500 }),
  faultMap('faults'),
];

export const validateSupplierCheck = [
  ...validateReturnId,
  body('passed').customSanitizer(toBool).isBoolean().withMessage('Pass or fail?'),
  body('notes').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('Add the supplier\'s notes'),
];

export const validateClaimParam = [
  ...validateReturnId,
  param('claimId').custom(isObjectId).withMessage('Invalid supplier claim'),
];

export const validateClaimOpen = [
  ...validateReturnId,
  body('supplierName').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Name the supplier'),
  body('orderItemIds').optional().isArray({ max: 50 }),
  body('orderItemIds.*').optional().custom(isObjectId).withMessage('Invalid item'),
];

export const validateClaimAnswer = [
  ...validateClaimParam,
  body('accepted').customSanitizer(toBool).isBoolean().withMessage('Accepted or rejected?'),
  body('reference').optional().isString().isLength({ max: 120 }),
  body('note').optional().isString().isLength({ max: 1000 }),
];

export const validateClaimShipBack = [
  ...validateClaimParam,
  body('courier').isString().trim().isLength({ min: 1, max: 80 }).withMessage('Enter the courier'),
  body('trackingNumber').isString().trim().isLength({ min: 1, max: 80 }).withMessage('Enter the tracking number'),
];

export const validateClaimCheck = [
  ...validateClaimParam,
  body('passed').customSanitizer(toBool).isBoolean().withMessage('Pass or fail?'),
  body('notes').optional().isString().isLength({ max: 1000 }),
];

export const validateClaimPromise = [
  ...validateClaimParam,
  body('kind').isIn(SUPPLIER_SETTLEMENT_KINDS).withMessage('Choose credit note, refund to us, or free replacement'),
  body('amountRupees').optional({ values: 'falsy' }).isFloat({ min: 0, max: 10000000 }).withMessage('Enter a valid amount'),
  body('reference').optional().isString().isLength({ max: 120 }),
];

export const validateClaimMoney = [
  ...validateClaimParam,
  body('method').optional({ values: 'falsy' }).isIn(SUPPLIER_MONEY_METHODS).withMessage('Choose bank or deducted'),
  body('utr').optional().isString().isLength({ max: 120 }),
  body('deductedFromRef').optional().isString().isLength({ max: 20 }),
  body('note').optional().isString().isLength({ max: 500 }),
];
