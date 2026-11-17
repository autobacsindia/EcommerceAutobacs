/**
 * A project's "Details" box: the job's own facts (customer, vehicle, dates,
 * amounts…) on the form its kind of work uses (config/projectTemplates.js),
 * and the data each printable slip is drawn from.
 *
 * ── Who does what ───────────────────────────────────────────────────────────
 *   read     whoever sees the project (services/staffProjectService.js)
 *   change   the admin, the owner and the project's people — the ones doing
 *            the job. A team head who only sees it through their team reads.
 *   order    filling customer details from an order also needs a team that
 *            handles orders (sales, operations, accounts) or the admin, so the
 *            box is not a way round who may read customer addresses
 *   slips    services/slipTemplateService.js (stored templates)
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - only fields of the chosen form are stored, each checked for its type
 *   - two people editing at once never silently overwrite each other (rev)
 *   - the balance on a slip is worked out here, in paise, never sent by the panel
 *   - a deleted (archived) project cannot be changed; it can still be read
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffProjectRepository from '../repositories/staffProjectRepository.js';
import Order from '../models/Order.js';
import { orderNumber } from './invoiceService.js';
import { loadVisibleProject, canManageProject } from './staffProjectService.js';
import { STAFF_TEAMS } from '../config/staff.js';
import {
  PROJECT_TEMPLATES, TEMPLATE_KEYS, FIELD_MAX,
  CUSTOM_FIELDS_MAX, CUSTOM_LABEL_MAX, CUSTOM_VALUE_MAX,
} from '../config/projectTemplates.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const ORDER_TEAMS = new Set([STAFF_TEAMS.SALES, STAFF_TEAMS.OPERATIONS, STAFF_TEAMS.ACCOUNTS]);

/** How far back a short order number (the 8 characters on the panel) is looked for. */
export const ORDER_SUFFIX_LOOKBACK_DAYS = 120;
const MONEY_MAX = 100_000_000; // ₹10 crore: far above any job
const NUMBER_MAX = 10_000_000;

// ── Rules ───────────────────────────────────────────────────────────────────

const inPeople = (u, p) => (p.people || []).some((x) => idOf(x.user) === idOf(u?._id));
export const canEditDetails = (u, p) => !!p && !p.archivedAt && (canManageProject(u, p) || (isActiveStaff(u) && inPeople(u, p)));
export const canReadOrders = (u) => isAdmin(u) || (isActiveStaff(u) && ORDER_TEAMS.has(u.staff.team));

// ── Input ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

function cleanText(raw, field, { multiline }) {
  if (typeof raw !== 'string' && typeof raw !== 'number') throw fail(`${field.label}: enter text.`, 400);
  let text = String(raw).normalize('NFKC').replace(CONTROL, '').replace(/\r\n?/g, '\n');
  text = multiline ? text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
  const max = field.max || FIELD_MAX[field.type] || FIELD_MAX.text;
  if (text.length > max) throw fail(`${field.label}: keep it under ${max} characters.`, 400);
  return field.upper ? text.toUpperCase() : text;
}

function cleanDate(raw, field) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3]) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) {
    throw fail(`${field.label}: pick a valid date.`, 400);
  }
  return m[0];
}

function cleanNumber(raw, field, { money }) {
  const text = typeof raw === 'string' ? raw.replace(/[,\s₹]/g, '') : raw;
  const n = typeof text === 'number' ? text : /^\d+(\.\d+)?$/.test(String(text)) ? Number(text) : NaN;
  if (!Number.isFinite(n) || n < 0) throw fail(`${field.label}: enter a number (0 or more).`, 400);
  if (n > (money ? MONEY_MAX : NUMBER_MAX)) throw fail(`${field.label}: that number is too large.`, 400);
  // Money is kept in rupees with paise; rounded here so 0.1 + 0.2 never reaches a slip.
  return money ? Math.round(n * 100) / 100 : n;
}

function cleanPhone(raw, field) {
  const text = String(raw).replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (!/^\+?[\d][\d\s-]{5,18}$/.test(text)) throw fail(`${field.label}: enter a phone number (digits, + - and spaces).`, 400);
  return text;
}

export function cleanValue(raw, field) {
  switch (field.type) {
    case 'text': return cleanText(raw, field, { multiline: false });
    case 'textarea': return cleanText(raw, field, { multiline: true });
    case 'phone': return cleanPhone(raw, field);
    case 'date': return cleanDate(raw, field);
    case 'number': return cleanNumber(raw, field, { money: false });
    case 'money': return cleanNumber(raw, field, { money: true });
    default: throw fail(`${field.label}: unknown field type.`, 500);
  }
}

/** The template's values from `raw`: unknown keys refused, empty ones dropped. */
export function cleanValues(template, raw) {
  const t = PROJECT_TEMPLATES[template];
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail('Details must be a list of fields.', 400);
  const byKey = new Map(t.fields.map((field) => [field.key, field]));
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = byKey.get(key);
    if (!field) throw fail(`“${key}” is not a field of the ${t.label} form.`, 400);
    if (blank(value)) continue;
    const clean = cleanValue(value, field);
    if (clean !== '') out[key] = clean;
  }
  return out;
}

export function cleanCustom(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw fail('Extra fields must be a list.', 400);
  if (raw.length > CUSTOM_FIELDS_MAX) throw fail(`Add at most ${CUSTOM_FIELDS_MAX} extra fields.`, 400);
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') throw fail('Each extra field needs a name.', 400);
    const label = cleanText(row.label ?? '', { label: 'Extra field name', type: 'text', max: CUSTOM_LABEL_MAX }, { multiline: false });
    const value = blank(row.value) ? '' : cleanText(row.value, { label: label || 'Extra field', type: 'textarea', max: CUSTOM_VALUE_MAX }, { multiline: true });
    if (!label && !value) continue; // an empty row the panel left behind
    if (!label) throw fail('Give each extra field a name.', 400);
    out.push({ label, value });
  }
  return out;
}

export function cleanTemplate(raw) {
  if (!TEMPLATE_KEYS.includes(raw)) throw fail('Pick one of the forms.', 400);
  return raw;
}

// ── Shape ───────────────────────────────────────────────────────────────────

/** Balance due = quoted − advance, in paise. null when nothing was quoted. */
export function balanceOf(values = {}) {
  if (typeof values.amountQuoted !== 'number') return null;
  const paise = Math.round(values.amountQuoted * 100) - Math.round((Number(values.advancePaid) || 0) * 100);
  return paise / 100;
}

export function shapeDetails(details) {
  if (!details?.template || !PROJECT_TEMPLATES[details.template]) return null;
  const values = { ...(details.values || {}) };
  return {
    template: details.template,
    templateLabel: PROJECT_TEMPLATES[details.template].label,
    values,
    custom: (details.custom || []).map((c) => ({ label: c.label, value: c.value || '' })),
    order: details.order?.id ? { id: idOf(details.order.id), number: details.order.number || '' } : null,
    balance: balanceOf(values),
    updatedAt: details.updatedAt || null,
    updatedByName: details.updatedByName || '',
  };
}

/** The forms and slips, for the panel to draw the editor from. */
export function templatesForPanel() {
  return {
    templates: TEMPLATE_KEYS.map((key) => {
      const t = PROJECT_TEMPLATES[key];
      return { key, label: t.label, hint: t.hint, groups: t.groups, fields: t.fields };
    }),
    limits: { customFields: CUSTOM_FIELDS_MAX, customLabel: CUSTOM_LABEL_MAX, customValue: CUSTOM_VALUE_MAX },
  };
}

// ── Orders ──────────────────────────────────────────────────────────────────

const ORDER_FIELDS = '_id wpId shippingAddress status listDate';

/**
 * An order from what someone typed or pasted: its link or full id, a website
 * number (#12345, migrated from WooCommerce), or the 8-character number the
 * panel shows (#AB12CD34) from the last ORDER_SUFFIX_LOOKBACK_DAYS — that one
 * is a bounded scan of the order_list_date range, never the whole collection.
 */
export async function findOrder(raw, now = new Date()) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 300) return null;
  const full = /\b([0-9a-f]{24})\b/i.exec(text);
  if (full) return Order.findById(full[1]).select(ORDER_FIELDS).lean();
  const wp = /^#?(\d{1,9})$/.exec(text);
  if (wp) {
    const byWp = await Order.findOne({ wpId: Number(wp[1]) }).select(ORDER_FIELDS).lean();
    // "#12345678" is also a valid short panel number (an id ending in digits only).
    if (byWp || wp[1].length !== 8) return byWp;
  }
  const short = /^#?([0-9a-f]{8})$/i.exec(text);
  if (!short) return null;
  const since = new Date(now.getTime() - ORDER_SUFFIX_LOOKBACK_DAYS * 86_400_000);
  const rows = await Order.find({
    listDate: { $gte: since },
    $expr: { $eq: [{ $substrCP: [{ $toString: '$_id' }, 16, 8] }, short[1].toLowerCase()] },
  }).select(ORDER_FIELDS).sort({ listDate: -1, _id: -1 }).limit(2).maxTimeMS(3000).lean();
  return rows.length === 1 ? rows[0] : null;
}

const addressOf = (a = {}) => [a.addressLine1, a.addressLine2, a.city, a.state, a.postalCode].map((x) => String(x || '').trim()).filter(Boolean).join(', ');

/** Customer fields an order fills in (the sales form's keys). */
export function valuesFromOrder(order) {
  const a = order?.shippingAddress || {};
  const out = {};
  if (a.fullName) out.customerName = String(a.fullName).slice(0, 80);
  if (a.phone) out.customerPhone = String(a.phone).slice(0, 20);
  const address = addressOf(a);
  if (address) out.customerAddress = address.slice(0, 300);
  return out;
}

/** "Fill from order": what the order would fill in. Nothing is saved. */
export async function previewFromOrder(actor, projectId, raw) {
  const p = await loadVisibleProject(actor, projectId);
  if (!canEditDetails(actor, p)) throw fail('Only the project’s people can change its details.', 403);
  if (!canReadOrders(actor)) throw fail('Only sales, operations, accounts and the admin can fill details from an order.', 403);
  const order = await findOrder(raw);
  if (!order) throw fail('No order found. Paste the order’s link, or its number like #AB12CD34.', 404);
  return { order: { id: idOf(order._id), number: orderNumber(order) }, values: valuesFromOrder(order) };
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Replace a project's details: { rev, template, values, custom, orderId? }.
 * The whole box is sent each time (it is one form), so a field left empty is cleared.
 */
export async function updateDetails(actor, id, input = {}, req) {
  const p = await loadVisibleProject(actor, id, { archived: true });
  if (p.archivedAt) throw fail('This project is deleted. Restore it first.', 409);
  if (!canEditDetails(actor, p)) throw fail('Only the project’s people can change its details.', 403);
  const rev = Number(input.rev);
  if (!Number.isInteger(rev)) throw fail('Reload and try again.', 400);
  if (rev !== p.rev) throw fail('Someone changed this project just now. It has been reloaded — try again.', 409);

  const template = cleanTemplate(input.template);
  const values = cleanValues(template, input.values);
  const custom = cleanCustom(input.custom);

  // The order link: kept as it was unless the panel names another (or clears it).
  let order = p.details?.order?.id ? p.details.order : null;
  if (Object.prototype.hasOwnProperty.call(input, 'orderId')) {
    if (input.orderId == null || input.orderId === '') {
      order = null;
    } else {
      if (!canReadOrders(actor)) throw fail('Only sales, operations, accounts and the admin can link an order.', 403);
      if (!mongoose.isValidObjectId(input.orderId)) throw fail('That order no longer exists.', 400);
      const found = await Order.findById(input.orderId).select(ORDER_FIELDS).lean();
      if (!found) throw fail('That order no longer exists.', 400);
      order = { id: found._id, number: orderNumber(found) };
    }
  }

  const details = { template, values, custom, order, updatedAt: new Date(), updatedByName: actor.name || '' };
  const next = await staffProjectRepository.updateIfRev(p._id, rev, { details });
  if (!next) throw fail('Someone changed this project just now. It has been reloaded — try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffProject', p._id, { changes: ['details'], template, fields: Object.keys(values).length, custom: custom.length });
  return next;
}
