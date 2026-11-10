/**
 * Turns one tab of the "sales lead sheet" into MetaLead rows. Pure, so every odd
 * thing a hand-kept sheet can do is unit-testable. Nothing is dropped silently:
 * each row with any content ends up in `rows`, or is counted as a test lead or a
 * repeated Meta id.
 *
 * Two kinds of tab exist: campaign tabs written by Meta (id, created_time, …,
 * form answers) and the typed "website lead" tab (date, name, phone, …, then two
 * columns with no heading).
 */
import { normalizePhone } from './identity.js';

const IST_OFFSET = '+05:30';
const TEST_MARK = '<test lead';
const FOLLOW_UP_CORE = ['followUp1', 'followUp2'];

const key = (h) => String(h ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/*
  Exact names only. `lead_status` (a Meta column) is not our `status`, and
  `ad_name` / `form_name` are not a person's name.
*/
const CORE_COLUMNS = {
  date: ['created_time', 'date', 'lead_date'],
  name: ['full_name', 'name', 'your_name', 'customer_name'],
  phone: ['phone_number', 'phone', 'mobile', 'mobile_number', 'contact_number', 'whatsapp_number', 'phone_no'],
  email: ['email', 'email_id', 'email_address'],
  product: ['product', 'product_name'],
  campaign: ['campaign_name'],
  form: ['form_name'],
  salesPerson: ['sales_person', 'salesperson', 'sales_executive'],
  status: ['status'],
  metaId: ['id'],
};
const COLUMN_OF = new Map(Object.entries(CORE_COLUMNS).flatMap(([col, names]) => names.map((n) => [n, col])));

/** Which core column a saved label feeds, or null for a form question etc. */
export function columnOfLabel(label) {
  const blank = /^Follow-up ([12])$/.exec(label);
  if (blank) return FOLLOW_UP_CORE[Number(blank[1]) - 1];
  return COLUMN_OF.get(key(label)) ?? null;
}

/** A date cell → the moment it means. A date with no time is that day in India. */
export function parseSheetDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { date: null, hasTime: false };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? { date: null, hasTime: false } : { date, hasTime: true };
  }
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (!m) return { date: null, hasTime: false };
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00${IST_OFFSET}`);
  // Reject 31-02-2026 instead of letting it roll into March.
  const valid = !Number.isNaN(date.getTime()) && new Date(date.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) === iso;
  return valid ? { date, hasTime: false } : { date: null, hasTime: false };
}

/** Meta writes phones as `p:+919876543210`. */
export const cleanPhone = (raw) => String(raw ?? '').trim().replace(/^p:/i, '').trim();

const headerRowIndex = (values) => values.findIndex((r) => r.filter((c) => String(c ?? '').trim()).length >= 2);

const META_ID = /^l:\d+$/i;
/**
 * The column holding Meta's lead ids, found by its values: on the live sheet
 * someone typed over the "id" heading, and a staff column elsewhere is headed "id".
 */
function metaIdColumn(body, width) {
  for (let i = 0; i < width; i += 1) {
    const filled = body.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
    if (filled.length && filled.filter((v) => META_ID.test(v)).length / filled.length >= 0.9) return i;
  }
  return -1;
}

/*
  Meta writes its columns up to `lead_status`; everything to the right is typed by
  the sales team, whose headings are missing or wrong ("id", "name", "follow up 1",
  blank). So those go by position: the first is the sales person, the rest are
  follow-ups in order, and only a column headed exactly "status" is the status.
  A tab without `lead_status` (the typed website tab) keeps its own headings.
*/
function labelsFor(headerRow, width, body) {
  const heads = Array.from({ length: width }, (_, i) => String(headerRow[i] ?? '').trim());
  const idCol = metaIdColumn(body, width);
  const statusAt = heads.findIndex((h) => key(h) === 'lead_status');
  const staffFrom = statusAt >= 0 ? statusAt + 1 : width;
  let blank = 0;
  let followUp = 0;
  const raw = heads.map((h, i) => {
    if (i === idCol) return { label: 'id', column: 'metaId' };
    if (i >= staffFrom) {
      if (key(h) === 'status') return { label: 'status', column: 'status' };
      if (i === staffFrom) return { label: 'Sales person', column: 'salesPerson' };
      followUp += 1;
      return { label: `Follow-up ${followUp}`, column: FOLLOW_UP_CORE[followUp - 1] ?? null };
    }
    if (!h) { blank += 1; return { label: `Follow-up ${blank}`, column: FOLLOW_UP_CORE[blank - 1] ?? null }; }
    const column = COLUMN_OF.get(key(h)) ?? null;
    // An "id" heading over something that is not Meta's id must not become the key.
    return { label: h, column: column === 'metaId' && idCol >= 0 ? null : column };
  });
  // One label per column, and one column per core field: the first one wins.
  const seen = new Map();
  const taken = new Set();
  return raw.map(({ label, column }) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    const own = column && !taken.has(column) ? column : null;
    if (own) taken.add(own);
    return { label: n > 1 ? `${label} (${n})` : label, column: own };
  });
}

/**
 * @param {{ name: string, gid: number|string, values: string[][] }} tab
 * @returns {{ rows: object[], report: object }} `seenMetaIds` is shared across tabs by the caller.
 */
export function parseTab({ name, gid, values }, seenMetaIds = new Set()) {
  const report = { tab: name, rowsWithData: 0, ready: 0, testLeads: 0, repeatedMetaIds: 0, repeatedPhones: 0, undated: 0, unreadableDates: 0, noContact: 0, columns: [], unrecognised: false };
  const rows = [];
  const start = headerRowIndex(values ?? []);
  if (start < 0) return { rows, report };

  const body = values.slice(start + 1);
  const width = Math.max(values[start].length, ...body.map((r) => r.length));
  const labels = labelsFor(values[start], width, body);
  report.columns = labels.map((l) => l.label);
  const present = new Set(labels.map((l) => l.column));
  if (!['phone', 'metaId', 'name'].some((c) => present.has(c))) {
    report.unrecognised = true;
    report.rowsWithData = body.filter((r) => r.some((c) => String(c ?? '').trim())).length;
    return { rows, report };
  }

  const occurrences = new Map();
  body.forEach((cells, offset) => {
    const text = labels.map((_, i) => String(cells[i] ?? '').trim());
    if (!text.some(Boolean)) return;
    report.rowsWithData += 1;
    if (text.some((c) => c.toLowerCase().includes(TEST_MARK))) { report.testLeads += 1; return; }

    const core = {};
    labels.forEach((l, i) => { if (l.column && !(l.column in core)) core[l.column] = text[i]; });

    const metaLeadId = /^l:/i.test(core.metaId ?? '') ? core.metaId : null;
    if (metaLeadId && seenMetaIds.has(metaLeadId)) { report.repeatedMetaIds += 1; return; }
    if (metaLeadId) seenMetaIds.add(metaLeadId);

    const phone = cleanPhone(core.phone);
    const digits = normalizePhone(phone);
    const person = digits ? `phone:${digits}` : `who:${(core.name ?? '').toLowerCase()}|${(core.product ?? '').toLowerCase()}`;
    const n = (occurrences.get(person) ?? 0) + 1;
    occurrences.set(person, n);
    if (n > 1 && digits && !metaLeadId) report.repeatedPhones += 1;
    if (!digits && !core.email) report.noContact += 1;

    const dateRaw = core.date ?? '';
    const { date, hasTime } = parseSheetDate(dateRaw);
    if (!dateRaw) report.undated += 1;
    else if (!date) report.unreadableDates += 1;

    rows.push({
      sheetKey: metaLeadId ?? `gid:${gid}|${person}#${n}`,
      metaLeadId,
      tab: name,
      rowNumber: start + offset + 2,
      leadDate: date,
      dateRaw,
      dateHasTime: hasTime,
      name: core.name ?? '',
      phone,
      email: core.email ?? '',
      product: core.product || core.form || '',
      campaign: core.campaign ?? '',
      salesPerson: core.salesPerson ?? '',
      status: core.status ?? '',
      followUp1: core.followUp1 ?? '',
      followUp2: core.followUp2 ?? '',
      fields: labels.map((l, i) => ({ label: l.label, value: text[i] })),
    });
    report.ready += 1;
  });
  return { rows, report };
}
