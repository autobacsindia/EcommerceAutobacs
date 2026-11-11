/**
 * Next follow-up deadlines on Meta leads: the rules, and the minute sweep that
 * reminds and escalates.
 *
 *   take a lead              first follow-up due within 60 office minutes
 *   record a follow-up       "next follow-up by" is required, unless the status
 *                            closes the lead (Converted / Not interested)
 *   miss a deadline          the next save on that lead needs a typed reason
 *   10 min before            pop-up to the person following up
 *   2 h overdue              pop-up to the GTM head(s)
 *   1 day overdue            pop-up to the admin(s) and Marketing head(s)
 *
 * Office hours only (config/leadConstants.js META_LEAD_OFFICE): a deadline is
 * moved into them, and escalations wait for them. Each message is claimed per
 * deadline (repository markSent), so overlapping sweeps or replicas send it once.
 */
import * as Sentry from '@sentry/node';
import AppError from '../utils/AppError.js';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, gtmRoleOf } from '../config/staff.js';
import {
  META_LEAD_REMINDER_MIN, META_LEAD_ESCALATE_HEAD_MIN, META_LEAD_ESCALATE_MANAGERS_MIN,
  META_LEAD_FIRST_FOLLOW_UP_MIN, META_LEAD_NEXT_MAX_DAYS, META_LEAD_REASON_MIN, META_LEAD_REASON_MAX,
} from '../config/leadConstants.js';
import { addOfficeMinutes, isOfficeTime, snapToOffice } from '../utils/officeHours.js';
import { formatDateTimeIST, istEndOfDay, formatIsoDateIST } from '../utils/datetime.js';
import { sendToUsers } from './pushService.js';

const fail = (message, status = 400) => new AppError(message, status, { expose: true });
const MIN_MS = 60 * 1000;
const EPOCH = new Date(0);
const time = (d) => (d ? new Date(d).getTime() : null);
const PAGE = '/team/meta-leads';
const ADMIN_PAGE = '/admin/meta-leads';

export const firstDeadline = (at) => addOfficeMinutes(at, META_LEAD_FIRST_FOLLOW_UP_MIN);

/** A "next follow-up by" from the form → a deadline inside office hours, or a clear 400. */
export function readNextAt(raw, now = new Date()) {
  if (raw == null || raw === '') throw fail('Pick when the next follow-up is due.');
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) throw fail('That next follow-up time is not valid.');
  if (date.getTime() <= now.getTime() + MIN_MS) throw fail('The next follow-up must be in the future.');
  if (date.getTime() > now.getTime() + META_LEAD_NEXT_MAX_DAYS * 24 * 60 * MIN_MS) throw fail(`Pick a next follow-up within ${META_LEAD_NEXT_MAX_DAYS} days.`);
  return snapToOffice(date);
}

/** A typed reason: plain text, long enough to mean something. */
export function readReason(raw, what = 'a reason') {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (text.length < META_LEAD_REASON_MIN) throw fail(`Type ${what}. Use at least ${META_LEAD_REASON_MIN} characters.`);
  if (text.length > META_LEAD_REASON_MAX) throw fail(`Keep it under ${META_LEAD_REASON_MAX} characters.`);
  return text;
}

/** The deadline has passed and nobody has said why yet. */
export const needsLateReason = (doc, now = new Date()) => !!doc.followingUpBy && !!doc.nextFollowUpAt
  && time(doc.nextFollowUpAt) < now.getTime() && time(doc.lateReasonFor) !== time(doc.nextFollowUpAt);

/**
 * When a save on an overdue lead must carry a reason: the reason, as history.
 * Null when the lead is not late (or its lateness is already explained).
 */
export function lateFor(doc, rawReason, actor, now = new Date()) {
  if (!needsLateReason(doc, now)) return null;
  const reason = readReason(rawReason, `why this follow-up is late: it was due ${formatDateTimeIST(doc.nextFollowUpAt)}`);
  return {
    reason,
    dueAt: doc.nextFollowUpAt,
    entry: { type: 'late_reason', at: now, by: actor._id, byName: actor.name ?? '', notes: reason, dueAt: doc.nextFollowUpAt },
  };
}

/** Where the deadline stands, for the card. */
export function deadlineOf(d, now = new Date()) {
  if (!d.nextFollowUpAt || !d.followingUpBy) return null;
  const at = new Date(d.nextFollowUpAt);
  const ms = at.getTime() - now.getTime();
  return {
    at,
    overdue: ms < 0,
    overdueMinutes: ms < 0 ? Math.floor(-ms / MIN_MS) : 0,
    dueSoon: ms >= 0 && ms <= META_LEAD_REMINDER_MIN * MIN_MS,
    lateReasonNeeded: needsLateReason(d, now),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function managers() {
  const people = await userRepository.findChatUsers();
  const active = (u) => u.role === 'admin' || u.staff?.active === true;
  return {
    gtmHeads: people.filter((u) => active(u) && gtmRoleOf(u) === 'head'),
    seniors: people.filter((u) => active(u) && (u.role === 'admin' || (u.staff?.team === STAFF_TEAMS.MARKETING && u.staff?.isHead === true))),
  };
}
const pageFor = (u) => (u.role === 'admin' ? ADMIN_PAGE : PAGE);

/** Claim then send: a lead whose message another sweep already claimed is skipped. */
async function claimAll(leads, flag) {
  const won = [];
  for (const l of leads) {
    if (await metaLeadRepository.markSent(l._id, flag, l.nextFollowUpAt)) won.push(l);
  }
  return won;
}

function summary(leads) {
  const byPerson = new Map();
  leads.forEach((l) => byPerson.set(l.followingUpName || 'Someone', (byPerson.get(l.followingUpName || 'Someone') ?? 0) + 1));
  return [...byPerson].map(([name, n]) => `${name}: ${n}`).join(', ');
}

/**
 * One pass: reminders, then escalations. Never throws (a failed pass is retried
 * by the next minute's run: nothing is marked sent unless it was claimed).
 * Messages carry the product and tab, never the customer's name or number.
 */
export async function runDeadlineSweep(now = new Date(), send = sendToUsers) {
  const out = { reminded: 0, head: 0, seniors: 0 };
  try {
    const soon = await claimAll(await metaLeadRepository.findDue(now, new Date(now.getTime() + META_LEAD_REMINDER_MIN * MIN_MS), 'reminderSentFor'), 'reminderSentFor');
    for (const l of soon) {
      await send([{ userId: l.followingUpBy, url: PAGE }], {
        title: `Follow-up due at ${formatDateTimeIST(l.nextFollowUpAt).split(', ').pop()}`,
        body: `${l.product || 'Meta lead'} (${l.tab}). Update it in the panel before the deadline.`,
        tag: `meta-lead-due-${l._id}`,
      });
    }
    out.reminded = soon.length;

    // Escalations wait for office hours: nobody is woken at night for a lead.
    if (!isOfficeTime(now)) return out;
    const { gtmHeads, seniors } = await managers();
    const headLate = await claimAll(await metaLeadRepository.findDue(EPOCH, new Date(now.getTime() - META_LEAD_ESCALATE_HEAD_MIN * MIN_MS), 'escalatedHeadFor'), 'escalatedHeadFor');
    if (headLate.length && gtmHeads.length) {
      await send(gtmHeads.map((u) => ({ userId: u._id, url: `${pageFor(u)}?due=overdue` })), {
        title: `${plural(headLate.length, 'Meta lead follow-up is', 'Meta lead follow-ups are')} 2+ hours late`,
        body: summary(headLate),
        tag: 'meta-lead-overdue-head',
      });
    }
    out.head = headLate.length;
    const dayLate = await claimAll(await metaLeadRepository.findDue(EPOCH, new Date(now.getTime() - META_LEAD_ESCALATE_MANAGERS_MIN * MIN_MS), 'escalatedManagersFor'), 'escalatedManagersFor');
    if (dayLate.length && seniors.length) {
      await send(seniors.map((u) => ({ userId: u._id, url: `${pageFor(u)}?due=overdue` })), {
        title: `${plural(dayLate.length, 'Meta lead follow-up is', 'Meta lead follow-ups are')} a day late`,
        body: summary(dayLate),
        tag: 'meta-lead-overdue-seniors',
      });
    }
    out.seniors = dayLate.length;
  } catch (err) {
    console.error('[MetaLeadDeadlines] sweep failed:', err.message);
    Sentry.captureException(err);
  }
  return out;
}

/** "Explain this lead" and its answer: one pop-up each, best-effort. */
export const notifyExplanationAsked = (lead, askedByName, send = sendToUsers) => send(
  [{ userId: lead.followingUpBy, url: PAGE }],
  { title: `${askedByName || 'Your manager'} asked about a Meta lead`, body: `${lead.product || 'Meta lead'} (${lead.tab}). Open it and type your explanation.`, tag: `meta-lead-explain-${lead._id}` },
);
export const notifyExplanationAnswered = (lead, asker, answeredByName, send = sendToUsers) => send(
  [{ userId: asker._id ?? asker, url: asker.role === 'admin' ? ADMIN_PAGE : PAGE }],
  { title: `${answeredByName || 'The team'} answered your question`, body: `${lead.product || 'Meta lead'} (${lead.tab}).`, tag: `meta-lead-explained-${lead._id}` },
);

const isReviewer = (u) => u?.role === 'admin' || gtmRoleOf(u) === 'head'
  || (u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.MARKETING && u.staff.isHead === true);

/**
 * The bell (services/notificationService.js): my follow-ups due today or late,
 * questions waiting on me, and — for the admin / heads — the team's late ones.
 * Only rows with something in them. A failed count drops the row, never the bell.
 */
export async function bellItemsFor(user, now = new Date()) {
  const page = user?.role === 'admin' ? ADMIN_PAGE : PAGE;
  const holds = user?.role === 'admin' || gtmRoleOf(user) !== null;
  const reviews = isReviewer(user);
  if (!holds && !reviews) return [];
  try {
    const tonight = istEndOfDay(formatIsoDateIST(now));
    const [due, asked, teamLate] = await Promise.all([
      holds ? metaLeadRepository.countDueBy(tonight, user._id) : 0,
      holds ? metaLeadRepository.countOpenExplanations(user._id) : 0,
      reviews ? metaLeadRepository.countOverdue(now) : 0,
    ]);
    const items = [];
    if (due > 0) items.push({ key: 'meta_leads_due', label: 'My Meta lead follow-ups due', count: due, href: `${page}?view=mine&due=today` });
    if (asked > 0) items.push({ key: 'meta_leads_explain', label: 'Meta leads: explanation asked', count: asked, href: `${page}?view=mine` });
    if (teamLate > 0) items.push({ key: 'meta_leads_team_overdue', label: 'Overdue Meta lead follow-ups (team)', count: teamLate, href: `${page}?due=overdue` });
    return items;
  } catch (err) {
    console.error('[MetaLeadDeadlines] bell counts failed:', err.message);
    return [];
  }
}
