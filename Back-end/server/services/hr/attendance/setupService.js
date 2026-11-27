/**
 * Work sites and shifts (HR/admin). CAS on `rev`, every change audit-logged.
 * Both are deactivated, never deleted — punches and days reference them.
 */
import mongoose from 'mongoose';
import attendanceSetupRepository from '../../../repositories/hr/attendanceSetupRepository.js';
import { HHMM_RE, SITE_RADIUS_MIN_M, SITE_RADIUS_MAX_M } from '../../../config/hr.js';
import {
  encodeCursor, decodeCursor, afterClause, sortSpec,
} from '../../../utils/listQuery.js';
import { recordHrAudit, diffFields } from '../audit.js';
import { fail } from './errors.js';
import { withTx, isDuplicateKey } from './tx.js';

const PAGE_MAX = 50;
const NAME_SORT = Object.freeze({ field: 'name', dir: 1, type: 'string' });

const validationFail = (err) => {
  if (err?.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    return fail(first?.message || 'Some values are not valid', 400);
  }
  return err;
};

async function pageOf(listFn, filter, { cursor, limit }, shape) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), PAGE_MAX);
  const ac = afterClause(NAME_SORT, cursor ? decodeCursor('name', NAME_SORT, cursor) : null);
  const rows = await listFn(ac ? { $and: [filter, ac] } : filter, { sort: sortSpec(NAME_SORT), limit: lim + 1 });
  const hasMore = rows.length > lim;
  const items = hasMore ? rows.slice(0, lim) : rows;
  return { items: items.map(shape), nextCursor: hasMore ? encodeCursor('name', NAME_SORT, items[items.length - 1]) : null };
}

const activeFilter = (active) => (active === 'all' ? {} : { active: active !== 'false' });
const needRev = (rev) => {
  if (rev === undefined || rev === null || !Number.isInteger(Number(rev))) throw fail('rev is required', 400);
  return Number(rev);
};
const idOrFail = (id, what) => {
  if (!mongoose.isValidObjectId(id)) throw fail(`${what} not found`, 404);
  return id;
};

// ── Sites ────────────────────────────────────────────────────────────────────
export const shapeSite = (s) => ({
  id: String(s._id), name: s.name, address: s.address || '', lat: s.lat, lng: s.lng, radiusM: s.radiusM, active: !!s.active, rev: s.rev || 0,
});

function siteSet(input, { creating }) {
  const set = {};
  if (input.name !== undefined || creating) {
    const name = String(input.name ?? '').trim().slice(0, 80);
    if (!name) throw fail('Site name is required', 400);
    set.name = name;
  }
  if (input.address !== undefined) set.address = String(input.address ?? '').slice(0, 400);
  for (const k of ['lat', 'lng']) {
    if (input[k] !== undefined || creating) {
      const v = Number(input[k]);
      if (!Number.isFinite(v) || (k === 'lat' ? Math.abs(v) > 90 : Math.abs(v) > 180)) throw fail('Pick the site on the map (latitude/longitude)', 400);
      set[k] = v;
    }
  }
  if (input.radiusM !== undefined || creating) {
    const r = Number(input.radiusM);
    if (!Number.isFinite(r) || r < SITE_RADIUS_MIN_M || r > SITE_RADIUS_MAX_M) {
      throw fail(`Radius must be ${SITE_RADIUS_MIN_M}–${SITE_RADIUS_MAX_M} metres`, 400);
    }
    set.radiusM = Math.round(r);
  }
  if (input.active !== undefined) set.active = input.active === true;
  return set;
}

export const listSites = ({ active, cursor, limit } = {}) => pageOf(attendanceSetupRepository.listSites, activeFilter(active), { cursor, limit }, shapeSite);

export async function createSite(actor, input = {}, req = null) {
  const set = siteSet(input, { creating: true });
  const row = await attendanceSetupRepository.createSite({ ...set, createdBy: actor._id }).catch((e) => { throw validationFail(e); });
  await recordHrAudit({
    action: 'site.created', entity: 'HrWorkSite', entityId: row._id, actor, req, changes: diffFields({}, set),
  });
  return shapeSite(row);
}

export async function updateSite(actor, id, input = {}, req = null) {
  idOrFail(id, 'Site');
  const rev = needRev(input.rev);
  const set = siteSet(input, { creating: false });
  if (!Object.keys(set).length) throw fail('Nothing to change', 400);
  const before = await attendanceSetupRepository.findSiteById(id);
  if (!before) throw fail('Site not found', 404);
  const row = await attendanceSetupRepository.updateSiteIfRev(id, rev, set).catch((e) => { throw validationFail(e); });
  if (!row) throw fail('This site was changed by someone else. Reload and try again.', 409);
  await recordHrAudit({
    action: 'site.updated', entity: 'HrWorkSite', entityId: row._id, actor, req, reason: input.reason || '', changes: diffFields(before, set),
  });
  return shapeSite(row);
}

// ── Shifts ───────────────────────────────────────────────────────────────────
export const shapeShift = (s) => ({
  id: String(s._id),
  name: s.name,
  start: s.start,
  end: s.end,
  graceMinutes: s.graceMinutes,
  earlyGraceMinutes: s.earlyGraceMinutes ?? 10,
  absentBelowMinutes: s.absentBelowMinutes ?? 120,
  latesPerHalfDayLop: s.latesPerHalfDayLop,
  halfDayMinMinutes: s.halfDayMinMinutes,
  fullDayMinutes: s.fullDayMinutes,
  overtimeAfterMinutes: s.overtimeAfterMinutes,
  breakAllowanceMinutes: s.breakAllowanceMinutes,
  weeklyOff: s.weeklyOff || [],
  isDefault: !!s.isDefault,
  active: !!s.active,
  rev: s.rev || 0,
});

const SHIFT_NUMBERS = ['graceMinutes', 'earlyGraceMinutes', 'absentBelowMinutes', 'latesPerHalfDayLop', 'halfDayMinMinutes', 'fullDayMinutes', 'overtimeAfterMinutes', 'breakAllowanceMinutes'];

function shiftSet(input, { creating }) {
  const set = {};
  if (input.name !== undefined || creating) {
    const name = String(input.name ?? '').trim().slice(0, 60);
    if (!name) throw fail('Shift name is required', 400);
    set.name = name;
  }
  for (const k of ['start', 'end']) {
    if (input[k] !== undefined || creating) {
      if (!HHMM_RE.test(String(input[k] ?? ''))) throw fail(`${k === 'start' ? 'Start' : 'End'} time must look like 10:00`, 400);
      set[k] = String(input[k]);
    }
  }
  for (const k of SHIFT_NUMBERS) {
    if (input[k] !== undefined) {
      const v = Number(input[k]);
      if (!Number.isInteger(v) || v < 0) throw fail(`${k} must be a whole number`, 400);
      set[k] = v;
    }
  }
  if (input.weeklyOff !== undefined) {
    if (!Array.isArray(input.weeklyOff) || input.weeklyOff.length > 7
      || input.weeklyOff.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw fail('Weekly off must be days 0 (Sunday) to 6 (Saturday)', 400);
    }
    set.weeklyOff = [...new Set(input.weeklyOff)].sort();
  }
  if (input.isDefault !== undefined) set.isDefault = input.isDefault === true;
  if (input.active !== undefined) set.active = input.active === true;
  return set;
}

export const listShifts = ({ active, cursor, limit } = {}) => pageOf(attendanceSetupRepository.listShifts, activeFilter(active), { cursor, limit }, shapeShift);

/** Making a shift the default un-defaults the previous one in the same transaction. */
export async function createShift(actor, input = {}, req = null) {
  const set = shiftSet(input, { creating: true });
  await attendanceSetupRepository.validateShift({ ...set, createdBy: actor._id }).catch((e) => { throw validationFail(e); });
  try {
    return await withTx(async (session) => {
      if (set.isDefault) await attendanceSetupRepository.clearDefaultExcept(null, session);
      const row = await attendanceSetupRepository.createShift({ ...set, createdBy: actor._id }, session);
      await recordHrAudit({
        action: 'shift.created', entity: 'HrShift', entityId: row._id, actor, req, session, changes: diffFields({}, set),
      });
      return shapeShift(row);
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw fail('Another shift became the default at the same moment. Try again.', 409);
    throw validationFail(err);
  }
}

export async function updateShift(actor, id, input = {}, req = null) {
  idOrFail(id, 'Shift');
  const rev = needRev(input.rev);
  const set = shiftSet(input, { creating: false });
  if (!Object.keys(set).length) throw fail('Nothing to change', 400);
  const before = await attendanceSetupRepository.findShiftById(id);
  if (!before) throw fail('Shift not found', 404);
  await attendanceSetupRepository.validateShift({ ...before, ...set }).catch((e) => { throw validationFail(e); });
  try {
    return await withTx(async (session) => {
      if (set.isDefault) await attendanceSetupRepository.clearDefaultExcept(id, session);
      const row = await attendanceSetupRepository.updateShiftIfRev(id, rev, set, session);
      if (!row) throw fail('This shift was changed by someone else. Reload and try again.', 409);
      await recordHrAudit({
        action: 'shift.updated', entity: 'HrShift', entityId: row._id, actor, req, session, reason: input.reason || '', changes: diffFields(before, set),
      });
      return shapeShift(row);
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw fail('Another shift became the default at the same moment. Try again.', 409);
    throw validationFail(err);
  }
}
