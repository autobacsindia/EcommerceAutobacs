/**
 * IST day boundaries for `<input type="date">` values.
 *
 * The mirror of the backend's `utils/datetime.js` helpers, and it exists for the same
 * reason: `new Date('2026-09-05')` is parsed as UTC midnight, which is 05:30 IST. An
 * admin typing "ends 5 Sep" would close a campaign at half five that morning and lose
 * the whole of the last trading day. The display direction is just as wrong — an IST
 * midnight start (18:30Z the previous day) formatted via `toISOString()` shows as the
 * day before, so a 15 Aug start reads back as 14 Aug.
 *
 * IST is UTC+05:30 year-round with no daylight saving, so the offset is stated literally.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const IST_OFFSET = '+05:30';

/** `YYYY-MM-DD` → ISO instant at 00:00:00.000 IST that day. */
export function istStartOfDayISO(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T00:00:00.000${IST_OFFSET}`).toISOString();
}

/** `YYYY-MM-DD` → ISO instant at 23:59:59.999 IST that day — the day's last moment. */
export function istEndOfDayISO(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T23:59:59.999${IST_OFFSET}`).toISOString();
}

/**
 * ISO instant → the `YYYY-MM-DD` an operator in India would call that moment.
 * Shifts into IST before slicing, so a stored 2026-08-14T18:30:00Z reads back as
 * 2026-08-15 — the date that was actually entered.
 */
export function toISTDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}
