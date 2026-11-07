import { body } from 'express-validator';

/** PUT /festival-offer/admin — shape only; window ordering is checked in the controller. */
export const validateUpdateFestivalOffer = [
  body('enabled').isBoolean().withMessage('enabled must be true or false').toBoolean(),
  body('startsAt').optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('Start must be a date and time'),
  body('endsAt').optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('End must be a date and time'),
];
