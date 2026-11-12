/**
 * Who may see whose Roav Points.
 *   admin        — everyone, plus rules / month close / export.
 *   GTM head     — every active GTM (sales team) member, and themself.
 *   anyone else  — their own figures only.
 * Name-only CRM reps (earnerKey 'r:…') have no login, so only an admin sees them.
 */
import { activeTeamMemberIds } from '../../repositories/incentiveRepository.js';
import AppError from '../../utils/AppError.js';
import { gtmRoleOf, STAFF_TEAMS } from '../../config/staff.js';

export const isAdmin = (user) => user?.role === 'admin';
export const isGtmHead = (user) => gtmRoleOf(user) === 'head';
export const selfKey = (user) => `u:${user._id}`;

/** Earner keys a head may see. */
export async function teamKeys(user) {
  const members = await activeTeamMemberIds(STAFF_TEAMS.SALES);
  const keys = new Set(members.map((m) => `u:${m._id}`));
  keys.add(selfKey(user));
  return [...keys];
}

/** null = no filter (admin); otherwise a Mongo filter on earnerKey. */
export async function teamFilter(user) {
  if (isAdmin(user)) return null;
  if (isGtmHead(user)) return { $in: await teamKeys(user) };
  throw new AppError('Only the GTM head or an admin can see team figures', 403, { expose: true });
}

export async function assertCanSee(user, earnerKey) {
  if (isAdmin(user) || earnerKey === selfKey(user)) return;
  if (isGtmHead(user) && (await teamKeys(user)).includes(earnerKey)) return;
  throw new AppError('Not authorized', 403);
}
