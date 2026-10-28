/**
 * Staff task validation (express-validator). Pair each chain with `validateRequest`.
 *
 * Shape and bounds only. Who may give, see or change a task is decided by
 * services/staffTaskService.js, which sees the acting user — and which also
 * cleans every body field itself, so these chains only reject what is plainly
 * malformed.
 */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES } from '../config/staff.js';
import { TASK_STATUSES, TASK_PRIORITIES } from '../models/StaffTask.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const optionalId = (field) => body(field).optional({ values: 'null' })
  .custom((v) => v === '' || isObjectId(v)).withMessage(`Invalid ${field}`);

export const validateTaskId = [param('id').custom(isObjectId).withMessage('Invalid task id')];

export const validateTaskList = [
  query('view').optional().isIn(['mine', 'created', 'team']).withMessage('Invalid view'),
  query('state').optional().isIn(['open', 'done', 'archived']).withMessage('Invalid state'),
  query('due').optional().isIn(['overdue', 'today', 'late']).withMessage('Invalid due filter'),
  query('assignee').optional().custom(isObjectId).withMessage('Invalid person'),
  query('team').optional().isIn([...STAFF_TEAM_VALUES, 'admin']).withMessage('Invalid team'),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
];

export const validateTaskCreate = [
  body('title').isString().withMessage('Give the task a title'),
  body('description').optional().isString(),
  body('priority').optional().isIn(TASK_PRIORITIES).withMessage('Invalid priority'),
  body('dueOn').optional({ values: 'null' }).isString(),
  optionalId('assigneeId'),
  body('assigneeIds').optional().isArray({ max: 30 }).withMessage('Pick at most 30 people'),
  body('assigneeIds.*').custom(isObjectId).withMessage('Invalid person'),
  optionalId('orderId'),
  body('clientId').optional().isString().isLength({ max: 64 }),
];

export const validateTaskUpdate = [
  ...validateTaskId,
  body('rev').isInt({ min: 1 }).withMessage('Reload the task and try again'),
  body('title').optional().isString(),
  body('description').optional().isString(),
  body('priority').optional().isIn(TASK_PRIORITIES).withMessage('Invalid priority'),
  body('status').optional().isIn(TASK_STATUSES).withMessage('Invalid status'),
  body('dueOn').optional({ values: 'null' }).isString(),
  body('archived').optional().isBoolean().withMessage('Invalid archive flag'),
  optionalId('assigneeId'),
  optionalId('orderId'),
];

export const validateCommentList = [
  ...validateTaskId,
  query('before').optional().custom(isObjectId).withMessage('Invalid page cursor'),
];

export const validateCommentCreate = [
  ...validateTaskId,
  body('text').isString().withMessage('Write a comment first'),
  body('clientId').optional().isString().isLength({ max: 64 }),
];
