/**
 * The GTM leads sheet in the team panel (/team/leads → /api/v1/staff/leads).
 *
 * The same Lead documents the admin CRM (/admin/leads) works, so a follow-up
 * taken here shows in admin under the same name, and the other way round.
 * Ownership is `Lead.assignedRep` (a SalesRep); a GTM login's SalesRep is found
 * or created on first use (SalesRep.user), exactly as sales orders do.
 *
 * Who may do what:
 *   see the sheet           everyone in GTM (head, leads, executives, support), admin
 *   follow up (claim)       GTM head, GTM leads (canSell), admin
 *   stop following up       the person following up, GTM head, admin
 *   reassign                GTM head, admin
 *   phone / e-mail          the person following up, GTM head, admin — so two
 *                           people never ring the same customer
 *
 * Every claim / release / reassign is a compare-and-set on the owner the caller
 * saw (repositories/leadRepository.js), so concurrent clicks resolve to exactly
 * one winner and the history never records a move that did not happen.
 */

import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import leadRepository from '../repositories/leadRepository.js';
import salesRepRepository from '../repositories/salesRepRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, canSell, gtmRoleOf } from '../config/staff.js';
import { LEAD_STATUSES, OPEN_LEAD_STATUSES, NURTURE_SOURCE, LEAD_QUIET_DAYS } from '../config/leadConstants.js';
import { and, keysetPage, plainQuery, searchWords, searchClauses, isObjectId } from '../utils/listQuery.js';
import { phoneSearchPattern } from '../utils/identity.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const DAY = 24 * 60 * 60 * 1000;
export const TEAM_LEADS_PAGE_SIZE = 20;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

// ── Who ───────────────────────────────────────────────────────────────────────

const isAdmin = (u) => u?.role === 'admin';
const isGtmHead = (u) => gtmRoleOf(u) === 'head';

export const canViewLeads = (u) => isAdmin(u) || gtmRoleOf(u) !== null;
export const canFollowUp = (u) => isAdmin(u) || canSell(u);
export const canReassign = (u) => isAdmin(u) || isGtmHead(u);

function assertView(actor) {
  if (!canViewLeads(actor)) throw fail('Only the GTM team can see leads.', 403);
}

/** May `actor` see this lead's phone and e-mail? `ownerUserId` = the login following up. */
const seesContact = (actor, ownerUserId) =>
  isAdmin(actor) || isGtmHead(actor) || (!!ownerUserId && ownerUserId === idOf(actor._id));

// ── Rows ──────────────────────────────────────────────────────────────────────

/** The one short line describing what the customer did, from the strongest signal's snapshot. */
function detailOf(lead) {
  const src = (lead.sources || []).find((s) => s.type === lead.primarySource) || lead.sources?.[0];
  const snap = src?.snapshot || {};
  return {
    total: Number.isFinite(Number(snap.total)) && snap.total != null ? Number(snap.total) : null,
    itemCount: Number.isFinite(Number(snap.itemCount)) && snap.itemCount != null ? Number(snap.itemCount) : null,
    productName: typeof snap.productName === 'string' ? snap.productName : null,
    makeModel: typeof snap.makeModel === 'string' ? snap.makeModel : null,
    city: typeof snap.city === 'string' ? snap.city : null,
    orderNumber: typeof snap.orderNumber === 'string' ? snap.orderNumber : null,
  };
}

/** The lead as the team sheet shows it to `actor`. */
export function rowOf(lead, actor, now = new Date()) {
  const rep = lead.assignedRep && typeof lead.assignedRep === 'object' ? lead.assignedRep : null;
  const ownerUserId = rep?.user ? idOf(rep.user) : null;
  const last = lead.activities?.[lead.activities.length - 1];
  const lastUpdateAt = last?.at || lead.updatedAt || lead.createdAt || null;
  const quietDays = rep && lastUpdateAt ? Math.floor((now - new Date(lastUpdateAt)) / DAY) : 0;
  const contact = seesContact(actor, ownerUserId) ? { phone: lead.phone || null, email: lead.email || null } : null;
  return {
    id: idOf(lead._id),
    name: lead.name || 'Customer',
    status: lead.status,
    score: lead.leadScore || 0,
    source: lead.primarySource || null,
    detail: detailOf(lead),
    hasPurchased: !!lead.hasPurchased,
    returning: (lead.reopenCount || 0) > 0,
    createdAt: lead.createdAt,
    lastUpdateAt,
    followingUp: rep
      ? { repId: idOf(rep._id), name: rep.name, at: lead.assignedAt, mine: !!ownerUserId && ownerUserId === idOf(actor._id) }
      : null,
    // Followed up on but nothing logged for a week: the head decides (no auto-release).
    quietDays: rep && quietDays >= LEAD_QUIET_DAYS ? quietDays : 0,
    contact,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

export const TEAM_LEAD_SORTS = {
  score: { field: 'leadScore', dir: -1, type: 'number' },
  newest: { field: 'createdAt', dir: -1, type: 'date' },
  updated: { field: 'updatedAt', dir: -1, type: 'date' },
};
export const TEAM_LEAD_VIEWS = ['all', 'free', 'mine', 'person'];
export const TEAM_LEAD_STATUS_FILTERS = ['open', 'all', ...LEAD_STATUSES];

function statusClause(status) {
  if (!status || status === 'open') return { status: { $in: OPEN_LEAD_STATUSES } };
  if (status === 'all') return null;
  return LEAD_STATUSES.includes(status) ? { status } : { status: { $in: OPEN_LEAD_STATUSES } };
}

function searchClause(q) {
  // A phone number typed with spaces or a +91 ("+91 98765 43210") is one number, not three words.
  const compact = String(q ?? '').replace(/[\s\-().]/g, '');
  if (/^\+?\d{4,15}$/.test(compact)) {
    const pattern = phoneSearchPattern(compact);
    if (pattern) return { phone: { $regex: pattern } };
  }
  const words = searchWords(q);
  if (!words.length) return null;
  return and(searchClauses(words, ['name', 'email'], (w) => {
    const pattern = phoneSearchPattern(w);
    return pattern ? [{ phone: { $regex: pattern } }] : [];
  }));
}

/**
 * GET /staff/leads?view=all|free|mine|person&rep=&status=open|all|new|…&q=&sort=score|newest|updated&cursor=
 * Keyset-paged (never skip). Dormant sign-ups (the admin "Nurture" bucket) are not
 * on the sheet: they are a marketing list, not people to ring.
 */
export async function listTeamLeads(actor, params = {}) {
  assertView(actor);
  const f = plainQuery(params);
  const view = TEAM_LEAD_VIEWS.includes(f.view) ? f.view : 'all';
  const sortName = Object.hasOwn(TEAM_LEAD_SORTS, f.sort || '') ? f.sort : 'score';
  const myRep = await salesRepRepository.findByUser(actor._id);

  let owner = null;
  if (view === 'free') owner = { assignedRep: null };
  else if (view === 'mine') {
    if (!myRep) return { leads: [], nextCursor: null, sort: sortName, you: youOf(actor, null) };
    owner = { assignedRep: myRep._id };
  } else if (view === 'person') {
    if (!isObjectId(f.rep)) throw fail('Pick a person.', 400);
    owner = { assignedRep: new mongoose.Types.ObjectId(f.rep) };
  }

  const query = and(
    { primarySource: { $ne: NURTURE_SOURCE } },
    statusClause(f.status),
    owner,
    searchClause(f.q),
  );
  const { items, ...page } = await keysetPage({
    query, sorts: TEAM_LEAD_SORTS, sortName, cursor: f.cursor, pageSize: TEAM_LEADS_PAGE_SIZE,
    find: (q, o) => leadRepository.teamPage(q, o),
  });
  const now = new Date();
  return { ...page, leads: items.map((l) => rowOf(l, actor, now)), you: youOf(actor, myRep) };
}

const youOf = (actor, myRep) => ({
  canFollowUp: canFollowUp(actor),
  canReassign: canReassign(actor),
  repId: myRep ? idOf(myRep._id) : null,
});

/** GET /staff/leads/people — names for the "by person" filter; who a head can reassign to. */
export async function teamLeadPeople(actor) {
  assertView(actor);
  const reps = await salesRepRepository.findActive();
  const out = { people: reps.map((r) => ({ repId: idOf(r._id), name: r.name })) };
  if (canReassign(actor)) {
    const gtm = await userRepository.findActiveStaff(STAFF_TEAMS.SALES);
    out.sellers = gtm.filter(canSell).map((u) => ({ userId: idOf(u._id), name: u.name }));
  }
  return out;
}

// ── One lead ──────────────────────────────────────────────────────────────────

const HISTORY_LABELS = {
  note: 'Note', call: 'Call', email: 'E-mail', sms: 'SMS', status_change: 'Status changed',
  claim: 'Started following up', assignment: 'Owner changed', conversion: 'Converted to order',
};

async function loadRow(leadId, actor) {
  const lead = await leadRepository.teamDetail(leadId, 1);
  if (!lead) throw fail('Lead not found.', 404);
  return rowOf(lead, actor);
}

/** GET /staff/leads/:id — the row plus its history, newest first. Everyone in GTM sees the history. */
export async function getTeamLead(actor, leadId) {
  assertView(actor);
  const lead = await leadRepository.teamDetail(leadId, 50);
  if (!lead) throw fail('Lead not found.', 404);
  const history = (lead.activities || []).slice().reverse().map((a) => ({
    id: idOf(a._id),
    type: a.type,
    label: HISTORY_LABELS[a.type] || a.type,
    at: a.at,
    // The named rep it credits, else the login that did it (system lines have neither).
    who: a.rep?.name || a.by?.name || null,
    notes: a.notes || '',
  }));
  const signals = (lead.sources || []).map((s) => ({ type: s.type, at: s.capturedAt }));
  return { lead: { ...rowOf(lead, actor), history, signals } };
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * POST /staff/leads/:id/follow-up — take the lead.
 * { outcome: 'claimed' | 'already_yours' | 'taken' | 'closed', lead }.
 * 'taken' is what the slower of two simultaneous clicks gets: not an error, the
 * row showing who has it.
 */
export async function followUp(actor, leadId) {
  assertView(actor);
  if (!canFollowUp(actor)) throw fail('Only the GTM head and GTM leads can follow up on leads.', 403);
  const rep = await salesRepRepository.findOrCreateForUser(actor);
  const won = await leadRepository.claimForTeam(leadId, { repId: rep._id, actorId: actor._id, openStatuses: OPEN_LEAD_STATUSES });
  const lead = await loadRow(leadId, actor);
  if (won) return { outcome: 'claimed', lead };
  if (lead.followingUp?.repId === idOf(rep._id)) return { outcome: 'already_yours', lead };
  if (lead.followingUp) return { outcome: 'taken', lead };
  return { outcome: 'closed', lead };
}

/** POST /staff/leads/:id/release — give it back. The owner, the GTM head or admin. Idempotent. */
export async function releaseLead(actor, leadId) {
  assertView(actor);
  const current = await leadRepository.teamDetail(leadId, 1);
  if (!current) throw fail('Lead not found.', 404);
  const rep = current.assignedRep;
  if (!rep) return { outcome: 'already_free', lead: rowOf(current, actor) };
  const mine = !!rep.user && idOf(rep.user) === idOf(actor._id);
  if (!mine && !canReassign(actor)) throw fail('Only the person following up, the GTM head or admin can do this.', 403);
  const moved = await leadRepository.moveOwner(leadId, {
    fromRepId: rep._id, toRepId: null, actorId: actor._id, action: 'release',
    notes: mine ? `${rep.name} stopped following up` : `${actor.name || 'Admin'} took the lead off ${rep.name}`,
  });
  const lead = await loadRow(leadId, actor);
  return { outcome: moved ? 'released' : 'changed', lead };
}

/** POST /staff/leads/:id/reassign { userId } — GTM head or admin moves it to a GTM seller. */
export async function reassignLead(actor, leadId, userId) {
  assertView(actor);
  if (!canReassign(actor)) throw fail('Only the GTM head or admin can reassign a lead.', 403);
  const gtm = await userRepository.findActiveStaff(STAFF_TEAMS.SALES);
  const target = gtm.find((u) => idOf(u._id) === String(userId) && canSell(u));
  if (!target) throw fail('Pick a GTM head or GTM lead.', 400);

  const current = await leadRepository.teamDetail(leadId, 1);
  if (!current) throw fail('Lead not found.', 404);
  if (!OPEN_LEAD_STATUSES.includes(current.status)) throw fail('This lead is closed.', 409);
  const toRep = await salesRepRepository.findOrCreateForUser(target);
  const from = current.assignedRep;
  if (from && idOf(from._id) === idOf(toRep._id)) return { outcome: 'unchanged', lead: rowOf(current, actor) };

  const moved = await leadRepository.moveOwner(leadId, {
    fromRepId: from ? from._id : null, toRepId: toRep._id, actorId: actor._id, action: 'reassign',
    notes: from ? `Moved from ${from.name} to ${toRep.name}` : `Given to ${toRep.name}`,
  });
  const lead = await loadRow(leadId, actor);
  return { outcome: moved ? 'reassigned' : 'changed', lead };
}
