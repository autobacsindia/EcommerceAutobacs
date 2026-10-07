/**
 * Staff access validation (express-validator). Pair each chain with `validateRequest`.
 *
 * Shape and bounds only. WHO may invite or remove whom is a capability rule and
 * lives in staffService, which sees the acting user.
 */

import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES } from '../config/staff.js';
import { isCommonPassword, COMMON_PASSWORD_MESSAGE } from '../config/commonPasswords.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

export const validateTeamQuery = [
  query('team').optional().isIn(STAFF_TEAM_VALUES).withMessage('Unknown team'),
];

export const validateStaffInvite = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Enter a valid email address')
    .isLength({ max: 254 })
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),
  // The account is created from the invite, and User.phone is required.
  body('phone')
    .trim()
    .matches(/^(\+91[\s-]?)?[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number'),
  body('team').optional().isIn(STAFF_TEAM_VALUES).withMessage('Unknown team'),
  body('isHead').optional().isBoolean().withMessage('isHead must be true or false').toBoolean(),
];

export const validateInviteIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid invite id'),
];

export const validateMemberIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid member id'),
];

export const validateInviteToken = [
  query('token').isString().isLength({ min: 20, max: 200 }).withMessage('Invalid invite link'),
];

export const validateAcceptInvite = [
  body('token').isString().isLength({ min: 20, max: 200 }).withMessage('Invalid invite link'),
  body('password')
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters')
    .custom((value) => !isCommonPassword(value))
    .withMessage(COMMON_PASSWORD_MESSAGE),
];

// ── Sales panel ──────────────────────────────────────────────────────────────

export const validateSalesProductSearch = [
  query('q').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Type at least 2 characters'),
];

export const validateCursorQuery = [
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];

export const validateOrderIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
];

/**
 * Shape and bounds only. Prices are NOT trusted from here — the service re-prices
 * every line from the catalogue and only accepts an offer between ₹1 and that price.
 */
export const validateSalesOrder = [
  body('customer.name').trim().isLength({ min: 2, max: 100 }).withMessage('Customer name must be 2–100 characters'),
  body('customer.email').trim().isEmail().withMessage('Enter a valid customer email').isLength({ max: 254 }),
  body('customer.phone').trim().matches(/^(\+91[\s-]?)?[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),
  body('shippingAddress.fullName').optional().trim().isLength({ max: 100 }),
  body('shippingAddress.phone').optional({ values: 'falsy' }).trim().matches(/^(\+91[\s-]?)?[6-9]\d{9}$/).withMessage('Enter a valid delivery phone number'),
  body('shippingAddress.addressLine1').trim().isLength({ min: 3, max: 200 }).withMessage('Enter the delivery address'),
  body('shippingAddress.addressLine2').optional().trim().isLength({ max: 200 }),
  body('shippingAddress.city').trim().isLength({ min: 2, max: 80 }).withMessage('Enter the city'),
  body('shippingAddress.state').trim().isLength({ min: 2, max: 80 }).withMessage('Enter the state'),
  body('shippingAddress.postalCode').trim().matches(/^\d{6}$/).withMessage('Enter a valid 6-digit PIN code'),
  body('items').isArray({ min: 1, max: 30 }).withMessage('Add between 1 and 30 products'),
  body('items.*.product').custom(isObjectId).withMessage('Invalid product'),
  body('items.*.variantId').optional({ values: 'null' }).custom(isObjectId).withMessage('Invalid product option'),
  body('items.*.quantity').isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100').toInt(),
  body('items.*.offerPrice').optional({ values: 'null' }).isFloat({ min: 0, max: 10000000 }).withMessage('Invalid offer price'),
  body('notes').optional().isString().isLength({ max: 1000 }),
];

// ── Team workflow ────────────────────────────────────────────────────────────

export const validateWorkQueue = [
  query('queue').isIn(['procurement', 'decisions', 'refunds', 'deliveries']).withMessage('Unknown work list'),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];

export const validateWorkOrder = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
];

export const validateWorkLine = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
  param('itemId').custom(isObjectId).withMessage('Invalid item'),
];

export const validateWorkParcel = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
  param('shipmentId').custom(isObjectId).withMessage('Invalid parcel'),
];

export const validateStockUpdate = [
  ...validateWorkLine,
  body('stock').isIn(['in_stock', 'ordered', 'out_of_stock']).withMessage('Unknown stock status'),
  body('supplierName').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 })
    .withMessage('Supplier name is too long'),
];

export const validatePaymentInitiated = [
  ...validateWorkLine,
  body('initiated').isBoolean().withMessage('initiated must be true or false').toBoolean(),
];

export const validateShipWithProof = [
  ...validateWorkOrder,
  // Multipart fields arrive as strings; item ids as a JSON array or comma list.
  body('itemIds').optional({ values: 'falsy' }).customSanitizer((v) => {
    if (Array.isArray(v)) return v;
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : [v]; } catch { return String(v).split(','); }
  }).custom((v) => Array.isArray(v) && v.length <= 50 && v.every(isObjectId)).withMessage('Invalid items'),
  body('courierName').optional({ values: 'falsy' }).isString().trim().isLength({ max: 80 }).withMessage('Courier name is too long'),
  body('trackingNumber').optional({ values: 'falsy' }).isString().trim().isLength({ max: 80 }).withMessage('Tracking number is too long'),
];

export const validateCustomerDecision = [
  ...validateWorkLine,
  body('decision').isIn(['wait', 'refund']).withMessage('Choose "will wait" or "wants a refund"'),
  body('note').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
];

export const validateRefundReview = [
  ...validateWorkLine,
  body('approve').isBoolean().withMessage('Approve or send back').toBoolean(),
  body('note').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
];

export const validateMarkDelivered = [
  ...validateWorkOrder,
  body('shipmentId').optional({ values: 'falsy' }).custom(isObjectId).withMessage('Invalid parcel'),
];
