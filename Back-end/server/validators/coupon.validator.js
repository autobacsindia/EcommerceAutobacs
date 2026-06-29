/**
 * Coupon + checkout-quote + loyalty validation (express-validator).
 * Mirrors validators/product.validator.js conventions. Pair each chain with the
 * shared `validateRequest` middleware to surface 400s.
 */

import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

// ── Coupon admin CRUD ─────────────────────────────────────────────────────────

const couponRules = (partial = false) => {
  const required = (chain) => (partial ? chain.optional() : chain);
  return [
    required(body('code'))
      .trim().notEmpty().withMessage('Coupon code is required')
      .isLength({ max: 40 }).withMessage('Coupon code too long')
      .matches(/^[A-Za-z0-9_-]+$/).withMessage('Coupon code may only contain letters, numbers, - and _'),
    required(body('type'))
      .isIn(['percentage', 'fixed', 'free_shipping']).withMessage('Invalid coupon type'),
    body('value').optional().isFloat({ min: 0 }).withMessage('value must be ≥ 0'),
    body('maxDiscountAmount').optional({ nullable: true }).isFloat({ min: 0 }),
    body('visibility').optional().isIn(['public', 'hidden']),
    body('minCartValue').optional().isFloat({ min: 0 }),
    body('maxCartValue').optional({ nullable: true }).isFloat({ min: 0 }),
    body('startsAt').optional({ nullable: true }).isISO8601().withMessage('startsAt must be a date'),
    body('expiresAt').optional({ nullable: true }).isISO8601().withMessage('expiresAt must be a date'),
    body('firstOrderOnly').optional().isBoolean(),
    body('usageLimit').optional({ nullable: true }).isInt({ min: 0 }),
    body('usageLimitPerUser').optional({ nullable: true }).isInt({ min: 0 }),
    body('isActive').optional().isBoolean(),
    body('appliesTo.categories').optional().isArray(),
    body('appliesTo.categories.*').optional().custom(isObjectId).withMessage('Invalid category id'),
    body('appliesTo.products').optional().isArray(),
    body('appliesTo.products.*').optional().custom(isObjectId).withMessage('Invalid product id'),
    body('appliesTo.brandSlugs').optional().isArray(),
    // Percentage coupons must carry a 0–100 value.
    body('value').if(body('type').equals('percentage'))
      .isFloat({ min: 0, max: 100 }).withMessage('Percentage value must be between 0 and 100')
  ];
};

export const validateCouponCreate = couponRules(false);
export const validateCouponUpdate = couponRules(true);
export const validateCouponId = [param('id').custom(isObjectId).withMessage('Invalid coupon id')];

// ── Checkout quote ────────────────────────────────────────────────────────────

export const validateCheckoutQuote = [
  body('items').isArray({ min: 1, max: 50 }).withMessage('items must be a non-empty array'),
  body('items.*.product').custom(isObjectId).withMessage('Invalid product id'),
  body('items.*.quantity').isInt({ min: 1, max: 999 }).withMessage('Invalid quantity'),
  body('couponCode').optional({ nullable: true }).trim().isLength({ max: 40 }),
  body('redeemKarmaPoints').optional().isInt({ min: 0 }).withMessage('redeemKarmaPoints must be ≥ 0'),
  body('shippingCost').optional().isFloat({ min: 0 })
];

// ── Loyalty config + adjust (admin) ───────────────────────────────────────────

export const validateLoyaltyConfig = [
  body('enabled').optional().isBoolean(),
  body('earnRatePercent').optional().isFloat({ min: 0, max: 100 }),
  body('pointsExpiryDays').optional({ nullable: true }).isInt({ min: 0 }),
  body('pointValueInRupees').optional().isFloat({ min: 0 }),
  body('redeemMaxPercent').optional().isFloat({ min: 0, max: 100 }),
  body('minRedeemPoints').optional().isInt({ min: 0 })
];

export const validateKarmaAdjust = [
  param('userId').custom(isObjectId).withMessage('Invalid user id'),
  body('points').isInt().withMessage('points must be an integer'),
  body('description').optional().trim().isLength({ max: 500 })
];
