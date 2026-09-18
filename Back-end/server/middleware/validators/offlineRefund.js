/**
 * Request-shape validation for refunds settled outside the gateway, and for
 * withdrawing such a record.
 *
 * ⚠️ AMOUNTS ARE DELIBERATELY NOT BOUNDED HERE — only checked for being a positive
 * number at all. What is actually refundable depends on the order, on sibling returns
 * and on the Payment row, and is recomputed server-side by
 * offlineRefundService.resolveAmountRupees against `remainingRefundable`. A ceiling
 * asserted here would be a second, weaker copy of that rule, and the client's figure is
 * never the authority regardless. Same stance the return refund validator takes.
 */

import { body, param } from 'express-validator';
import mongoose from 'mongoose';
import { validateRequest } from '../validateRequest.js';
import { OFFLINE_METHODS } from '../../config/offlineRefund.js';

const objectId = (name, message) =>
  param(name)
    .custom((value) => mongoose.Types.ObjectId.isValid(value))
    .withMessage(message);

/**
 * The offline fields, applied only when `method === 'offline'`.
 *
 * Every rule is conditional, because these routes serve BOTH methods: the gateway path
 * posts no body at all and must keep working untouched.
 */
const offlineBody = () => [
  body('method')
    .optional()
    .isIn(['original_payment', 'offline'])
    .withMessage('Invalid refund method'),
  body('offlineMethod')
    .if(body('method').equals('offline'))
    .isIn([...OFFLINE_METHODS])
    .withMessage(`How the money was paid back is required (${OFFLINE_METHODS.join(', ')})`),
  body('reference')
    .if(body('method').equals('offline'))
    .isString().withMessage('A reference (UTR, cheque or receipt number) is required')
    .bail()
    .trim()
    .notEmpty().withMessage('A reference (UTR, cheque or receipt number) is required')
    .isLength({ max: 120 }).withMessage('Reference cannot exceed 120 characters'),
  body('paidAt')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('The payout date is not a valid date')
    .bail()
    /*
      A payout cannot have happened in the future. Caught here rather than in the
      service because it is a pure shape rule — and because a future date would
      otherwise sit in the record looking deliberate.
    */
    .custom((value) => new Date(value).getTime() <= Date.now())
    .withMessage('The payout date cannot be in the future'),
  body('amount')
    .optional({ values: 'null' })
    .isFloat({ gt: 0 }).withMessage('The refund amount must be greater than ₹0'),
  body('notifyCustomer')
    .optional()
    .isBoolean().withMessage('notifyCustomer must be true or false'),
];

/** POST /orders/:id/refund */
export const validateOrderRefundBody = [
  objectId('id', 'Invalid ID format'),
  ...offlineBody(),
  validateRequest,
];

/** POST /orders/:id/cancellations/:cancellationId/refund */
export const validateCancellationRefundBody = [
  objectId('id', 'Invalid ID format'),
  objectId('cancellationId', 'Invalid cancellation ID format'),
  ...offlineBody(),
  validateRequest,
];

/**
 * A reason is MANDATORY on every revert.
 *
 * Reverting rewrites what the books say about money. The reason is the only record of
 * why, and it is what the next person reading the audit log has to go on — an optional
 * field would be blank exactly when it mattered.
 */
const revertBody = () => [
  body('reason')
    .isString().withMessage('A reason for reverting is required')
    .bail()
    .trim()
    .notEmpty().withMessage('A reason for reverting is required')
    .isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters'),
];

/** POST /orders/:id/refund/revert */
export const validateRefundRevert = [
  objectId('id', 'Invalid ID format'),
  ...revertBody(),
  validateRequest,
];

/** POST /orders/:id/cancellations/:cancellationId/refund/revert */
export const validateCancellationRefundRevert = [
  objectId('id', 'Invalid ID format'),
  objectId('cancellationId', 'Invalid cancellation ID format'),
  ...revertBody(),
  validateRequest,
];

/** POST /returns/admin/:id/refund/revert */
export const validateReturnRefundRevert = [
  objectId('id', 'Invalid Return Request ID'),
  ...revertBody(),
  validateRequest,
];
