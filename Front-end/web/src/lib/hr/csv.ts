/**
 * CSV for HR reports. Values are what the server sent; nothing is worked out here.
 * Cells are quoted, and a cell starting with = + - @ gets a leading ' so a
 * spreadsheet never runs it as a formula (CSV injection).
 */
export type CsvCell = string | number | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== String(v) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (header: string[], rows: CsvCell[][]): string =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

/** Starts a browser download of `csv` as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens the ₹ / ½ characters as UTF-8.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
