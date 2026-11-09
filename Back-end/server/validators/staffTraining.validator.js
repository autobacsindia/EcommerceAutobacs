/** Training validation: shape and bounds only. Rules are services/staffTrainingService.js. */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES } from '../config/staff.js';
import { TRAINING_STATUSES } from '../models/StaffTraining.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const cursor = query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor');

export const validateTrainingId = [param('id').custom(isObjectId).withMessage('Invalid id')];
export const validatePathList = [query('team').optional().isIn(STAFF_TEAM_VALUES).withMessage('Invalid team'), cursor];
export const validateLessonOptions = [query('team').isIn(STAFF_TEAM_VALUES).withMessage('Invalid team')];
export const validatePathCreate = [
  body('title').isString().withMessage('Give the training a job title'),
  body('team').isIn(STAFF_TEAM_VALUES).withMessage('Choose a team'),
  body('items').optional().isArray({ max: 100 }),
  body('questions').optional().isArray({ max: 100 }),
];
export const validatePathUpdate = [
  ...validateTrainingId,
  body('rev').isInt({ min: 0 }).withMessage('Reload and try again'),
  body('title').optional().isString(),
  body('items').optional().isArray({ max: 100 }),
  body('questions').optional().isArray({ max: 100 }),
];
export const validateAssign = [
  ...validateTrainingId,
  body('userId').custom(isObjectId).withMessage('Choose a person'),
  body('buddyId').custom(isObjectId).withMessage('Choose a buddy'),
];
export const validateAssignmentList = [
  query('view').optional().isIn(['mine', 'buddy', 'team']).withMessage('Invalid view'),
  query('status').optional().isIn(TRAINING_STATUSES).withMessage('Invalid status'),
  cursor,
];
export const validateSubmit = [
  ...validateTrainingId,
  body('attemptId').custom(isObjectId).withMessage('Test not found'),
  body('answers').isObject().withMessage('Invalid answers'),
];
export const validateMark = [
  ...validateTrainingId,
  body('attemptId').custom(isObjectId).withMessage('Test not found'),
  body('marks').isObject().withMessage('Invalid marks'),
];
