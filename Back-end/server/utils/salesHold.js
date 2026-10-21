/**
 * "On hold — customer thinking" for a GTM quotation or an unpaid sales order.
 *
 * A hold is a note on the record, never a state change: the quotation stays
 * `open`, the order stays `awaiting_payment`, prices and payment links are
 * untouched (a customer who decides early can still pay). It only moves the
 * record out of the seller's active list and out of "waiting" counts until the
 * follow-up date — after that it is back in the active list, marked due, until
 * someone resumes it.
 *
 * Stored as { since, until, note, by, byName }; absent when not on hold.
 */
import AppError from './AppError.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const DAY = 24 * 60 * 60 * 1000;
export const HOLD_MAX_DAYS = 60;
export const HOLD_DEFAULT_DAYS = 3;

/**
 * 'YYYY-MM-DD' (or empty for the default) → the follow-up moment: the start of
 * that day in India (UTC+05:30). Today is allowed ("call back later today");
 * the past and more than HOLD_MAX_DAYS ahead are not.
 */
export function cleanFollowUp(raw, now = Date.now()) {
  const istToday = new Date(now + 5.5 * 60 * 60 * 1000);
  const todayUtc = Date.UTC(istToday.getUTCFullYear(), istToday.getUTCMonth(), istToday.getUTCDate());
  let dayUtc;
  if (raw == null || raw === '') {
    dayUtc = todayUtc + HOLD_DEFAULT_DAYS * DAY;
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw));
    const d = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
    if (!m || Number.isNaN(d) || new Date(d).getUTCDate() !== Number(m[3])) throw fail('Choose a follow-up date.', 400);
    if (d < todayUtc) throw fail('The follow-up date cannot be in the past.', 400);
    if (d > todayUtc + HOLD_MAX_DAYS * DAY) throw fail(`Choose a follow-up date within ${HOLD_MAX_DAYS} days.`, 400);
    dayUtc = d;
  }
  // Midnight IST of that day, as an instant.
  return new Date(dayUtc - 5.5 * 60 * 60 * 1000);
}

export function buildHold(actor, input = {}, now = Date.now()) {
  return {
    since: new Date(now),
    until: cleanFollowUp(input.until, now),
    note: String(input.note ?? '').trim().slice(0, 300),
    by: actor._id,
    byName: actor.name || '',
  };
}

/** API shape; null when not on hold. `due` = the follow-up date has arrived. */
export function shapeHold(hold, now = Date.now()) {
  if (!hold || !hold.until) return null;
  return {
    since: hold.since || null,
    until: hold.until,
    note: hold.note || '',
    by: hold.byName || '',
    due: new Date(hold.until).getTime() <= now,
  };
}

/**
 * Query fragments on the hold field `path`. "Held" = on hold and not yet due;
 * everything else (never held, or due) counts as active.
 */
export const heldFilter = (path, now = new Date()) => ({ [`${path}.until`]: { $gt: now } });
export const notHeldFilter = (path, now = new Date()) => ({
  $or: [{ [path]: null }, { [`${path}.until`]: { $lte: now } }],
});
