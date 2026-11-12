/**
 * The panel's block of columns on every lead tab, kept tidy (owner's call,
 * 2026-11-12, "Yes, build it"):
 *
 *   every tab           every recognised lead tab has all the panel columns,
 *                       whether or not a lead on it has been touched yet
 *   one order           PANEL_COLUMNS order, the same on every tab, lead id last
 *   no gaps             the block starts right after the team's last used column
 *   team untouched      the team's columns keep their order and their cells; a
 *                       panel column sitting among them is moved out to the
 *                       right, never a team column moved in. Nothing is deleted.
 *   once only           heading style, column widths, the frozen heading row and
 *                       a warning-only protection are set once per tab (the
 *                       first time it is laid out); a tab already tidy costs
 *                       no write at all.
 *
 * Pure: planPanelLayout reads the tabs and returns Google batchUpdate requests.
 */
import { PANEL_COLUMNS, parseTab, tabLayout } from '../utils/metaLeadSheet.js';

export const LAYOUT_VERSION = 1;
export const PANEL_PROTECTION = 'Filled automatically by the Roavion panel. Type in the columns to the left.';

const PANEL_ORDER = Object.keys(PANEL_COLUMNS);
const WIDTHS = { followingUp: 140, status: 140, nextBy: 150, note: 260, lateReason: 220, updatedAt: 140, leadId: 90 };
const rgb = (r, g, b) => ({ red: r / 255, green: g / 255, blue: b / 255 });
const BAND = rgb(31, 56, 100);
const WHITE = rgb(255, 255, 255);
const GREY = rgb(128, 128, 128);

const filled = (v) => String(v ?? '').trim() !== '';

/**
 * One tab's moves. `cols` is the simulated column list: a panel name, or null for
 * a team / empty column. Pure.
 * @returns {{ requests: object[], start: number }} start = first panel column after the moves
 */
function arrange(tab, layout) {
  const { headerRow, labels } = layout;
  const width = labels.length;
  const cols = labels.map((l, i) => (l.panel ? (Object.keys(layout.panel).find((n) => layout.panel[n] === i) ?? '?panel') : null));
  // Team's last used column: any non-panel cell with something in it, header included.
  let teamEnd = 0;
  for (let i = 0; i < width; i += 1) {
    if (cols[i] === null && tab.values.some((r) => filled(r?.[i]))) teamEnd = i + 1;
  }

  const requests = [];
  const sheetId = tab.gid;
  const dims = (from) => ({ sheetId, dimension: 'COLUMNS', startIndex: from, endIndex: from + 1 });

  // Missing headings: written into the empty columns past everything on the tab.
  const missing = PANEL_ORDER.filter((n) => layout.panel[n] == null);
  if (missing.length) {
    const need = width + missing.length;
    if (tab.columnCount && need > tab.columnCount) {
      requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: need - tab.columnCount } });
    }
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: headerRow - 1, columnIndex: width },
        rows: [{ values: missing.map((n) => ({ userEnteredValue: { stringValue: PANEL_COLUMNS[n] } })) }],
        fields: 'userEnteredValue',
      },
    });
    cols.push(...missing);
  }

  // Pass 1: a panel column among the team's (left of their last used one) goes to the end.
  const start = teamEnd - cols.slice(0, teamEnd).filter((c) => c !== null).length;
  for (let i = teamEnd - 1; i >= 0; i -= 1) {
    if (cols[i] !== null) {
      requests.push({ moveDimension: { source: dims(i), destinationIndex: cols.length } });
      cols.push(cols.splice(i, 1)[0]);
    }
  }
  // Now everything left of `start` is the team's. Pass 2: each panel column into its place.
  PANEL_ORDER.forEach((name, k) => {
    const p = start + k;
    const s = cols.indexOf(name);
    if (s === p) return;
    // Google counts destinationIndex before the source is removed; s > p here, always.
    requests.push({ moveDimension: { source: dims(s), destinationIndex: p } });
    cols.splice(p, 0, cols.splice(s, 1)[0]);
  });
  return { requests, start };
}

/** Heading band, widths, grey lead id, frozen heading row, protection: first time only. */
function dress(tab, layout, start) {
  const sheetId = tab.gid;
  const end = start + PANEL_ORDER.length;
  const out = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: layout.headerRow - 1, endRowIndex: layout.headerRow, startColumnIndex: start, endColumnIndex: end },
        cell: { userEnteredFormat: { backgroundColor: BAND, textFormat: { bold: true, foregroundColor: WHITE } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: layout.headerRow, startColumnIndex: end - 1, endColumnIndex: end },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: GREY, fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat(foregroundColor,fontSize)',
      },
    },
    ...PANEL_ORDER.map((name, k) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: start + k, endIndex: start + k + 1 },
        properties: { pixelSize: WIDTHS[name] },
        fields: 'pixelSize',
      },
    })),
  ];
  // Only ever freeze more, never unfreeze what the team chose.
  if ((tab.frozenRows ?? 0) < layout.headerRow) {
    out.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: layout.headerRow } }, fields: 'gridProperties.frozenRowCount' } });
  }
  if (!(tab.protections ?? []).some((p) => p.description === PANEL_PROTECTION)) {
    out.push({
      addProtectedRange: {
        protectedRange: { range: { sheetId, startColumnIndex: start, endColumnIndex: end }, description: PANEL_PROTECTION, warningOnly: true },
      },
    });
  }
  return out;
}

/**
 * Every request that makes every lead tab tidy. Pure.
 * @param tabs   readAllTabs output
 * @param done   gids already dressed (writeBack.layout.gids)
 * @returns {{ requests: object[], dressed: (number|string)[], tabs: string[] }}
 */
export function planPanelLayout(tabs, done = []) {
  const already = new Set(done.map(String));
  const requests = [];
  const dressed = [];
  const touched = [];
  tabs.forEach((tab) => {
    if (parseTab(tab, new Set()).report.unrecognised) return;
    const layout = tabLayout(tab.values);
    if (!layout) return;
    const { requests: moves, start } = arrange(tab, layout);
    const first = !already.has(String(tab.gid));
    const extra = first ? dress(tab, layout, start) : [];
    if (moves.length || extra.length) touched.push(tab.name);
    requests.push(...moves, ...extra);
    if (first) dressed.push(tab.gid);
  });
  return { requests, dressed, tabs: touched };
}
