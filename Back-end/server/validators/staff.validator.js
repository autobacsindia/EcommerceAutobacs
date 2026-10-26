/**
 * Staff access validation (express-validator). Pair each chain with `validateRequest`.
 *
 * Shape and bounds only. WHO may invite or remove whom is a capability rule and
 * lives in staffService, which sees the acting user.
 */

import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES, STAFF_USERNAME_PATTERN, STAFF_USERNAME_HINT, GTM_SUB_ROLE_VALUES } from '../config/staff.js';
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

// ── Company accounts ─────────────────────────────────────────────────────────

const newPassword = (field) => body(field)
  .isString()
  .isLength({ min: 8, max: 72 })
  .withMessage('Password must be between 8 and 72 characters')
  .custom((value) => !isCommonPassword(value))
  .withMessage(COMMON_PASSWORD_MESSAGE);

export const validateCompanyAccount = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('username')
    .isString()
    .trim()
    .toLowerCase()
    .matches(STAFF_USERNAME_PATTERN)
    .withMessage(`Username: ${STAFF_USERNAME_HINT}`),
  body('phone')
    .trim()
    .matches(/^(\+91[\s-]?)?[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number'),
  newPassword('password'),
  body('team').optional().isIn(STAFF_TEAM_VALUES).withMessage('Unknown team'),
  body('isHead').optional().isBoolean().withMessage('isHead must be true or false').toBoolean(),
  body('subRole').optional({ values: 'falsy' }).isIn(GTM_SUB_ROLE_VALUES).withMessage('Unknown role'),
];

export const validatePasswordReset = [
  param('id').custom(isObjectId).withMessage('Invalid member'),
  newPassword('password'),
];

export const validateOwnPasswordChange = [
  body('currentPassword').isString().isLength({ min: 1, max: 200 }).withMessage('Enter your current password'),
  newPassword('newPassword'),
];

// ── Sales panel ──────────────────────────────────────────────────────────────

export const validateSalesProductSearch = [
  query('q').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Type at least 2 characters'),
];

export const validateCursorQuery = [
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];

/**
 * The paid-order list, optionally split by fulfilment stage ("Order processing"
 * vs "Delivered"). Absent means every paid order, which is what the list did
 * before the split — so an older client keeps working unchanged.
 */
export const validatePaidOrdersQuery = [
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
  query('stage').optional().isIn(['processing', 'delivered']).withMessage('Invalid stage'),
];

export const validateAttributionList = [
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];

// salesUserId / expectedSalesUserId: an id, or null for "no one".
const idOrNull = (v) => v === null || (typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v));
export const validateSetSeller = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
  body('salesUserId').exists().withMessage('Choose a salesman (or none)').bail().custom(idOrNull).withMessage('Invalid salesman'),
  body('expectedSalesUserId').exists().withMessage('Refresh the page and try again').bail().custom(idOrNull).withMessage('Invalid salesman'),
  body('note').optional().isString().isLength({ max: 300 }).withMessage('Note is too long (300 characters maximum)'),
];

export const validateBankTransferList = [
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
  query('status').optional().isIn(['pending', 'confirmed', 'rejected', 'all']).withMessage('Invalid status'),
];

export const validateBankTransferId = [
  param('id').custom(isObjectId).withMessage('Invalid bank transfer id'),
];

export const validateBankTransferFile = [
  param('id').custom(isObjectId).withMessage('Invalid bank transfer id'),
  param('fileId').custom(isObjectId).withMessage('Invalid file id'),
];

export const validateBankTransferReject = [
  param('id').custom(isObjectId).withMessage('Invalid bank transfer id'),
  body('note').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Say why (3–500 characters)'),
];

export const validateOrderIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
];

/**
 * Shape and bounds only. Prices are NOT trusted from here — the service re-prices
 * every line from the catalogue and only accepts an offer between ₹1 and that price.
 */
/** The `items[n]` object a `items[n].field` path belongs to. */
const lineAt = (req, path) => {
  const m = /^items\[(\d+)\]/.exec(path);
  return m ? req.body?.items?.[Number(m[1])] : undefined;
};
const isCustomLine = (req, path) => {
  const c = lineAt(req, path)?.custom;
  return c === true || c === 'true';
};

/**
 * An Indian mobile number as people type it — "98765 43210", "098765-43210",
 * "+91 98765 43210" — reduced to its 10 digits, so the rule below checks the
 * number and not the formatting. Anything that isn't a mobile stays as typed and
 * fails the rule.
 */
export const normalizeIndianMobile = (value) => {
  const digits = String(value ?? '').replace(/[\s\-().]/g, '');
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? m[1] : String(value ?? '').trim();
};
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export const validateQuotationIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid quotation id'),
];

export const validateQuotationList = [
  query('cursor').optional().custom(isObjectId).withMessage('Invalid page cursor'),
  query('status').optional().isIn(['open', 'on_hold', 'accepted', 'cancelled']).withMessage('Unknown status'),
];

/** "On hold — customer thinking" body: follow-up date (YYYY-MM-DD, optional) and a note. */
const holdBody = [
  body('until').optional({ values: 'falsy' }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Choose a follow-up date'),
  body('note').optional().isString().isLength({ max: 300 }).withMessage('Keep the note under 300 characters'),
];
export const validateQuotationHold = [param('id').custom(isObjectId).withMessage('Invalid quotation id'), ...holdBody];
export const validateOrderHold = [param('id').custom(isObjectId).withMessage('Invalid order id'), ...holdBody];

/** Sales order list: page cursor and which view (active / on hold). */
export const validateSalesOrderList = [
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
  query('view').optional().isIn(['active', 'on_hold']).withMessage('Unknown view'),
];

/** Request payment on an order in one or more parts (rupees). */
export const validatePaymentParts = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
  body('amounts').isArray({ min: 1, max: 10 }).withMessage('Enter between 1 and 10 amounts'),
  body('amounts.*').isFloat({ min: 1, max: 10000000 }).withMessage('Each part must be between ₹1 and ₹1,00,00,000').toFloat(),
];

export const validatePaymentPartParam = [
  param('id').custom(isObjectId).withMessage('Invalid order id'),
  param('partId').custom(isObjectId).withMessage('Invalid payment part'),
];

export const validateSalesOrder = [
  body('customer.name').trim().isLength({ min: 2, max: 100 }).withMessage('Customer name must be 2–100 characters'),
  // Optional: a customer on the phone may have no email (utils/customerContact.js).
  body('customer.email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Enter a valid customer email, or leave it empty').isLength({ max: 254 }),
  body('customer.phone').customSanitizer(normalizeIndianMobile).matches(INDIAN_MOBILE).withMessage('Enter a valid 10-digit Indian mobile number (starting 6, 7, 8 or 9)'),
  body('shippingAddress.fullName').optional().trim().isLength({ max: 100 }),
  body('shippingAddress.phone').optional({ values: 'falsy' }).customSanitizer(normalizeIndianMobile).matches(INDIAN_MOBILE).withMessage('Enter a valid 10-digit delivery mobile number'),
  body('shippingAddress.addressLine1').trim().isLength({ min: 3, max: 200 }).withMessage('Enter the delivery address'),
  body('shippingAddress.addressLine2').optional().trim().isLength({ max: 200 }),
  body('shippingAddress.city').trim().isLength({ min: 2, max: 80 }).withMessage('Enter the city'),
  body('shippingAddress.state').trim().isLength({ min: 2, max: 80 }).withMessage('Enter the state'),
  body('shippingAddress.postalCode').trim().matches(/^\d{6}$/).withMessage('Enter a valid 6-digit PIN code'),
  body('items').isArray({ min: 1, max: 30 }).withMessage('Add between 1 and 30 products'),
  // A line is either a catalogue product, or a CUSTOM item (not in the catalogue)
  // that the seller names and prices — `custom: true` + name + price.
  body('items.*.custom').optional().isBoolean().withMessage('Invalid item type').toBoolean(),
  body('items.*.product').if((_v, { req, path }) => !isCustomLine(req, path)).custom(isObjectId).withMessage('Invalid product'),
  body('items.*.variantId').optional({ values: 'null' }).custom(isObjectId).withMessage('Invalid product option'),
  body('items.*.name').if((_v, { req, path }) => isCustomLine(req, path))
    .isString().trim().isLength({ min: 2, max: 150 }).withMessage('Name each custom item (2–150 characters)'),
  body('items.*.price').if((_v, { req, path }) => isCustomLine(req, path))
    .isFloat({ min: 1, max: 10000000 }).withMessage('Enter a price for each custom item (at least ₹1)').toFloat(),
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

export const validateWorkLineOnly = [...validateWorkLine];

export const validateEditParcel = [
  ...validateWorkOrder,
  param('shipmentId').custom(isObjectId).withMessage('Invalid parcel'),
  body('courierName').optional({ values: 'null' }).isString().trim().isLength({ max: 80 }).withMessage('Courier name is too long'),
  body('trackingNumber').optional({ values: 'null' }).isString().trim().isLength({ max: 80 }).withMessage('Tracking number is too long'),
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

export const validateRefundRetry = [
  ...validateWorkOrder,
  param('cancellationId').custom(isObjectId).withMessage('Invalid refund'),
];

export const validateMarkDelivered = [
  ...validateWorkOrder,
  body('shipmentId').optional({ values: 'falsy' }).custom(isObjectId).withMessage('Invalid parcel'),
];

export const validateUndoDelivered = [
  ...validateWorkOrder,
  body('shipmentId').custom(isObjectId).withMessage('Choose the parcel'),
];

/** Admin edits a team member. Every field optional; at least one is checked in the service. */
export const validateMemberUpdate = [
  param('id').custom(isObjectId).withMessage('Invalid member id'),
  body('name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('phone').optional().customSanitizer(normalizeIndianMobile).matches(INDIAN_MOBILE).withMessage('Enter a valid 10-digit Indian mobile number'),
  body('username').optional().isString().trim().toLowerCase().matches(STAFF_USERNAME_PATTERN).withMessage(`Username: ${STAFF_USERNAME_HINT}`),
  body('team').optional().isIn(STAFF_TEAM_VALUES).withMessage('Choose a team'),
  body('isHead').optional().isBoolean().withMessage('Invalid head setting').toBoolean(),
  body('subRole').optional({ values: 'null' }).isIn(GTM_SUB_ROLE_VALUES).withMessage('Choose a GTM role'),
];

// ── Customer bank details (refunds / NEFT) ──────────────────────────────────────
const validateCustomerBankTarget = [
  param('kind').isIn(['quotation', 'order']).withMessage('Unknown record'),
  param('id').custom(isObjectId).withMessage('Invalid id'),
];

export const validateCustomerBankRead = [
  ...validateCustomerBankTarget,
  query('reveal').optional().isIn(['0', '1', 'true', 'false']).withMessage('reveal must be 0 or 1'),
];

export const validateCustomerBankSave = [
  ...validateCustomerBankTarget,
  body('accountName').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Enter the account holder\'s name'),
  body('accountNumber').isString().isLength({ min: 6, max: 30 }).withMessage('Enter the account number'),
  body('confirmAccountNumber').optional().isString().isLength({ max: 30 }),
  body('ifsc').isString().trim().isLength({ min: 11, max: 11 }).withMessage('Enter the 11-character IFSC code'),
  body('bankName').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
];

export const validateCustomerBankRemove = validateCustomerBankTarget;
