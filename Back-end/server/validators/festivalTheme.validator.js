import { body } from 'express-validator';
import { FESTIVAL_THEME_KEYS } from '../config/festivalThemes.js';

/** PUT /festival-theme/admin — shape only; window ordering is checked in the controller. */
export const validateUpdateFestivalTheme = [
  body('enabled').isBoolean().withMessage('enabled must be true or false').toBoolean(),
  body('themeKey').optional().isIn(FESTIVAL_THEME_KEYS).withMessage('Unknown festival theme'),
  body('startsAt').optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('Start must be a date and time'),
  body('endsAt').optional({ nullable: true, checkFalsy: true })
    .isISO8601().withMessage('End must be a date and time'),
];
