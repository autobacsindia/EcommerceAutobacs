/**
 * The Meta leads tab: who sees it, the list, one lead, and edits.
 * Follow-ups (claim, status, notes) are services/metaLeadFollowUpService.js.
 *
 *   see               everyone in GTM, the Marketing head, admin
 *   edit sheet data   GTM head, Marketing head, admin
 *   phone / e-mail    the person following up, GTM head, Marketing head, admin —
 *                     as on website leads, so two people never ring one customer
 *
 * Every edit is recorded (who, when, from → to) and locks that field against the
 * sheet sync, so the team's correction is not undone five minutes later.
 */
import AppError from '../utils/AppError.js';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import leadRepository from '../repositories/leadRepository.js';
import { STAFF_TEAMS, gtmRoleOf } from '../config/staff.js';
import { FOLLOW_UP_STATUSES, FOLLOW_UP_STATUS_KEYS, LEAD_QUIET_DAYS, NURTURE_SOURCE } from '../config/leadConstants.js';
import { and, isObjectId, keysetPage, plainQuery, searchWords, searchClauses } from '../utils/listQuery.js';
import { normalizePhone, phoneSearchPattern } from '../utils/identity.js';
import { columnOfLabel } from '../utils/metaLeadSheet.js';
import { META_LEADS_UNDATED, extraKey, phoneKeyOf } from './metaLeadSync.js';
import { requestMetaLeadSheetWrite } from './metaLeadSheetWriter.js';
import { deadlineOf } from './metaLeadDeadlineService.js';
import { istEndOfDay, formatIsoDateIST } from '../utils/datetime.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const META_LEADS_PAGE_SIZE = 25;
// Longer than this and the feed has stopped: three scheduled runs missed.
const STALE_AFTER_MS = 20 * 60 * 1000;
const COLUMN_NOTICE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RELATED_SHOWN = 3;
export const META_LEAD_TEXT_MAX = 2000;
export const META_LEAD_EDITABLE = Object.freeze({
  name: 'Name', phone: 'Phone', email: 'E-mail', product: 'Product / form', campaign: 'Campaign',
  salesPerson: 'Sales person', status: 'Status', followUp1: 'Follow-up 1', followUp2: 'Follow-up 2',
});
const SHOWN_COLUMNS = new Set(['date', 'name', 'phone', 'email', 'product', 'campaign', 'salesPerson', 'status', 'followUp1', 'followUp2']);
const SORTS = { newest: { field: 'sortAt', dir: -1, type: 'date' } };

const isAdmin = (u) => u?.role === 'admin';
const isMarketingHead = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.MARKETING && u.staff.isHead === true;

export const canViewMetaLeads = (u) => isAdmin(u) || isMarketingHead(u) || gtmRoleOf(u) !== null;
export const canEditMetaLeads = (u) => isAdmin(u) || isMarketingHead(u) || gtmRoleOf(u) === 'head';
export const canFollowUpMetaLeads = (u) => isAdmin(u) || gtmRoleOf(u) !== null;
export const canManageMetaLeads = (u) => isAdmin(u) || gtmRoleOf(u) === 'head';

export const assertViewMetaLeads = (u) => { if (!canViewMetaLeads(u)) throw fail('Only GTM, the Marketing head and admin can see Meta leads.', 403); };

const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const isMine = (d, actor) => !!d.followingUpBy && idOf(d.followingUpBy) === idOf(actor._id);
const seesContact = (actor, d) => canEditMetaLeads(actor) || isMine(d, actor);

// Admin, Marketing head, GTM head: see the team's activity, ask for explanations.
export const canReviewMetaLeads = canEditMetaLeads;

export const youOf = (actor) => ({
  userId: idOf(actor._id),
  canEdit: canEditMetaLeads(actor),
  canFollowUp: canFollowUpMetaLeads(actor),
  canManage: canManageMetaLeads(actor),
  canReview: canReviewMetaLeads(actor),
});

function explanationOf(d, actor) {
  const e = d.explanation;
  if (!e?.askedAt) return null;
  return {
    question: e.question ?? '', askedBy: e.askedByName || 'Someone', askedAt: e.askedAt,
    answer: e.answer ?? '', answeredAt: e.answeredAt ?? null,
    open: !e.answeredAt,
    canAnswer: !e.answeredAt && isMine(d, actor),
  };
}

/** The newest thing the team did on a lead that someone holds; 0 until it has gone quiet. */
function quietDaysOf(d, now) {
  const last = d.followUpStatusAt && d.followUpStatusAt > d.followingUpAt ? d.followUpStatusAt : d.followingUpAt;
  if (!d.followingUpBy || !last) return 0;
  const days = Math.floor((now - new Date(last)) / DAY_MS);
  return days >= LEAD_QUIET_DAYS ? days : 0;
}

const NO_RELATED = Object.freeze({ others: [], inWebsiteLeads: false });

export function rowOf(d, actor, related = NO_RELATED, now = new Date()) {
  const contact = seesContact(actor, d);
  return {
    id: String(d._id),
    tab: d.tab,
    rowNumber: d.rowNumber ?? null,
    removedFromSheet: !!d.removedFromSheetAt,
    leadDate: d.leadDate ?? null,
    dateRaw: d.dateRaw ?? '',
    dateHasTime: !!d.dateHasTime,
    name: d.name ?? '',
    phone: contact ? (d.phone ?? '') : '',
    email: contact ? (d.email ?? '') : '',
    // There is a number, you just cannot see it yet (Follow up shows it).
    contactHidden: !contact && !!(d.phone || d.email),
    product: d.product ?? '',
    campaign: d.campaign ?? '',
    salesPerson: d.salesPerson ?? '',
    status: d.status ?? '',
    followUp1: d.followUp1 ?? '',
    followUp2: d.followUp2 ?? '',
    revision: d.revision ?? 0,
    followingUp: d.followingUpBy
      ? { userId: idOf(d.followingUpBy), name: d.followingUpName || 'Someone', at: d.followingUpAt ?? null, mine: isMine(d, actor) }
      : null,
    followUpStatus: d.followUpStatus && FOLLOW_UP_STATUSES[d.followUpStatus]
      ? { status: d.followUpStatus, label: FOLLOW_UP_STATUSES[d.followUpStatus], at: d.followUpStatusAt ?? null }
      : null,
    quietDays: quietDaysOf(d, now),
    nextFollowUp: deadlineOf(d, now),
    lateReason: d.lateReason ? { text: d.lateReason, forDeadline: d.lateReasonFor ?? null } : null,
    reschedules: d.reschedules ?? 0,
    explanation: explanationOf(d, actor),
    // Panel → sheet: waiting to be written, or the row could not be found.
    sheet: { waiting: !!d.sheetDirty, problem: d.sheetWriteError || null },
    others: related.others,
    inWebsiteLeads: related.inWebsiteLeads,
  };
}

// A form question can hold a number too ("Alternate WhatsApp?"): same rule as the phone itself.
const CONTACT_LABEL = /phone|mobile|whats\s*app|e-?mail|contact/i;
const CONTACT_VALUE = /^\+?[\d\s()-]{10,15}$|^[^@\s]+@[^@\s]+$/;
const isContactExtra = ({ label, value }) => CONTACT_LABEL.test(label) || CONTACT_VALUE.test(String(value ?? '').trim());
const CONTACT_EDITS = new Set([META_LEAD_EDITABLE.phone, META_LEAD_EDITABLE.email]);

const HISTORY_LABELS = {
  claim: 'Started following up', release: 'Stopped following up', reassign: 'Moved',
  reschedule: 'Moved the next follow-up', late_reason: 'Reason for being late',
  explain_ask: 'Asked for an explanation', explain_answer: 'Explained',
};
const historyOf = (d) => [...(d.followUpLog ?? [])].reverse().map((e) => ({
  type: e.type,
  label: e.type === 'follow_up' ? (FOLLOW_UP_STATUSES[e.status] ?? 'Follow-up') : (HISTORY_LABELS[e.type] ?? 'Update'),
  followUpStatus: e.type === 'follow_up' ? (e.status ?? null) : null,
  at: e.at,
  who: e.byName || null,
  notes: e.notes ?? '',
  nextAt: e.nextAt ?? null,
  late: e.late === true,
}));

export const detailOf = (d, actor, related = NO_RELATED) => {
  const contact = seesContact(actor, d);
  return {
    ...rowOf(d, actor, related),
    // Columns not already shown as a form field above; Meta's id is the row's identity.
    extras: (d.fields ?? [])
      .filter((f) => !SHOWN_COLUMNS.has(columnOfLabel(f.label)) && (contact || !isContactExtra(f)))
      .map(({ label, value }) => ({ label, value, readOnly: columnOfLabel(label) === 'metaId' })),
    editedFields: d.editedFields ?? [],
    edits: [...(d.edits ?? [])].reverse()
      .map((e) => ({ at: e.at, who: e.byName, changes: contact ? e.changes : e.changes.filter((c) => !CONTACT_EDITS.has(c.field) && !CONTACT_LABEL.test(c.field)) }))
      .filter((e) => e.changes.length),
    history: historyOf(d),
  };
};

const PHONE_FORMATS = (digits) => [digits, `+91${digits}`, `91${digits}`, `0${digits}`];

/**
 * Lead id → the customer's other enquiries, and whether they are on Website leads
 * too. A note for the person ringing, nothing is merged. A failed read only drops
 * the note: the list must never fail because a hint did.
 */
export async function relatedFor(docs) {
  const out = new Map();
  const phoneKeys = [...new Set(docs.map((d) => d.phoneKey).filter(Boolean))];
  const emails = [...new Set(docs.map((d) => String(d.email ?? '').trim().toLowerCase()).filter(Boolean))];
  if (!phoneKeys.length && !emails.length) return out;
  try {
    const [rows, website] = await Promise.all([
      phoneKeys.length ? metaLeadRepository.findByPhoneKeys(phoneKeys) : [],
      leadRepository.findContactsIn({ phones: phoneKeys.flatMap(PHONE_FORMATS), emails, excludeSource: NURTURE_SOURCE }),
    ]);
    const sitePhones = new Set(website.map((l) => normalizePhone(l.phone)).filter(Boolean));
    const siteEmails = new Set(website.map((l) => l.email).filter(Boolean));
    docs.forEach((d) => {
      const others = rows.filter((r) => d.phoneKey && r.phoneKey === d.phoneKey && String(r._id) !== String(d._id));
      out.set(String(d._id), {
        others: others.slice(0, RELATED_SHOWN).map((r) => ({ tab: r.tab, product: r.product ?? '', followingUp: r.followingUpName || null })),
        inWebsiteLeads: sitePhones.has(d.phoneKey) || siteEmails.has(String(d.email ?? '').trim().toLowerCase()),
      });
    });
  } catch (err) {
    console.error('[metaLeads] finding related enquiries failed:', err?.message);
  }
  return out;
}

const relatedOf = (map, d) => map.get(String(d._id)) ?? NO_RELATED;

/** One lead as a row, with its related enquiries read. */
export async function presentRow(doc, actor) {
  return rowOf(doc, actor, relatedOf(await relatedFor([doc]), doc));
}

/** One lead with its history, with its related enquiries read. */
export async function presentDetail(doc, actor) {
  return detailOf(doc, actor, relatedOf(await relatedFor([doc]), doc));
}

function searchClause(q) {
  const compact = String(q ?? '').replace(/[\s\-().]/g, '');
  if (/^\+?\d{4,15}$/.test(compact)) {
    const pattern = phoneSearchPattern(compact);
    if (pattern) return { phone: { $regex: pattern } };
  }
  const words = searchWords(q);
  if (!words.length) return null;
  return and(searchClauses(words, ['name', 'email', 'product', 'salesPerson', 'status']));
}

function writeBackInfo(w = {}) {
  return {
    pending: w.pending ?? 0,
    notInSheet: w.notInSheet ?? 0,
    lastSuccessAt: w.lastSuccessAt ?? null,
    error: w.error || null,
    errorKind: w.errorKind || null,
    // Not a secret: the address the owner shares the sheet with.
    robotEmail: w.errorKind === 'permission' ? (w.robotEmail || null) : null,
  };
}

function syncInfo(state) {
  const lastSuccessAt = state?.lastSuccessAt ?? null;
  const since = Date.now() - COLUMN_NOTICE_MS;
  return {
    writeBack: writeBackInfo(state?.writeBack),
    lastSuccessAt,
    connected: !!lastSuccessAt,
    stale: !lastSuccessAt || Date.now() - new Date(lastSuccessAt).getTime() > STALE_AFTER_MS,
    columnsMoved: (state?.layouts ?? []).filter((l) => l.changedAt && new Date(l.changedAt).getTime() > since).map((l) => l.tab),
    skippedTabs: state?.skippedTabs ?? [],
  };
}

const VIEWS = ['all', 'free', 'mine'];

function ownerClause(f, actor) {
  if (isObjectId(f.owner)) return { followingUpBy: f.owner };
  if (f.view === 'free') return { followingUpBy: null };
  if (f.view === 'mine') return { followingUpBy: actor._id };
  return null;
}

/** due=overdue|today: deadlines that have passed, or fall before tonight (India time). */
function dueClause(v, now = new Date()) {
  if (v === 'overdue') return { nextFollowUpAt: { $lt: now }, followingUpBy: { $ne: null } };
  if (v === 'today') return { nextFollowUpAt: { $lt: istEndOfDay(formatIsoDateIST(now)) }, followingUpBy: { $ne: null } };
  return null;
}

function followUpClause(v) {
  if (v === 'none') return { followUpStatus: null };
  return FOLLOW_UP_STATUS_KEYS.includes(v) ? { followUpStatus: v } : null;
}

/** GET /staff/meta-leads?view=all|free|mine&owner=&followUp=&tab=&q=&cursor= — keyset-paged, newest first; undated rows last. */
export async function listMetaLeads(actor, params = {}) {
  assertViewMetaLeads(actor);
  const f = plainQuery(params);
  const view = VIEWS.includes(f.view) ? f.view : 'all';
  const query = and(
    f.tab ? { tab: String(f.tab) } : null,
    ownerClause({ ...f, view }, actor),
    followUpClause(f.followUp),
    dueClause(f.due),
    searchClause(f.q),
  );
  const [{ items, ...page }, state] = await Promise.all([
    keysetPage({ query, sorts: SORTS, sortName: 'newest', cursor: f.cursor, pageSize: META_LEADS_PAGE_SIZE, find: (q, o) => metaLeadRepository.page(q, o) }),
    metaLeadRepository.getState(),
  ]);
  const related = await relatedFor(items);
  const now = new Date();
  return {
    ...page,
    leads: items.map((d) => rowOf(d, actor, relatedOf(related, d), now)),
    tabs: (state?.tabs ?? []).map((t) => ({ name: t.name, rows: t.rows })),
    sync: syncInfo(state),
    you: youOf(actor),
  };
}

export async function getMetaLead(actor, id) {
  assertViewMetaLeads(actor);
  const doc = await metaLeadRepository.findDetail(id);
  if (!doc) throw fail('Lead not found.', 404);
  return { lead: await presentDetail(doc, actor), you: youOf(actor) };
}

function readDate(value) {
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw fail('That date is not valid.', 400);
  return date;
}

const textOf = (value, label) => {
  if (typeof value !== 'string') throw fail(`${label} must be text.`, 400);
  const text = value.trim();
  if (text.length > META_LEAD_TEXT_MAX) throw fail(`${label} is too long.`, 400);
  return text;
};

/**
 * PATCH /staff/meta-leads/:id { revision, changes: { name, …, leadDate }, extras: { "Column": "value" } }
 * `outcome: 'changed'` = someone else saved first; the caller gets their version.
 */
export async function updateMetaLead(actor, id, body = {}) {
  if (!canEditMetaLeads(actor)) throw fail('Only the GTM head, Marketing head and admin can edit Meta leads.', 403);
  const doc = await metaLeadRepository.findDetail(id);
  if (!doc) throw fail('Lead not found.', 404);

  const revision = Number(body.revision);
  if (!Number.isInteger(revision)) throw fail('Please reload and try again.', 400);
  if (revision !== (doc.revision ?? 0)) return { outcome: 'changed', lead: detailOf(doc, actor) };

  const set = {};
  const log = [];
  const locks = [];
  const arrayFilters = [];
  const changes = body.changes && typeof body.changes === 'object' ? body.changes : {};
  const extras = body.extras && typeof body.extras === 'object' ? body.extras : {};

  Object.entries(changes).forEach(([field, value]) => {
    if (field === 'leadDate') {
      const date = readDate(value);
      if ((date?.getTime() ?? null) === (doc.leadDate ? new Date(doc.leadDate).getTime() : null)) return;
      set.leadDate = date;
      set.sortAt = date ?? META_LEADS_UNDATED;
      set.dateHasTime = !!date;
      set.dateRaw = date ? date.toISOString() : '';
      log.push({ field: 'Date', from: doc.leadDate ? new Date(doc.leadDate).toISOString() : '', to: date ? date.toISOString() : '' });
      locks.push('leadDate');
      return;
    }
    if (!Object.hasOwn(META_LEAD_EDITABLE, field)) throw fail('That field cannot be edited.', 400);
    const text = textOf(value, META_LEAD_EDITABLE[field]);
    if (text === (doc[field] ?? '')) return;
    set[field] = text;
    if (field === 'phone') set.phoneKey = phoneKeyOf(text);
    log.push({ field: META_LEAD_EDITABLE[field], from: doc[field] ?? '', to: text });
    locks.push(field);
  });

  const current = new Map((doc.fields ?? []).map((f) => [f.label, f.value]));
  Object.entries(extras).forEach(([label, value]) => {
    const column = columnOfLabel(label);
    if (!current.has(label) || SHOWN_COLUMNS.has(column) || column === 'metaId') throw fail('That column cannot be edited here.', 400);
    const text = textOf(value, label);
    if (text === current.get(label)) return;
    const name = `f${arrayFilters.length}`;
    set[`fields.$[${name}].value`] = text;
    arrayFilters.push({ [`${name}.label`]: label });
    log.push({ field: label, from: current.get(label), to: text });
    locks.push(extraKey(label));
  });

  if (!log.length) return { outcome: 'unchanged', lead: detailOf(doc, actor) };

  const saved = await metaLeadRepository.applyEdit(id, revision, {
    $set: set,
    $inc: { revision: 1 },
    $addToSet: { editedFields: { $each: locks } },
    $push: { edits: { $each: [{ at: new Date(), by: actor._id, byName: actor.name ?? '', changes: log }], $slice: -100 } },
  }, arrayFilters.length ? arrayFilters : undefined);
  if (!saved) return { outcome: 'changed', lead: detailOf(await metaLeadRepository.findDetail(id), actor) };
  requestMetaLeadSheetWrite();
  return { outcome: 'saved', lead: detailOf(saved, actor) };
}

const ACTIVITY_DAYS = [1, 7, 30];
const REASONS_SHOWN = 100;

/**
 * GET /staff/meta-leads/activity?days=1|7|30 — what each person did, and what
 * is late right now. Admin, Marketing head, GTM head. Customer names only on the
 * overdue list (the managers may see contacts anyway); counts everywhere else.
 */
export async function metaLeadActivity(actor, params = {}) {
  assertViewMetaLeads(actor);
  if (!canReviewMetaLeads(actor)) throw fail('Only the admin, the Marketing head and the GTM head can see team activity.', 403);
  const days = ACTIVITY_DAYS.includes(Number(params.days)) ? Number(params.days) : 7;
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY_MS);
  const tonight = istEndOfDay(formatIsoDateIST(now));
  const [entries, holdings, overdue] = await Promise.all([
    metaLeadRepository.activity(from, now),
    metaLeadRepository.holdings(now, tonight),
    metaLeadRepository.overdueList(now),
  ]);

  const people = new Map();
  const person = (userId, name) => {
    const key = idOf(userId) || name || 'unknown';
    if (!people.has(key)) {
      people.set(key, {
        userId: idOf(userId) || null, name: name || 'Someone', holding: 0, overdue: 0, dueToday: 0, openExplanations: 0,
        taken: 0, followUps: 0, onTime: 0, late: 0, rescheduled: 0, firstMinutes: [],
      });
    }
    const p = people.get(key);
    if (name && p.name === 'Someone') p.name = name;
    return p;
  };
  holdings.forEach((h) => Object.assign(person(h._id, h.name), { holding: h.holding, overdue: h.overdue, dueToday: h.dueToday, openExplanations: h.openExplanations }));

  const reasons = [];
  entries.forEach(({ leadId, tab, product, e }) => {
    const p = person(e.by, e.byName);
    if (e.type === 'claim') p.taken += 1;
    if (e.type === 'follow_up') {
      p.followUps += 1;
      if (e.late) p.late += 1; else if (e.dueAt) p.onTime += 1;
      if (typeof e.minutesSinceClaim === 'number') p.firstMinutes.push(e.minutesSinceClaim);
    }
    if (e.type === 'reschedule') p.rescheduled += 1;
    if (['late_reason', 'reschedule', 'explain_ask', 'explain_answer'].includes(e.type) && reasons.length < REASONS_SHOWN) {
      reasons.push({ leadId: String(leadId), tab, product: product ?? '', type: e.type, label: HISTORY_LABELS[e.type], who: e.byName || 'Someone', at: e.at, text: e.notes ?? '' });
    }
  });

  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    days,
    from,
    people: [...people.values()]
      .map(({ firstMinutes, ...p }) => ({ ...p, avgMinutesToFirst: avg(firstMinutes), onTimeRate: p.onTime + p.late ? Math.round((100 * p.onTime) / (p.onTime + p.late)) : null }))
      .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name)),
    overdue: overdue.map((d) => ({
      id: String(d._id), name: d.name ?? '', product: d.product ?? '', tab: d.tab, followingUp: d.followingUpName || 'Someone',
      dueAt: d.nextFollowUpAt, overdueMinutes: Math.floor((now - new Date(d.nextFollowUpAt)) / 60000),
      lateReason: d.lateReason && d.lateReasonFor && new Date(d.lateReasonFor).getTime() === new Date(d.nextFollowUpAt).getTime() ? d.lateReason : '',
      explanationOpen: !!d.explanation?.askedAt && !d.explanation?.answeredAt,
    })),
    reasons,
  };
}
