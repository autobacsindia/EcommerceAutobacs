/**
 * HR push cron, registered from services/cronService.js with one line. Runs
 * under the cron service's Redis lock; idempotent by notification key, so a
 * second run (another instance, a restart) sends nothing new.
 *
 *   hrMissedPunchPush  10:30 IST — "you did not clock out yesterday"
 */
import cron from 'node-cron';
import { sendMissedPunchReminders } from './index.js';

const TZ = 'Asia/Kolkata';

export function scheduleHrPushJobs(svc) {
  if (process.env.NODE_ENV === 'test') return;
  const name = 'hrMissedPunchPush';
  const schedule = process.env.HR_MISSED_PUNCH_PUSH_CRON || '30 10 * * *';
  if (!cron.validate(schedule)) {
    console.error(`[CronService] Invalid schedule "${schedule}" for ${name} — NOT scheduled`);
    return;
  }
  const task = cron.schedule(schedule, () => svc.withDistributedLock(`cron:lock:${name}`, 10 * 60, async () => {
    try {
      console.log(`[CronService] ${name}: ${JSON.stringify(await sendMissedPunchReminders())}`);
    } catch (err) {
      console.error(`[CronService] ${name} failed:`, err.message);
    }
  }), { scheduled: true, timezone: TZ });
  svc.scheduledTasks.push({ name, task, schedule, description: 'HR: push "you did not clock out" for yesterday\'s auto-closed days' });
}
