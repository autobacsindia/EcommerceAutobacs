/**
 * The project owner's morning reminder: "your projects today — what's open,
 * due today and late", as a pop-up in the panel and a phone/browser
 * notification.
 *
 * ── Once a day, never twice ─────────────────────────────────────────────────
 * Both ways in write the same row, StaffProjectReminder (user, day), unique:
 *   - the panel asks GET /staff/tasks/projects/reminder from REMINDER_HOUR_IST
 *     on; the row is created if missing, and the pop-up shows until "Got it"
 *   - the 10:00 cron (cronService.scheduleProjectReminders) creates the row
 *     for every owner with something open and sends the notification — only
 *     the run that moves `push` from 'pending' to 'sending' sends, so a
 *     doubled, retried or restarted run sends nothing more
 * Someone who already saw the pop-up before the cron reached them gets no
 * notification ('skipped'): they have been told.
 * A notification that fails is marked 'failed' and not retried — at most once
 * is the promise; the pop-up is the reliable channel.
 *
 * Content is worked out when it is shown, so a task closed at 10:05 is gone
 * from a pop-up opened at 10:30.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import StaffProject from '../models/StaffProject.js';
import StaffTask from '../models/StaffTask.js';
import StaffProjectReminder from '../models/StaffProjectReminder.js';
import userRepository from '../repositories/userRepository.js';
import { sendToUsers } from './pushService.js';
import { formatIsoDateIST } from '../utils/datetime.js';
import { REMINDER_HOUR_IST } from '../config/projectTemplates.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const inPanel = (u) => isAdmin(u) || isActiveStaff(u);

/** Projects one owner's reminder covers (soonest deadline first). */
export const REMINDER_PROJECTS_MAX = 50;
/** Open tasks read for one reminder. */
export const REMINDER_TASKS_MAX = 500;
/** Tasks named under each project (the rest are counted). */
export const REMINDER_TASKS_SHOWN = 5;
/** Owners one cron run reaches. */
export const REMINDER_OWNERS_MAX = 1000;
const KEEP_DAYS = 45;
export const PROJECTS_URL = '/team/tasks?view=projects';

const hourIST = (now) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(now));
export const reminderHour = () => (Number.isInteger(REMINDER_HOUR_IST) && REMINDER_HOUR_IST >= 0 && REMINDER_HOUR_IST <= 23 ? REMINDER_HOUR_IST : 10);
export const reminderDue = (now = new Date()) => hourIST(now) >= reminderHour();

/**
 * What one owner's reminder says today: their live projects with open work,
 * a deadline today, or a deadline passed. Empty when there is nothing to say.
 */
export async function digestFor(userId, today) {
  const uid = new mongoose.Types.ObjectId(idOf(userId));
  // people.user first: the staff_project_people index (the owner is always in people).
  const projects = await StaffProject.find({ 'people.user': uid, archivedAt: null, 'owner.user': uid })
    .select('name colour dueOn statusOverride rank')
    .sort({ rank: 1, _id: 1 })
    .limit(REMINDER_PROJECTS_MAX)
    .lean();
  const live = projects.filter((p) => p.statusOverride !== 'done');
  if (!live.length) return [];
  const tasks = await StaffTask.find({ project: { $in: live.map((p) => p._id) }, bucket: 'open', personal: { $ne: true } })
    .select('title dueOn project number')
    .sort({ rank: 1, _id: 1 })
    .limit(REMINDER_TASKS_MAX)
    .lean();
  const byProject = new Map();
  for (const t of tasks) {
    const key = idOf(t.project);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  }
  const out = [];
  for (const p of live) {
    const open = byProject.get(idOf(p._id)) || [];
    const late = open.filter((t) => t.dueOn && t.dueOn < today);
    const dueToday = open.filter((t) => t.dueOn === today);
    const projectLate = !!p.dueOn && p.dueOn < today && open.length > 0;
    const projectDueToday = p.dueOn === today;
    if (!open.length && !projectDueToday) continue;
    const pick = (list) => list.slice(0, REMINDER_TASKS_SHOWN).map((t) => ({ id: idOf(t._id), title: t.title, dueOn: t.dueOn || null }));
    out.push({
      id: idOf(p._id),
      name: p.name,
      colour: p.colour || 'blue',
      dueOn: p.dueOn || null,
      projectLate,
      projectDueToday,
      open: open.length,
      late: late.length,
      dueToday: dueToday.length,
      lateTasks: pick(late),
      dueTodayTasks: pick(dueToday),
    });
  }
  return out;
}

/** "Vicky's Hilux: 3 open, 1 late · Diwali launch: 2 due today" (for the notification). */
export function summaryLine(digest) {
  return digest.slice(0, 3).map((p) => {
    const bits = [`${p.open} open`];
    if (p.late) bits.push(`${p.late} late`);
    if (p.dueToday) bits.push(`${p.dueToday} due today`);
    return `${p.name}: ${bits.join(', ')}`;
  }).join(' · ') + (digest.length > 3 ? ` · +${digest.length - 3} more` : '');
}

/** The (user, day) row, created once. A simultaneous create loses to the unique index and reads the winner's. */
export async function ensureRow(userId, day, now = new Date()) {
  const filter = { user: new mongoose.Types.ObjectId(idOf(userId)), day };
  const insert = { push: 'pending', expiresAt: new Date(now.getTime() + KEEP_DAYS * 86_400_000) };
  try {
    return await StaffProjectReminder.findOneAndUpdate(filter, { $setOnInsert: insert }, { upsert: true, new: true }).lean();
  } catch (err) {
    if (err?.code === 11000) return StaffProjectReminder.findOne(filter).lean();
    throw err;
  }
}

/** The pop-up for `actor`, or null: not yet time, nothing to say, or already dismissed today. */
export async function getReminder(actor, now = new Date()) {
  if (!inPanel(actor) || !reminderDue(now)) return null;
  const day = formatIsoDateIST(now);
  const existing = await StaffProjectReminder.findOne({ user: actor._id, day }).select('dismissedAt').lean();
  if (existing?.dismissedAt) return null;
  const projects = await digestFor(actor._id, day);
  if (!projects.length) return null;
  const row = existing || await ensureRow(actor._id, day, now);
  if (row?.dismissedAt) return null;
  await StaffProjectReminder.updateOne({ _id: row._id, shownAt: null }, { $set: { shownAt: now } });
  return {
    day,
    projects,
    totals: projects.reduce((t, p) => ({ open: t.open + p.open, late: t.late + p.late, dueToday: t.dueToday + p.dueToday }), { open: 0, late: 0, dueToday: 0 }),
  };
}

/** "Got it": the pop-up stays away for the rest of `day`. Repeating it is harmless. */
export async function dismissReminder(actor, day, now = new Date()) {
  if (!inPanel(actor)) throw fail('Not found.', 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) throw fail('Reload and try again.', 400);
  await StaffProjectReminder.updateOne({ user: actor._id, day, dismissedAt: null }, { $set: { dismissedAt: now } });
  return { ok: true };
}

/**
 * The 10:00 run: every owner with something open gets the day's row and, once,
 * a notification. Returns what it did (for the log and the tests).
 */
export async function runDailyReminders(now = new Date(), { send = sendToUsers } = {}) {
  const day = formatIsoDateIST(now);
  const result = { day, owners: 0, withWork: 0, sent: 0, skipped: 0, already: 0, failed: 0 };
  const ownerIds = (await StaffProject.distinct('owner.user', { archivedAt: null })).slice(0, REMINDER_OWNERS_MAX);
  if (!ownerIds.length) return result;
  const users = (await userRepository.findChatUsersByIds(ownerIds)).filter(inPanel);
  result.owners = users.length;
  for (const u of users) {
    try {
      const digest = await digestFor(u._id, day);
      if (!digest.length) continue;
      result.withWork += 1;
      const row = await ensureRow(u._id, day, now);
      // Seen in the panel already, or dismissed: no notification needed.
      if (row.shownAt || row.dismissedAt) {
        const r = await StaffProjectReminder.updateOne({ _id: row._id, push: 'pending' }, { $set: { push: 'skipped' } });
        result[r.modifiedCount ? 'skipped' : 'already'] += 1;
        continue;
      }
      // The claim: only one run moves pending → sending, so only one run sends.
      const claimed = await StaffProjectReminder.findOneAndUpdate(
        { _id: row._id, push: 'pending' },
        { $set: { push: 'sending' } },
        { new: true },
      ).lean();
      if (!claimed) { result.already += 1; continue; }
      const devices = await send([{ userId: idOf(u._id), url: PROJECTS_URL }], {
        title: digest.some((p) => p.late || p.projectLate) ? 'Your projects today — some are late' : 'Your projects today',
        body: summaryLine(digest),
        tag: `project-reminder-${day}`,
        ttl: 6 * 3600,
      });
      await StaffProjectReminder.updateOne({ _id: row._id }, { $set: { push: 'sent', pushedAt: new Date() } });
      result.sent += devices > 0 ? 1 : 0;
    } catch (err) {
      result.failed += 1;
      console.error('[ProjectReminder] owner failed (others continue):', err.message);
    }
  }
  return result;
}
