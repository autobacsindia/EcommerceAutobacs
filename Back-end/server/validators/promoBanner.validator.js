/**
 * PromoBanner validation (express-validator). Pair each chain with the shared
 * `validateRequest` middleware.
 *
 * Shape only, with one exception that earns its place here: `linkPath` is an
 * admin-editable value that ends up in an href, so the open-redirect guard runs
 * at the boundary as well as in the controller. The rule itself lives in
 * utils/promoLinkPath.js so it is unit-testable on its own.
 */

import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { isSafePromoLinkPath } from '../utils/promoLinkPath.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

/** Cloudinary delivery URLs only — the artwork must come from our own account. */
const isCloudinaryUrl = (v) =>
  typeof v === 'string' && /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9._-]+\//.test(v.trim());

export const validatePromoBannerId = [
  param('id').custom(isObjectId).withMessage('Invalid banner id'),
];

export const validatePromoBannerList = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100'),
  query('before').optional().isISO8601().withMessage('before must be a date'),
];

const bannerRules = (partial = false) => {
  const required = (chain) => (partial ? chain.optional() : chain);
  return [
    required(body('title'))
      .trim().notEmpty().withMessage('Banner title is required')
      .isLength({ max: 120 }).withMessage('Banner title too long'),

    required(body('imageUrl'))
      .trim().notEmpty().withMessage('A banner image is required')
      .custom(isCloudinaryUrl).withMessage('Banner image must be a Cloudinary URL'),
    body('imagePublicId').optional({ nullable: true }).trim().isLength({ max: 300 }),

    // Optional per-breakpoint artwork. Absent ⇒ the desktop image is used.
    body('tabletImageUrl').optional({ nullable: true, checkFalsy: true })
      .trim().custom(isCloudinaryUrl).withMessage('Tablet image must be a Cloudinary URL'),
    body('tabletImagePublicId').optional({ nullable: true }).trim().isLength({ max: 300 }),
    body('mobileImageUrl').optional({ nullable: true, checkFalsy: true })
      .trim().custom(isCloudinaryUrl).withMessage('Mobile image must be a Cloudinary URL'),
    body('mobileImagePublicId').optional({ nullable: true }).trim().isLength({ max: 300 }),

    // Recorded dimensions from the Cloudinary upload response, used to warn about
    // under-sized artwork. Bounded so a nonsense value can't be stored.
    ...['imageWidth', 'imageHeight',
      'tabletImageWidth', 'tabletImageHeight',
      'mobileImageWidth', 'mobileImageHeight',
    ].map((field) =>
      body(field).optional({ nullable: true }).isInt({ min: 1, max: 20000 })
        .withMessage(`${field} must be a positive pixel count`)),

    // Required because the banner's whole message is inside the image; without
    // alt text a screen-reader user gets an unlabelled link and nothing else.
    required(body('alt'))
      .trim().notEmpty().withMessage('Alt text is required (the banner image carries the campaign message)')
      .isLength({ max: 200 }).withMessage('Alt text too long'),

    body('linkPath').optional({ nullable: true, checkFalsy: true })
      .trim()
      .custom(isSafePromoLinkPath)
      .withMessage('Link must be a relative path on this site, e.g. /offers'),

    body('isActive').optional().isBoolean().withMessage('isActive must be true or false'),
    body('priority').optional().isInt({ min: -1000, max: 1000 }).withMessage('priority must be -1000..1000'),
    body('startsAt').optional({ nullable: true }).isISO8601().withMessage('startsAt must be a date'),
    body('endsAt').optional({ nullable: true }).isISO8601().withMessage('endsAt must be a date'),
  ];
};

export const validateCreatePromoBanner = bannerRules(false);
export const validateUpdatePromoBanner = [...validatePromoBannerId, ...bannerRules(true)];
export const validateTogglePromoBanner = [
  ...validatePromoBannerId,
  body('isActive').isBoolean().withMessage('isActive must be true or false'),
];

export default {
  validatePromoBannerId,
  validatePromoBannerList,
  validateCreatePromoBanner,
  validateUpdatePromoBanner,
  validateTogglePromoBanner,
};
