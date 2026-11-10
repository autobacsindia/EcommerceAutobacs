/**
 * Google Sheet → MetaLead. Runs every few minutes (cronService) and from
 * scripts/sync-meta-leads-sheet.js, always through this one routine.
 *
 *   new row in the sheet        → added
 *   cell changed in the sheet   → updated, unless that field was edited in the panel
 *   row removed from the sheet  → stays, marked as no longer in the sheet
 *   same run twice              → second run writes nothing
 *   Google unreachable          → nothing written, failure recorded for the page
 *
 * The team's follow-up work (who is following up, statuses, notes) is never read
 * or written here: it is not in SYNC_FIELDS and no update below names it.
 *
 * Writes are guarded by the row's `revision`, so a person's edit landing mid-run
 * makes that one update miss (the next run catches up) instead of being overwritten.
 */
import * as Sentry from '@sentry/node';
import metaLeadRepository from '../repositories/metaLeadRepository.js';
import { readAllTabs, readServiceAccount } from './googleSheetsClient.js';
import { cleanPhone, parseTab } from '../utils/metaLeadSheet.js';
import { normalizePhone } from '../utils/identity.js';

export const META_LEADS_UNDATED = new Date(0);
const WRITE_BATCH = 500;
// Sheet-owned columns, each named as editedFields names them.
const COLUMNS = ['name', 'phone', 'email', 'product', 'campaign', 'salesPerson', 'status', 'followUp1', 'followUp2'];

export const extraKey = (label) => `field:${label}`;
export const phoneKeyOf = (phone) => normalizePhone(cleanPhone(phone)) ?? '';
const sameDate = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** What the sheet would change on an existing row, leaving edited fields alone. */
export function diffRow(existing, row) {
  const locked = new Set(existing.editedFields ?? []);
  const set = {};
  COLUMNS.forEach((c) => { if (!locked.has(c) && (existing[c] ?? '') !== row[c]) set[c] = row[c]; });
  const phoneKey = phoneKeyOf(locked.has('phone') ? existing.phone : row.phone);
  if ((existing.phoneKey ?? '') !== phoneKey) set.phoneKey = phoneKey;
  if (!locked.has('leadDate')) {
    if (!sameDate(existing.leadDate, row.leadDate)) { set.leadDate = row.leadDate; set.sortAt = row.leadDate ?? META_LEADS_UNDATED; }
    if ((existing.dateRaw ?? '') !== row.dateRaw) set.dateRaw = row.dateRaw;
    if (!!existing.dateHasTime !== row.dateHasTime) set.dateHasTime = row.dateHasTime;
  }
  if (existing.tab !== row.tab) set.tab = row.tab;
  if (existing.rowNumber !== row.rowNumber) set.rowNumber = row.rowNumber;
  if (existing.removedFromSheetAt) set.removedFromSheetAt = null;

  // Keep edited answers; a column that has left the sheet stays saved.
  const before = new Map((existing.fields ?? []).map((f) => [f.label, f.value]));
  const merged = row.fields.map((f) => (locked.has(extraKey(f.label)) && before.has(f.label) ? { label: f.label, value: before.get(f.label) } : f));
  const inSheet = new Set(row.fields.map((f) => f.label));
  (existing.fields ?? []).forEach((f) => { if (!inSheet.has(f.label)) merged.push({ label: f.label, value: f.value }); });
  if (JSON.stringify(merged) !== JSON.stringify((existing.fields ?? []).map(({ label, value }) => ({ label, value })))) set.fields = merged;
  return set;
}

const lower = (v) => String(v ?? '').trim().toLowerCase();
const partsOf = (r) => [phoneKeyOf(r.phone), lower(r.name), lower(r.dateRaw), lower(r.product)];
const agreeing = (a, b) => partsOf(a).filter((v, i) => v && v === partsOf(b)[i]).length;
const tabScope = (key) => key.split('|')[0];
const contentKey = (r) => `${tabScope(r.sheetKey)}|${partsOf(r).join('|')}`;
// Two of phone / name / date / product agreeing is a corrected row, not a new enquiry.
const SAME_ENQUIRY = 2;

/**
 * Typed rows have no id from Meta, and their first key depends on position. Point
 * each one back at the saved row it really is, so a corrected phone, or a deleted
 * row above, cannot move a follow-up onto a different enquiry. Rewrites `sheetKey`
 * on `rows` in place. When there is any doubt the row is treated as new: an extra
 * row is visible and harmless, a follow-up on the wrong customer is neither.
 */
export function keepTypedRowIdentity(rows, known) {
  let waiting = rows.filter((r) => !r.metaLeadId);
  if (!waiting.length) return;
  const free = new Map([...known].filter(([, d]) => !d.metaLeadId && d.sheetKey.startsWith('gid:')));
  const take = (row, doc) => { row.sheetKey = doc.sheetKey; free.delete(doc.sheetKey); };

  // 1. Same content: the row simply moved.
  const byContent = new Map();
  free.forEach((d) => byContent.set(contentKey(d), [...(byContent.get(contentKey(d)) ?? []), d]));
  waiting = waiting.filter((row) => {
    const docs = byContent.get(contentKey(row));
    if (!docs?.length) return true;
    take(row, docs.splice(Math.max(docs.findIndex((d) => d.sheetKey === row.sheetKey), 0), 1)[0]);
    return false;
  });

  // 2. Same position, a cell corrected.
  waiting = waiting.filter((row) => {
    const doc = free.get(row.sheetKey);
    if (!doc || agreeing(doc, row) < SAME_ENQUIRY) return true;
    take(row, doc);
    return false;
  });

  // 3. Moved AND corrected: only when exactly one row and one saved row point at each other.
  const candidates = (row) => [...free.values()].filter((d) => !d.removedFromSheetAt && tabScope(d.sheetKey) === tabScope(row.sheetKey) && agreeing(d, row) >= SAME_ENQUIRY);
  const leftover = waiting.map((row) => ({ row, docs: candidates(row) }));
  waiting = leftover.filter(({ row, docs }) => {
    const unique = docs.length === 1 && leftover.filter((o) => o.docs.includes(docs[0])).length === 1;
    if (unique) take(row, docs[0]);
    return !unique;
  }).map((o) => o.row);

  // Anything left is new, on a key no saved row holds.
  const used = new Set(known.keys());
  waiting.forEach((row) => {
    const [stem, n] = row.sheetKey.split(/#(?=\d+$)/);
    for (let i = Number(n); used.has(row.sheetKey); i += 1) row.sheetKey = `${stem}#${i + 1}`;
    used.add(row.sheetKey);
  });
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

/** Saved rows that have left the sheet, except on a tab that could not be read this run. */
function markRemoved(rows, known, reports, now) {
  const seen = new Set(rows.map((r) => r.sheetKey));
  const unread = new Set(reports.filter((r) => r.unrecognised).map((r) => r.tab));
  return [...known.values()]
    .filter((d) => !seen.has(d.sheetKey) && !d.removedFromSheetAt && !unread.has(d.tab))
    .map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { removedFromSheetAt: now } } } }));
}

const isPrefix = (a, b) => a.every((c, i) => c === b[i]);

/*
  The sales columns after Meta's go by position, so a column inserted or moved
  shifts their meaning. A column added on the right (or an empty one dropped
  there) changes nothing, so only a real shift is reported.
*/
function nextLayouts(reports, previous, now) {
  const before = new Map((previous ?? []).map((l) => [l.tab, l]));
  const shifted = [];
  const layouts = reports.filter((r) => r.columns.length).map((r) => {
    const old = before.get(r.tab);
    const moved = old?.columns?.length && !isPrefix(old.columns, r.columns) && !isPrefix(r.columns, old.columns);
    if (moved) shifted.push(r.tab);
    return { tab: r.tab, columns: r.columns, changedAt: moved ? now : (old?.changedAt ?? null) };
  });
  return { layouts, shifted };
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
  const reports = parsed.map((p) => p.report);
  const existing = await metaLeadRepository.findAllForSync();
  keepTypedRowIdentity(rows, existing);
  const { ops, added, updated } = plan(rows, existing);
  const now = new Date();
  const removedOps = markRemoved(rows, existing, reports, now);
  const writes = [...ops, ...removedOps];

  if (apply) {
    for (let i = 0; i < writes.length; i += WRITE_BATCH) await metaLeadRepository.bulkWrite(writes.slice(i, i + WRITE_BATCH));
  }

  const totals = {
    rowsWithData: reports.reduce((n, r) => n + r.rowsWithData, 0),
    ready: rows.length,
    testLeads: reports.reduce((n, r) => n + r.testLeads, 0),
    repeatedMetaIds: reports.reduce((n, r) => n + r.repeatedMetaIds, 0),
    unrecognisedRows: reports.filter((r) => r.unrecognised).reduce((n, r) => n + r.rowsWithData, 0),
    added,
    updated,
    unchanged: rows.length - added - updated,
    removed: removedOps.length,
  };
  let shifted = [];
  if (apply) {
    const before = await metaLeadRepository.getState();
    const next = nextLayouts(reports, before?.layouts, now);
    shifted = next.shifted;
    await metaLeadRepository.saveState({
      lastAttemptAt: now, lastSuccessAt: now, lastError: '',
      tabs: await metaLeadRepository.tabCounts(),
      layouts: next.layouts,
      skippedTabs: reports.filter((r) => r.unrecognised).map((r) => r.tab),
      summary: totals,
    });
  }
  return { reports, totals, shifted };
}

/** The scheduled run: off until both settings exist; a failure is recorded and alerted, never thrown. */
export async function runScheduledMetaLeadSync() {
  if (!process.env.META_LEADS_SHEET_ID || !process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) return null;
  try {
    readServiceAccount();
    const { totals, shifted } = await syncMetaLeadsFromSheet();
    if (totals.added || totals.updated || totals.removed) console.log(`[MetaLeadSync] added ${totals.added}, updated ${totals.updated}, left the sheet ${totals.removed}`);
    if (totals.unrecognisedRows) Sentry.captureMessage(`[MetaLeadSync] ${totals.unrecognisedRows} rows on tabs with unrecognised columns were not imported`, 'warning');
    if (shifted.length) Sentry.captureMessage(`[MetaLeadSync] columns inserted or moved on ${shifted.length} tab(s); sales columns are read by position`, 'warning');
    return totals;
  } catch (err) {
    console.error('[MetaLeadSync] failed:', err.message);
    Sentry.captureException(err);
    await metaLeadRepository.saveState({ lastAttemptAt: new Date(), lastError: String(err.message).slice(0, 200) }).catch(() => {});
    return null;
  }
}
