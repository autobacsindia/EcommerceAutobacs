/**
 * Phone notifications for the Autobacs Team app (Expo push).
 *
 *   notifyEmployee()  — records ONE HrNotification per event key, then queues
 *                       delivery on the notifications queue (BullMQ). Never
 *                       throws and never slows the action that called it.
 *   deliverNotification() — the queue job: sends to the employee's phones.
 *
 * Idempotent end to end:
 *   - the event key is unique (HrNotification.key): a retried decision, a
 *     second cron run or a double click finds the row and queues nothing;
 *   - the job id is the row id, so a double enqueue is one job;
 *   - a job retry skips tokens Expo already accepted (`sentTo`), and a row no
 *     longer `queued` is never sent again.
 *
 * Fail-soft: no phones → status `no_device`; Expo down → the job throws and
 * BullMQ retries (3 attempts, backoff); Redis down → delivered inline, best
 * effort. A token Expo calls DeviceNotRegistered is deleted; MAX_FAILURES
 * refusals in a row delete it too. An exited employee gets nothing.
 *
 * Triggers (call sites):
 *   leave decided     services/hr/leave/requests.js decideLeave → notifyLeaveDecided
 *   missed clock-out  ./cronJobs.js daily → sendMissedPunchReminders
 *   overtime decided  attendance-policy calls notifyOvertimeDecided
 *   payslip ready     payroll calls notifyPayslipReady
 */
import mongoose from 'mongoose';
import teamPushRepository from '../../../repositories/hr/teamPushRepository.js';
import employeeRepository from '../../../repositories/hr/employeeRepository.js';
import { getNotificationsQueue } from '../../../queue/queues.js';
import AppError from '../../../utils/AppError.js';
import { sendExpoPush, ExpoTransportError, EXPO_TOKEN_RE } from './expoPush.js';

export const HR_PUSH_JOB = 'hr-team-push';
export const MAX_FAILURES = 3;

const fail = (message, status) => new AppError(message, status, { expose: true });
const isDup = (err) => err?.code === 11000 || err?.cause?.code === 11000;
const DEVICE_RE = /^[A-Za-z0-9_-]{8,100}$/;
const log = (...a) => { if (process.env.NODE_ENV !== 'test') console.log('[hr-push]', ...a); };
const warn = (...a) => { if (process.env.NODE_ENV !== 'test') console.warn('[hr-push]', ...a); };

// ── tokens ───────────────────────────────────────────────────────────────────

/** The app registers its Expo token at sign-in and on every launch. */
export async function registerPushToken(employee, user, input = {}) {
  const token = String(input.token || '').trim();
  const deviceId = String(input.deviceId || '').trim();
  const platform = String(input.platform || '');
  if (!EXPO_TOKEN_RE.test(token)) throw fail('Invalid push token', 400);
  if (!DEVICE_RE.test(deviceId)) throw fail('Invalid device id', 400);
  if (!['ios', 'android'].includes(platform)) throw fail("platform must be 'ios' or 'android'", 400);

  const set = { token, platform, user: user?._id || null, lastSeenAt: new Date() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await teamPushRepository.releaseToken(token, employee._id, deviceId);
      await teamPushRepository.upsertToken(employee._id, deviceId, set);
      return { registered: true };
    } catch (err) {
      // Two launches racing on the same token/device: the second loses the
      // unique index once; one retry settles it.
      if (!isDup(err) || attempt === 1) throw err;
    }
  }
  return { registered: true };
}

export async function unregisterPushToken(employee, deviceId) {
  if (!DEVICE_RE.test(String(deviceId || ''))) throw fail('Invalid device id', 400);
  await teamPushRepository.removeDevice(employee._id, String(deviceId));
  return { registered: false };
}

// ── send ─────────────────────────────────────────────────────────────────────

async function enqueue(id) {
  try {
    await getNotificationsQueue().add(HR_PUSH_JOB, { id: String(id) }, { jobId: `hrpush-${id}` });
  } catch (err) {
    // Redis unreachable: deliver inline, off the request path, best effort.
    warn(`queue unavailable (${err.message}); sending inline`);
    setImmediate(() => { deliverNotification(id).catch((e) => warn(`inline send failed: ${e.message}`)); });
  }
}

/**
 * Record + queue one notification. Returns { status: 'queued'|'duplicate'|'skipped'|'error' }.
 * Never throws.
 */
export async function notifyEmployee({ employeeId, type, key, title, body, path = '/' }) {
  try {
    if (!mongoose.isValidObjectId(employeeId) || !key || !type || !title || !body) return { status: 'skipped' };
    let row;
    try {
      row = await teamPushRepository.createNotification({
        key: String(key).slice(0, 200), employee: employeeId, type, title: String(title).slice(0, 120), body: String(body).slice(0, 300), path,
      });
    } catch (err) {
      if (isDup(err)) return { status: 'duplicate' };
      throw err;
    }
    await enqueue(row._id);
    return { status: 'queued', id: String(row._id) };
  } catch (err) {
    warn(`notify ${type} ${key} failed: ${err.message}`);
    return { status: 'error' };
  }
}

/** The queue job. Throws only on an Expo transport failure (so BullMQ retries). */
export async function deliverNotification(id, { fetchImpl } = {}) {
  const n = await teamPushRepository.findNotification(id);
  if (!n || n.status !== 'queued') return { status: n?.status || 'missing' };

  const employee = await employeeRepository.findById(n.employee);
  if (!employee || employee.status === 'exited') {
    await teamPushRepository.finishNotification(n._id, { status: 'no_device', error: 'employee not active' });
    return { status: 'no_device' };
  }
  const already = new Set(n.sentTo || []);
  const tokens = (await teamPushRepository.tokensFor(n.employee)).map((t) => t.token).filter((t) => !already.has(t));
  if (!tokens.length) {
    const status = already.size ? 'sent' : 'no_device';
    await teamPushRepository.finishNotification(n._id, { status, sentAt: already.size ? new Date() : null });
    return { status };
  }

  const messages = tokens.map((to) => ({
    to, title: n.title, body: n.body, data: { type: n.type, path: n.path, id: String(n._id) },
  }));
  const results = await sendExpoPush(messages, fetchImpl ? { fetchImpl } : undefined); // ExpoTransportError → retry

  const ok = tokens.filter((_, i) => results[i]?.ok);
  const gone = tokens.filter((_, i) => results[i]?.gone);
  const refused = tokens.filter((_, i) => !results[i]?.ok && !results[i]?.gone);
  if (ok.length) {
    await teamPushRepository.markSentTo(n._id, ok);
    await teamPushRepository.resetFailures(ok);
  }
  if (gone.length) await teamPushRepository.removeTokens(gone);
  if (refused.length) {
    await teamPushRepository.bumpFailures(refused);
    await teamPushRepository.removeFailing(MAX_FAILURES);
  }
  const delivered = ok.length + already.size > 0;
  const error = refused.length ? results.find((r) => r && !r.ok && !r.gone)?.error || '' : '';
  await teamPushRepository.finishNotification(n._id, delivered
    ? { status: 'sent', sentAt: new Date(), error }
    : { status: gone.length && !refused.length ? 'no_device' : 'failed', error: error || 'device gone' });
  log(`${n.type} ${n.key}: ${ok.length} sent, ${gone.length} gone, ${refused.length} refused`);
  return { status: delivered ? 'sent' : 'failed', sent: ok.length, gone: gone.length, refused: refused.length };
}

export { ExpoTransportError };

// ── events ───────────────────────────────────────────────────────────────────

const fmtDate = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const range = (from, to) => (from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`);
const hm = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};

/** Leave reached its final state (approved by the last step, or rejected). */
export function notifyLeaveDecided({ employeeId, requestId, from, to, decision, typeName = 'Leave' }) {
  const approved = decision === 'approved';
  return notifyEmployee({
    employeeId,
    type: 'leave_decided',
    key: `leave:${requestId}:${decision}`,
    title: approved ? 'Leave approved' : 'Leave not approved',
    body: approved
      ? `Your ${typeName} for ${range(from, to)} is approved.`
      : `Your ${typeName} for ${range(from, to)} was not approved. Open the app to see why.`,
    path: '/leave',
  });
}

/**
 * Overtime decided on one day. `decisionId` must change if the same day is
 * decided again (e.g. the day's rev), so a real second decision is a second push.
 */
export function notifyOvertimeDecided({ employeeId, dayId, decisionId, date, decision, approvedMinutes = 0 }) {
  const approved = decision === 'approved' && approvedMinutes > 0;
  return notifyEmployee({
    employeeId,
    type: 'overtime_decided',
    key: `ot:${dayId}:${decisionId ?? decision}`,
    title: approved ? 'Overtime approved' : 'Overtime not approved',
    body: approved
      ? `${hm(approvedMinutes)} of overtime on ${fmtDate(date)} is approved. It is paid at 2x in this month's salary.`
      : `Overtime on ${fmtDate(date)} was not approved.`,
    path: '/marks',
  });
}

/** A payslip was released to the employee. One push per payslip. */
export function notifyPayslipReady({ employeeId, month, payslipId }) {
  const [y, m] = String(month).split('-').map(Number);
  const label = y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : month;
  return notifyEmployee({
    employeeId,
    type: 'payslip_ready',
    key: `payslip:${payslipId || `${employeeId}:${month}`}`,
    title: 'Payslip ready',
    body: `Your payslip for ${label} is ready.`,
    path: '/payslips',
  });
}

/** The day was closed automatically: they forgot to clock out. One per employee per day. */
export function notifyMissedPunch({ employeeId, date }) {
  return notifyEmployee({
    employeeId,
    type: 'missed_punch',
    key: `missed_out:${employeeId}:${date}`,
    title: 'You did not clock out',
    body: `You did not clock out on ${fmtDate(date)}. If the time is wrong, ask for a fix in the app.`,
    path: '/history',
  });
}

const istDate = (now) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Cron: yesterday's auto-closed days → one reminder each (idempotent per key). */
export async function sendMissedPunchReminders(now = new Date()) {
  const y = istDate(new Date(now.getTime() - 86_400_000));
  const days = await teamPushRepository.autoClosedDays(y);
  let queued = 0;
  let duplicate = 0;
  for (const d of days) {
    const r = await notifyMissedPunch({ employeeId: d.employee, date: d.date });
    if (r.status === 'queued') queued += 1;
    else if (r.status === 'duplicate') duplicate += 1;
  }
  return { date: y, days: days.length, queued, duplicate };
}

export default {
  registerPushToken, unregisterPushToken, notifyEmployee, deliverNotification,
  notifyLeaveDecided, notifyOvertimeDecided, notifyPayslipReady, notifyMissedPunch, sendMissedPunchReminders,
};
