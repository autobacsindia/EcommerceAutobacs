/**
 * The Meta leads tab: who sees it, the list, one lead, and edits.
 *
 *   see      everyone in GTM, the Marketing head, admin
 *   edit     GTM head, Marketing head, admin
 *
 * Every edit is recorded (who, when, from → to) and locks that field against the
 * sheet sync, so the team's correction is not undone five minutes later.
 */
import AppError from '../utils/AppError.js';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import { STAFF_TEAMS, gtmRoleOf } from '../config/staff.js';
import { and, keysetPage, plainQuery, searchWords, searchClauses } from '../utils/listQuery.js';
import { phoneSearchPattern } from '../utils/identity.js';
import { columnOfLabel } from '../utils/metaLeadSheet.js';
import { META_LEADS_UNDATED, extraKey } from './metaLeadSync.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const META_LEADS_PAGE_SIZE = 25;
// Longer than this and the feed has stopped: three scheduled runs missed.
const STALE_AFTER_MS = 20 * 60 * 1000;
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

const assertView = (u) => { if (!canViewMetaLeads(u)) throw fail('Only GTM, the Marketing head and admin can see Meta leads.', 403); };

const rowOf = (d) => ({
  id: String(d._id),
  tab: d.tab,
  rowNumber: d.rowNumber ?? null,
  leadDate: d.leadDate ?? null,
  dateRaw: d.dateRaw ?? '',
  dateHasTime: !!d.dateHasTime,
  name: d.name ?? '',
  phone: d.phone ?? '',
  email: d.email ?? '',
  product: d.product ?? '',
  campaign: d.campaign ?? '',
  salesPerson: d.salesPerson ?? '',
  status: d.status ?? '',
  followUp1: d.followUp1 ?? '',
  followUp2: d.followUp2 ?? '',
  revision: d.revision ?? 0,
});

const detailOf = (d) => ({
  ...rowOf(d),
  // Columns not already shown as a form field above; Meta's id is the row's identity.
  extras: (d.fields ?? [])
    .filter((f) => !SHOWN_COLUMNS.has(columnOfLabel(f.label)))
    .map(({ label, value }) => ({ label, value, readOnly: columnOfLabel(label) === 'metaId' })),
  editedFields: d.editedFields ?? [],
  edits: [...(d.edits ?? [])].reverse().map((e) => ({ at: e.at, who: e.byName, changes: e.changes })),
});

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

function syncInfo(state) {
  const lastSuccessAt = state?.lastSuccessAt ?? null;
  return {
    lastSuccessAt,
    connected: !!lastSuccessAt,
    stale: !lastSuccessAt || Date.now() - new Date(lastSuccessAt).getTime() > STALE_AFTER_MS,
  };
}

/** GET /staff/meta-leads?tab=&q=&cursor= — keyset-paged, newest first; undated rows last. */
export async function listMetaLeads(actor, params = {}) {
  assertView(actor);
  const f = plainQuery(params);
  const query = and(f.tab ? { tab: String(f.tab) } : null, searchClause(f.q));
  const [{ items, ...page }, state] = await Promise.all([
    keysetPage({ query, sorts: SORTS, sortName: 'newest', cursor: f.cursor, pageSize: META_LEADS_PAGE_SIZE, find: (q, o) => metaLeadRepository.page(q, o) }),
    metaLeadRepository.getState(),
  ]);
  return {
    ...page,
    leads: items.map(rowOf),
    tabs: (state?.tabs ?? []).map((t) => ({ name: t.name, rows: t.rows })),
    sync: syncInfo(state),
    you: { canEdit: canEditMetaLeads(actor) },
  };
}

export async function getMetaLead(actor, id) {
  assertView(actor);
  const doc = await metaLeadRepository.findDetail(id);
  if (!doc) throw fail('Lead not found.', 404);
  return { lead: detailOf(doc), you: { canEdit: canEditMetaLeads(actor) } };
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
  if (revision !== (doc.revision ?? 0)) return { outcome: 'changed', lead: detailOf(doc) };

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

  if (!log.length) return { outcome: 'unchanged', lead: detailOf(doc) };

  const saved = await metaLeadRepository.applyEdit(id, revision, {
    $set: set,
    $inc: { revision: 1 },
    $addToSet: { editedFields: { $each: locks } },
    $push: { edits: { $each: [{ at: new Date(), by: actor._id, byName: actor.name ?? '', changes: log }], $slice: -100 } },
  }, arrayFilters.length ? arrayFilters : undefined);
  if (!saved) return { outcome: 'changed', lead: detailOf(await metaLeadRepository.findDetail(id)) };
  return { outcome: 'saved', lead: detailOf(saved) };
}
