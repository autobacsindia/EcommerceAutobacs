/**
 * Shape checks for the team-panel leads sheet (/api/v1/staff/leads). Shape only:
 * who may act lives in services/teamLeadService.js, which re-checks everything.
 */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v) && String(v).length === 24;

export const validateTeamLeadList = [
  query('view').optional().isIn(['all', 'free', 'mine', 'person']).withMessage('Unknown list'),
  query('rep').optional().custom(isObjectId).withMessage('Invalid person'),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
  ...['q', 'status', 'sort'].map((n) => query(n).optional().isString().isLength({ max: 60 }).withMessage(`Invalid ${n}`)),
];

export const validateTeamLeadId = [
  param('id').custom(isObjectId).withMessage('Invalid lead'),
];

export const validateTeamLeadReassign = [
  ...validateTeamLeadId,
  body('userId').custom(isObjectId).withMessage('Pick a person'),
];
