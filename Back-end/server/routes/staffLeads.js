/**
 * The GTM leads sheet — /api/v1/staff/leads. Mounted inside routes/staff.js, behind
 * its protect + staffOrAdmin gate and authenticated rate limit. Thin shell over
 * services/teamLeadService.js, which owns who may do what.
 *
 *   see the sheet + history     everyone in GTM, admin
 *   follow up                   GTM head, GTM leads, admin
 *   stop following up           the person following up, GTM head, admin
 *   reassign                    GTM head, admin
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { validateTeamLeadList, validateTeamLeadId, validateTeamLeadReassign } from '../validators/staffLeads.validator.js';
import {
  listTeamLeads, teamLeadPeople, getTeamLead, followUp, releaseLead, reassignLead,
} from '../services/teamLeadService.js';

const router = express.Router();

// @route  GET /staff/leads?view=all|free|mine|person&rep=&status=&q=&sort=&cursor=
router.get('/', validateTeamLeadList, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listTeamLeads(req.user, req.query)) });
}));

// @route  GET /staff/leads/people
router.get('/people', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await teamLeadPeople(req.user)) });
}));

// @route  GET /staff/leads/:id
router.get('/:id', validateTeamLeadId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await getTeamLead(req.user, req.params.id)) });
}));

// @route  POST /staff/leads/:id/follow-up
// Someone else got there first → 409 with the lead, so the screen shows who has it.
router.post('/:id/follow-up', validateTeamLeadId, validateRequest, asyncHandler(async (req, res) => {
  const { outcome, lead } = await followUp(req.user, req.params.id);
  if (outcome === 'taken') {
    return res.status(409).json({ success: false, outcome, message: `${lead.followingUp.name} is already following up on this lead.`, lead });
  }
  if (outcome === 'closed') {
    return res.status(409).json({ success: false, outcome, message: 'This lead is closed.', lead });
  }
  res.json({ success: true, outcome, lead });
}));

// @route  POST /staff/leads/:id/release
router.post('/:id/release', validateTeamLeadId, validateRequest, asyncHandler(async (req, res) => {
  const { outcome, lead } = await releaseLead(req.user, req.params.id);
  if (outcome === 'changed') {
    return res.status(409).json({ success: false, outcome, message: 'Someone changed this lead just now.', lead });
  }
  res.json({ success: true, outcome, lead });
}));

// @route  POST /staff/leads/:id/reassign { userId }
router.post('/:id/reassign', validateTeamLeadReassign, validateRequest, asyncHandler(async (req, res) => {
  const { outcome, lead } = await reassignLead(req.user, req.params.id, req.body.userId);
  if (outcome === 'changed') {
    return res.status(409).json({ success: false, outcome, message: 'Someone changed this lead just now.', lead });
  }
  res.json({ success: true, outcome, lead });
}));

export default router;
