import { body, param, query } from 'express-validator';
import { validateRequest } from '../validateRequest.js';
import mongoose from 'mongoose';
import { OTHER_CARRIER_CODE, MAX_CUSTOM_CARRIER_NAME } from '../../services/orderTrackingService.js';
import { CANCELLATION_REASON_CODES } from '../../config/cancellationReasons.js';

// The customer pop-up's limit; the same bound for the admin forms.
export const MAX_CANCELLATION_NOTES = 500;

/*
  Reason + notes on any cancel request. Checked here, at the door, so a reason the
  service would refuse comes back as a plain 400 BEFORE anything is written — on the
  per-line path the lines used to cancel first and only the roll-up to `cancelled`
  failed, leaving the order with a stale status.
*/
const cancellationReasonRules = [
  body('reason')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isIn(CANCELLATION_REASON_CODES)
    .withMessage('Please choose one of the listed cancellation reasons'),
  body('notes')
    .optional({ values: 'null' })
    .isString()
    .withMessage('Notes must be text')
    .trim()
    .isLength({ max: MAX_CANCELLATION_NOTES })
    .withMessage(`Notes cannot exceed ${MAX_CANCELLATION_NOTES} characters`),
];

export const validateOrder = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),
  body('shippingAddress')
    .notEmpty()
    .withMessage('Shipping address is required'),
  body('shippingAddress.fullName')
    .notEmpty()
    .withMessage('Full name is required in shipping address'),
  body('shippingAddress.phone')
    .notEmpty()
    .withMessage('Phone number is required')
    .bail()
    .custom((value) => {
      // Enforce a dialable Indian mobile. notEmpty() alone let junk like "533201"
      // (6 digits) through — it satisfied the model's required:true, but the CRM's
      // normalizePhone (utils/identity.js) drops anything under 7 digits, so the
      // resulting payment_failed/abandoned lead was created with phone:null and no
      // way for sales to call the customer back. Mirror normalizePhone's "last 10
      // significant digits" logic (tolerating +91/91/0 prefixes and separators) so
      // a phone that passes here is guaranteed to survive normalization downstream.
      const digits = String(value).replace(/\D/g, '');
      const national = digits.length > 10 ? digits.slice(-10) : digits;
      return /^[6-9]\d{9}$/.test(national);
    })
    .withMessage('Enter a valid 10-digit Indian mobile number'),
  body('shippingAddress.addressLine1')
    .notEmpty()
    .withMessage('Address line 1 is required'),
  body('shippingAddress.city')
    .notEmpty()
    .withMessage('City is required'),
  body('shippingAddress.state')
    .notEmpty()
    .withMessage('State is required'),
  body('shippingAddress.postalCode')
    .notEmpty()
    .withMessage('Postal code is required'),
  // discount is intentionally excluded — always ignored server-side
  body('shippingCost')
    .optional()
    .isFloat({ min: 0, max: 10000 })
    .withMessage('shippingCost must be a number between 0 and 10000'),
  body('tax')
    .optional()
    .isFloat({ min: 0, max: 100000 })
    .withMessage('tax must be a non-negative number'),
  validateRequest
];

export const validateOrderStatusUpdate = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['awaiting_payment', 'processing', 'shipped', 'delivered', 'returned', 'cancelled'])
    .withMessage('Invalid order status. Must be one of: awaiting_payment, processing, shipped, delivered, returned, cancelled'),
  body('reason')
    .optional()
    .trim(),
  body('notes')
    .optional()
    .trim(),
  // Tracking is mandatory to move an order to `shipped`; ignored for other
  // transitions. carrierCode must match a supported carrier so the email can
  // build a real "track your package" link.
  body('trackingNumber')
    .if(body('status').equals('shipped'))
    .trim()
    .notEmpty()
    .withMessage('Tracking number is required to mark an order as shipped'),
  body('carrierCode')
    .if(body('status').equals('shipped'))
    .trim()
    .notEmpty()
    .withMessage('Carrier is required to mark an order as shipped'),
  // Free-text courier name, only for the `OTHER` carrier. The service re-checks
  // it (this is the friendly, field-level message).
  body('carrierName')
    .if(body('carrierCode').equals(OTHER_CARRIER_CODE))
    .trim()
    .notEmpty()
    .withMessage('Courier name is required when the carrier is "Other"')
    .isLength({ max: MAX_CUSTOM_CARRIER_NAME })
    .withMessage(`Courier name must be ${MAX_CUSTOM_CARRIER_NAME} characters or fewer`),
  validateRequest
];

export const validateOrderCancellation = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  ...cancellationReasonRules,
  validateRequest
];

// POST /orders/:id/cancellations — the admin per-line cancel.
export const validateLineCancellation = [
  ...cancellationReasonRules,
  validateRequest
];

export const validateBulkStatusUpdate = [
  body('orderIds')
    .isArray({ min: 1 })
    .withMessage('orderIds must be an array with at least one ID'),
  body('orderIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID in list'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['processing', 'shipped', 'delivered', 'returned', 'cancelled'])
    .withMessage('Invalid order status'),
  validateRequest
];

export const validateBulkDelete = [
  body('orderIds')
    .isArray({ min: 1 })
    .withMessage('orderIds must be an array with at least one ID'),
  body('orderIds.*')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID in list'),
  validateRequest
];

export const validateTrackingInfo = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('carrierCode')
    .notEmpty()
    .withMessage('Carrier code is required'),
  body('carrierName')
    .if(body('carrierCode').equals(OTHER_CARRIER_CODE))
    .trim()
    .notEmpty()
    .withMessage('Courier name is required when the carrier is "Other"')
    .isLength({ max: MAX_CUSTOM_CARRIER_NAME })
    .withMessage(`Courier name must be ${MAX_CUSTOM_CARRIER_NAME} characters or fewer`),
  body('trackingNumber')
    .optional()
    .trim(),
  validateRequest
];

export const validateTrackingEvent = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('status')
    .notEmpty()
    .withMessage('Tracking status is required'),
  body('location')
    .optional()
    .trim(),
  body('description')
    .optional()
    .trim(),
  validateRequest
];

export const validatePaymentFailed = [
  param('id')
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid Order ID'),
  body('reason')
    .optional()
    .trim(),
  body('paymentId')
    .optional()
    .trim(),
  body('errorDescription')
    .optional()
    .trim(),
  validateRequest
];

export const validateAdminOrderQuery = [
  // status is a comma-joined multi-select; the controller filters out non-real
  // statuses, so we only trim here rather than reject.
  query('status')
    .optional()
    .trim(),
  query('orderNumber')
    .optional()
    .trim(),
  query('search')
    .optional()
    .trim(),
  query('customer')
    .optional()
    .trim(),
  query('startDate')
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage('startDate must be a valid date'),
  query('endDate')
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage('endDate must be a valid date'),
  query('minAmount')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage('minAmount must be a non-negative number'),
  query('maxAmount')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage('maxAmount must be a non-negative number'),
  query('sortBy')
    .optional()
    // listDate = the paid date, or the created date while unpaid — the page's default
    // (utils/orderListDate.js). Keep in step with ADMIN_ORDER_SORT_FIELDS in orderController.
    .isIn(['listDate', 'createdAt', 'totalAmount', 'status'])
    .withMessage('sortBy must be one of: listDate, createdAt, totalAmount, status'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('sortOrder must be asc or desc'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  validateRequest
];

export const validateTrackingSimulate = [
  body('scenario')
    .notEmpty()
    .withMessage('Scenario is required')
    .trim(),
  validateRequest
];

export const validateRefundsQuery = [
  query('status')
    .optional()
    .trim(),
  query('search')
    .optional()
    .trim()
    .isLength({ max: 120 }).withMessage('Search term is too long'),
  // Clamped again in the repository; asserted here so an out-of-range value is a clear
  // 400 rather than being silently rounded into something the caller did not ask for.
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  // Order-placed date range (YYYY-MM-DD, India time) and newest / oldest first.
  query(['from', 'to'])
    .optional({ values: 'falsy' })
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Dates must be YYYY-MM-DD'),
  query('sort')
    .optional({ values: 'falsy' })
    .isIn(['newest', 'oldest']).withMessage('Unknown sort'),
  // The keyset cursor, echoed back from the previous page. Both halves or neither — a
  // half-supplied cursor is a client bug, and ignoring it would silently restart
  // pagination at page one and re-serve rows the admin has already worked through.
  query('cursorCreatedAt')
    .optional()
    .isISO8601().withMessage('Invalid pagination cursor'),
  query('cursorId')
    .optional()
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage('Invalid pagination cursor'),
  query('cursorId')
    .custom((value, { req }) => Boolean(value) === Boolean(req.query.cursorCreatedAt))
    .withMessage('Both cursor parts are required'),
  validateRequest
];
