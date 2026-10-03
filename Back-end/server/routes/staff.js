import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  authenticatedUserRateLimit,
  resetPasswordRateLimit,
  verifyEmailRateLimit,
} from '../middleware/rateLimitMiddleware.js';
import {
  validateTeamQuery,
  validateStaffInvite,
  validateInviteIdParam,
  validateMemberIdParam,
  validateInviteToken,
  validateAcceptInvite,
} from '../validators/staff.validator.js';
import {
  describeStaff,
  listTeam,
  inviteMember,
  revokeInvite,
  deactivateMember,
  verifyInvite,
  acceptInvite,
} from '../services/staffService.js';

/**
 * Staff panel API (/api/v1/staff). Two halves:
 *   - public invite redemption (the invitee has no account yet)
 *   - the signed-in panel (active staff or admin; scope enforced in staffService)
 */
const router = express.Router();

// ── Public: invite redemption ────────────────────────────────────────────────

// @route  GET /staff/invites/verify?token=
router.get('/invites/verify', verifyEmailRateLimit, validateInviteToken, validateRequest,
  asyncHandler(async (req, res) => {
    const invite = await verifyInvite(req.query.token);
    res.json({ success: true, invite });
  }));

// @route  POST /staff/invites/accept  { token, password }
router.post('/invites/accept', resetPasswordRateLimit, validateAcceptInvite, validateRequest,
  asyncHandler(async (req, res) => {
    const result = await acceptInvite(req.body.token, req.body.password, req);
    res.json({ success: true, message: 'Your access is active. Sign in to continue.', ...result });
  }));

// ── Signed-in panel ──────────────────────────────────────────────────────────

router.use(authenticatedUserRateLimit, protect, staffOrAdmin);

// @route  GET /staff/me — the caller's team profile (null for an admin)
router.get('/me', (req, res) => {
  res.json({ success: true, staff: describeStaff(req.user), isAdmin: req.user.role === 'admin' });
});

// @route  GET /staff/team?team= — members + open invites
router.get('/team', validateTeamQuery, validateRequest, asyncHandler(async (req, res) => {
  const data = await listTeam(req.user, req.query.team);
  res.json({ success: true, ...data });
}));

// @route  POST /staff/invites  { name, email, phone, team?, isHead? }
router.post('/invites', validateStaffInvite, validateRequest, asyncHandler(async (req, res) => {
  const result = await inviteMember(req.user, req.body, req);
  res.status(201).json({ success: true, ...result });
}));

// @route  DELETE /staff/invites/:id — withdraw an open invite
router.delete('/invites/:id', validateInviteIdParam, validateRequest, asyncHandler(async (req, res) => {
  const invite = await revokeInvite(req.user, req.params.id, req);
  res.json({ success: true, invite });
}));

// @route  POST /staff/members/:id/deactivate — remove someone's staff access
router.post('/members/:id/deactivate', validateMemberIdParam, validateRequest, asyncHandler(async (req, res) => {
  const member = await deactivateMember(req.user, req.params.id, req);
  res.json({ success: true, member });
}));

export default router;
