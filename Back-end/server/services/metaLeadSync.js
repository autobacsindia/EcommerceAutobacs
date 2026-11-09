/**
 * Google Sheet → MetaLead. Runs every few minutes (cronService) and from
 * scripts/sync-meta-leads-sheet.js, always through this one routine.
 *
 *   new row in the sheet        → added
 *   cell changed in the sheet   → updated, unless that field was edited in the panel
 *   row removed from the sheet  → stays: the sync never deletes
 *   same run twice              → second run writes nothing
 *   Google unreachable          → nothing written, failure recorded for the page
 *
 * Writes are guarded by the row's `revision`, so a person's edit landing mid-run
 * makes that one update miss (the next run catches up) instead of being overwritten.
 */
import * as Sentry from '@sentry/node';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import { readAllTabs, readServiceAccount } from './googleSheetsClient.js';
import { parseTab } from '../utils/metaLeadSheet.js';

export const META_LEADS_UNDATED = new Date(0);
const WRITE_BATCH = 500;
// Sheet-owned columns, each named as editedFields names them.
const COLUMNS = ['name', 'phone', 'email', 'product', 'campaign', 'salesPerson', 'status', 'followUp1', 'followUp2'];

export const extraKey = (label) => `field:${label}`;
const sameDate = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** What the sheet would change on an existing row, leaving edited fields alone. */
export function diffRow(existing, row) {
  const locked = new Set(existing.editedFields ?? []);
  const set = {};
  COLUMNS.forEach((c) => { if (!locked.has(c) && (existing[c] ?? '') !== row[c]) set[c] = row[c]; });
  if (!locked.has('leadDate')) {
    if (!sameDate(existing.leadDate, row.leadDate)) { set.leadDate = row.leadDate; set.sortAt = row.leadDate ?? META_LEADS_UNDATED; }
    if ((existing.dateRaw ?? '') !== row.dateRaw) set.dateRaw = row.dateRaw;
    if (!!existing.dateHasTime !== row.dateHasTime) set.dateHasTime = row.dateHasTime;
  }
  if (existing.tab !== row.tab) set.tab = row.tab;
  if (existing.rowNumber !== row.rowNumber) set.rowNumber = row.rowNumber;

  // Keep edited answers; a column that has left the sheet stays saved.
  const before = new Map((existing.fields ?? []).map((f) => [f.label, f.value]));
  const merged = row.fields.map((f) => (locked.has(extraKey(f.label)) && before.has(f.label) ? { label: f.label, value: before.get(f.label) } : f));
  const inSheet = new Set(row.fields.map((f) => f.label));
  (existing.fields ?? []).forEach((f) => { if (!inSheet.has(f.label)) merged.push({ label: f.label, value: f.value }); });
  if (JSON.stringify(merged) !== JSON.stringify((existing.fields ?? []).map(({ label, value }) => ({ label, value })))) set.fields = merged;
  return set;
}

function plan(rows, existing) {
  const ops = [];
  let added = 0;
  let updated = 0;
  rows.forEach((row) => {
    const found = existing.get(row.sheetKey);
    if (!found) {
      added += 1;
      ops.push({ updateOne: { filter: { sheetKey: row.sheetKey }, update: { $setOnInsert: { ...row, sortAt: row.leadDate ?? META_LEADS_UNDATED } }, upsert: true } });
      return;
    }
    const set = diffRow(found, row);
    if (Object.keys(set).length) {
      updated += 1;
      ops.push({ updateOne: { filter: { _id: found._id, revision: found.revision ?? 0 }, update: { $set: set } } });
    }
  });
  return { ops, added, updated };
}

/**
 * @param {{ apply?: boolean, readTabs?: Function }} options `apply: false` reports without writing.
 * @returns the per-tab report and totals.
 */
export async function syncMetaLeadsFromSheet({ apply = true, readTabs = readAllTabs } = {}) {
  const sheetId = process.env.META_LEADS_SHEET_ID;
  if (!sheetId) throw new Error('META_LEADS_SHEET_ID is not set');

  const tabs = await readTabs(sheetId);
  const seen = new Set();
  const parsed = tabs.map((t) => parseTab(t, seen));
  const rows = parsed.flatMap((p) => p.rows);
  const existing = await metaLeadRepository.findBySheetKeys(rows.map((r) => r.sheetKey));
  const { ops, added, updated } = plan(rows, existing);

  if (apply) {
    for (let i = 0; i < ops.length; i += WRITE_BATCH) await metaLeadRepository.bulkWrite(ops.slice(i, i + WRITE_BATCH));
  }

  const reports = parsed.map((p) => p.report);
  const totals = {
    rowsWithData: reports.reduce((n, r) => n + r.rowsWithData, 0),
    ready: rows.length,
    testLeads: reports.reduce((n, r) => n + r.testLeads, 0),
    repeatedMetaIds: reports.reduce((n, r) => n + r.repeatedMetaIds, 0),
    unrecognisedRows: reports.filter((r) => r.unrecognised).reduce((n, r) => n + r.rowsWithData, 0),
    added,
    updated,
    unchanged: rows.length - added - updated,
  };
  if (apply) {
    await metaLeadRepository.saveState({
      lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastError: '',
      tabs: reports.filter((r) => r.ready > 0).map((r) => ({ name: r.tab, rows: r.ready })),
      summary: totals,
    });
  }
  return { reports, totals };
}

/** The scheduled run: off until both settings exist; a failure is recorded and alerted, never thrown. */
export async function runScheduledMetaLeadSync() {
  if (!process.env.META_LEADS_SHEET_ID || !process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) return null;
  try {
    readServiceAccount();
    const { totals } = await syncMetaLeadsFromSheet();
    if (totals.added || totals.updated) console.log(`[MetaLeadSync] added ${totals.added}, updated ${totals.updated}`);
    if (totals.unrecognisedRows) Sentry.captureMessage(`[MetaLeadSync] ${totals.unrecognisedRows} rows on tabs with unrecognised columns were not imported`, 'warning');
    return totals;
  } catch (err) {
    console.error('[MetaLeadSync] failed:', err.message);
    Sentry.captureException(err);
    await metaLeadRepository.saveState({ lastAttemptAt: new Date(), lastError: String(err.message).slice(0, 200) }).catch(() => {});
    return null;
  }
}
