/**
 * Office time in India for follow-up deadlines: working days, opening and closing
 * minute, and holidays (IST 'YYYY-MM-DD'). Pure — every function takes the office
 * object (config/followUp.js `office`) and never reads a clock it was not given.
 *
 * utils/officeHours.js does the same for Meta leads but has no holidays and whole
 * hours only; this one adds both rather than changing a shared helper.
 */
const IST_MS = 330 * 60 * 1000;
const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const GUARD_DAYS = 400;

const ms = (d) => (d instanceof Date ? d.getTime() : Number(d));
/** The UTC instant of the IST midnight that starts the day holding `t`. */
const istMidnight = (t) => t - ((t + IST_MS) % DAY_MS);
/** 'YYYY-MM-DD' (IST) of the day starting at `midnight`. */
export const istDayKey = (midnight) => new Date(midnight + IST_MS).toISOString().slice(0, 10);
const weekday = (midnight) => new Date(midnight + IST_MS).getUTCDay();

export function isWorkday(midnight, office) {
  return office.days.includes(weekday(midnight)) && !office.holidays?.has(istDayKey(midnight));
}

export function isOfficeTime(date, office) {
  const t = ms(date);
  const mid = istMidnight(t);
  const minute = (t - mid) / MIN_MS;
  return isWorkday(mid, office) && minute >= office.startMinute && minute < office.endMinute;
}

/** The moment itself when it is office time, else the next opening. */
export function snapToOffice(date, office) {
  const t = ms(date);
  if (isOfficeTime(t, office)) return new Date(t);
  let mid = istMidnight(t);
  // Before opening on a working day → that day's opening; otherwise a later day's.
  if (!(isWorkday(mid, office) && t - mid < office.startMinute * MIN_MS)) mid += DAY_MS;
  for (let i = 0; i < GUARD_DAYS && !isWorkday(mid, office); i += 1) mid += DAY_MS;
  return new Date(mid + office.startMinute * MIN_MS);
}

/** `minutes` of office time after `date` (nights, days off and holidays do not count). */
export function addOfficeMinutes(date, minutes, office) {
  let at = snapToOffice(date, office).getTime();
  let left = Math.max(0, minutes);
  for (let i = 0; i < GUARD_DAYS; i += 1) {
    const close = istMidnight(at) + office.endMinute * MIN_MS;
    const room = (close - at) / MIN_MS;
    if (left < room) return new Date(at + left * MIN_MS);
    left -= room;
    at = snapToOffice(close, office).getTime();
  }
  return new Date(at);
}

/** Office minutes between two moments (0 when `to` is not after `from`). */
export function officeMinutesBetween(from, to, office) {
  const end = ms(to);
  let at = snapToOffice(from, office).getTime();
  let total = 0;
  for (let i = 0; i < GUARD_DAYS && at < end; i += 1) {
    const close = istMidnight(at) + office.endMinute * MIN_MS;
    total += (Math.min(close, end) - at) / MIN_MS;
    at = snapToOffice(close, office).getTime();
  }
  return Math.max(0, Math.round(total));
}
