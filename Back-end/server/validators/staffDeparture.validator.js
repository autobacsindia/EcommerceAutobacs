/** Departure validation: shape and bounds only. Rules are services/staffDepartureService.js. */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const blankOrId = (v) => v === '' || v === null || isObjectId(v);

export const validateDepartureId = [param('id').custom(isObjectId).withMessage('Invalid id')];
export const validateDepartureList = [query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor')];
export const validateDepartureCreate = [
  body('userId').custom(isObjectId).withMessage('Choose who is leaving'),
  body('lastDay').isString().withMessage('Choose a last day'),
  body('reason').optional().isString(),
  body('successorId').optional({ nullable: true }).custom(blankOrId).withMessage('Choose who takes over'),
];
export const validateDepartureUpdate = [
  ...validateDepartureId,
  body('rev').isInt({ min: 0 }).withMessage('Reload and try again'),
  body('lastDay').optional().isString(),
  body('reason').optional().isString(),
  body('note').optional().isString(),
  body('successorId').optional({ nullable: true }).custom(blankOrId).withMessage('Choose who takes over'),
];
