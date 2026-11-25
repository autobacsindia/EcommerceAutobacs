/**
 * After-hours auto-reply timing ("Nothing Extra" campaign, 2026-11-23).
 *
 * NOT a second definition of support hours: it reads the published ones
 * (config/supportPolicy.js BUSINESS_HOURS — Mon–Sat 10 am–6 pm IST) and the
 * SUPPORT_HOLIDAYS closures, through the same utils/businessHours.js the ticket
 * SLA clock uses. Change the hours there and both move together.
 *
 * Pure apart from the default `holidays` (read from env once, like the SLA code):
 * every function takes `now`, so tests never depend on the clock.
 */
import { BUSINESS_HOURS, SUPPORT_HOLIDAYS } from './supportPolicy.js';
import { isWithinBusinessHours, addBusinessMinutes } from '../utils/businessHours.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const clock = (h) => (h === 12 ? '12 noon' : h < 12 ? `${h} am` : `${h - 12} pm`);

/** Shown to customers. No weekday names: automated mail never names a day. */
export const SUPPORT_HOURS_TEXT =
  `${clock(BUSINESS_HOURS.startHour)} to ${clock(BUSINESS_HOURS.endHour)} India time, ` +
  `${BUSINESS_HOURS.workingDays.length === 6 ? 'six days a week' : `${BUSINESS_HOURS.workingDays.length} days a week`}`;

/** True while the support team is working (holidays count as closed). */
export const isWithinSupportHours = (now = new Date(), holidays = SUPPORT_HOLIDAYS) =>
  isWithinBusinessHours(now, holidays);

/**
 * The India day ('YYYY-MM-DD') support next opens, seen from `now`; today while
 * open. Every moment of one closed stretch — Saturday 7 pm, Sunday noon, Monday
 * 8 am, a holiday — gives the same day, so it names "this night" for the
 * once-only key.
 */
export function nextOpeningDay(now = new Date(), holidays = SUPPORT_HOLIDAYS) {
  const opening = addBusinessMinutes(now, 0, holidays); // snaps to the next opening
  return new Date(opening.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Once-only key for "the after-hours note for this closed stretch". */
export const afterHoursKey = (now = new Date(), holidays = SUPPORT_HOLIDAYS) =>
  `after-hours:${nextOpeningDay(now, holidays)}`;

export default { SUPPORT_HOURS_TEXT, isWithinSupportHours, nextOpeningDay, afterHoursKey };
