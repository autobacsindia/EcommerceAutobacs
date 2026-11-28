/**
 * Auto-close: a day someone forgot to clock out of is closed at the SHIFT END
 * (not at the moment the job runs), marked `autoClosed`, and never counts as
 * overtime (dayRules). The day keeps `needsReview` off only because it is now
 * closed; HR can still correct it.
 *
 * Runs from the cron (cronJobs.js) every 15 minutes; acts only once the IST
 * time has reached HrSettings.autoCloseTime for today's sessions, and always for
 * yesterday's (a missed run, an overnight shift). Idempotent: the out punch has
 * the fixed clientPunchId `auto-<date>`, unique per employee.
 */
import mongoose from 'mongoose';
import attendancePunchRepository from '../../../repositories/hr/attendancePunchRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { getHrSettings } from '../settings.js';
import { shiftFor } from './dayService.js';
import { storePunch } from './punchService.js';
import {
  istDate, addDays, shiftWindow, IST_OFFSET_MS, MINUTE_MS,
} from './time.js';

const istHHMM = (now) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);

export async function autoCloseOpenDays(now = new Date()) {
  const settings = await getHrSettings();
  const today = istDate(now);
  const dates = [addDays(today, -1)];
  if (istHHMM(now) >= settings.autoCloseTime) dates.push(today);

  let closed = 0;
  let skipped = 0;
  let failed = 0;
  for (const date of dates) {
    const open = await attendancePunchRepository.openSessionsOn(date);
    for (const o of open) {
      try {
        const employee = await employeeRepository.findById(o._id);
        if (!employee) { skipped += 1; continue; }
        const shift = await shiftFor(employee);
        const { end } = shiftWindow(date, shift);
        if (end > now) { skipped += 1; continue; } // overnight shift still running
        const at = new Date(Math.max(end.getTime(), new Date(o.lastAt).getTime() + MINUTE_MS));
        const r = await storePunch(employee, {
          _id: new mongoose.Types.ObjectId(),
          employee: employee._id,
          user: employee.user || null,
          clientPunchId: `auto-${date}`,
          type: 'out',
          at: at > now ? now : at,
          receivedAt: now,
          date,
          source: 'auto_close',
          status: 'accepted',
          reviewNote: 'Closed automatically at the shift end (no clock-out)',
        });
        if (r.replay) skipped += 1; else closed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[hr-attendance] auto-close failed for ${o._id} ${date}: ${err.message}`);
      }
    }
  }
  return { closed, skipped, failed };
}
