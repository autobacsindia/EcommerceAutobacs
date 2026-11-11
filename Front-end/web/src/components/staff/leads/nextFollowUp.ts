/**
 * "Next follow-up by" choices, in India time whatever the device's clock zone.
 * The server moves any time outside office hours (10 am – 7 pm, Mon – Sat) to the
 * next opening, so these only need to be sensible, not exact.
 */
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight India time of the day `now` falls on, as a real moment. */
const istMidnight = (now: Date) => now.getTime() - ((now.getTime() + IST_MS) % DAY_MS);
const istHour = (now: Date) => ((now.getTime() + IST_MS) % DAY_MS) / 3_600_000;

/** `days` from today, at hour:minute India time. */
export const istAt = (now: Date, days: number, hour: number, minute = 0) => new Date(istMidnight(now) + days * DAY_MS + (hour * 60 + minute) * 60_000);

export type NextChoice = { key: string; label: string; at: Date };

export function nextChoices(now: Date = new Date()): NextChoice[] {
  const out: NextChoice[] = [{ key: 'hour', label: 'In 1 hour', at: new Date(now.getTime() + 60 * 60_000) }];
  if (istHour(now) < 17) out.push({ key: 'evening', label: 'This evening (6 pm)', at: istAt(now, 0, 18) });
  out.push({ key: 'tomorrow', label: 'Tomorrow 11 am', at: istAt(now, 1, 11) });
  out.push({ key: 'three', label: 'In 3 days', at: istAt(now, 3, 11) });
  return out;
}

/** A Date → the value of an <input type="datetime-local"> showing India time. */
export const toIstInput = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 16);

/** An <input type="datetime-local"> value read as India time → ISO, or '' when empty/invalid. */
export function fromIstInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
