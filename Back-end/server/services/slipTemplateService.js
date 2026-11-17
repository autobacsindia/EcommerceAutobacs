/**
 * Printable slips from STORED templates (models/SlipTemplate.js): the admin's
 * Slip templates screen, the "Create slip" menu on a project, each slip's own
 * boxes kept on the project, and the data a slip prints
 * (services/projectSlipService.js draws it, one layout for all).
 *
 * ── Who does what ───────────────────────────────────────────────────────────
 *   templates   the admin adds, changes, hides, deletes, restores and resets
 *   menu        whoever sees a project sees the slips its form offers
 *   slip boxes  the project's people (staffProjectDetailsService.canEditDetails)
 *   print       whoever sees the project
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - a template is checked in full before it is saved: every key it prints
 *     exists, every {{placeholder}} is known, sizes are bounded — a broken
 *     template can never reach a project's menu
 *   - the defaults are written once into an empty collection; an admin edit is
 *     never overwritten by a deploy
 *   - two admins editing at once never overwrite each other (rev)
 *   - amounts on an item list are worked out here in paise; the panel's numbers
 *     are never printed
 *   - a missing value prints as a blank line and is listed, never a refusal
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import SlipTemplate from '../models/SlipTemplate.js';
import staffProjectRepository from '../repositories/staffProjectRepository.js';
import { companyInfo } from '../config/company.js';
import { formatIsoDateIST } from '../utils/datetime.js';
import {
  PROJECT_TEMPLATES, TEMPLATE_KEYS, FIELD_TYPES, FIELD_MAX, SLIP_FIELD_TYPES, COMPUTED_KEYS,
  SUMMARY_SLIP, SLIP_LIMITS, DEFAULT_SLIPS,
} from '../config/projectTemplates.js';
import { loadVisibleProject } from './staffProjectService.js';
import { cleanValue, balanceOf, canEditDetails } from './staffProjectDetailsService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]{0,39})\s*\}\}/g;
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const ITEM_QTY_MAX = 100_000;
const ITEM_RATE_MAX = 10_000_000;

/** Every field of every project form, by key (a template may print any of them). */
const FORM_FIELDS = new Map(TEMPLATE_KEYS.flatMap((t) => PROJECT_TEMPLATES[t].fields.map((f) => [f.key, f])));

// ── Checking a template ─────────────────────────────────────────────────────

function text(raw, what, max, { required = false, multiline = false } = {}) {
  if (raw != null && typeof raw !== 'string') throw fail(`${what}: enter text.`, 400);
  let v = String(raw ?? '').normalize('NFKC').replace(CONTROL, '').replace(/\r\n?/g, '\n');
  v = multiline ? v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : v.replace(/\s+/g, ' ').trim();
  if (required && !v) throw fail(`${what}: fill this in.`, 400);
  if (v.length > max) throw fail(`${what}: keep it under ${max} characters.`, 400);
  return v;
}

function list(raw, what, max) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw fail(`${what} must be a list.`, 400);
  if (raw.length > max) throw fail(`${what}: at most ${max}.`, 400);
  return raw;
}

function cleanTemplateField(raw, i) {
  const where = `Box ${i + 1}`;
  if (!raw || typeof raw !== 'object') throw fail(`${where}: give it a name and a type.`, 400);
  const key = String(raw.key ?? '');
  if (!FIELD_KEY_RE.test(key)) throw fail(`${where}: its code must be letters and digits, starting with a letter (like driverName).`, 400);
  if (COMPUTED_KEYS[key] || FORM_FIELDS.has(key)) throw fail(`${where}: “${key}” is already a project detail — pick another code.`, 400);
  const label = text(raw.label, `${where} name`, SLIP_LIMITS.label, { required: true });
  if (!SLIP_FIELD_TYPES.includes(raw.type)) throw fail(`${where}: pick one of the box types.`, 400);
  const out = { key, label, type: raw.type };
  if (raw.max != null && raw.max !== '') {
    const max = Number(raw.max);
    if (!['text', 'textarea', 'phone'].includes(raw.type) || !Number.isInteger(max) || max < 1 || max > SLIP_LIMITS.paragraph) {
      throw fail(`${where}: a length limit is a whole number up to ${SLIP_LIMITS.paragraph}, for text boxes only.`, 400);
    }
    out.max = max;
  }
  if (raw.upper === true) out.upper = true;
  const placeholder = text(raw.placeholder, `${where} hint`, 120);
  if (placeholder) out.placeholder = placeholder;
  if (raw.notBefore) out.notBefore = String(raw.notBefore);
  return out;
}

/**
 * A template definition, checked in full. Returns the clean definition, or
 * throws a 400 that names what is wrong ("Section 2 prints “chasisNo”, which
 * is not a box of this slip or a project detail").
 */
export function cleanDefinition(input = {}, { key: fixedKey } = {}) {
  const key = fixedKey ?? String(input.key ?? '').trim().toLowerCase();
  if (!KEY_RE.test(key)) throw fail('The slip’s code must be 2–40 lowercase letters, digits or _ (like rto_letter).', 400);
  if (key === SUMMARY_SLIP.key) throw fail('“summary” is the built-in project summary — pick another code.', 400);
  const label = text(input.label, 'Menu name', SLIP_LIMITS.label, { required: true });
  const title = text(input.title, 'Printed heading', SLIP_LIMITS.title, { required: true });

  const forms = [...new Set(list(input.forms, 'Forms', TEMPLATE_KEYS.length))];
  for (const f of forms) if (!TEMPLATE_KEYS.includes(f)) throw fail('Pick forms from the list.', 400);

  const fields = list(input.fields, 'Boxes', SLIP_LIMITS.fields).map(cleanTemplateField);
  const ownKeys = new Map(fields.map((f) => [f.key, f]));
  if (ownKeys.size !== fields.length) throw fail('Two boxes have the same code.', 400);
  for (const f of fields) {
    if (f.notBefore && ownKeys.get(f.notBefore)?.type !== 'date') throw fail(`${f.label}: “not before” must name another date box.`, 400);
    if (f.notBefore && f.type !== 'date') throw fail(`${f.label}: only a date box can have “not before”.`, 400);
  }

  // What this slip may print: its own boxes, its forms' fields (every form's when it
  // is offered on all), and the computed values.
  const formKeys = new Set((forms.length ? forms : TEMPLATE_KEYS).flatMap((t) => PROJECT_TEMPLATES[t].fields.map((f) => f.key)));
  const printable = (k) => (ownKeys.has(k) && ownKeys.get(k).type !== 'items') || formKeys.has(k) || !!COMPUTED_KEYS[k];
  const name = (k, where) => {
    if (ownKeys.get(k)?.type === 'items') throw fail(`${where}: an item list prints as its own table — add an “Item table” block for “${k}”.`, 400);
    if (!printable(k)) throw fail(`${where} prints “${k}”, which is not a box of this slip or a detail of its forms.`, 400);
    return k;
  };

  const rawBlocks = list(input.blocks, 'Blocks', SLIP_LIMITS.blocks);
  if (!rawBlocks.length) throw fail('Add at least one block to print.', 400);
  const blocks = rawBlocks.map((b, i) => {
    const where = `Block ${i + 1}`;
    if (!b || typeof b !== 'object') throw fail(`${where}: pick what it is.`, 400);
    if (b.type === 'section') {
      const keys = list(b.keys, `${where} rows`, SLIP_LIMITS.keysPerSection).map((k) => name(String(k), where));
      if (!keys.length) throw fail(`${where}: pick at least one detail to print.`, 400);
      return { type: 'section', title: text(b.title, `${where} title`, SLIP_LIMITS.sectionTitle), keys: [...new Set(keys)] };
    }
    if (b.type === 'paragraph') {
      const t = text(b.text, `${where} text`, SLIP_LIMITS.paragraph, { required: true, multiline: true });
      // A {{...}} that does not parse as a placeholder is a typo, not text to print.
      const stray = t.replace(PLACEHOLDER, '').match(/\{\{|\}\}/);
      if (stray) throw fail(`${where}: a {{…}} is not closed or names nothing — write it like {{driverName}}.`, 400);
      for (const m of t.matchAll(PLACEHOLDER)) name(m[1], where);
      return { type: 'paragraph', text: t, bold: b.bold === true };
    }
    if (b.type === 'items') {
      const k = String(b.key ?? '');
      if (ownKeys.get(k)?.type !== 'items') throw fail(`${where}: pick an item-list box of this slip.`, 400);
      return { type: 'items', key: k };
    }
    throw fail(`${where}: a block is a section, a paragraph or an item table.`, 400);
  });

  const needs = [...new Set(list(input.needs, 'Warn-if-empty list', SLIP_LIMITS.fields + 40).map(String))];
  for (const k of needs) {
    if (COMPUTED_KEYS[k] || !(ownKeys.has(k) || formKeys.has(k))) throw fail(`“${k}” cannot be on the warn-if-empty list: it is not a box of this slip or a detail of its forms.`, 400);
  }
  const declaration = text(input.declaration, 'Closing line', SLIP_LIMITS.declaration, { multiline: true });
  const signatures = list(input.signatures, 'Signature boxes', SLIP_LIMITS.signatures).map((s, i) => text(s, `Signature box ${i + 1}`, SLIP_LIMITS.signature, { required: true }));
  const out = { key, label, title, forms, fields, blocks, needs, declaration, signatures };
  if (has(input, 'active')) out.active = input.active === true || input.active === 'true';
  if (has(input, 'order')) {
    const order = Number(input.order);
    if (!Number.isInteger(order) || order < 0 || order > 1000) throw fail('Menu position must be a whole number from 0 to 1000.', 400);
    out.order = order;
  }
  return out;
}

// Every default must pass its own checks: a typo in config fails the first test run, not a print.
for (const d of DEFAULT_SLIPS) cleanDefinition(d);

// ── Defaults ────────────────────────────────────────────────────────────────

let seeding = null;
/**
 * Writes each default whose key is missing ($setOnInsert): an empty
 * collection gets them all, an existing one keeps every admin edit. Runs when
 * the collection is empty (first boot, a restored database) — one metadata
 * count otherwise. Concurrent callers share one write.
 */
export async function ensureDefaults() {
  if (seeding) return seeding;
  if ((await SlipTemplate.estimatedDocumentCount()) > 0) return undefined;
  seeding = seedDefaults().finally(() => { seeding = null; });
  return seeding;
}

export async function seedDefaults() {
  try {
    await SlipTemplate.bulkWrite(DEFAULT_SLIPS.map((d, i) => ({
      updateOne: {
        filter: { key: d.key },
        update: { $setOnInsert: { ...cleanDefinition(d), active: true, isDefault: true, order: (i + 1) * 10, rev: 1, archivedAt: null } },
        upsert: true,
      },
    })), { ordered: false });
  } catch (err) {
    // Two instances seeding at once: the unique key decided, every default exists.
    const dupOnly = err?.code === 11000 || (err?.writeErrors?.length && err.writeErrors.every((e) => e.code === 11000));
    if (!dupOnly) throw err;
  }
}

/** Live templates, in menu order (bounded; the menu is short). */
export async function liveTemplates() {
  await ensureDefaults();
  return SlipTemplate.find({ archivedAt: null, active: true }).sort({ order: 1, _id: 1 }).limit(SLIP_LIMITS.templates).lean();
}

// ── Admin ───────────────────────────────────────────────────────────────────

const mustBeAdmin = (actor) => { if (!isAdmin(actor)) throw fail('Only the admin manages slip templates.', 403); };

export function shapeTemplate(t) {
  return {
    id: idOf(t._id),
    key: t.key,
    label: t.label,
    title: t.title,
    forms: t.forms || [],
    fields: (t.fields || []).map((f) => ({ ...f })),
    blocks: (t.blocks || []).map((b) => ({ ...b })),
    needs: t.needs || [],
    declaration: t.declaration || '',
    signatures: t.signatures || [],
    active: t.active !== false,
    isDefault: !!t.isDefault,
    order: t.order ?? 100,
    rev: t.rev,
    archivedAt: t.archivedAt || null,
    updatedAt: t.updatedAt || null,
    updatedByName: t.updatedByName || '',
  };
}

/** What the editor offers: forms with their fields, computed keys, limits. */
export function editorOptions() {
  return {
    forms: TEMPLATE_KEYS.map((k) => ({ key: k, label: PROJECT_TEMPLATES[k].label, fields: PROJECT_TEMPLATES[k].fields.map((f) => ({ key: f.key, label: f.label, type: f.type })) })),
    computed: Object.entries(COMPUTED_KEYS).map(([key, c]) => ({ key, label: c.label, type: c.type })),
    fieldTypes: SLIP_FIELD_TYPES,
    limits: SLIP_LIMITS,
  };
}

export async function adminList(actor) {
  mustBeAdmin(actor);
  await ensureDefaults();
  const rows = await SlipTemplate.find({}).sort({ archivedAt: 1, order: 1, _id: 1 }).limit(SLIP_LIMITS.templates * 2).lean();
  return { templates: rows.map(shapeTemplate), options: editorOptions() };
}

export async function adminCreate(actor, input = {}, req) {
  mustBeAdmin(actor);
  await ensureDefaults();
  const def = cleanDefinition(input);
  const live = await SlipTemplate.countDocuments({ archivedAt: null });
  if (live >= SLIP_LIMITS.templates) throw fail(`At most ${SLIP_LIMITS.templates} slip templates — delete one first.`, 409);
  let doc;
  try {
    doc = await SlipTemplate.create({ active: true, order: 100, ...def, isDefault: false, rev: 1, updatedByName: actor.name || '' });
  } catch (err) {
    if (err?.code === 11000) throw fail(`A slip with the code “${def.key}” already exists (it may be in Deleted).`, 409);
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'SlipTemplate', doc._id, { key: def.key });
  return shapeTemplate(doc.toObject());
}

async function loadTemplate(id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Slip template not found.', 404);
  const t = await SlipTemplate.findById(id).lean();
  if (!t) throw fail('Slip template not found.', 404);
  return t;
}

async function writeIfRev(t, rev, set, actor, req, action) {
  const next = await SlipTemplate.findOneAndUpdate(
    { _id: t._id, rev },
    { $set: { ...set, updatedByName: actor.name || '' }, $inc: { rev: 1 } },
    { new: true },
  ).lean();
  if (!next) throw fail('Someone changed this template just now. It has been reloaded — try again.', 409);
  auditLogger.logAction(req, action, 'SlipTemplate', t._id, { key: t.key, changes: Object.keys(set) });
  return shapeTemplate(next);
}

const checkRev = (input, t) => {
  const rev = Number(input.rev);
  if (!Number.isInteger(rev)) throw fail('Reload and try again.', 400);
  if (rev !== t.rev) throw fail('Someone changed this template just now. It has been reloaded — try again.', 409);
  return rev;
};

/**
 * Change a template: { rev, ...definition } replaces the definition (its code
 * never changes — projects' saved boxes are filed under it), or { rev, archived }
 * deletes/restores it. The whole definition is sent: it is one form.
 */
export async function adminUpdate(actor, id, input = {}, req) {
  mustBeAdmin(actor);
  const t = await loadTemplate(id);
  const rev = checkRev(input, t);
  if (has(input, 'archived')) {
    const want = input.archived === true || input.archived === 'true';
    if (want === !!t.archivedAt) return shapeTemplate(t);
    if (!want) {
      const live = await SlipTemplate.countDocuments({ archivedAt: null });
      if (live >= SLIP_LIMITS.templates) throw fail(`At most ${SLIP_LIMITS.templates} slip templates — delete one first.`, 409);
    }
    return writeIfRev(t, rev, { archivedAt: want ? new Date() : null }, actor, req, want ? 'DELETE' : 'UPDATE');
  }
  if (t.archivedAt) throw fail('This template is deleted. Restore it first.', 409);
  if (has(input, 'key') && input.key !== t.key) throw fail('A slip’s code cannot change — make a new slip instead.', 400);
  const def = cleanDefinition(input, { key: t.key });
  delete def.key;
  return writeIfRev(t, rev, def, actor, req, 'UPDATE');
}

/** A default back to how it shipped (config/projectTemplates.js), keeping its place, on/off and code. */
export async function adminReset(actor, id, input = {}, req) {
  mustBeAdmin(actor);
  const t = await loadTemplate(id);
  const rev = checkRev(input, t);
  const def = DEFAULT_SLIPS.find((d) => d.key === t.key);
  if (!t.isDefault || !def) throw fail('Only a built-in slip can be reset.', 400);
  if (t.archivedAt) throw fail('This template is deleted. Restore it first.', 409);
  const clean = cleanDefinition(def);
  delete clean.key;
  return writeIfRev(t, rev, clean, actor, req, 'UPDATE');
}

// ── A project's slips ───────────────────────────────────────────────────────

const offeredOn = (t, form) => !t.forms?.length || (!!form && t.forms.includes(form));
const formOf = (p) => (p.details?.template && PROJECT_TEMPLATES[p.details.template] ? p.details.template : null);

/** A printable key's label and type: the slip's own box, a project detail, or computed. */
function metaOf(t, key) {
  const own = (t.fields || []).find((f) => f.key === key);
  if (own) return own;
  if (COMPUTED_KEYS[key]) return { key, ...COMPUTED_KEYS[key] };
  const f = FORM_FIELDS.get(key);
  return f ? { key, label: f.label, type: f.type } : { key, label: key, type: 'text' };
}

const savedValues = (p, key) => p.slipValues?.[key]?.values || {};
const empty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** The value a key prints on this project's slip ('' = blank). */
function valueOf(p, t, key, now) {
  const own = (t.fields || []).find((f) => f.key === key);
  if (own) return savedValues(p, t.key)[key] ?? '';
  switch (key) {
    case 'balance': return balanceOf(p.details?.values || {}) ?? '';
    case 'today': return formatIsoDateIST(now);
    case 'projectName': return p.name || '';
    case 'owner': return p.owner?.name || '';
    case 'company': return companyInfo.name;
    default: return p.details?.values?.[key] ?? '';
  }
}

export function missingOf(p, t) {
  return (t.needs || []).filter((k) => empty(valueOf(p, t, k, new Date()))).map((k) => metaOf(t, k).label);
}

/** The slips menu of one project: its form's stored slips (with their boxes and saved values), then the summary. */
export function slipsForProject(p, templates) {
  const form = formOf(p);
  return [
    ...templates.filter((t) => offeredOn(t, form)).map((t) => ({
      key: t.key,
      label: t.label,
      missing: missingOf(p, t),
      fields: (t.fields || []).map((f) => ({ ...f })),
      values: savedValues(p, t.key),
    })),
    { key: SUMMARY_SLIP.key, label: SUMMARY_SLIP.label, missing: [], fields: [], values: {} },
  ];
}

// ── Item lists ──────────────────────────────────────────────────────────────

const paise = (rupees) => Math.round(Number(rupees) * 100);

function cleanItems(raw, field) {
  if (raw == null || raw === '') return [];
  if (!Array.isArray(raw)) throw fail(`${field.label}: must be a list of items.`, 400);
  if (raw.length > SLIP_LIMITS.items) throw fail(`${field.label}: at most ${SLIP_LIMITS.items} items.`, 400);
  const out = [];
  raw.forEach((row, i) => {
    if (!row || typeof row !== 'object') throw fail(`${field.label}, line ${i + 1}: give the item a name.`, 400);
    const name = text(row.name, `${field.label}, line ${i + 1}`, SLIP_LIMITS.itemName);
    const blankRow = !name && empty(row.qty) && empty(row.rate);
    if (blankRow) return; // an empty line the panel left behind
    if (!name) throw fail(`${field.label}, line ${i + 1}: give the item a name.`, 400);
    const qty = cleanValue(row.qty, { label: `${field.label}, line ${i + 1} quantity`, type: 'money' });
    if (!(qty > 0) || qty > ITEM_QTY_MAX) throw fail(`${field.label}, line ${i + 1}: the quantity must be more than 0.`, 400);
    const rate = empty(row.rate) ? 0 : cleanValue(row.rate, { label: `${field.label}, line ${i + 1} rate`, type: 'money' });
    if (rate > ITEM_RATE_MAX) throw fail(`${field.label}, line ${i + 1}: that rate is too large.`, 400);
    out.push({ name, qty, rate });
  });
  return out;
}

/** Amount per line and the total, in paise then rupees — never the panel's arithmetic. Exported for tests. */
export function itemsWithAmounts(items = []) {
  let total = 0;
  const rows = items.map((r) => {
    const amount = Math.round(paise(r.qty) * paise(r.rate) / 100); // paise
    total += amount;
    return { name: r.name, qty: r.qty, rate: r.rate, amount: amount / 100 };
  });
  return { rows, total: total / 100 };
}

/** A slip's own boxes from `raw`: unknown keys refused, empty ones dropped, dates in order. */
export function cleanSlipValues(t, raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail('Slip boxes must be a list of fields.', 400);
  const byKey = new Map((t.fields || []).map((f) => [f.key, f]));
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = byKey.get(key);
    if (!field) throw fail(`“${key}” is not a box of the ${t.label}.`, 400);
    if (field.type === 'items') {
      const items = cleanItems(value, field);
      if (items.length) out[key] = items;
      continue;
    }
    if (empty(value) || (typeof value === 'string' && !value.trim())) continue;
    if (!FIELD_TYPES.includes(field.type)) throw fail(`${field.label}: unknown box type.`, 500);
    const clean = cleanValue(value, { ...field, max: field.max || FIELD_MAX[field.type] });
    if (clean !== '') out[key] = clean;
  }
  for (const f of t.fields || []) {
    if (f.notBefore && out[f.key] && out[f.notBefore] && out[f.key] < out[f.notBefore]) {
      throw fail(`${f.label} can’t be before ${byKey.get(f.notBefore)?.label || f.notBefore}.`, 400);
    }
  }
  return out;
}

async function liveTemplateFor(p, key) {
  await ensureDefaults();
  if (!KEY_RE.test(String(key))) throw fail('Pick one of the slips.', 404);
  const t = await SlipTemplate.findOne({ key: String(key), archivedAt: null, active: true }).lean();
  if (!t) throw fail('Pick one of the slips.', 404);
  if (!offeredOn(t, formOf(p))) {
    const need = t.forms.map((k) => PROJECT_TEMPLATES[k]?.label || k).join(' or ');
    throw fail(formOf(p) ? `A ${t.label.toLowerCase()} needs the ${need} form.` : `Fill in the project’s details on the ${need} form first.`, 409);
  }
  return t;
}

/** Save one slip's own boxes on a project: { rev, values }. */
export async function saveSlipValues(actor, projectId, key, input = {}, req) {
  const p = await loadVisibleProject(actor, projectId, { archived: true });
  if (p.archivedAt) throw fail('This project is deleted. Restore it first.', 409);
  if (!canEditDetails(actor, p)) throw fail('Only the project’s people can fill in its slips.', 403);
  const t = await liveTemplateFor(p, key);
  const rev = Number(input.rev);
  if (!Number.isInteger(rev)) throw fail('Reload and try again.', 400);
  if (rev !== p.rev) throw fail('Someone changed this project just now. It has been reloaded — try again.', 409);
  const values = cleanSlipValues(t, input.values);
  const next = await staffProjectRepository.updateIfRev(p._id, rev, {
    [`slipValues.${t.key}`]: { values, updatedAt: new Date(), updatedByName: actor.name || '' },
  });
  if (!next) throw fail('Someone changed this project just now. It has been reloaded — try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffProject', p._id, { changes: [`slip:${t.key}`], fields: Object.keys(values).length });
  return next;
}

// ── What a slip prints ──────────────────────────────────────────────────────

/** "PRJ-0007" once projects are numbered (feat/project-ids-payment-links), else the short id. */
export const projectRef = (p) => (Number.isInteger(p?.number) ? `PRJ-${String(p.number).padStart(4, '0')}` : `#${idOf(p._id).slice(-6).toUpperCase()}`);

const row = (p, t, key, now) => {
  const m = metaOf(t, key);
  return { key, label: m.label, type: m.type, value: valueOf(p, t, key, now), ...(key === 'balance' && { strong: true }) };
};

/**
 * A stored template filled from one project: blocks with values ('' = blank
 * line), item tables with server amounts, and what is still missing.
 */
export function slipFromTemplate(p, t, now = new Date()) {
  const blocks = (t.blocks || []).map((b) => {
    if (b.type === 'section') return { type: 'section', title: b.title || '', rows: b.keys.map((k) => row(p, t, k, now)) };
    if (b.type === 'paragraph') {
      // Each {{key}} becomes its value, kept as a separate piece so the PDF can draw a blank for an empty one.
      const pieces = [];
      let last = 0;
      for (const m of b.text.matchAll(PLACEHOLDER)) {
        if (m.index > last) pieces.push({ text: b.text.slice(last, m.index) });
        pieces.push({ ...row(p, t, m[1], now), placeholder: true });
        last = m.index + m[0].length;
      }
      if (last < b.text.length) pieces.push({ text: b.text.slice(last) });
      return { type: 'paragraph', bold: !!b.bold, pieces };
    }
    const field = (t.fields || []).find((f) => f.key === b.key);
    return { type: 'items', title: field?.label || 'Items', ...itemsWithAmounts(savedValues(p, t.key)[b.key] || []) };
  });
  return {
    key: t.key,
    title: t.title,
    label: t.label,
    ref: projectRef(p),
    projectName: p.name,
    owner: p.owner?.name || '',
    order: p.details?.order?.number || '',
    showProject: t.blocks?.[0]?.type !== 'paragraph',
    blocks,
    missing: missingOf(p, t),
    declaration: t.declaration || '',
    signatures: t.signatures || [],
  };
}

/** The built-in summary: every filled detail of the project's form, its balance and extra rows. */
export function summarySlip(p) {
  const form = PROJECT_TEMPLATES[formOf(p)] || PROJECT_TEMPLATES.general;
  const values = p.details?.values || {};
  const blocks = Object.entries(form.groups).map(([g, title]) => ({
    type: 'section',
    title,
    rows: form.fields.filter((f) => f.group === g && !empty(values[f.key])).map((f) => ({ key: f.key, label: f.label, type: f.type, value: values[f.key] })),
  })).filter((b) => b.rows.length);
  const balance = balanceOf(values);
  if (typeof balance === 'number') blocks.push({ type: 'section', title: 'Balance', rows: [{ key: 'balance', label: COMPUTED_KEYS.balance.label, type: 'money', value: balance, strong: true }] });
  if (p.details?.custom?.length) {
    blocks.push({ type: 'section', title: 'Other details', rows: p.details.custom.map((c, i) => ({ key: `custom${i}`, label: c.label, type: 'textarea', value: c.value || '' })) });
  }
  return {
    key: SUMMARY_SLIP.key, title: SUMMARY_SLIP.title, label: SUMMARY_SLIP.label, ref: projectRef(p),
    projectName: p.name, owner: p.owner?.name || '', order: p.details?.order?.number || '',
    blocks, missing: [], declaration: '', signatures: ['Prepared by', 'Checked by'],
  };
}

/** A slip's data for `actor`: anyone who sees the project (a deleted one too, for the record). */
export async function loadSlip(actor, projectId, key, now = new Date()) {
  const p = await loadVisibleProject(actor, projectId, { archived: true });
  if (String(key) === SUMMARY_SLIP.key) return summarySlip(p);
  return slipFromTemplate(p, await liveTemplateFor(p, key), now);
}

/** The admin's "Preview": a definition, checked, filled with [Labels] so the layout shows. */
export function previewSlip(actor, input = {}) {
  mustBeAdmin(actor);
  const t = cleanDefinition({ ...input, key: input.key || 'preview' });
  const sample = { _id: new mongoose.Types.ObjectId(), name: 'Sample project', owner: { name: 'Project owner' }, details: { template: t.forms[0] || 'general', values: {} }, slipValues: {} };
  const fake = (k) => `[${metaOf(t, k).label.replace(/\s*\(₹\)$/, '')}]`;
  const slip = slipFromTemplate(sample, t);
  const fill = (r) => (r.value === '' ? { ...r, type: 'text', value: fake(r.key) } : r);
  slip.blocks = slip.blocks.map((b) => {
    if (b.type === 'section') return { ...b, rows: b.rows.map(fill) };
    if (b.type === 'paragraph') return { ...b, pieces: b.pieces.map((x) => (x.placeholder ? fill(x) : x)) };
    return { ...b, ...itemsWithAmounts([{ name: '[Item]', qty: 2, rate: 150 }, { name: '[Item]', qty: 1, rate: 499.5 }]) };
  });
  slip.ref = 'PREVIEW';
  slip.missing = [];
  return slip;
}

