/**
 * Panel → Google Sheet. The other half of services/metaLeadSync.js: whatever the
 * team does on a Meta lead in the panel is written back to its row in the sheet.
 *
 *   what is written     the panel's own columns, appended on the right of each tab
 *                       (PANEL_COLUMNS: lead id, following up, status, note, next
 *                       follow-up, late reason, updated at), plus the team's own
 *                       cell for any field edited in the panel (owner's call,
 *                       2026-11-11: the sheet and the panel must agree).
 *   which row           found again on every write, never by row number (people
 *                       sort and insert): the "Panel lead ID" cell, else Meta's
 *                       own id, else the one row that agrees on 2 of phone / name /
 *                       date / product. Not found, or two candidates → nothing is
 *                       written and the lead says so.
 *   loop safety         the reader skips the panel columns, and a team cell is
 *                       written only for a field the panel has locked
 *                       (editedFields), which the reader no longer reads.
 *   idempotent          only cells whose value differs are sent; writing the same
 *                       state twice sends nothing the second time.
 *   failure             the panel save never waits for Google. Leads stay marked
 *                       (sheetDirty) until a write lands: the queue job retries,
 *                       and the 5-minute sync retries whatever is still marked.
 *   layout              services/metaLeadSheetLayout.js keeps the panel's block the
 *                       same on every tab: one order, no gaps, after the team's.
 *   rate limit          one queue job per 10-second window flushes every waiting
 *                       lead in one read + at most two writes, far under Google's
 *                       60 writes a minute.
 */
import * as Sentry from '@sentry/node';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import { readAllTabs, writeCells, updateLayout, a1Cell, serviceAccountEmail } from './googleSheetsClient.js';
import { planPanelLayout, LAYOUT_VERSION } from './metaLeadSheetLayout.js';
import { PANEL_COLUMNS, parseTab, tabLayout } from '../utils/metaLeadSheet.js';
import { richTextToPlain } from '../utils/richText.js';
import { sheetDateTime } from '../utils/officeHours.js';
import { FOLLOW_UP_STATUSES } from '../config/leadConstants.js';
import { agreeing, SAME_ENQUIRY } from './metaLeadSync.js';
// Namespace import: many tests replace queues.js with a partial mock, and a
// missing named export would stop this whole module from loading.
import * as queues from '../queue/queues.js';

/** Job name on the notifications queue (queue/workers/notificationWorker.js). */
export const META_LEAD_SHEET_JOB = 'write-meta-lead-sheet';

const PANEL_ORDER = Object.keys(PANEL_COLUMNS);
// The sheet-owned core fields a panel edit may also write back, by editedFields name.
const CORE_FIELDS = ['name', 'phone', 'email', 'product', 'campaign', 'salesPerson', 'status', 'followUp1', 'followUp2'];
const CELL_MAX = 2000;
const WINDOW_MS = 10_000;

export const sheetWriteEnabled = () => !!process.env.META_LEADS_SHEET_ID
  && !!process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
  && String(process.env.META_LEADS_SHEET_WRITEBACK ?? '').toLowerCase() !== 'off';

const clip = (v) => String(v ?? '').slice(0, CELL_MAX);
const lastNote = (log = []) => {
  for (let i = log.length - 1; i >= 0; i -= 1) if (log[i].type === 'follow_up') return richTextToPlain(log[i].notes ?? '').trim();
  return '';
};

/** The panel's own columns for one lead. Deterministic: the same lead always gives the same cells. */
export function panelValues(lead) {
  const status = lead.followUpStatus ? (FOLLOW_UP_STATUSES[lead.followUpStatus] ?? '') : '';
  return {
    leadId: String(lead._id),
    followingUp: lead.followingUpName ?? '',
    status,
    note: clip(lastNote(lead.followUpLog)),
    nextBy: sheetDateTime(lead.nextFollowUpAt),
    lateReason: clip(lead.lateReason),
    updatedAt: sheetDateTime(lead.sheetChangedAt),
  };
}

/** The team cells this lead's panel edits own: [{ column?: core, label?: extra, value }]. */
function editedCells(lead) {
  const out = [];
  (lead.editedFields ?? []).forEach((f) => {
    if (CORE_FIELDS.includes(f)) out.push({ column: f, value: clip(lead[f]) });
    else if (f === 'leadDate') out.push({ column: 'date', value: lead.leadDate ? sheetDateTime(lead.leadDate) : '' });
    else if (f.startsWith('field:')) {
      const label = f.slice('field:'.length);
      const field = (lead.fields ?? []).find((x) => x.label === label);
      if (field) out.push({ label, value: clip(field.value) });
    }
  });
  return out;
}

function indexTab(tab) {
  const layout = tabLayout(tab.values);
  if (!layout) return null;
  const rows = parseTab(tab, new Set()).rows;
  const idCol = layout.panel.leadId;
  const panelIdAt = (row) => (idCol == null ? '' : String(tab.values[row - 1]?.[idCol] ?? '').trim());
  return { tab, layout, rows, panelIdAt };
}

/**
 * Where each lead's row is now. Pure.
 * @returns Map leadId → { at: { t, row } } | { error: 'not_in_sheet' | 'ambiguous' }
 */
export function locateRows(indexed, leads) {
  const byPanelId = new Map();
  const byMetaId = new Map();
  indexed.forEach((t) => t.tab.values.forEach((_, i) => {
    const row = i + 1;
    if (row <= t.layout.headerRow) return;
    const id = t.panelIdAt(row);
    if (id) byPanelId.set(id, [...(byPanelId.get(id) ?? []), { t, row }]);
  }));
  indexed.forEach((t) => t.rows.forEach((r) => { if (r.metaLeadId) byMetaId.set(r.metaLeadId, { t, row: r.rowNumber }); }));

  const taken = new Set([...byPanelId.values()].flat().map((p) => `${p.t.tab.name}#${p.row}`));
  const out = new Map();
  leads.forEach((lead) => {
    const id = String(lead._id);
    const pinned = byPanelId.get(id) ?? [];
    if (pinned.length === 1) { out.set(id, { at: pinned[0] }); return; }
    if (pinned.length > 1) { out.set(id, { error: 'ambiguous' }); return; }
    if (lead.metaLeadId) {
      const at = byMetaId.get(lead.metaLeadId);
      out.set(id, at ? { at } : { error: 'not_in_sheet' });
      if (at) taken.add(`${at.t.tab.name}#${at.row}`);
      return;
    }
    // A typed row: the best-agreeing free row on its own tab, only when it is the only one.
    const t = indexed.find((x) => x.tab.name === lead.tab);
    if (!t) { out.set(id, { error: 'not_in_sheet' }); return; }
    const scored = t.rows
      .filter((r) => !r.metaLeadId && !taken.has(`${t.tab.name}#${r.rowNumber}`) && !t.panelIdAt(r.rowNumber))
      .map((r) => ({ r, score: agreeing(lead, r) }))
      .filter((x) => x.score >= SAME_ENQUIRY);
    const best = Math.max(0, ...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score === best);
    if (top.length !== 1) { out.set(id, { error: top.length ? 'ambiguous' : 'not_in_sheet' }); return; }
    const at = { t, row: top[0].r.rowNumber };
    taken.add(`${t.tab.name}#${at.row}`);
    out.set(id, { at });
  });
  return out;
}

/**
 * Every cell that must change, for every lead. Pure: Google is not touched.
 * @returns {{ grow: {gid, columns}[], data: {range, values}[], results: {id, wanted, error}[], cells: number }}
 */
export function planSheetWrites(tabs, leads) {
  const indexed = tabs.map(indexTab).filter(Boolean);
  const located = locateRows(indexed, leads);
  const data = [];
  const results = [];
  const newColumns = new Map(); // tab name → { first, names }
  const panelCol = (t, name) => {
    if (t.layout.panel[name] != null) return t.layout.panel[name];
    if (!newColumns.has(t.tab.name)) {
      // Missing panel columns go after everything on the tab, in a fixed order.
      const missing = PANEL_ORDER.filter((n) => t.layout.panel[n] == null);
      newColumns.set(t.tab.name, { first: t.layout.width, missing });
      missing.forEach((n, i) => { t.layout.panel[n] = t.layout.width + i; });
      missing.forEach((n) => data.push({ range: a1Cell(t.tab.name, t.layout.headerRow, t.layout.panel[n]), values: [[PANEL_COLUMNS[n]]] }));
    }
    return t.layout.panel[name];
  };
  const set = (t, row, col, value) => {
    const now = String(t.tab.values[row - 1]?.[col] ?? '');
    if (now === value) return false;
    data.push({ range: a1Cell(t.tab.name, row, col), values: [[value]] });
    return true;
  };

  leads.forEach((lead) => {
    const id = String(lead._id);
    const found = located.get(id);
    if (!found?.at) { results.push({ id: lead._id, wanted: lead.sheetWanted ?? 0, error: found?.error ?? 'not_in_sheet' }); return; }
    const { t, row } = found.at;
    const values = panelValues(lead);
    PANEL_ORDER.forEach((name) => set(t, row, panelCol(t, name), values[name]));
    editedCells(lead).forEach((c) => {
      const col = t.layout.labels.findIndex((l) => !l.panel && (c.column ? l.column === c.column : l.label === c.label));
      if (col >= 0) set(t, row, col, c.value);
    });
    results.push({ id: lead._id, wanted: lead.sheetWanted ?? 0, error: '' });
  });

  const grow = [];
  newColumns.forEach(({ missing }, name) => {
    const t = indexed.find((x) => x.tab.name === name);
    const need = t.layout.width + missing.length;
    if (t.tab.columnCount && need > t.tab.columnCount) grow.push({ gid: t.tab.gid, columns: need - t.tab.columnCount });
  });
  return { grow, data, results, cells: data.length };
}

const classify = (err) => {
  if (err?.status === 403) return 'permission';
  if (err?.status === 404) return 'missing';
  if (/not set/.test(err?.message ?? '')) return 'config';
  return 'unavailable';
};
const MESSAGES = {
  permission: 'The sheet is not shared with the website\'s robot account as Editor, so panel changes cannot be written to it.',
  missing: 'The sales lead sheet was not found. Check META_LEADS_SHEET_ID.',
  config: 'The Google connection is not set up on the server.',
  unavailable: 'Google Sheets did not answer. Panel changes will be written as soon as it does.',
};

async function saveWriteState(patch) {
  const before = (await metaLeadRepository.getState())?.writeBack ?? {};
  await metaLeadRepository.saveState({ writeBack: { ...before, ...patch } });
  return before;
}

/**
 * Keep the panel's columns tidy on every lead tab (services/metaLeadSheetLayout.js).
 * Best-effort: a failure here is recorded and reported once, and never stops the
 * cell writes. Returns the tabs to plan the writes on (re-read after any change).
 */
async function tidyLayout(sheetId, tabs, readTabs, layout) {
  const state = (await metaLeadRepository.getState())?.writeBack?.layout ?? {};
  const done = state.version === LAYOUT_VERSION ? (state.gids ?? []) : [];
  const plan = planPanelLayout(tabs, done);
  if (!plan.requests.length) return tabs;
  try {
    await layout(sheetId, plan.requests);
    const gids = [...new Set([...done, ...plan.dressed].map(String))];
    await saveWriteState({ layout: { version: LAYOUT_VERSION, gids, error: '', at: new Date() } });
    console.log(`[MetaLeadSheetWrite] tidied the panel columns on: ${plan.tabs.join(', ')}`);
  } catch (err) {
    console.error('[MetaLeadSheetWrite] layout failed:', err.message);
    if (!state.error) Sentry.captureException(err, { tags: { metaLeadSheetWrite: 'layout' } });
    await saveWriteState({ layout: { ...state, error: String(err.message ?? err).slice(0, 300) } }).catch(() => {});
    return tabs;
  }
  // Columns moved: plan the cell writes on the sheet as it is now.
  return readTabs(sheetId);
}

/**
 * Write every waiting lead to the sheet, after tidying the panel's columns.
 * Never touches a lead whose write did not land. Throws only when Google was
 * unavailable (so the queue retries); a permission error is recorded and left for
 * the next run, as retrying it now cannot help. `ensureLayout` (the scheduled
 * run) reads the sheet even with nothing waiting, so every tab gets its columns.
 */
export async function flushMetaLeadSheetWrites({
  readTabs = readAllTabs, write = writeCells, layout = updateLayout, now = () => new Date(), ensureLayout = false,
} = {}) {
  if (!sheetWriteEnabled()) return null;
  const sheetId = process.env.META_LEADS_SHEET_ID;
  const leads = await metaLeadRepository.findSheetDirty();
  const attemptAt = now();
  if (!leads.length && !ensureLayout) {
    await saveWriteState({ pending: 0 });
    return { leads: 0, cells: 0, notFound: 0 };
  }
  try {
    const tabs = await tidyLayout(sheetId, await readTabs(sheetId), readTabs, layout);
    if (!leads.length) {
      await saveWriteState({ pending: 0, lastAttemptAt: attemptAt, lastSuccessAt: attemptAt, error: '', errorKind: '', robotEmail: '' });
      return { leads: 0, cells: 0, notFound: 0 };
    }
    const plan = planSheetWrites(tabs, leads);
    await write(sheetId, plan);
    await metaLeadRepository.settleSheetWrites(plan.results, attemptAt);
    const notFound = plan.results.filter((r) => r.error).length;
    const [pending, notInSheet] = await Promise.all([metaLeadRepository.countSheetDirty(), metaLeadRepository.countSheetNotFound()]);
    await saveWriteState({ lastAttemptAt: attemptAt, lastSuccessAt: attemptAt, error: '', errorKind: '', robotEmail: '', pending, notInSheet });
    if (plan.cells) console.log(`[MetaLeadSheetWrite] ${plan.cells} cell(s) for ${leads.length} lead(s)${notFound ? `, ${notFound} not found in the sheet` : ''}`);
    if (pending) requestMetaLeadSheetWrite();
    return { leads: leads.length, cells: plan.cells, notFound };
  } catch (err) {
    const kind = classify(err);
    const pending = await metaLeadRepository.countSheetDirty().catch(() => leads.length);
    const before = await saveWriteState({
      lastAttemptAt: attemptAt, error: MESSAGES[kind], errorKind: kind, pending,
      robotEmail: kind === 'permission' ? (serviceAccountEmail() ?? '') : '',
    }).catch(() => ({}));
    console.error(`[MetaLeadSheetWrite] failed (${kind}):`, err.message);
    // Once per kind of trouble, not every 10 seconds while it lasts.
    if (before.errorKind !== kind) Sentry.captureException(err, { tags: { metaLeadSheetWrite: kind } });
    if (kind === 'unavailable') throw err;
    return { leads: leads.length, cells: 0, error: kind };
  }
}

/** The scheduled safety net (every sync run): retries whatever is still waiting. Never throws. */
export async function runScheduledSheetWrite() {
  try { return await flushMetaLeadSheetWrites({ ensureLayout: true }); } catch { return null; }
}

/**
 * Ask for a write soon. Edits in the same 10-second window share one job (same
 * jobId), so a burst of clicks is one Google write. Without the queue Redis the
 * 5-minute run still writes it: nothing is lost, only later.
 */
export function requestMetaLeadSheetWrite(at = Date.now(), enqueue = queues.enqueueMetaLeadSheetWrite) {
  if (!sheetWriteEnabled() || typeof enqueue !== 'function') return;
  const window = Math.floor(at / WINDOW_MS) + 1;
  const delay = window * WINDOW_MS - at;
  try {
    Promise.resolve(enqueue({ jobId: `meta-lead-sheet|${window}`, delay })).catch((err) => console.error('[MetaLeadSheetWrite] enqueue failed:', err.message));
  } catch (err) {
    console.error('[MetaLeadSheetWrite] enqueue failed:', err.message);
  }
}
