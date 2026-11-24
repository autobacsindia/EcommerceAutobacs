/**
 * Who owns a follow-up step, and who hears about each ladder level.
 *
 *   owner   the person who moved the item into the stage (parcel: who set its
 *           date / dispatched it), if they are still active staff on a team that
 *           works that stage. Otherwise (left, deactivated, the system, an admin,
 *           or someone from another team such as accounts paying a supplier) →
 *           the head of the stage's team → else "Admins".
 *   remind / due   the owner (Admins when the owner is Admins; the owner's team
 *           head when the owner has since left)
 *   head    the owner's OWN team head(s), never the owner themself → else admins
 *   admin   every admin
 * Within one ladder cycle nobody hears twice (an admin who got the head level as
 * the fallback does not get the admin level again).
 */
import userRepository from '../../repositories/userRepository.js';

const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

/** Everyone who can be alerted: admins and active staff. One query per sweep. */
export async function loadPeople(repo = userRepository) {
  const users = await repo.findChatUsers();
  const byId = new Map(users.map((u) => [idOf(u._id), u]));
  const admins = users.filter((u) => u.role === 'admin').sort(byName);
  const heads = new Map();
  for (const u of users) {
    if (!isActiveStaff(u) || u.staff.isHead !== true || !u.staff.team) continue;
    if (!heads.has(u.staff.team)) heads.set(u.staff.team, []);
    heads.get(u.staff.team).push(u);
  }
  for (const list of heads.values()) list.sort(byName);
  return { byId, admins, headsOf: (team) => heads.get(team) || [] };
}

const snapshot = (u, source) => ({ user: u._id, name: u.name || '', team: u.staff?.team || '', source });
const ADMINS = Object.freeze({ user: null, name: 'Admins', team: '', source: 'admins' });

/** The owner of `step` now, as stored on the row. */
export function resolveOwner(step, people) {
  const u = step.candidate?.user ? people.byId.get(idOf(step.candidate.user)) : null;
  if (isActiveStaff(u) && step.acceptTeams.includes(u.staff.team)) {
    return snapshot(u, step.itemKind === 'parcel' ? 'parcel' : 'mover');
  }
  const head = people.headsOf(step.team)[0];
  return head ? snapshot(head, 'team_head') : { ...ADMINS };
}

/**
 * The people (user docs) a level goes to, before the per-cycle de-duplication.
 * `owner` is the row's owner snapshot (ownerAtLate once late); `team` the step's team.
 */
export function recipientsFor(level, owner, team, people) {
  const ownerUser = owner?.user ? people.byId.get(idOf(owner.user)) : null;
  const ownerActive = isActiveStaff(ownerUser) || ownerUser?.role === 'admin';
  if (level === 'remind' || level === 'due') {
    if (ownerActive) return [ownerUser];
    const heads = people.headsOf(owner?.team || team);
    return heads.length ? heads : people.admins;
  }
  if (level === 'head') {
    const heads = people.headsOf(owner?.team || team).filter((h) => idOf(h._id) !== idOf(owner?.user));
    return heads.length ? heads : people.admins;
  }
  return people.admins;
}

/** Is `actor` the step's owner, a head of its team / the owner's team, or an admin? */
export function canActOn(actor, row) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (!isActiveStaff(actor)) return false;
  const owner = row.ownerAtLate || row.owner;
  if (owner?.user && idOf(owner.user) === idOf(actor._id)) return true;
  return actor.staff.isHead === true && [row.team, owner?.team].includes(actor.staff.team);
}

/** May `actor` excuse this delay? Heads of the team / owner's team, or an admin — never your own. */
export function canExcuse(actor, row) {
  if (!actor) return false;
  const owner = row.ownerAtLate || row.owner;
  if (owner?.user && idOf(owner.user) === idOf(actor._id)) return false;
  if (actor.role === 'admin') return true;
  return isActiveStaff(actor) && actor.staff.isHead === true && [row.team, owner?.team].includes(actor.staff.team);
}
