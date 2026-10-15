/**
 * Staff teams — the internal roles that get their own panel at /team.
 *
 * A staff member is a User with `role: 'staff'` and a `staff` subdocument naming
 * their team. `role` stays a three-value enum (customer / staff / admin) so every
 * existing `role === 'admin'` check keeps meaning exactly what it meant: staff are
 * NOT admins and none of the admin API opens to them by accident.
 *
 * Who may grant access:
 *   - admin  → invites team HEADS (and members) to any team
 *   - head   → invites MEMBERS to their own team only; never heads, never admins
 * Access is only granted when the invitee accepts an emailed one-time link, which
 * is what proves they control the address (staff use personal emails).
 */

export const STAFF_TEAMS = Object.freeze({
  SALES: 'sales',
  PROCUREMENT: 'procurement',
  ACCOUNTS: 'accounts',
  MARKETING: 'marketing',
  // Delivery follow-up: sees every paid order and the supplier's shipping proof,
  // and marks parcels delivered.
  OPERATIONS: 'operations',
});

export const STAFF_TEAM_VALUES = Object.freeze(Object.values(STAFF_TEAMS));

export const STAFF_TEAM_LABELS = Object.freeze({
  sales: 'Sales',
  procurement: 'Procurement',
  accounts: 'Accounts',
  marketing: 'Marketing',
  operations: 'Operations',
});

/** How long an emailed invite link stays usable. Personal inboxes are read late. */
export const STAFF_INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export const isStaffTeam = (value) => STAFF_TEAM_VALUES.includes(value);

/*
  Company accounts — staff logins the company owns.

  An invite grants access to a person's own (usually Gmail) account, so when
  they leave, the account — and every way back into it (their inbox, Google
  sign-in, "forgot password") — leaves with them. A company account is created
  by an admin or team head with a username and a password they set. It has no
  real mailbox: forgot-password and Google sign-in cannot reach it, only an
  admin or head can reset it, and removing access blocks the login outright.
  Everything the person did stays attached to the account.

  `email` is required and unique on every User, so a company account gets an
  internal address under the reserved `.invalid` TLD (RFC 2606): it can never
  receive mail, and emailHandler refuses to send to it.
*/
export const STAFF_USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/;
export const STAFF_USERNAME_HINT = '3–30 characters: lowercase letters, numbers, dot, dash or underscore';
export const COMPANY_EMAIL_DOMAIN = 'staff.autobacs.invalid';

export const companyEmailFor = (username) => `${username}@${COMPANY_EMAIL_DOMAIN}`;
export const isCompanyEmail = (email) => String(email || '').toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN}`);
export const normaliseUsername = (value) => String(value || '').trim().toLowerCase();
export const isValidStaffUsername = (value) => STAFF_USERNAME_PATTERN.test(normaliseUsername(value));
