import { body, param, query } from 'express-validator';

const isObjectId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);

export const validateChannelIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid channel id'),
];

export const validateMessageIdParam = [
  param('id').custom(isObjectId).withMessage('Invalid message id'),
];

export const validateMessagePage = [
  query('before').optional().isInt({ min: 1 }).withMessage('Invalid cursor'),
  query('after').optional().isInt({ min: 0 }).withMessage('Invalid cursor'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
];

export const validateSendMessage = [
  // A message may be text, files, or both — the service rejects a truly empty one.
  body('text').optional({ values: 'falsy' }).isString().isLength({ max: 4000 }).withMessage('Message must be 4000 characters or fewer'),
  body('clientId').optional().isString().matches(/^[A-Za-z0-9_-]{8,64}$/).withMessage('Invalid client id'),
];

export const validateFilePage = [
  query('before').optional().isISO8601().withMessage('Invalid cursor'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
];

export const validateOrderPick = [
  query('q').optional().isString().isLength({ max: 80 }),
];

export const validateMarkRead = [
  body('seq').isInt({ min: 0 }).withMessage('Invalid position'),
];

export const validateCreateSpace = [
  body('name').isString().isLength({ min: 2, max: 60 }).withMessage('Space name must be 2-60 characters'),
  body('description').optional().isString().isLength({ max: 240 }),
  body('memberIds').optional().isArray({ max: 200 }),
  body('memberIds.*').optional().custom(isObjectId).withMessage('Invalid member id'),
];

export const validateOpenDm = [
  body('userId').custom(isObjectId).withMessage('Invalid person'),
];
