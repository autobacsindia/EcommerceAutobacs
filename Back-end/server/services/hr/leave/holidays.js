/**
 * Company holidays (models/hr/HrHoliday.js). `sites` empty = every site.
 * `optional` holidays are restricted holidays an employee may pick — they are
 * NOT days off for everyone, so they never count as holidays in leave maths.
 */
import mongoose from 'mongoose';
import holidayRepository from '../../../repositories/hr/holidayRepository.js';
import { encodeCursor, decodeCursor, afterClause, sortSpec } from '../../../utils/listQuery.js';
import { recordHrAudit, diffFields } from '../audit.js';
import { isValidDate, yearOf } from './calendar.js';
import {
  fail, isDup, isId, inTransaction,
} from './common.js';

const SORT = Object.freeze({ field: 'date', dir: 1, type: 'string' });
const MAX_SITES = 50;
const HOLIDAY_PAGE_MAX = 100;

export const shapeHoliday = (h) => ({
  id: String(h._id), date: h.date, year: h.year, name: h.name, sites: (h.sites || []).map(String), optional: !!h.optional,
});

/** A year's holidays, by date (keyset; a year rarely has more than ~25). */
export async function listHolidays({ year, cursor, limit } = {}) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) throw fail('year is required (e.g. 2026)', 400);
  const lim = Math.min(Math.max(Number(limit) || HOLIDAY_PAGE_MAX, 1), HOLIDAY_PAGE_MAX);
  const ac = afterClause(SORT, cursor ? decodeCursor('date', SORT, cursor) : null);
  const base = { year: y };
  const rows = await holidayRepository.page(ac ? { $and: [base, ac] } : base, { sort: sortSpec(SORT), limit: lim + 1 });
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  return { items: page.map(shapeHoliday), nextCursor: hasMore ? encodeCursor('date', SORT, page[page.length - 1]) : null };
}

export async function createHoliday(actor, input = {}, req = null) {
  const date = String(input.date || '');
  if (!isValidDate(date)) throw fail('date must be a real day, YYYY-MM-DD', 400);
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw fail('Give the holiday a name', 400);
  const sites = input.sites === undefined ? [] : input.sites;
  if (!Array.isArray(sites) || sites.length > MAX_SITES || !sites.every(isId)) throw fail('sites must be a list of site ids', 400);
  if (input.optional !== undefined && typeof input.optional !== 'boolean') throw fail('optional must be true or false', 400);
  const doc = {
    date, year: yearOf(date), name, sites: [...new Set(sites.map(String))].map((s) => new mongoose.Types.ObjectId(s)), optional: input.optional === true, createdBy: actor._id,
  };
  try {
    return shapeHoliday(await inTransaction(async (session) => {
      const row = await holidayRepository.create(doc, session);
      await recordHrAudit({
        action: 'holiday.created', entity: 'HrHoliday', entityId: row._id, actor, req, session,
        changes: diffFields({}, { date, name, sites: doc.sites.map(String), optional: doc.optional }),
      });
      return row;
    }));
  } catch (err) {
    if (isDup(err)) throw fail(`${name} on ${date} is already a holiday`, 409);
    throw err;
  }
}

export async function deleteHoliday(actor, id, req = null) {
  if (!isId(id)) throw fail('Holiday not found', 404);
  return inTransaction(async (session) => {
    const row = await holidayRepository.deleteById(id, session);
    if (!row) throw fail('Holiday not found', 404);
    await recordHrAudit({
      action: 'holiday.deleted', entity: 'HrHoliday', entityId: row._id, actor, req, session,
      changes: [{ field: 'holiday', from: `${row.date} ${row.name}`, to: null }],
    });
    return shapeHoliday(row);
  });
}

const appliesTo = (h, siteIds) => !h.sites?.length || h.sites.some((s) => siteIds.has(String(s)));

/**
 * Set of holiday dates in [from, to] that apply to someone working at `siteIds`
 * (an employee with no sites gets only the company-wide holidays).
 */
export async function holidayDatesInRange(from, to, siteIds = []) {
  const sites = new Set((siteIds || []).map(String));
  const rows = await holidayRepository.inRange(from, to);
  return new Set(rows.filter((h) => appliesTo(h, sites)).map((h) => h.date));
}

/** Is `date` a (non-optional) holiday for someone at `siteIds`? Exported for attendance/payroll. */
export async function isHoliday(date, siteIds = []) {
  if (!isValidDate(date)) return false;
  return (await holidayDatesInRange(date, date, siteIds)).has(date);
}
