/**
 * HR attendance cron jobs, registered from services/cronService.js
 * (initializeCronJobs) with one line. Both run under the cron service's Redis
 * lock so several Railway instances never run them at once, and both are
 * idempotent on their own (fixed punch id / delete-then-row).
 *
 *   hrAutoClose        every 15 min — closes forgotten clock-outs at the shift end
 *   hrFacePhotoCleanup 03:40 IST    — deletes review photos past faceReviewPhotoDays
 *                                     (stored object first, then the row)
 */
import cron from 'node-cron';
import { autoCloseOpenDays } from './autoClose.js';
import { sweepExpiredPhotos } from '../face/reviewPhotos.js';

const TZ = 'Asia/Kolkata';

function add(svc, name, schedule, lockSeconds, fn, description) {
  if (!cron.validate(schedule)) {
    console.error(`[CronService] Invalid schedule "${schedule}" for ${name} — NOT scheduled`);
    return;
  }
  const task = cron.schedule(schedule, () => svc.withDistributedLock(`cron:lock:${name}`, lockSeconds, async () => {
    try {
      const r = await fn();
      console.log(`[CronService] ${name}: ${JSON.stringify(r)}`);
    } catch (err) {
      console.error(`[CronService] ${name} failed:`, err.message);
    }
  }), { scheduled: true, timezone: TZ });
  svc.scheduledTasks.push({ name, task, schedule, description });
}

export function scheduleHrAttendanceJobs(svc) {
  if (process.env.NODE_ENV === 'test') return;
  add(svc, 'hrAutoClose', process.env.HR_AUTO_CLOSE_CRON || '*/15 * * * *', 10 * 60, () => autoCloseOpenDays(),
    'HR: close forgotten clock-outs at the shift end (never overtime)');
  add(svc, 'hrFacePhotoCleanup', process.env.HR_FACE_PHOTO_CLEANUP_CRON || '40 3 * * *', 30 * 60, () => sweepExpiredPhotos(),
    'HR: delete face review photos after faceReviewPhotoDays (object, then row)');
}
