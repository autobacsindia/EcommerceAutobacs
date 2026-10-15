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

// The team stored as 'sales' is called GTM (go-to-market) everywhere a person
// reads it. The key stays 'sales' on purpose: staff accounts, chat spaces and
// orders already carry it, and a key rename would be a data migration for no
// visible gain.
export const STAFF_TEAM_LABELS = Object.freeze({
  sales: 'GTM',
  procurement: 'Procurement',
  accounts: 'Accounts',
  marketing: 'Marketing',
  operations: 'Operations',
});

/** How long an emailed invite link stays usable. Personal inboxes are read late. */
export const STAFF_INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export const isStaffTeam = (value) => STAFF_TEAM_VALUES.includes(value);

/*
  Roles inside GTM. The head is `staff.isHead`; everyone else has a `subRole`:
    lead       — sells: sales orders, payment links, quotations, customer
                 decisions. Every GTM member from before roles existed is a lead
                 (no subRole stored), so nothing they could do changes.
    executive  — GTM executive: signs in; tools to come.
    support    — customer support: signs in; tools to come.
*/
export const GTM_SUB_ROLES = Object.freeze({ LEAD: 'lead', EXECUTIVE: 'executive', SUPPORT: 'support' });
export const GTM_SUB_ROLE_VALUES = Object.freeze(Object.values(GTM_SUB_ROLES));
export const GTM_SUB_ROLE_LABELS = Object.freeze({ lead: 'GTM lead', executive: 'GTM executive', support: 'Customer support' });

const isActiveStaffUser = (u) => u?.role === 'staff' && u.staff?.active === true;

/** A GTM member's role: 'head', or their sub-role ('lead' when none is stored). */
export function gtmRoleOf(user) {
  if (!isActiveStaffUser(user) || user.staff.team !== STAFF_TEAMS.SALES) return null;
  if (user.staff.isHead) return 'head';
  return GTM_SUB_ROLE_VALUES.includes(user.staff.subRole) ? user.staff.subRole : GTM_SUB_ROLES.LEAD;
}

/** May this person sell (sales orders, links, quotations, customer decisions)? The GTM head and GTM leads. */
export const canSell = (user) => ['head', GTM_SUB_ROLES.LEAD].includes(gtmRoleOf(user));

/** What to call this person's role: "GTM head", "GTM lead", "Procurement head", "Member"… */
export function staffRoleLabel(user) {
  const gtm = gtmRoleOf(user);
  if (gtm === 'head') return 'GTM head';
  if (gtm) return GTM_SUB_ROLE_LABELS[gtm];
  if (!isActiveStaffUser(user)) return null;
  return user.staff.isHead ? `${STAFF_TEAM_LABELS[user.staff.team]} head` : 'Member';
}

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
