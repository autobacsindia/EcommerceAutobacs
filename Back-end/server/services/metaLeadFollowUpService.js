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
 * The sheet sync never READS any of this (services/metaLeadSync.js); every change
 * here is WRITTEN to the sheet (services/metaLeadSheetWriter.js) a few seconds later.
 *
 * Deadlines (services/metaLeadDeadlineService.js): taking a lead and every
 * follow-up set the next one; a save on an overdue lead needs a typed reason;
 * the admin, Marketing head and GTM head can ask for an explanation.
 */
import AppError from '../utils/AppError.js';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, gtmRoleOf } from '../config/staff.js';
import { FOLLOW_UP_STATUS_KEYS, FOLLOW_UP_NOTE_MAX } from '../config/leadConstants.js';
import { FOLLOW_UP_CLOSING } from '../config/leadConstants.js';
import { cleanRichTextWithin } from '../utils/richText.js';
import {
  assertViewMetaLeads, canFollowUpMetaLeads, canManageMetaLeads, canEditMetaLeads, presentRow,
} from './metaLeadService.js';
import { requestMetaLeadSheetWrite } from './metaLeadSheetWriter.js';
import {
  firstDeadline, readNextAt, readReason, lateFor, notifyExplanationAsked, notifyExplanationAnswered,
} from './metaLeadDeadlineService.js';

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

/** A saved change: tell the sheet, then show it. */
async function saved(outcome, doc, actor) {
  requestMetaLeadSheetWrite();
  return { outcome, lead: await presentRow(doc, actor) };
}

/** Minutes from taking the lead to this, when it is the first follow-up since then. */
function minutesSinceClaim(doc, now) {
  const log = doc.followUpLog ?? [];
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (log[i].type === 'follow_up') return undefined;
    if (log[i].type === 'claim' || log[i].type === 'reassign') return Math.max(0, Math.round((now - new Date(log[i].at)) / 60000));
  }
  return undefined;
}

const mayWorkOn = (doc, actor) => idOf(doc.followingUpBy) === idOf(actor._id) || canManageMetaLeads(actor);

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
  const nextAt = firstDeadline(at);
  const won = await metaLeadRepository.claim(id, {
    userId: actor._id, name, at, nextAt, entry: entryBy(actor, at, { type: 'claim', nextAt }),
  });
  if (won) return saved('claimed', won, actor);
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
  const done = await metaLeadRepository.moveOwner(id, doc.followingUpBy, null, entryBy(actor, new Date(), { type: 'release', notes }));
  return done
    ? saved('released', done, actor)
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
  const done = await metaLeadRepository.moveOwner(id, doc.followingUpBy ?? null, { userId: target._id, name: target.name, at }, entryBy(actor, at, { type: 'reassign', notes }));
  return done
    ? saved('reassigned', done, actor)
    : { outcome: 'changed', lead: await presentRow(await load(id), actor) };
}

function isRepeat(doc, actor, status, note, now) {
  const last = doc.followUpLog?.[doc.followUpLog.length - 1];
  return !!last && last.type === 'follow_up' && idOf(last.by) === idOf(actor._id) && last.status === status
    && (last.notes ?? '') === note && now - new Date(last.at) < DUPLICATE_WINDOW_MS;
}

/**
 * POST /:id/follow-ups { status, note, nextAt, lateReason } — how the follow-up
 * went. `Others` needs a note. `nextAt` (when the next follow-up is due) is
 * required unless the status closes the lead. `lateReason` is required when the
 * lead's deadline has passed unexplained. A later status replaces it on the card
 * and every one stays in the history; a wrong tap is fixed by choosing again.
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
  if (!mayWorkOn(doc, actor)) {
    throw fail('Only the person following up, the GTM head or admin can update this lead.', 403);
  }

  const now = new Date();
  // A double click or a retried request records one follow-up, not two.
  if (isRepeat(doc, actor, status, note, now)) return { outcome: 'duplicate', lead: await presentRow(doc, actor) };
  const nextAt = FOLLOW_UP_CLOSING.includes(status) ? null : readNextAt(body.nextAt, now);
  const late = lateFor(doc, body.lateReason, actor, now);
  const dueAt = doc.nextFollowUpAt ?? undefined;
  const done = await metaLeadRepository.recordFollowUp(id, {
    ownerId: doc.followingUpBy, seenAt: doc.followUpStatusAt, status, at: now, nextAt, late,
    entry: entryBy(actor, now, {
      type: 'follow_up', status, notes: note, nextAt: nextAt ?? undefined, dueAt,
      late: dueAt ? now > new Date(dueAt) : undefined, minutesSinceClaim: minutesSinceClaim(doc, now),
    }),
  });
  if (done) return saved('saved', done, actor);

  const current = await load(id);
  return { outcome: isRepeat(current, actor, status, note, new Date()) ? 'duplicate' : 'changed', lead: await presentRow(current, actor) };
}

/**
 * POST /:id/next-follow-up { nextAt, reason } — move the deadline. Always needs a
 * reason (it is counted, so a lead pushed again and again stands out); on an
 * overdue lead the same reason explains the lateness.
 */
export async function rescheduleMetaLead(actor, id, body = {}) {
  assertViewMetaLeads(actor);
  const doc = await load(id);
  if (!doc.followingUpBy) return { outcome: 'not_following', lead: await presentRow(doc, actor) };
  if (!mayWorkOn(doc, actor)) throw fail('Only the person following up, the GTM head or admin can change this.', 403);
  const now = new Date();
  const nextAt = readNextAt(body.nextAt, now);
  const reason = readReason(body.reason, 'why the follow-up is moving');
  if (doc.nextFollowUpAt && new Date(doc.nextFollowUpAt).getTime() === nextAt.getTime()) return { outcome: 'unchanged', lead: await presentRow(doc, actor) };
  const late = lateFor(doc, reason, actor, now);
  const done = await metaLeadRepository.reschedule(id, {
    ownerId: doc.followingUpBy, seenNextAt: doc.nextFollowUpAt, nextAt, at: now, late,
    entry: entryBy(actor, now, { type: 'reschedule', notes: reason, nextAt, dueAt: doc.nextFollowUpAt ?? undefined }),
  });
  return done ? saved('rescheduled', done, actor) : { outcome: 'changed', lead: await presentRow(await load(id), actor) };
}

/** POST /:id/explanation { question } — the admin, Marketing head or GTM head asks the person following up. */
export async function askMetaLeadExplanation(actor, id, body = {}) {
  assertViewMetaLeads(actor);
  if (!canEditMetaLeads(actor)) throw fail('Only the admin, the Marketing head and the GTM head can ask for an explanation.', 403);
  const question = readReason(body.question, 'your question');
  const doc = await load(id);
  if (!doc.followingUpBy) throw fail('Nobody is following up on this lead.', 400);
  if (idOf(doc.followingUpBy) === idOf(actor._id)) throw fail('You are following up on this lead yourself.', 400);
  const at = new Date();
  const done = await metaLeadRepository.askExplanation(id, { askedAt: at, askedBy: actor._id, askedByName: actor.name ?? '', question, answer: '', answeredAt: null },
    entryBy(actor, at, { type: 'explain_ask', notes: question }));
  if (!done) return { outcome: 'already_asked', lead: await presentRow(await load(id), actor) };
  notifyExplanationAsked(done, actor.name).catch(() => {});
  return { outcome: 'asked', lead: await presentRow(done, actor) };
}

/** POST /:id/explanation/answer { answer } — only the person following up answers. */
export async function answerMetaLeadExplanation(actor, id, body = {}) {
  assertViewMetaLeads(actor);
  const doc = await load(id);
  const open = doc.explanation && !doc.explanation.answeredAt ? doc.explanation : null;
  if (!open) return { outcome: 'nothing_open', lead: await presentRow(doc, actor) };
  if (idOf(doc.followingUpBy) !== idOf(actor._id)) throw fail('Only the person following up can answer this.', 403);
  const answer = readReason(body.answer, 'your explanation');
  const at = new Date();
  const done = await metaLeadRepository.answerExplanation(id, open.askedAt, { answer, at }, entryBy(actor, at, { type: 'explain_answer', notes: answer }));
  if (!done) return { outcome: 'changed', lead: await presentRow(await load(id), actor) };
  userRepository.findChatPrincipal(open.askedBy)
    .then((asker) => asker && notifyExplanationAnswered(done, asker, actor.name))
    .catch(() => {});
  return { outcome: 'answered', lead: await presentRow(done, actor) };
}
