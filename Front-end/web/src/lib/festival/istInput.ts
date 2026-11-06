import { formatIsoDateTimeIST } from '@/lib/datetime';

/**
 * `<input type="datetime-local">` speaks naive wall-clock time. The festival
 * window is entered in IST whatever timezone the admin's laptop is in, so the
 * conversion pins +05:30 explicitly instead of trusting the browser's zone.
 */
export function istInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value.length === 16 ? `${value}:00` : value}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:mm" in IST, for the input's value. */
export function isoToIstInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = formatIsoDateTimeIST(iso, '');
  return s ? s.replace(' ', 'T') : '';
}
