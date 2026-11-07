/**
 * Shape checks for the team-panel leads sheet (/api/v1/staff/leads). Shape only:
 * who may act lives in services/teamLeadService.js, which re-checks everything.
 */
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { FOLLOW_UP_STATUS_KEYS, FOLLOW_UP_NOTE_MAX } from '../config/leadConstants.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v) && String(v).length === 24;

export const validateTeamLeadList = [
  query('view').optional().isIn(['all', 'free', 'mine', 'person']).withMessage('Unknown list'),
  query('rep').optional().custom(isObjectId).withMessage('Invalid person'),
  query('followUp').optional().isIn(['none', ...FOLLOW_UP_STATUS_KEYS]).withMessage('Unknown follow-up status'),
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

// Shape only; the service re-checks (and owns the "Others needs a note" rule's wording).
export const validateTeamLeadFollowUp = [
  ...validateTeamLeadId,
  body('status').isIn(FOLLOW_UP_STATUS_KEYS).withMessage('Pick how the follow-up went.'),
  body('note').optional({ nullable: true }).isString().withMessage('The note must be text.')
    .bail().isLength({ max: FOLLOW_UP_NOTE_MAX + 50 }).withMessage(`Keep the note under ${FOLLOW_UP_NOTE_MAX} characters.`),
];
