/**
 * The company's internal teams — one list for the whole frontend.
 *
 * Must stay in step with `STAFF_TEAMS` in Back-end/server/config/staff.js, which
 * is what the API validates against. A team missing here is simply unreachable
 * from the screens even though the server would accept it.
 *
 * This used to be written out in four places (the members panel, both payments
 * pages and the chat composer) and they had already drifted: the admin's
 * payments filter offered Procurement, Operations and Marketing only, so an
 * expense raised by GTM or Accounts could not be filtered for at all. One list,
 * and TypeScript catches the next team everywhere it is used.
 *
 * `sales` is the stored value; "GTM" is what people read — renaming the key
 * would be a data migration across staff accounts, chat spaces and orders for
 * no visible gain.
 */
export const STAFF_TEAM_LABELS = {
  sales: 'GTM',
  procurement: 'Procurement',
  accounts: 'Accounts',
  marketing: 'Marketing',
  operations: 'Operations',
  developer: 'Developer',
} as const;

export type StaffTeam = keyof typeof STAFF_TEAM_LABELS;

export const STAFF_TEAMS = Object.keys(STAFF_TEAM_LABELS) as StaffTeam[];

/** `[{ value, label }]` — for the team filters and pickers. */
export const STAFF_TEAM_OPTIONS = STAFF_TEAMS.map((value) => ({
  value,
  label: STAFF_TEAM_LABELS[value],
}));
