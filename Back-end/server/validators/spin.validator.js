/**
 * Spin-to-Win validation (express-validator). Pair each chain with `validateRequest`.
 *
 * Shape and bounds only. The rules that decide whether a campaign is SAFE TO RUN — one
 * unlimited floor prize, a reachable minimum, a real prize to win — are not shape checks
 * and live in spinService.validateForPublish, which runs at the publish boundary and can
 * see the prizes as a set rather than one request body at a time.
 */

import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import {
  SPIN_STATUSES,
  SPIN_STATUS,
  PRIZE_KINDS,
  MIN_SEGMENT_COUNT,
  MAX_SEGMENT_COUNT,
  REVIEW_URL_ALLOWED_HOSTS,
} from '../config/spin.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

/**
 * Parsed with `new URL()` and matched on exact hostname.
 *
 * Never a substring or prefix test: `https://evil.com/?q=google.com` passes a "contains"
 * check and `//evil.com` passes a "starts with /" check. Mirrors the same guard in
 * spinService so a bad URL is refused at the boundary as well as at publish.
 */
const isAllowedReviewUrl = (v) => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' && REVIEW_URL_ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

export const validateOrderIdParam = [
  param('orderId').custom(isObjectId).withMessage('Invalid order id'),
];
export const validateCampaignIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid campaign id'),
];
export const validatePrizeIdParam = [
  param('prizeId').custom(isObjectId).withMessage('Invalid prize id'),
];
export const validateSpinResultIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid spin result id'),
];

const campaignRules = (partial = false) => {
  const opt = (chain) => (partial ? chain.optional() : chain);
  return [
    opt(body('slug')).isSlug().withMessage('slug must be url-safe').isLength({ max: 80 }),
    opt(body('name')).isString().trim().notEmpty().isLength({ max: 120 }),
    opt(body('startsAt')).isISO8601().withMessage('startsAt must be a date'),
    opt(body('endsAt')).isISO8601().withMessage('endsAt must be a date'),
    body('minOrderValuePaise').optional().isInt({ min: 0 }),
    body('maxSpinsPerUserPerCampaign').optional({ nullable: true }).isInt({ min: 1 }),
    body('segmentCount').optional().isInt({ min: MIN_SEGMENT_COUNT, max: MAX_SEGMENT_COUNT })
      .withMessage(`segmentCount must be ${MIN_SEGMENT_COUNT}-${MAX_SEGMENT_COUNT}`),
    // The single number that prices the whole economy — see SpinCampaign for the maths.
    body('goodieWinRatePercent').optional().isInt({ min: 1, max: 100 })
      .withMessage('goodieWinRatePercent must be 1-100'),
    body('reviewCta.enabled').optional().isBoolean(),
    body('reviewCta.headline').optional({ nullable: true }).isString().isLength({ max: 160 }),
    body('reviewCta.body').optional({ nullable: true }).isString().isLength({ max: 400 }),
    body('reviewCta.url').optional({ nullable: true }).custom((v) => v === null || v === '' || isAllowedReviewUrl(v))
      .withMessage(`Review URL must be https:// on one of: ${REVIEW_URL_ALLOWED_HOSTS.join(', ')}`),
    body('excludedStates').optional().isArray({ max: 40 }),
    body('excludedStates.*').optional().isString().isLength({ max: 60 }),
    body('terms').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  ];
};

export const validateCreateCampaign = campaignRules(false);
export const validateUpdateCampaign = [...validateCampaignIdParam, ...campaignRules(true)];

export const validateCampaignStatus = [
  ...validateCampaignIdParam,
  // `live` is deliberately excluded: going live must go through /publish so the safety
  // gate runs. Allowing it here would be a second, ungated way to start a campaign.
  body('status').isIn(SPIN_STATUSES.filter((s) => s !== SPIN_STATUS.LIVE))
    .withMessage('Use the publish endpoint to go live'),
];

const prizeRules = (partial = false) => {
  const opt = (chain) => (partial ? chain.optional() : chain);
  return [
    opt(body('name')).isString().trim().notEmpty().isLength({ max: 120 }),
    body('kind').optional().isIn(PRIZE_KINDS),
    body('sku').optional({ nullable: true }).isString().trim().isLength({ max: 60 }),
    body('shortLabel').optional({ nullable: true }).isString().trim().isLength({ max: 24 })
      .withMessage('shortLabel must be 24 characters or fewer to fit a wheel slice'),
    body('imageUrl').optional({ nullable: true }).isURL({ protocols: ['https'], require_protocol: true }),
    body('active').optional().isBoolean(),
    // null = unlimited, which the publish gate then restricts to the floor prize alone.
    body('stockTotal').optional({ nullable: true }).isInt({ min: 0 }),
    body('weightMode').optional().isIn(['stock', 'manual']),
    body('manualWeight').optional().isInt({ min: 0 }),
    body('weightFactor').optional().isFloat({ min: 0 }),
    body('minOrderValuePaise').optional().isInt({ min: 0 }),
    body('maxWinsPerDay').optional({ nullable: true }).isInt({ min: 1 }),
    body('isFloorPrize').optional().isBoolean(),
    body('couponCode').optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body('karmaPoints').optional().isInt({ min: 0 }),
    body('sortOrder').optional().isInt(),
    // stockRemaining and stockAwarded are server-owned. stockRemaining is derived from
    // stockTotal on create and from the delta on update; stockAwarded is history. A
    // client-sent value for either could award units that do not exist.
    body('stockRemaining').not().exists().withMessage('stockRemaining is derived from stockTotal'),
    body('stockAwarded').not().exists().withMessage('stockAwarded is read-only'),
  ];
};

export const validateCreatePrize = [...validateCampaignIdParam, ...prizeRules(false)];
export const validateUpdatePrize = [...validatePrizeIdParam, ...prizeRules(true)];

export const validateWinnerList = [
  query('campaignId').optional().custom(isObjectId).withMessage('Invalid campaign id'),
  query('fulfilled').optional().isIn(['true', 'false']),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100'),
  query('before').optional().isISO8601().withMessage('before must be a date'),
];

/**
 * Cloning needs its own slug — slugs are unique, so the copy cannot inherit one. Dates
 * are optional: omit them to carry the source window over and edit afterwards.
 */
export const validateCloneCampaign = [
  ...validateCampaignIdParam,
  body('slug').isSlug().withMessage('The new campaign needs its own url-safe slug').isLength({ max: 80 }),
  body('name').optional().isString().trim().isLength({ max: 120 }),
  body('startsAt').optional().isISO8601().withMessage('startsAt must be a date'),
  body('endsAt').optional().isISO8601().withMessage('endsAt must be a date'),
];
