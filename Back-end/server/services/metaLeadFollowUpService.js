/**
 * Following up on Meta leads — the same rules and statuses as website leads
 * (services/teamLeadService.js), on the sheet's own rows.
 *
 *   take a lead            everyone in GTM, admin
 *   record a follow-up     the person following up, GTM head, admin
 *   stop following up      the person following up, GTM head, admin
 *   move a lead            GTM head, admin
 *
 * The owner is a login, not a SalesRep: every GTM member may follow up here, and a
 * SalesRep record would add executives and support to the sales-rep lists.
 *
 * Every write is a compare-and-set on what the caller saw, so simultaneous clicks
 * have exactly one winner and the history never records a move that did not happen.
 * The sheet sync never touches any of this (services/metaLeadSync.js).
 */
import AppError from '../utils/AppError.js';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, gtmRoleOf } from '../config/staff.js';
import { FOLLOW_UP_STATUS_KEYS, FOLLOW_UP_NOTE_MAX } from '../config/leadConstants.js';
import { cleanRichTextWithin } from '../utils/richText.js';
import {
  assertViewMetaLeads, canFollowUpMetaLeads, canManageMetaLeads, presentRow,
} from './metaLeadService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
// A second identical click within this window is the same follow-up, not a new one.
const DUPLICATE_WINDOW_MS = 15 * 1000;

async function load(id) {
  const doc = await metaLeadRepository.findDetail(id);
  if (!doc) throw fail('Lead not found.', 404);
  return doc;
}

const entryBy = (actor, at, fields) => ({ at, by: actor._id, byName: actor.name ?? '', ...fields });

/** GET /staff/meta-leads/people — who holds leads, and who a head can move one to. */
export async function metaLeadPeople(actor) {
  assertViewMetaLeads(actor);
  const holders = await metaLeadRepository.holders();
  const out = { people: holders.map((h) => ({ userId: idOf(h._id), name: h.name || 'Someone' })) };
  if (canManageMetaLeads(actor)) {
    const gtm = await userRepository.findActiveStaff(STAFF_TEAMS.SALES);
    out.members = gtm.filter((u) => gtmRoleOf(u) !== null).map((u) => ({ userId: idOf(u._id), name: u.name }));
  }
  return out;
}

/** POST /:id/follow-up — take the lead. The slower of two clicks gets 'taken', with who has it. */
export async function takeMetaLead(actor, id) {
  assertViewMetaLeads(actor);
  if (!canFollowUpMetaLeads(actor)) throw fail('Only the GTM team and admin can follow up on Meta leads.', 403);
  const at = new Date();
  const name = actor.name ?? '';
  const won = await metaLeadRepository.claim(id, {
    userId: actor._id, name, at, entry: entryBy(actor, at, { type: 'claim' }),
  });
  if (won) return { outcome: 'claimed', lead: await presentRow(won, actor) };
  const doc = await load(id);
  const lead = await presentRow(doc, actor);
  return { outcome: lead.followingUp?.mine ? 'already_yours' : 'taken', lead };
}

/** POST /:id/release — back to free. The person following up, GTM head or admin. Idempotent. */
export async function releaseMetaLead(actor, id) {
  assertViewMetaLeads(actor);
  const doc = await load(id);
  if (!doc.followingUpBy) return { outcome: 'already_free', lead: await presentRow(doc, actor) };
  const mine = idOf(doc.followingUpBy) === idOf(actor._id);
  if (!mine && !canManageMetaLeads(actor)) throw fail('Only the person following up, the GTM head or admin can do this.', 403);
  const notes = mine ? '' : `Taken off ${doc.followingUpName || 'someone'}`;
  const saved = await metaLeadRepository.moveOwner(id, doc.followingUpBy, null, entryBy(actor, new Date(), { type: 'release', notes }));
  return saved
    ? { outcome: 'released', lead: await presentRow(saved, actor) }
    : { outcome: 'changed', lead: await presentRow(await load(id), actor) };
}

/** POST /:id/reassign { userId } — GTM head or admin hands it to a GTM member. */
export async function reassignMetaLead(actor, id, userId) {
  assertViewMetaLeads(actor);
  if (!canManageMetaLeads(actor)) throw fail('Only the GTM head or admin can move a lead.', 403);
  const gtm = await userRepository.findActiveStaff(STAFF_TEAMS.SALES);
  const target = gtm.find((u) => idOf(u._id) === String(userId) && gtmRoleOf(u) !== null);
  if (!target) throw fail('Pick someone in the GTM team.', 400);
  const doc = await load(id);
  if (idOf(doc.followingUpBy) === idOf(target._id)) return { outcome: 'unchanged', lead: await presentRow(doc, actor) };

  const at = new Date();
  const notes = doc.followingUpBy ? `From ${doc.followingUpName || 'someone'} to ${target.name}` : `Given to ${target.name}`;
  const saved = await metaLeadRepository.moveOwner(id, doc.followingUpBy ?? null, { userId: target._id, name: target.name, at }, entryBy(actor, at, { type: 'reassign', notes }));
  return saved
    ? { outcome: 'reassigned', lead: await presentRow(saved, actor) }
    : { outcome: 'changed', lead: await presentRow(await load(id), actor) };
}

function isRepeat(doc, actor, status, note, now) {
  const last = doc.followUpLog?.[doc.followUpLog.length - 1];
  return !!last && last.type === 'follow_up' && idOf(last.by) === idOf(actor._id) && last.status === status
    && (last.notes ?? '') === note && now - new Date(last.at) < DUPLICATE_WINDOW_MS;
}

/**
 * POST /:id/follow-ups { status, note } — how the follow-up went. `Others` needs a
 * note. A later status replaces it on the card and every one stays in the history;
 * nothing closes the lead, so a wrong tap is fixed by choosing again.
 */
export async function recordMetaLeadFollowUp(actor, id, body = {}) {
  assertViewMetaLeads(actor);
  if (!canFollowUpMetaLeads(actor)) throw fail('Only the GTM team and admin can update follow-ups.', 403);
  const status = typeof body.status === 'string' ? body.status : '';
  if (!FOLLOW_UP_STATUS_KEYS.includes(status)) throw fail('Pick how the follow-up went.', 400);
  if (body.note != null && typeof body.note !== 'string') throw fail('The note must be text.', 400);
  // The note may be formatted (rich-text box): cleaned here, limit counts words.
  const { value: note, tooLong } = cleanRichTextWithin(body.note, FOLLOW_UP_NOTE_MAX);
  if (tooLong) throw fail(`Keep the note under ${FOLLOW_UP_NOTE_MAX} characters.`, 400);
  if (status === 'other' && !note) throw fail('Type what happened when you pick "Others".', 400);

  const doc = await load(id);
  if (!doc.followingUpBy) return { outcome: 'not_following', lead: await presentRow(doc, actor) };
  if (idOf(doc.followingUpBy) !== idOf(actor._id) && !canManageMetaLeads(actor)) {
    throw fail('Only the person following up, the GTM head or admin can update this lead.', 403);
  }

  const now = new Date();
  // A double click or a retried request records one follow-up, not two.
  if (isRepeat(doc, actor, status, note, now)) return { outcome: 'duplicate', lead: await presentRow(doc, actor) };
  const saved = await metaLeadRepository.recordFollowUp(id, {
    ownerId: doc.followingUpBy, seenAt: doc.followUpStatusAt, status, at: now,
    entry: entryBy(actor, now, { type: 'follow_up', status, notes: note }),
  });
  if (saved) return { outcome: 'saved', lead: await presentRow(saved, actor) };

  const current = await load(id);
  return { outcome: isRepeat(current, actor, status, note, new Date()) ? 'duplicate' : 'changed', lead: await presentRow(current, actor) };
}
