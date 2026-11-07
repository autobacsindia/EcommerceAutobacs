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
 *   record a follow-up      the person following up, GTM head, admin
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
import orderRepository from '../repositories/orderRepository.js';
import cartRepository from '../repositories/cartRepository.js';
import productRepository from '../repositories/productRepository.js';
import leadSyncService from './leadSyncService.js';
import salesRepRepository from '../repositories/salesRepRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, canSell, gtmRoleOf } from '../config/staff.js';
import {
  LEAD_STATUSES, OPEN_LEAD_STATUSES, NURTURE_SOURCE, LEAD_QUIET_DAYS,
  FOLLOW_UP_STATUSES, FOLLOW_UP_STATUS_KEYS, FOLLOW_UP_NOTE_MAX,
} from '../config/leadConstants.js';
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

/** The signal the card describes: the strongest one (primarySource), else the first. */
const primarySourceOf = (lead) =>
  (lead.sources || []).find((s) => s.type === lead.primarySource) || lead.sources?.[0] || null;

/** The one short line describing what the customer did, from the strongest signal's snapshot. */
function detailOf(lead, items = null) {
  const src = primarySourceOf(lead);
  const snap = src?.snapshot || {};
  return {
    total: Number.isFinite(Number(snap.total)) && snap.total != null ? Number(snap.total) : null,
    itemCount: Number.isFinite(Number(snap.itemCount)) && snap.itemCount != null ? Number(snap.itemCount) : null,
    productName: typeof snap.productName === 'string' ? snap.productName : null,
    makeModel: typeof snap.makeModel === 'string' ? snap.makeModel : null,
    city: typeof snap.city === 'string' ? snap.city : null,
    orderNumber: typeof snap.orderNumber === 'string' ? snap.orderNumber : null,
    // Which products — [{ name, variantLabel, quantity, removed }], or null when the
    // signal has none (a consultation, a sign-up). See lineItemsFor.
    items: items ?? itemsFromSnapshot(snap),
  };
}

// ── Which products ────────────────────────────────────────────────────────────
//
// "Left at checkout · ₹15,980" told sales nothing about WHAT was left. The order
// signals snapshot their lines (snapshot.items, since 2026-07), but older leads
// and abandoned carts (snapshot.itemCount only) do not, and the snapshot carries
// no variant. So each page reads the orders / carts behind its rows — one query
// each, by _id, plus one for product names a line lacks: at most three reads per
// page of 20, never one per lead. A product deleted since shows as removed.

const MAX_LINES = 10;
const toQty = (q) => (Number.isFinite(Number(q)) && Number(q) > 0 ? Number(q) : null);
const line = (name, variantLabel, quantity) => ({
  name: typeof name === 'string' && name.trim() ? name.trim() : null,
  variantLabel: typeof variantLabel === 'string' && variantLabel.trim() ? variantLabel.trim() : null,
  quantity: toQty(quantity),
  removed: !(typeof name === 'string' && name.trim()),
});

/** Lines from the signal's own snapshot: the fallback when the order / cart is gone. */
function itemsFromSnapshot(snap) {
  if (Array.isArray(snap.items) && snap.items.length) {
    return snap.items.slice(0, MAX_LINES).map((it) => line(it?.name, it?.variantLabel, it?.quantity));
  }
  if (typeof snap.productName === 'string' && snap.productName) return [line(snap.productName, snap.variantLabel, null)];
  return null;
}

/**
 * Lead id → lines, for every lead whose card names products (order and cart
 * signals). Bounded by the page (≤ 20 leads). A failed read only drops back to
 * the snapshot: the sheet must never fail because a lookup did.
 */
async function lineItemsFor(leads) {
  const out = new Map();
  const want = [];
  for (const lead of leads) {
    const src = primarySourceOf(lead);
    if (src?.ref && (src.refModel === 'Order' || src.refModel === 'Cart')) want.push({ lead, src });
  }
  if (!want.length) return out;
  try {
    const ids = (model) => [...new Set(want.filter((w) => w.src.refModel === model).map((w) => String(w.src.ref)))];
    const [orders, carts] = await Promise.all([
      orderRepository.findLeadItemsByIds(ids('Order')),
      cartRepository.findItemsByIds(ids('Cart')),
    ]);
    const raw = new Map();
    for (const { lead, src } of want) {
      const lines = (src.refModel === 'Order' ? orders : carts).get(String(src.ref));
      if (lines?.length) raw.set(idOf(lead._id), lines.slice(0, MAX_LINES));
    }
    // Names the lines do not carry (cart lines never do; very old order lines may not).
    const productIds = [...new Set([...raw.values()].flat().filter((l) => !l.name && l.product).map((l) => String(l.product)))];
    const names = await productRepository.findNamesByIds(productIds);
    for (const [leadId, lines] of raw) {
      out.set(leadId, lines.map((l) => line(l.name || (l.product ? names.get(String(l.product)) : null), l.variantLabel, l.quantity)));
    }
  } catch (err) {
    console.error('[teamLeads] reading lead products failed:', err?.message);
  }
  return out;
}

/** The lead as the team sheet shows it to `actor`. `items` = its lines from lineItemsFor, if read. */
export function rowOf(lead, actor, now = new Date(), items = undefined) {
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
    detail: detailOf(lead, items),
    followUpStatus: lead.followUpStatus && FOLLOW_UP_STATUSES[lead.followUpStatus]
      ? { status: lead.followUpStatus, label: FOLLOW_UP_STATUSES[lead.followUpStatus], at: lead.followUpStatusAt || null }
      : null,
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
/** "Follow-up" filter: the newest status recorded, or 'none' for leads with none yet. */
export const TEAM_LEAD_FOLLOW_UP_FILTERS = ['none', ...FOLLOW_UP_STATUS_KEYS];

function followUpClause(v) {
  if (v === 'none') return { followUpStatus: null };
  return FOLLOW_UP_STATUS_KEYS.includes(v) ? { followUpStatus: v } : null;
}

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
    followUpClause(f.followUp),
    searchClause(f.q),
  );
  const { items, ...page } = await keysetPage({
    query, sorts: TEAM_LEAD_SORTS, sortName, cursor: f.cursor, pageSize: TEAM_LEADS_PAGE_SIZE,
    find: (q, o) => leadRepository.teamPage(q, o),
  });
  const now = new Date();
  const lines = await lineItemsFor(items);
  return { ...page, leads: items.map((l) => rowOf(l, actor, now, lines.get(idOf(l._id)))), you: youOf(actor, myRep) };
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
  follow_up: 'Follow-up',
};

/** A history line's label: a follow-up shows its status ("No response"). */
const historyLabel = (a) =>
  (a.type === 'follow_up' && FOLLOW_UP_STATUSES[a.meta?.status]) || HISTORY_LABELS[a.type] || a.type;

/** The row with its products read — for a single lead after a write or on open. */
async function rowWithItems(lead, actor) {
  const lines = await lineItemsFor([lead]);
  return rowOf(lead, actor, new Date(), lines.get(idOf(lead._id)));
}

async function loadRow(leadId, actor) {
  const lead = await leadRepository.teamDetail(leadId, 1);
  if (!lead) throw fail('Lead not found.', 404);
  return rowWithItems(lead, actor);
}

/** GET /staff/leads/:id — the row plus its history, newest first. Everyone in GTM sees the history. */
export async function getTeamLead(actor, leadId) {
  assertView(actor);
  const lead = await leadRepository.teamDetail(leadId, 50);
  if (!lead) throw fail('Lead not found.', 404);
  const history = (lead.activities || []).slice().reverse().map((a) => ({
    id: idOf(a._id),
    type: a.type,
    label: historyLabel(a),
    followUpStatus: a.type === 'follow_up' && FOLLOW_UP_STATUSES[a.meta?.status] ? a.meta.status : null,
    at: a.at,
    // The named rep it credits, else the login that did it (system lines have neither).
    who: a.rep?.name || a.by?.name || null,
    notes: a.notes || '',
  }));
  const signals = (lead.sources || []).map((s) => ({ type: s.type, at: s.capturedAt }));
  return { lead: { ...(await rowWithItems(lead, actor)), history, signals } };
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

// ── Follow-up status ──────────────────────────────────────────────────────────

// A second identical click within this window is the same follow-up, not a new one.
const DUPLICATE_WINDOW_MS = 15 * 1000;
// Statuses that mean the customer was reached (they bump a new lead to contacted).
const REACHED = new Set(['responded', 'whatsapp', 'other', 'converted']);

/**
 * POST /staff/leads/:id/follow-ups { status, note } — record how a follow-up went.
 *
 *   status  one of FOLLOW_UP_STATUSES; `other` needs a note
 *   note    optional free text (≤ FOLLOW_UP_NOTE_MAX)
 *
 * Who: the person following up, the GTM head, admin. The lead must be open and
 * someone must be following it up (click Follow up first).
 * → { outcome: 'saved' | 'duplicate' | 'closed' | 'not_following' | 'changed', lead, warning? }
 *
 * Then the lead's own status moves (see FOLLOW_UP_STATUSES in leadConstants):
 * Not interested closes it as lost; Converted moves it to qualified and leaves it
 * open, because only a real paid order marks a lead won.
 */
export async function recordFollowUp(actor, leadId, body = {}) {
  assertView(actor);
  if (!canFollowUp(actor)) throw fail('Only the GTM head and GTM leads can update follow-ups.', 403);
  const status = typeof body.status === 'string' ? body.status : '';
  if (!FOLLOW_UP_STATUS_KEYS.includes(status)) throw fail('Pick how the follow-up went.', 400);
  if (body.note != null && typeof body.note !== 'string') throw fail('The note must be text.', 400);
  const note = (body.note || '').trim();
  if (note.length > FOLLOW_UP_NOTE_MAX) throw fail(`Keep the note under ${FOLLOW_UP_NOTE_MAX} characters.`, 400);
  if (status === 'other' && !note) throw fail('Type what happened when you pick "Others".', 400);

  const current = await leadRepository.teamDetail(leadId, 1);
  if (!current) throw fail('Lead not found.', 404);
  if (!OPEN_LEAD_STATUSES.includes(current.status)) {
    return { outcome: 'closed', lead: await rowWithItems(current, actor) };
  }
  const rep = current.assignedRep;
  if (!rep) return { outcome: 'not_following', lead: await rowWithItems(current, actor) };
  const mine = !!rep.user && idOf(rep.user) === idOf(actor._id);
  if (!mine && !canReassign(actor)) {
    throw fail('Only the person following up, the GTM head or admin can update this lead.', 403);
  }

  // A double click (or a retried request) records one follow-up, not two.
  const now = new Date();
  const last = current.activities?.[current.activities.length - 1];
  if (last?.type === 'follow_up' && idOf(last.by) === idOf(actor._id) && last.meta?.status === status
    && (last.notes || '') === note && now - new Date(last.at) < DUPLICATE_WINDOW_MS) {
    return { outcome: 'duplicate', lead: await rowWithItems(current, actor) };
  }

  const set = { followUpStatus: status, followUpStatusAt: now };
  if (REACHED.has(status) || status === 'not_interested') Object.assign(set, { lastContactedAt: now, contactedBy: actor._id });
  const saved = await leadRepository.recordTeamFollowUp(leadId, {
    ownerRepId: rep._id,
    openStatuses: OPEN_LEAD_STATUSES,
    // Credited to the owner when it is theirs; otherwise the head / admin by login.
    entry: { type: 'follow_up', by: actor._id, rep: mine ? rep._id : null, at: now, notes: note, meta: { status, via: 'team' } },
    set,
  });
  if (!saved) return { outcome: 'changed', lead: await loadRow(leadId, actor) };

  // The lead's own status. The follow-up is already saved; if this step fails the
  // card says so instead of pretending, and choosing the status again finishes it.
  let warning;
  try {
    const opts = { actorId: actor._id, repId: mine ? rep._id : null };
    if (status === 'not_interested') {
      await leadSyncService.applyLeadStatus(leadId, 'lost', { ...opts, lostReason: note || 'Not interested', notes: 'Closed: not interested' });
    } else if (status === 'converted' && current.status !== 'qualified') {
      await leadSyncService.applyLeadStatus(leadId, 'qualified', { ...opts, notes: 'Converted — closes as won when the order is paid' });
    } else if (REACHED.has(status) && current.status === 'new') {
      await leadSyncService.applyLeadStatus(leadId, 'contacted', { ...opts, notes: 'First contact logged' });
    }
  } catch (err) {
    console.error('[teamLeads] follow-up status move failed:', err?.message);
    warning = 'Follow-up saved, but the lead status did not update. Pick the status again.';
  }
  return { outcome: 'saved', lead: await loadRow(leadId, actor), ...(warning && { warning }) };
}
