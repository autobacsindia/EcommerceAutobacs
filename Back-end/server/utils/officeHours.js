/**
 * Office hours in India time, for follow-up deadlines. Pure: every function
 * takes the hours, so tests pin them and nothing reads a clock it was not given.
 */
import { META_LEAD_OFFICE } from '../config/leadConstants.js';

const IST_MS = 5.5 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;

/** India wall-clock parts of a moment. */
function istParts(date) {
  const shifted = new Date(date.getTime() + IST_MS);
  return { day: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), midnight: date.getTime() - ((date.getTime() + IST_MS) % DAY_MS) };
}

export function isOfficeTime(date, office = META_LEAD_OFFICE) {
  const { day, minutes } = istParts(date);
  return office.days.includes(day) && minutes >= office.startHour * 60 && minutes < office.endHour * 60;
}

/** The moment itself when it is in office hours, else the next opening (10 am of the next working day). */
export function snapToOffice(date, office = META_LEAD_OFFICE) {
  if (isOfficeTime(date, office)) return new Date(date);
  let { day, minutes, midnight } = istParts(date);
  // Before opening on a working day: that day's opening. Otherwise the next day's.
  if (!(office.days.includes(day) && minutes < office.startHour * 60)) { midnight += DAY_MS; day = (day + 1) % 7; }
  for (let i = 0; i < 7 && !office.days.includes(day); i += 1) { midnight += DAY_MS; day = (day + 1) % 7; }
  return new Date(midnight + office.startHour * 60 * MIN_MS);
}

/** `minutes` of office time after `date` (nights and days off do not count). */
export function addOfficeMinutes(date, minutes, office = META_LEAD_OFFICE) {
  let at = snapToOffice(date, office);
  let left = minutes;
  for (let guard = 0; guard < 400; guard += 1) {
    const { minutes: now, midnight } = istParts(at);
    const room = office.endHour * 60 - now;
    if (left < room) return new Date(at.getTime() + left * MIN_MS);
    left -= room;
    at = snapToOffice(new Date(midnight + office.endHour * 60 * MIN_MS), office);
  }
  return at;
}

/** "12-11-2026 16:00" in India time: the shape the sheet reader (parseSheetDate) reads back. */
export function sheetDateTime(date) {
  if (!date) return '';
  const iso = new Date(new Date(date).getTime() + IST_MS).toISOString();
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}
