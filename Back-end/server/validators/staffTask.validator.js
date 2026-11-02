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
  query('view').optional().isIn(['mine', 'following', 'created', 'team']).withMessage('Invalid view'),
  query('state').optional().isIn(['open', 'done', 'archived']).withMessage('Invalid state'),
  query('due').optional().isIn(['overdue', 'today', 'late', 'week']).withMessage('Invalid due filter'),
  query('priority').optional().isIn(TASK_PRIORITIES).withMessage('Invalid priority'),
  query('q').optional().isString().isLength({ max: 100 }).withMessage('Search is too long'),
  query('assignee').optional().custom(isObjectId).withMessage('Invalid person'),
  query('team').optional().isIn([...STAFF_TEAM_VALUES, 'admin']).withMessage('Invalid team'),
  query('tag').optional().isString().isLength({ max: 60 }).withMessage('Invalid tag'),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
  // due (default) | newest | oldest | updated; anything else reads as due, so an old link still opens.
  query('sort').optional().isString().isLength({ max: 20 }).withMessage('Invalid sort'),
];

export const validateTaskCreate = [
  body('title').isString().withMessage('Give the task a title'),
  body('description').optional().isString(),
  body('priority').optional().isIn(TASK_PRIORITIES).withMessage('Invalid priority'),
  body('status').optional().isIn(['todo', 'in_progress', 'waiting']).withMessage('Invalid status'),
  body('dueOn').optional({ values: 'null' }).isString(),
  body('startOn').optional({ values: 'null' }).isString(),
  body('tags').optional().isArray({ max: 10 }).withMessage('A task can have at most 10 tags'),
  body('tags.*').isString().withMessage('Invalid tag'),
  optionalId('assigneeId'),
  body('assigneeIds').optional().isArray({ max: 30 }).withMessage('Pick at most 30 people'),
  body('assigneeIds.*').custom(isObjectId).withMessage('Invalid person'),
  body('shared').optional().isBoolean().withMessage('Invalid choice'),
  body('checklist').optional().isArray({ max: 30 }).withMessage('A checklist can have at most 30 steps'),
  body('checklist.*').isString().withMessage('Invalid step'),
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
  body('startOn').optional({ values: 'null' }).isString(),
  body('tags').optional().isArray({ max: 10 }).withMessage('A task can have at most 10 tags'),
  body('tags.*').isString().withMessage('Invalid tag'),
  body('archived').optional().isBoolean().withMessage('Invalid archive flag'),
  optionalId('assigneeId'),
  body('assigneeIds').optional().isArray({ min: 1, max: 30 }).withMessage('Keep between 1 and 30 people on a task'),
  body('assigneeIds.*').custom(isObjectId).withMessage('Invalid person'),
  optionalId('orderId'),
];

export const validateTaskFollowers = [
  ...validateTaskId,
  body('add').optional().isArray({ max: 50 }).withMessage('Add at most 50 followers'),
  body('add.*').custom(isObjectId).withMessage('Invalid person'),
  body('remove').optional().isArray({ max: 50 }).withMessage('Remove at most 50 followers'),
  body('remove.*').custom(isObjectId).withMessage('Invalid person'),
];

export const validateTaskBulk = [
  body('items').isArray({ min: 1, max: 50 }).withMessage('Pick between 1 and 50 tasks'),
  body('items.*.id').custom(isObjectId).withMessage('Invalid task id'),
  body('items.*.rev').isInt({ min: 1 }).withMessage('Reload the tasks and try again'),
  body('changes').isObject().withMessage('Pick what to change'),
  body('changes.status').optional().isIn(TASK_STATUSES).withMessage('Invalid status'),
  body('changes.priority').optional().isIn(TASK_PRIORITIES).withMessage('Invalid priority'),
  body('changes.dueOn').optional({ values: 'null' }).isString(),
  body('changes.assigneeId').optional().custom(isObjectId).withMessage('Invalid person'),
  body('changes.archived').optional().isBoolean().withMessage('Invalid archive flag'),
  body('changes.addTags').optional().isArray({ max: 10 }).withMessage('At most 10 tags'),
  body('changes.addTags.*').isString().withMessage('Invalid tag'),
  body('changes.removeTags').optional().isArray({ max: 10 }).withMessage('At most 10 tags'),
  body('changes.removeTags.*').isString().withMessage('Invalid tag'),
];

export const validateCommentList = [
  ...validateTaskId,
  query('before').optional().custom(isObjectId).withMessage('Invalid page cursor'),
];

// JSON, or multipart when files are attached (then `mentions` is a JSON string).
export const validateCommentCreate = [
  ...validateTaskId,
  body('text').optional().isString().withMessage('Write a comment first'),
  body('clientId').optional().isString().isLength({ max: 64 }),
  body('mentions').optional().custom((v) => Array.isArray(v) || (typeof v === 'string' && v.length <= 2000)).withMessage('Invalid mentions'),
];

const commentParams = [...validateTaskId, param('commentId').custom(isObjectId).withMessage('Invalid comment')];
export const validateCommentId = commentParams;
export const validateCommentEdit = [...commentParams, body('text').isString().withMessage('Write the comment first')];
export const validateCommentReaction = [
  ...commentParams,
  body('emoji').isString().isLength({ min: 1, max: 32 }).withMessage('Pick an emoji'),
  body('on').optional().isBoolean().withMessage('Invalid reaction'),
];
export const validateTaskFileName = [...validateTaskId, param('name').isString().isLength({ min: 1, max: 120 }).withMessage('File not found')];

const itemParams = [...validateTaskId, param('itemId').custom(isObjectId).withMessage('Invalid step')];

export const validateChecklistAdd = [
  ...validateTaskId,
  body('text').isString().withMessage('Write the step first'),
  body('clientId').optional().isString().isLength({ max: 64 }),
];

export const validateChecklistUpdate = [
  ...itemParams,
  body('done').optional().isBoolean().withMessage('Invalid tick'),
  body('text').optional().isString(),
];

export const validateChecklistRemove = itemParams;
