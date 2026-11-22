/**
 * Leave + holiday facts for attendance, read through the LEAVE module's exported
 * functions (services/hr/leave/index.js — docs/ADR-hr-system.md §4), never its
 * repositories.
 *
 * The leave module is built in parallel; until it is merged, the import fails
 * with ERR_MODULE_NOT_FOUND and attendance treats every day as "no leave, no
 * holiday" — which is exactly what the company has before leave exists. Any
 * OTHER failure is thrown: a recompute that silently ignored approved leave
 * would mark someone absent.
 */
let leaveModulePromise = null;

async function leaveModule() {
  if (!leaveModulePromise) {
    leaveModulePromise = import('../leave/index.js').catch((err) => {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') return null;
      leaveModulePromise = null;
      throw err;
    });
  }
  return leaveModulePromise;
}

/**
 * { leaveByDate: Map(date → { halves: 1|2, paid }), holidays: Set(date) } for [from, to].
 */
export async function calendarFacts(employeeId, from, to, siteIds = []) {
  const mod = await leaveModule();
  const leaveByDate = new Map();
  let holidays = new Set();
  if (!mod) return { leaveByDate, holidays };
  const [leave, hol] = await Promise.all([
    typeof mod.leaveDaysInRange === 'function' ? mod.leaveDaysInRange(employeeId, from, to) : [],
    typeof mod.holidayDatesInRange === 'function' ? mod.holidayDatesInRange(from, to, siteIds) : new Set(),
  ]);
  for (const d of leave || []) {
    const prev = leaveByDate.get(d.date);
    const halves = Math.min(2, (prev?.halves || 0) + (Number(d.halves) || 0));
    leaveByDate.set(d.date, { halves, paid: (prev ? prev.paid : true) && d.paid !== false });
  }
  holidays = hol instanceof Set ? hol : new Set(hol || []);
  return { leaveByDate, holidays };
}

/** Tests only: forget the cached module (so a test can mock it). */
export const _resetCalendarModule = () => { leaveModulePromise = null; };
