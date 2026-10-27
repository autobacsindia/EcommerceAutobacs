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
 * Two ways in:
 *   - an INVITE to the person's own email, granted when they redeem the link
 *     (proves they control the address); the account stays theirs;
 *   - a COMPANY ACCOUNT (username + password set by an admin or head), which the
 *     company owns: only an admin or head can reset its password, and removing
 *     access blocks its login. See config/staff.js.
 * Removing access revokes every session immediately.
 *
 * Passwords: an encrypted copy of every staff password is kept (staffPasswordView,
 * utils/fieldEncryption.js) so the admin can look any of them up, and a head those
 * of their own team's members — the owner's decision. Every look-up is audit-logged.
 */

import bcrypt from 'bcryptjs';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import emailHandler from './emailHandler.js';
import staffInviteRepository from '../repositories/staffInviteRepository.js';
import userRepository from '../repositories/userRepository.js';
import { generateTokenPair, hashToken } from '../utils/tokenUtils.js';
import { revokeAllRefreshTokens } from '../utils/sessionManager.js';
import { encryptField, decryptField } from '../utils/fieldEncryption.js';
import { staffInviteEmail } from '../utils/emailTemplates.js';
import {
  STAFF_TEAM_LABELS, STAFF_INVITE_TTL_MS, isStaffTeam,
  companyEmailFor, isCompanyEmail, normaliseUsername, isValidStaffUsername, STAFF_USERNAME_HINT,
  STAFF_TEAMS, GTM_SUB_ROLE_VALUES, gtmRoleOf, canSell, staffRoleLabel,
} from '../config/staff.js';

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

/**
 * May `actor` look up `target`'s password? The admin: any staff member. A head: the
 * members of their own team — not another head, and not their own (the admin's).
 */
export const canViewPassword = (actor, target) => {
  if (!target || target.role !== 'staff' || target.staff?.active !== true) return false;
  if (isAdmin(actor)) return true;
  return isActiveHead(actor)
    && target.staff.team === actor.staff.team
    && !target.staff.isHead
    && String(target._id) !== String(actor._id);
};

/**
 * The encrypted copy to store beside a new password. Never blocks setting the
 * password itself: without FIELD_ENCRYPTION_KEY no copy is kept and "Show" says so.
 */
const passwordCopy = (password) => {
  try {
    return encryptField(String(password)) || null;
  } catch (err) {
    console.error('[Staff] Password copy not stored:', err.message);
    return null;
  }
};

const publicMember = (user) => ({
  id: String(user._id),
  name: user.name,
  // A company account's address is internal (`.invalid`) — show its username instead.
  email: user.companyAccount || isCompanyEmail(user.email) ? '' : user.email,
  username: user.username || null,
  companyAccount: !!user.companyAccount,
  phone: user.phone || '',
  team: user.staff?.team,
  isHead: !!user.staff?.isHead,
  subRole: gtmRoleOf(user) && gtmRoleOf(user) !== 'head' ? gtmRoleOf(user) : null,
  roleLabel: staffRoleLabel(user),
  addedAt: user.staff?.addedAt || user.createdAt,
});

/** The staff profile the /team panel renders from. */
export const describeStaff = (user) => (isActiveStaff(user)
  ? {
    team: user.staff.team,
    teamLabel: STAFF_TEAM_LABELS[user.staff.team],
    isHead: !!user.staff.isHead,
    // GTM roles (config/staff.js): what the panel shows and which tools it offers.
    gtmRole: gtmRoleOf(user),
    roleLabel: staffRoleLabel(user),
    canSell: canSell(user),
  }
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
    members: members.map((m) => ({ ...publicMember(m), canViewPassword: canViewPassword(actor, m) })),
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
 * Admin edits a team member: name, mobile, username (company logins), team,
 * head, GTM role. Their history stays attached — it is the same account.
 *
 * Name / mobile only: nothing else changes. A change to team, head or GTM role
 * changes what they may do, so every session ends and they sign in again under
 * the new permissions. A username change moves the company login (and its
 * internal address) with it.
 */
export async function updateMember(actor, userId, input = {}, req) {
  if (!isAdmin(actor)) throw fail('Only an administrator can edit team members.', 403);
  const target = await userRepository.findById(userId);
  if (!isActiveStaff(target)) throw fail('Staff member not found.', 404);

  const set = {};
  const changed = [];
  if (input.name !== undefined && input.name !== target.name) { set.name = String(input.name).trim(); changed.push('name'); }
  if (input.phone !== undefined && input.phone !== target.phone) { set.phone = String(input.phone).trim(); changed.push('phone'); }

  if (input.username !== undefined) {
    const username = normaliseUsername(input.username);
    if (username !== target.username) {
      if (!target.companyAccount) throw fail('Only a company login has a username — this person signs in with their own email.', 400);
      if (!isValidStaffUsername(username)) throw fail(`Username: ${STAFF_USERNAME_HINT}.`, 400);
      const taken = await userRepository.findByUsername(username);
      if (taken && String(taken._id) !== String(target._id)) throw fail('That username is already taken.', 409);
      set.username = username;
      set.email = companyEmailFor(username);
      changed.push('username');
    }
  }

  const team = input.team !== undefined ? input.team : target.staff.team;
  if (!isStaffTeam(team)) throw fail('Choose a team.', 400);
  const isHead = input.isHead !== undefined ? input.isHead === true : !!target.staff.isHead;
  // GTM only: a head has no sub-role; a member keeps (or gets) one, defaulting to lead.
  let subRole = input.subRole !== undefined ? input.subRole : (target.staff.subRole ?? null);
  if (team !== STAFF_TEAMS.SALES || isHead) subRole = null;
  if (subRole && !GTM_SUB_ROLE_VALUES.includes(subRole)) throw fail('Choose a GTM role.', 400);

  const permissionsChange = team !== target.staff.team || isHead !== !!target.staff.isHead
    || (subRole ?? null) !== (target.staff.subRole ?? null);
  if (permissionsChange) {
    set['staff.team'] = team;
    set['staff.isHead'] = isHead;
    set['staff.subRole'] = subRole ?? undefined;
    changed.push('role');
  }
  if (changed.length === 0) return publicMember(target);

  let updated;
  try {
    updated = await userRepository.updateActiveStaff(target._id, set, { bumpSession: permissionsChange || changed.includes('username') });
  } catch (err) {
    if (err?.code === 11000) throw fail('That username is already taken.', 409);
    throw err;
  }
  if (!updated) throw fail('Staff member not found.', 404);
  if (permissionsChange || changed.includes('username')) await revokeAllRefreshTokens(updated);

  auditLogger.logAction(req, 'UPDATE', 'User', target._id, {
    change: 'staff_member_edited', fields: changed,
    from: { team: target.staff.team, isHead: !!target.staff.isHead, subRole: target.staff.subRole ?? null, username: target.username ?? null },
    to: { team, isHead, subRole: subRole ?? null, username: set.username ?? target.username ?? null },
  });
  return publicMember(updated);
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
    const passwordView = passwordCopy(password);
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
      user = await userRepository.grantStaff(user._id, { passwordHash, staff, phone: invite.phone, passwordView });
      if (!user) throw fail('This account cannot be added to a team.', 409);
      // A password just changed on an existing account: end every old session.
      await revokeAllRefreshTokens(user);
    } else {
      user = await userRepository.create({
        name: invite.name,
        email: invite.email,
        phone: invite.phone,
        passwordHash,
        ...(passwordView && { staffPasswordView: passwordView }),
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

// ── Company accounts ────────────────────────────────────────────────────────────

const hashPassword = async (password) => bcrypt.hash(String(password), await bcrypt.genSalt(10));

/**
 * Create a company-owned staff login. Same authority as an invite: an admin for
 * any team (heads or members), a head for members of their own team only. The
 * password is the creator's and stays theirs to manage: the person signs in with
 * it as given, and only an admin (or their head) changes it.
 */
export async function createCompanyAccount(actor, input, req) {
  const name = String(input.name || '').trim();
  const phone = String(input.phone || '').trim();
  const username = normaliseUsername(input.username);
  const wantsHead = input.isHead === true;
  const subRole = input.subRole ? String(input.subRole) : null;

  let team;
  if (isAdmin(actor)) {
    team = resolveTeamScope(actor, input.team);
  } else if (isActiveHead(actor)) {
    team = resolveTeamScope(actor, input.team);
    if (wantsHead) throw fail('Only an administrator can add a team head.', 403);
  } else {
    throw fail('Only a team head or an administrator can add people.', 403);
  }

  if (subRole && (team !== STAFF_TEAMS.SALES || !GTM_SUB_ROLE_VALUES.includes(subRole))) {
    throw fail('A role (GTM lead, GTM executive, Customer support) applies to the GTM team only.', 400);
  }
  if (!isValidStaffUsername(username)) throw fail(`Username: ${STAFF_USERNAME_HINT}.`, 400);
  if (await userRepository.findByUsername(username)) throw fail('That username is already taken.', 409);
  const email = companyEmailFor(username);
  if (await userRepository.findByEmail(email)) throw fail('That username is already taken.', 409);

  const passwordView = passwordCopy(input.password);
  let user;
  try {
    user = await userRepository.create({
      name,
      email,
      username,
      phone,
      passwordHash: await hashPassword(input.password),
      ...(passwordView && { staffPasswordView: passwordView }),
      role: 'staff',
      companyAccount: true,
      isVerified: true,
      staff: {
        team,
        isHead: isAdmin(actor) ? wantsHead : false,
        // GTM: a head has no sub-role; a member defaults to lead.
        ...(team === STAFF_TEAMS.SALES && !(isAdmin(actor) && wantsHead) && subRole ? { subRole } : {}),
        active: true,
        addedBy: actor._id,
        addedAt: new Date(),
      },
    });
  } catch (err) {
    // Two people creating the same username at once: the unique index decides.
    if (err?.code === 11000) throw fail('That username is already taken.', 409);
    throw err;
  }

  auditLogger.logAction(req, 'CREATE', 'User', user._id, {
    change: 'staff_company_account_created', team, isHead: !!user.staff?.isHead, subRole: user.staff?.subRole || null, username,
  });
  return publicMember(user);
}

/**
 * Set a new password on a company account — whenever the admin decides: a
 * routine change, a forgotten password, or someone leaving. Same authority as
 * removing access. Ends every session on the account at once, so the old
 * password stops working everywhere immediately.
 */
export async function resetCompanyPassword(actor, userId, password, req) {
  const target = await userRepository.findById(userId);
  if (!isActiveStaff(target)) throw fail('Staff member not found.', 404);
  if (!target.companyAccount) {
    throw fail('This person signs in with their own email — they can reset it from the login page.', 400);
  }
  if (String(target._id) === String(actor._id)) throw fail('Change your own password from your profile.', 400);
  if (!isAdmin(actor)) {
    if (!isActiveHead(actor) || target.staff.team !== actor.staff.team) {
      throw fail('You can only reset passwords for your own team.', 403);
    }
    if (target.staff.isHead) throw fail('Only an administrator can reset a team head\'s password.', 403);
  }

  const updated = await userRepository.setStaffPassword(target._id, await hashPassword(password), passwordCopy(password));
  if (!updated) throw fail('Staff member not found.', 404);
  await revokeAllRefreshTokens(updated);

  auditLogger.logAction(req, 'UPDATE', 'User', target._id, { change: 'staff_password_reset', team: target.staff.team });
  return publicMember(updated);
}

/**
 * A staff member changes their own password. Only for people who sign in with
 * their own email: a company account's password belongs to the company and is
 * changed by the admin (resetCompanyPassword), never by the person. Proves the
 * current one, so a session left open on a shared computer cannot lock the
 * owner out.
 */
export async function changeOwnPassword(actor, { currentPassword, newPassword }, req) {
  if (!isActiveStaff(actor)) throw fail('Not authorized.', 403);
  if (actor.companyAccount) throw fail('Your password is managed by your administrator. Ask them to change it.', 403);
  const user = await userRepository.findById(actor._id);
  if (!user?.passwordHash || !(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) {
    throw fail('Your current password is not correct.', 400);
  }
  if (String(currentPassword) === String(newPassword)) throw fail('Choose a password different from the current one.', 400);

  const updated = await userRepository.setStaffPassword(user._id, await hashPassword(newPassword), passwordCopy(newPassword));
  if (!updated) throw fail('Not authorized.', 403);
  // Other devices sign out; this one gets fresh cookies from the route.
  await revokeAllRefreshTokens(updated);
  auditLogger.logAction(req, 'UPDATE', 'User', user._id, { change: 'staff_password_changed' });
  return updated;
}

/**
 * Look up a staff member's current password (team panel "Show"). The admin: anyone;
 * a head: their own team's members (canViewPassword). Audit-logged every time.
 *
 * The copy is checked against the login password before it is shown, so a password
 * set some other way since (a "forgot password" link, or before this existed) reads
 * `{ password: null, reason: 'not_saved' }` — "set a new one" — never a stale value.
 *
 * @returns {Promise<{ password: string|null, reason: 'not_saved'|null }>}
 */
export async function getMemberPassword(actor, userId, req) {
  const target = await userRepository.findStaffPasswordView(userId);
  if (!target || target.role !== 'staff' || target.staff?.active !== true) throw fail('Staff member not found.', 404);
  if (!canViewPassword(actor, target)) {
    throw fail(isAdmin(actor) || isActiveHead(actor)
      ? 'You can see passwords for your own team\'s members only.'
      : 'Only an administrator or the team head can see passwords.', 403);
  }

  let password = null;
  if (target.staffPasswordView && target.passwordHash) {
    try {
      const plain = decryptField(target.staffPasswordView);
      if (await bcrypt.compare(String(plain), target.passwordHash)) password = String(plain);
    } catch (err) {
      console.error(`[Staff] Could not read the password copy for ${target._id}:`, err.message);
    }
  }

  auditLogger.logAction(req, 'READ_SENSITIVE', 'User', target._id, {
    change: 'staff_password_viewed', team: target.staff.team, shown: !!password,
  });
  return { password, reason: password ? null : 'not_saved' };
}

