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
});

export const STAFF_TEAM_VALUES = Object.freeze(Object.values(STAFF_TEAMS));

export const STAFF_TEAM_LABELS = Object.freeze({
  sales: 'Sales',
  procurement: 'Procurement',
  accounts: 'Accounts',
  marketing: 'Marketing',
});

/** How long an emailed invite link stays usable. Personal inboxes are read late. */
export const STAFF_INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export const isStaffTeam = (value) => STAFF_TEAM_VALUES.includes(value);
