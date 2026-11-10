/**
 * The Meta leads tab — /api/v1/staff/meta-leads. Mounted inside routes/staff.js,
 * behind its protect + staffOrAdmin gate. services/metaLeadService.js owns who may
 * do what.
 */
import express from 'express';
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { validateTeamLeadFollowUp, validateTeamLeadReassign } from '../validators/staffLeads.validator.js';
import { FOLLOW_UP_STATUS_KEYS } from '../config/leadConstants.js';
import { listMetaLeads, getMetaLead, updateMetaLead } from '../services/metaLeadService.js';
import {
  metaLeadPeople, takeMetaLead, releaseMetaLead, reassignMetaLead, recordMetaLeadFollowUp,
} from '../services/metaLeadFollowUpService.js';

const router = express.Router();
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v) && String(v).length === 24;
const validId = param('id').custom(isObjectId).withMessage('Invalid lead');

router.get('/', [
  ...['q', 'tab'].map((n) => query(n).optional().isString().isLength({ max: 120 }).withMessage(`Invalid ${n}`)),
  query('view').optional().isIn(['all', 'free', 'mine']).withMessage('Unknown list'),
  query('owner').optional().custom(isObjectId).withMessage('Invalid person'),
  query('followUp').optional().isIn(['none', ...FOLLOW_UP_STATUS_KEYS]).withMessage('Unknown follow-up status'),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
], validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listMetaLeads(req.user, req.query)) });
}));

router.get('/people', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await metaLeadPeople(req.user)) });
}));

router.get('/:id', validId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await getMetaLead(req.user, req.params.id)) });
}));

// Someone saved first → 409 with their version, so the form can show it.
router.patch('/:id', [
  validId,
  body('revision').isInt({ min: 0 }).withMessage('Please reload and try again.'),
  body('changes').optional().isObject().withMessage('Invalid changes'),
  body('extras').optional().isObject().withMessage('Invalid changes'),
], validateRequest, asyncHandler(async (req, res) => {
  const { outcome, lead } = await updateMetaLead(req.user, req.params.id, req.body);
  if (outcome === 'changed') {
    return res.status(409).json({ success: false, outcome, message: 'Someone else just changed this lead. Check their version and try again.', lead });
  }
  res.json({ success: true, outcome, lead });
}));

/** Losing a race is not an error page: 409 with the lead, so the card shows where it stands. */
const answer = (res, { outcome, lead }, conflicts) => {
  if (conflicts[outcome]) return res.status(409).json({ success: false, outcome, message: conflicts[outcome](lead), lead });
  return res.json({ success: true, outcome, lead });
};
const CHANGED = () => 'Someone changed this lead just now. Check it and try again.';

router.post('/:id/follow-up', validId, validateRequest, asyncHandler(async (req, res) => {
  answer(res, await takeMetaLead(req.user, req.params.id), { taken: (l) => `${l.followingUp?.name ?? 'Someone'} is already following up on this lead.` });
}));

router.post('/:id/release', validId, validateRequest, asyncHandler(async (req, res) => {
  answer(res, await releaseMetaLead(req.user, req.params.id), { changed: CHANGED });
}));

router.post('/:id/reassign', validateTeamLeadReassign, validateRequest, asyncHandler(async (req, res) => {
  answer(res, await reassignMetaLead(req.user, req.params.id, req.body.userId), { changed: CHANGED });
}));

router.post('/:id/follow-ups', validateTeamLeadFollowUp, validateRequest, asyncHandler(async (req, res) => {
  answer(res, await recordMetaLeadFollowUp(req.user, req.params.id, req.body), {
    not_following: () => 'Click Follow up first, then record how it went.',
    changed: CHANGED,
  });
}));

export default router;
