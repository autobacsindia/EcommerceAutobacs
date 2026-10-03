/**
 * Staff access: invites, team lists, deactivation and invite redemption.
 *
 * The capability rules live here and nowhere else, so every entry point (team
 * panel, admin screen, tests) enforces the same ones:
 *
 *   - An ADMIN may invite heads or members to any team and remove anyone's access.
 *   - An active team HEAD may invite MEMBERS to their own team and remove members
 *     of their own team. A head can never create a head or an admin, can never act
 *     on another team, and can never remove another head or themselves.
 *   - Everyone else (members, customers) can grant nothing.
 *
 * Access is only granted when the emailed link is redeemed, which proves the
 * invitee controls the address. Removing access drops the account back to an
 * ordinary customer and revokes every session immediately.
 */

import bcrypt from 'bcryptjs';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import emailHandler from './emailHandler.js';
import staffInviteRepository from '../repositories/staffInviteRepository.js';
import userRepository from '../repositories/userRepository.js';
import { generateTokenPair, hashToken } from '../utils/tokenUtils.js';
import { revokeAllRefreshTokens } from '../utils/sessionManager.js';
import { staffInviteEmail } from '../utils/emailTemplates.js';
import { STAFF_TEAM_LABELS, STAFF_INVITE_TTL_MS, isStaffTeam } from '../config/staff.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const isAdmin = (actor) => actor?.role === 'admin';
const isActiveStaff = (actor) => actor?.role === 'staff' && actor.staff?.active === true;
const isActiveHead = (actor) => isActiveStaff(actor) && actor.staff.isHead === true;

const publicInvite = (invite) => ({
  id: String(invite._id),
  name: invite.name,
  email: invite.email,
  phone: invite.phone,
  team: invite.team,
  isHead: invite.isHead,
  expiresAt: invite.expiresAt,
  createdAt: invite.createdAt,
});

const publicMember = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  phone: user.phone || '',
  team: user.staff?.team,
  isHead: !!user.staff?.isHead,
  addedAt: user.staff?.addedAt || user.createdAt,
});

/** The staff profile the /team panel renders from. */
export const describeStaff = (user) => (isActiveStaff(user)
  ? { team: user.staff.team, teamLabel: STAFF_TEAM_LABELS[user.staff.team], isHead: !!user.staff.isHead }
  : null);

/**
 * Resolve which team an actor is acting on, refusing anything outside their scope.
 * Admins must name a team; heads and members are pinned to their own.
 */
function resolveTeamScope(actor, requestedTeam) {
  if (isAdmin(actor)) {
    if (!isStaffTeam(requestedTeam)) throw fail('Choose a team.', 400);
    return requestedTeam;
  }
  if (isActiveStaff(actor)) {
    if (requestedTeam && requestedTeam !== actor.staff.team) {
      throw fail('You can only manage your own team.', 403);
    }
    return actor.staff.team;
  }
  throw fail('Not authorized.', 403);
}

/** Active members and open invites for one team. Any active member may view their own team. */
export async function listTeam(actor, requestedTeam) {
  const team = resolveTeamScope(actor, requestedTeam);
  const [members, invites] = await Promise.all([
    userRepository.findActiveStaff(team),
    staffInviteRepository.findPendingByTeam(team),
  ]);
  const now = Date.now();
  return {
    team,
    teamLabel: STAFF_TEAM_LABELS[team],
    canManage: isAdmin(actor) || isActiveHead(actor),
    members: members.map(publicMember),
    invites: invites.map((i) => ({ ...publicInvite(i), expired: new Date(i.expiresAt).getTime() <= now })),
  };
}

/**
 * Invite someone to a team. Returns the invite and whether the email went out —
 * an invite that saved but failed to send is still revocable and re-sendable.
 */
export async function inviteMember(actor, input, req) {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const phone = String(input.phone || '').trim();
  const wantsHead = input.isHead === true;

  let team;
  if (isAdmin(actor)) {
    team = resolveTeamScope(actor, input.team);
  } else if (isActiveHead(actor)) {
    team = resolveTeamScope(actor, input.team);
    if (wantsHead) throw fail('Only an administrator can add a team head.', 403);
  } else {
    throw fail('Only a team head or an administrator can add people.', 403);
  }

  if (email === String(actor.email || '').toLowerCase()) {
    throw fail('You cannot invite yourself.', 400);
  }

  const existing = await userRepository.findByEmail(email);
  if (existing?.role === 'admin') {
    throw fail('This email belongs to an administrator account and cannot be added to a team.', 409);
  }
  if (isActiveStaff(existing)) {
    throw fail(`This person is already on the ${STAFF_TEAM_LABELS[existing.staff.team]} team.`, 409);
  }

  // A newer invite supersedes any older open one for the same address.
  await staffInviteRepository.revokeOpenForEmail(email, actor._id);

  const { token, hashedToken } = generateTokenPair();
  const invite = await staffInviteRepository.create({
    email,
    name,
    phone,
    team,
    isHead: isAdmin(actor) ? wantsHead : false,
    invitedBy: actor._id,
    tokenHash: hashedToken,
    expiresAt: new Date(Date.now() + STAFF_INVITE_TTL_MS),
  });

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const template = staffInviteEmail({
    name,
    teamLabel: STAFF_TEAM_LABELS[team],
    isHead: invite.isHead,
    inviterName: actor.name || 'Your team',
    acceptUrl: `${frontendUrl}/staff-invite?token=${token}`,
    expiresInHours: Math.round(STAFF_INVITE_TTL_MS / 3600000),
  });

  let emailSent = false;
  try {
    const result = await emailHandler.sendEmail({ to: email, ...template });
    emailSent = !!result?.success;
    if (!emailSent) console.error(`[Staff] Invite email NOT sent to ${email}: ${result?.error || 'email service unavailable'}`);
  } catch (err) {
    console.error(`[Staff] Invite email failed for ${email}: ${err?.message || 'unknown error'}`);
  }
  // Local development usually has no email service. Print the link so the flow can
  // still be exercised; never in production, where the link is a live credential.
  if (!emailSent && process.env.NODE_ENV === 'development') {
    console.log(`[Staff] DEV ONLY — invite link for ${email}: ${frontendUrl}/staff-invite?token=${token}`);
  }

  auditLogger.logAction(req, 'CREATE', 'StaffInvite', invite._id, {
    email, team, isHead: invite.isHead, existingAccount: !!existing, emailSent,
  });

  return { invite: publicInvite(invite), emailSent, existingAccount: !!existing };
}

/** Withdraw an open invite. Heads may only withdraw member invites for their own team. */
export async function revokeInvite(actor, inviteId, req) {
  const invite = await staffInviteRepository.findById(inviteId);
  if (!invite || invite.acceptedAt || invite.revokedAt) throw fail('Invite not found or already closed.', 404);

  if (!isAdmin(actor)) {
    if (!isActiveHead(actor) || invite.team !== actor.staff.team || invite.isHead) {
      throw fail('You cannot withdraw this invite.', 403);
    }
  }

  const revoked = await staffInviteRepository.revokeOpen(inviteId, actor._id);
  if (!revoked) throw fail('Invite not found or already closed.', 404);
  auditLogger.logAction(req, 'DELETE', 'StaffInvite', inviteId, { email: invite.email, team: invite.team });
  return publicInvite(revoked);
}

/**
 * Remove someone's staff access. They become an ordinary customer account and are
 * signed out everywhere at once (access token AND refresh tokens).
 */
export async function deactivateMember(actor, userId, req) {
  const target = await userRepository.findById(userId);
  if (!isActiveStaff(target)) throw fail('Staff member not found.', 404);
  if (String(target._id) === String(actor._id)) throw fail('You cannot remove your own access.', 400);

  if (!isAdmin(actor)) {
    if (!isActiveHead(actor) || target.staff.team !== actor.staff.team) {
      throw fail('You can only remove members of your own team.', 403);
    }
    if (target.staff.isHead) throw fail('Only an administrator can remove a team head.', 403);
  }

  const updated = await userRepository.revokeStaff(target._id, actor._id);
  if (!updated) throw fail('Staff member not found.', 404);

  // Kill refresh tokens too: bumping sessionVersion alone leaves the refresh path
  // able to mint new access tokens (see the password-reset route).
  await revokeAllRefreshTokens(updated);

  auditLogger.logAction(req, 'UPDATE', 'User', target._id, {
    change: 'staff_access_removed', team: target.staff.team, wasHead: target.staff.isHead,
  });
  return publicMember(target);
}

/**
 * Is the person who sent this invite still allowed to grant it? An invite from a
 * head who has since lost their role must not keep working.
 */
async function inviterStillAuthorised(invite) {
  const inviter = await userRepository.findById(invite.invitedBy);
  if (isAdmin(inviter)) return true;
  return isActiveHead(inviter) && inviter.staff.team === invite.team && !invite.isHead;
}

/** Public: what the invite page shows before the password is set. */
export async function verifyInvite(token) {
  const invite = await staffInviteRepository.findRedeemable(hashToken(String(token || '')));
  if (!invite || !(await inviterStillAuthorised(invite))) {
    throw fail('This invite link is invalid or has expired. Ask your team head to send a new one.', 400);
  }
  const existing = await userRepository.findByEmail(invite.email);
  return {
    name: invite.name,
    email: invite.email,
    team: invite.team,
    teamLabel: STAFF_TEAM_LABELS[invite.team],
    isHead: invite.isHead,
    existingAccount: !!existing,
  };
}

/** Public: redeem an invite by setting a password. Grants access exactly once. */
export async function acceptInvite(token, password, req) {
  const tokenHash = hashToken(String(token || ''));
  const pending = await staffInviteRepository.findRedeemable(tokenHash);
  if (!pending || !(await inviterStillAuthorised(pending))) {
    throw fail('This invite link is invalid or has expired. Ask your team head to send a new one.', 400);
  }

  // Claim first, atomically: a second submit of the same link finds nothing to claim.
  const invite = await staffInviteRepository.claim(tokenHash);
  if (!invite) {
    throw fail('This invite link is invalid or has expired. Ask your team head to send a new one.', 400);
  }

  try {
    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const staff = {
      team: invite.team,
      isHead: invite.isHead,
      active: true,
      addedBy: invite.invitedBy,
      addedAt: new Date(),
    };

    let user = await userRepository.findByEmail(invite.email);
    if (user?.role === 'admin') {
      throw fail('This email belongs to an administrator account and cannot be added to a team.', 409);
    }

    if (user) {
      user = await userRepository.grantStaff(user._id, { passwordHash, staff, phone: invite.phone });
      if (!user) throw fail('This account cannot be added to a team.', 409);
      // A password just changed on an existing account: end every old session.
      await revokeAllRefreshTokens(user);
    } else {
      user = await userRepository.create({
        name: invite.name,
        email: invite.email,
        phone: invite.phone,
        passwordHash,
        role: 'staff',
        staff,
        isVerified: true,
      });
    }

    await staffInviteRepository.setAcceptedUser(invite._id, user._id);
    auditLogger.logAction(req, 'UPDATE', 'User', user._id, {
      change: 'staff_access_granted', team: invite.team, isHead: invite.isHead, inviteId: String(invite._id),
    });

    return { email: user.email, team: invite.team, teamLabel: STAFF_TEAM_LABELS[invite.team] };
  } catch (err) {
    // The account write failed: hand the link back so it can be retried.
    await staffInviteRepository.unclaim(invite._id);
    throw err;
  }
}
