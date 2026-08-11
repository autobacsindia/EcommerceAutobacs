/**
 * Campaign validation (express-validator). Mirrors validators/coupon.validator.js
 * conventions; pair each chain with the shared `validateRequest` middleware.
 *
 * Shape only. The rules that cost money — a tier ladder with a discount cliff, an
 * "everyone" campaign with no redemption cap, an end date before the start — are
 * enforced in campaignService (assertValidConfig / assertPublishable) so they hold for
 * the seed script and any future caller too, not just for HTTP.
 */

import { body, param } from 'express-validator';
import mongoose from 'mongoose';
import { CAMPAIGN_STATUSES, CAMPAIGN_AUDIENCES } from '../config/campaign.js';
import { TIER_RESOLUTIONS } from '../utils/campaignTiers.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

export const validateCampaignId = [
  param('id').custom(isObjectId).withMessage('Invalid campaign id'),
];

export const validateCampaignSlug = [
  param('slug')
    .trim().notEmpty().withMessage('Campaign slug is required')
    .isLength({ max: 60 }).withMessage('Campaign slug too long')
    .matches(/^[a-z0-9-]+$/i).withMessage('Campaign slug may only contain letters, numbers and -'),
];

const tierRules = [
  body('tiers').optional().isArray({ min: 1 }).withMessage('At least one tier is required'),
  body('tiers.*.id')
    .optional().trim().notEmpty().withMessage('Each tier needs an id')
    .matches(/^[a-z0-9_-]+$/i).withMessage('Tier id may only contain letters, numbers, - and _'),
  body('tiers.*.label').optional({ nullable: true }).trim().isLength({ max: 60 }),
  body('tiers.*.percent')
    .optional().isFloat({ min: 0, max: 100 }).withMessage('Tier percent must be between 0 and 100'),
  body('tiers.*.minCartValue').optional().isFloat({ min: 0 }),
  body('tiers.*.maxCartValue').optional({ nullable: true }).isFloat({ min: 0 }),
  body('tiers.*.maxDiscount').optional({ nullable: true }).isFloat({ min: 0 }),
];

const campaignRules = (partial = false) => {
  const required = (chain) => (partial ? chain.optional() : chain);
  return [
    required(body('name')).trim().notEmpty().withMessage('Campaign name is required')
      .isLength({ max: 120 }).withMessage('Campaign name too long'),
    body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
    body('status').optional().isIn(CAMPAIGN_STATUSES).withMessage('Invalid campaign status'),
    body('audience').optional().isIn(CAMPAIGN_AUDIENCES).withMessage('Invalid audience'),
    body('resolution').optional().isIn(TIER_RESOLUTIONS).withMessage('Invalid tier resolution'),
    body('requireVerifiedEmail').optional().isBoolean(),
    body('allowKarmaStacking').optional().isBoolean(),
    body('allowNonMonotonicTiers').optional().isBoolean(),
    body('startsAt').optional({ nullable: true }).isISO8601().withMessage('startsAt must be a date'),
    body('endsAt').optional({ nullable: true }).isISO8601().withMessage('endsAt must be a date'),
    body('maxDiscountPerOrder').optional({ nullable: true }).isFloat({ min: 0 }),
    body('maxRedemptions').optional({ nullable: true }).isInt({ min: 0 }),
    body('couponCode').optional({ nullable: true })
      .trim().matches(/^[A-Za-z0-9_-]+$/).withMessage('Coupon code may only contain letters, numbers, - and _')
      .isLength({ max: 40 }),
    body('landingPath').optional({ nullable: true })
      .trim().matches(/^\/[a-z0-9/-]*$/i).withMessage('Landing path must start with /'),
    body('testerEmails').optional().isArray({ max: 50 }).withMessage('At most 50 tester emails'),
    body('testerEmails.*').optional().isEmail().withMessage('Invalid tester email'),
    ...tierRules,
  ];
};

export const validateCampaignCreate = [
  body('slug')
    .trim().notEmpty().withMessage('Campaign slug is required')
    .isLength({ max: 60 })
    .matches(/^[a-z0-9-]+$/i).withMessage('Campaign slug may only contain letters, numbers and -'),
  ...campaignRules(false),
];

export const validateCampaignUpdate = campaignRules(true);

export const validateCampaignStatus = [
  body('status').isIn(CAMPAIGN_STATUSES).withMessage('Invalid campaign status'),
];

export const validateCampaignEmailCheck = [
  body('email')
    .trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Enter a valid email address')
    .isLength({ max: 254 })
    .normalizeEmail({ gmail_remove_dots: false }),
];

export const validateCampaignMembers = [
  body('members').isArray({ min: 1, max: 5000 }).withMessage('Provide 1–5000 members'),
  body('members.*.email').trim().isEmail().withMessage('Every member needs a valid email'),
  body('members.*.name').optional({ nullable: true }).trim().isLength({ max: 120 }),
  body('members.*.reviewNote').optional({ nullable: true }).trim().isLength({ max: 200 }),
];

export const validateCampaignSimulate = [
  body('cartValues').optional().isArray({ max: 25 }).withMessage('At most 25 cart values'),
  body('cartValues.*').optional().isFloat({ min: 0 }).withMessage('Cart values must be ≥ 0'),
];
