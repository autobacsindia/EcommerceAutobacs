import { body, query } from 'express-validator';
import {
  FESTIVAL_SETTING_MODE, FESTIVAL_CUSTOM_PERCENT_MIN, FESTIVAL_CUSTOM_PERCENT_MAX, isValidCustomPercent,
} from '../utils/festivalOffer.js';
import { MAX_BULK_PRODUCTS, MAX_EXCEPTIONS_PAGE } from '../services/productFestivalOfferService.js';

/** PUT /festival-offer/admin — shape only; window ordering is checked in the controller. */
export const validateUpdateFestivalOffer = [
  body('enabled').isBoolean().withMessage('enabled must be true or false').toBoolean(),
  body('startsAt').optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('Start must be a date and time'),
  body('endsAt').optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('End must be a date and time'),
];

/** PATCH /products/festival-offer-setting. The limits come from the pricing code. */
export const validateSetFestivalOfferSetting = [
  body('productIds').isArray({ min: 1, max: MAX_BULK_PRODUCTS })
    .withMessage(`Choose between 1 and ${MAX_BULK_PRODUCTS} products`),
  body('productIds.*').isMongoId().withMessage('Invalid product'),
  body('mode').isIn(Object.values(FESTIVAL_SETTING_MODE)).withMessage('Choose Automatic, No offer or Custom'),
  body('percent')
    .if(body('mode').equals(FESTIVAL_SETTING_MODE.CUSTOM))
    .custom((v) => isValidCustomPercent(v))
    .withMessage(`Custom offer must be a whole number from ${FESTIVAL_CUSTOM_PERCENT_MIN} to ${FESTIVAL_CUSTOM_PERCENT_MAX}`),
];

export const validateFestivalOfferExceptions = [
  query('mode').optional().isIn([FESTIVAL_SETTING_MODE.NONE, FESTIVAL_SETTING_MODE.CUSTOM]).withMessage('Invalid filter'),
  query('cursor').optional().isMongoId().withMessage('Invalid cursor'),
  query('limit').optional().isInt({ min: 1, max: MAX_EXCEPTIONS_PAGE }).withMessage(`Limit must be 1 to ${MAX_EXCEPTIONS_PAGE}`),
];
