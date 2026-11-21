/**
 * The morning project reminder — "update the status of your work" — for every
 * person on a project, as a pop-up in the panel and a phone/browser
 * notification. One reminder per person per day, listing:
 *
 *   mine       their own open tasks in live projects: overdue first, then due
 *              today, then due in the next SOON_DAYS days. Tasks with no due
 *              date are listed on Mondays only (WEEKLY_WEEKDAY) — a daily nag
 *              about undated work teaches people to ignore the reminder.
 *              Tasks due later than that are counted, not listed.
 *   deadlines  projects they are in (not owner) whose deadline is today, within
 *              SOON_DAYS, or passed, with work still open
 *   projects   for project OWNERS: each live project's open / due today / late,
 *              and who has late work on it ("not updated")
 *   team       for the ADMIN: everyone with late project work, across projects
 *
 * Nobody with nothing overdue, due or near gets a reminder. Done and deleted
 * tasks, deleted projects and projects marked done never count. Sundays and the
 * holiday list (config/projectTemplates.js staffHolidays) are quiet.
 *
 * ── Once a day, never twice ─────────────────────────────────────────────────
 * Both ways in write the same row, StaffProjectReminder (user, day), unique:
 *   - the panel asks GET /staff/tasks/projects/reminder from the reminder time
 *     on; the row is created if missing, and the pop-up shows until "Got it"
 *   - the morning cron (cronService.scheduleProjectReminders) creates the row
 *     for every person with something to say and sends the notification — only
 *     the run that moves `push` from 'pending' to 'sending' sends, so a
 *     doubled, retried or restarted run sends nothing more
 * Someone who already saw the pop-up before the cron reached them gets no
 * notification ('skipped'): they have been told.
 * A notification that fails is marked 'failed' and not retried — at most once
 * is the promise; the pop-up is the reliable channel.
 *
 * Content is worked out when it is shown, so a task closed at 10:05 is gone
 * from a pop-up opened at 10:30. All days are IST.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import StaffProject from '../models/StaffProject.js';
import StaffTask from '../models/StaffTask.js';
import StaffProjectReminder from '../models/StaffProjectReminder.js';
import userRepository from '../repositories/userRepository.js';
import { sendToUsers } from './pushService.js';
import { formatIsoDateIST } from '../utils/datetime.js';
import { REMINDER_HOUR_IST, REMINDER_MINUTE_IST, staffHolidays } from '../config/projectTemplates.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const inPanel = (u) => isAdmin(u) || isActiveStaff(u);
const oid = (v) => new mongoose.Types.ObjectId(idOf(v));

/** Projects one owner's section covers (soonest deadline first). */
export const REMINDER_PROJECTS_MAX = 50;
/** Open tasks read for one owner's section. */
export const REMINDER_TASKS_MAX = 500;
/** Tasks named under each project (the rest are counted). */
export const REMINDER_TASKS_SHOWN = 5;
/** One person's own open project tasks read for their list. */
export const MINE_MAX = 300;
/** Tasks named in each of "overdue / today / soon / no date" (the rest are counted). */
export const MINE_SHOWN = 10;
/** "Due soon" = within this many days after today. */
export const SOON_DAYS = 2;
/** Undated tasks are listed on this weekday only (1 = Monday). */
export const WEEKLY_WEEKDAY = 1;
/** Live projects one cron run looks at, and people it reaches. */
export const REMINDER_PROJECTS_SCAN_MAX = 2000;
export const REMINDER_PEOPLE_MAX = 1000;
/** Late tasks read for the admin's "who has late work" list, and people shown. */
export const TEAM_LATE_TASKS_MAX = 500;
export const TEAM_SHOWN = 10;
/** People named under one owner's project as "not updated". */
export const NOT_UPDATED_SHOWN = 5;
const KEEP_DAYS = 45;
export const PROJECTS_URL = '/team/tasks?view=projects';
const DAY_MS = 86_400_000;

// ── Days and times (IST) ────────────────────────────────────────────────────

const minutesIST = (now) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' })
    .format(now).split(':').map(Number);
  return h * 60 + m;
};
export const reminderTime = () => ({
  hour: Number.isInteger(REMINDER_HOUR_IST) && REMINDER_HOUR_IST >= 0 && REMINDER_HOUR_IST <= 23 ? REMINDER_HOUR_IST : 9,
  minute: Number.isInteger(REMINDER_MINUTE_IST) && REMINDER_MINUTE_IST >= 0 && REMINDER_MINUTE_IST <= 59 ? REMINDER_MINUTE_IST : 30,
});
/** The cron line for the reminder time, e.g. "30 9 * * *" (cronService; PROJECT_REMINDER_CRON overrides). */
export const reminderCron = () => { const t = reminderTime(); return `${t.minute} ${t.hour} * * *`; };
export const reminderDue = (now = new Date()) => { const t = reminderTime(); return minutesIST(now) >= t.hour * 60 + t.minute; };

const dayMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
export const addDays = (ymd, n) => new Date(dayMs(ymd) + n * DAY_MS).toISOString().slice(0, 10);
export const weekdayOf = (ymd) => new Date(dayMs(ymd)).getUTCDay();
const daysBetween = (from, to) => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
/** Sundays and holidays have no reminder. */
export const isQuietDay = (day, holidays = staffHolidays()) => weekdayOf(day) === 0 || holidays.has(day);
export const isWeeklyDay = (day) => weekdayOf(day) === WEEKLY_WEEKDAY;

// ── What one person's reminder says ─────────────────────────────────────────

const liveOnly = (p) => !!p && !p.archivedAt && p.statusOverride !== 'done';
const projectRef = (p) => ({ id: idOf(p._id), name: p.name, colour: p.colour || 'blue' });

/** The person's own open tasks in live projects, sorted into what the reminder lists. */
export async function myItems(userId, today) {
  const tasks = await StaffTask.find({
    'assignees.user': oid(userId), bucket: 'open', personal: { $ne: true }, project: { $type: 'objectId' },
  })
    .select('title number dueOn project')
    .sort({ rank: 1, _id: 1 })
    .limit(MINE_MAX)
    .lean();
  const ids = [...new Set(tasks.map((t) => idOf(t.project)))];
  const projects = ids.length
    ? await StaffProject.find({ _id: { $in: ids.map(oid) }, archivedAt: null }).select('name colour statusOverride archivedAt').lean()
    : [];
  const live = new Map(projects.filter(liveOnly).map((p) => [idOf(p._id), p]));
  const soonBy = addDays(today, SOON_DAYS);
  const out = { overdue: [], today: [], soon: [], noDate: [], later: 0 };
  for (const t of tasks) {
    const p = live.get(idOf(t.project));
    if (!p) continue;
    const item = {
      id: idOf(t._id), code: `T-${t.number}`, title: t.title, dueOn: t.dueOn || null,
      daysLate: t.dueOn && t.dueOn < today ? daysBetween(t.dueOn, today) : 0,
      project: projectRef(p),
    };
    if (!t.dueOn) out.noDate.push(item);
    else if (t.dueOn < today) out.overdue.push(item);
    else if (t.dueOn === today) out.today.push(item);
    else if (t.dueOn <= soonBy) out.soon.push(item);
    else out.later += 1;
  }
  // Longest late first.
  out.overdue.sort((a, b) => b.daysLate - a.daysLate);
  return out;
}

/** Open task counts for a handful of projects: one aggregate on staff_task_project. */
async function openCounts(projectIds) {
  if (!projectIds.length) return new Map();
  const rows = await StaffTask.aggregate([
    { $match: { project: { $in: projectIds.map(oid) }, bucket: 'open' } },
    { $group: { _id: '$project', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [idOf(r._id), r.n]));
}

/** Projects the person is in (not the owner) whose deadline is near or passed, with work open. */
export async function projectDeadlines(userId, today) {
  const uid = oid(userId);
  const projects = await StaffProject.find({
    'people.user': uid, archivedAt: null, 'owner.user': { $ne: uid },
    dueOn: { $type: 'string', $lte: addDays(today, SOON_DAYS) },
  })
    .select('name colour dueOn statusOverride')
    .sort({ rank: 1, _id: 1 })
    .limit(REMINDER_PROJECTS_MAX)
    .lean();
  const live = projects.filter(liveOnly);
  const counts = await openCounts(live.map((p) => p._id));
  return live
    .filter((p) => (counts.get(idOf(p._id)) || 0) > 0)
    .map((p) => ({ ...projectRef(p), dueOn: p.dueOn, daysLate: p.dueOn < today ? daysBetween(p.dueOn, today) : 0, open: counts.get(idOf(p._id)) }));
}

/** Late tasks → one line per person who has them: how many, how late, when last touched. */
function latePeople(tasks, today, { skip = null, max }) {
  const byPerson = new Map();
  for (const t of tasks) {
    for (const a of t.assignees || []) {
      const key = idOf(a.user);
      if (!key || key === skip) continue;
      const row = byPerson.get(key) || { id: key, name: a.name || '', late: 0, daysLate: 0, lastUpdate: null };
      row.late += 1;
      row.daysLate = Math.max(row.daysLate, daysBetween(t.dueOn, today));
      const at = t.updatedAt ? new Date(t.updatedAt).toISOString() : null;
      if (at && (!row.lastUpdate || at > row.lastUpdate)) row.lastUpdate = at;
      byPerson.set(key, row);
    }
  }
  return [...byPerson.values()].sort((a, b) => b.late - a.late || b.daysLate - a.daysLate).slice(0, max);
}

/**
 * The OWNER's section: their live projects with open work, a deadline today,
 * or a deadline passed — and who has late work on each. Empty when nothing.
 */
export async function digestFor(userId, today) {
  const uid = oid(userId);
  // people.user first: the staff_project_people index (the owner is always in people).
  const projects = await StaffProject.find({ 'people.user': uid, archivedAt: null, 'owner.user': uid })
    .select('name colour dueOn statusOverride rank')
    .sort({ rank: 1, _id: 1 })
    .limit(REMINDER_PROJECTS_MAX)
    .lean();
  const live = projects.filter((p) => p.statusOverride !== 'done');
  if (!live.length) return [];
  const tasks = await StaffTask.find({ project: { $in: live.map((p) => p._id) }, bucket: 'open', personal: { $ne: true } })
    .select('title dueOn project number assignees updatedAt')
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
      // The owner's own late work is in their "mine" list already.
      notUpdated: latePeople(late, today, { skip: idOf(uid), max: NOT_UPDATED_SHOWN }),
    });
  }
  return out;
}

/** The ADMIN's section: everyone with late work in any live project. */
export async function teamLate(today) {
  const live = await StaffProject.find({ archivedAt: null, statusOverride: { $ne: 'done' } })
    .select('_id')
    .limit(REMINDER_PROJECTS_SCAN_MAX)
    .lean();
  if (!live.length) return [];
  const tasks = await StaffTask.find({
    project: { $in: live.map((p) => p._id) }, bucket: 'open', rank: { $lt: today }, personal: { $ne: true },
  })
    .select('dueOn assignees updatedAt')
    .limit(TEAM_LATE_TASKS_MAX)
    .lean();
  return latePeople(tasks.filter((t) => t.dueOn && t.dueOn < today), today, { max: TEAM_SHOWN });
}

/** "Vicky's Hilux: 3 open, 1 late · Diwali launch: 2 due today" (an owner's projects). */
export function summaryLine(digest) {
  return digest.slice(0, 3).map((p) => {
    const bits = [`${p.open} open`];
    if (p.late) bits.push(`${p.late} late`);
    if (p.dueToday) bits.push(`${p.dueToday} due today`);
    return `${p.name}: ${bits.join(', ')}`;
  }).join(' · ') + (digest.length > 3 ? ` · +${digest.length - 3} more` : '');
}

/**
 * Everything `user`'s reminder says on `day`, or null when there is nothing:
 * no overdue / due / near work of their own, no near project deadline, nothing
 * in their own projects, and (the admin) nobody late.
 */
export async function buildReminder(user, day) {
  const weekly = isWeeklyDay(day);
  const [mine, deadlines, projects, team] = await Promise.all([
    myItems(user._id, day),
    projectDeadlines(user._id, day),
    digestFor(user._id, day),
    isAdmin(user) ? teamLate(day) : Promise.resolve([]),
  ]);
  const counts = {
    overdue: mine.overdue.length, today: mine.today.length, soon: mine.soon.length,
    noDate: mine.noDate.length, later: mine.later,
  };
  const listed = counts.overdue + counts.today + counts.soon + (weekly ? counts.noDate : 0);
  if (!listed && !deadlines.length && !projects.length && !team.length) return null;
  const shown = (list) => list.slice(0, MINE_SHOWN);
  return {
    day,
    weekly,
    mine: {
      overdue: shown(mine.overdue),
      today: shown(mine.today),
      soon: shown(mine.soon),
      noDate: weekly ? shown(mine.noDate) : [],
      counts,
    },
    deadlines,
    projects,
    team,
    totals: projects.reduce((t, p) => ({ open: t.open + p.open, late: t.late + p.late, dueToday: t.dueToday + p.dueToday }), { open: 0, late: 0, dueToday: 0 }),
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The phone notification for a reminder: the most urgent thing in the title. */
export function pushText(r) {
  const c = r.mine.counts;
  const title = c.overdue
    ? `${plural(c.overdue, 'item')} overdue — please update`
    : c.today ? `${plural(c.today, 'item')} due today — please update`
      : 'Your projects today — please update';
  const bits = [];
  if (c.overdue) bits.push(`${c.overdue} overdue`);
  if (c.today) bits.push(`${c.today} due today`);
  if (c.soon) bits.push(`${c.soon} due soon`);
  if (r.weekly && c.noDate) bits.push(`${c.noDate} with no date`);
  for (const d of r.deadlines.slice(0, 2)) {
    bits.push(`${d.name} deadline ${d.daysLate ? `${plural(d.daysLate, 'day')} late` : d.dueOn === r.day ? 'today' : d.dueOn}`);
  }
  if (r.projects.length) bits.push(summaryLine(r.projects));
  if (r.team.length) bits.push(`${plural(r.team.length, 'person', 'people')} with late work`);
  return { title, body: bits.join(' · ').slice(0, 240) };
}

// ── The row: once a day ─────────────────────────────────────────────────────

/** The (user, day) row, created once. A simultaneous create loses to the unique index and reads the winner's. */
export async function ensureRow(userId, day, now = new Date()) {
  const filter = { user: oid(userId), day };
  const insert = { push: 'pending', expiresAt: new Date(now.getTime() + KEEP_DAYS * DAY_MS) };
  try {
    return await StaffProjectReminder.findOneAndUpdate(filter, { $setOnInsert: insert }, { upsert: true, new: true }).lean();
  } catch (err) {
    if (err?.code === 11000) return StaffProjectReminder.findOne(filter).lean();
    throw err;
  }
}

/** The pop-up for `actor`, or null: not yet time, a quiet day, nothing to say, or already dismissed today. */
export async function getReminder(actor, now = new Date(), { holidays } = {}) {
  if (!inPanel(actor) || !reminderDue(now)) return null;
  const day = formatIsoDateIST(now);
  if (isQuietDay(day, holidays)) return null;
  const existing = await StaffProjectReminder.findOne({ user: actor._id, day }).select('dismissedAt').lean();
  if (existing?.dismissedAt) return null;
  const reminder = await buildReminder(actor, day);
  if (!reminder) return null;
  const row = existing || await ensureRow(actor._id, day, now);
  if (row?.dismissedAt) return null;
  await StaffProjectReminder.updateOne({ _id: row._id, shownAt: null }, { $set: { shownAt: now } });
  return reminder;
}

/** "Got it": the pop-up stays away for the rest of `day`. Repeating it is harmless. */
export async function dismissReminder(actor, day, now = new Date()) {
  if (!inPanel(actor)) throw fail('Not found.', 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) throw fail('Reload and try again.', 400);
  await StaffProjectReminder.updateOne({ user: actor._id, day, dismissedAt: null }, { $set: { dismissedAt: now } });
  return { ok: true };
}

/** Everyone the morning run looks at: people on live projects, whoever has open work in one, and the admins. */
async function candidates() {
  const live = await StaffProject.find({ archivedAt: null })
    .select('_id people.user')
    .limit(REMINDER_PROJECTS_SCAN_MAX)
    .lean();
  const ids = new Set();
  for (const p of live) for (const x of p.people || []) ids.add(idOf(x.user));
  if (live.length) {
    const assignees = await StaffTask.distinct('assignees.user', { project: { $in: live.map((p) => p._id) }, bucket: 'open' });
    for (const a of assignees) ids.add(idOf(a));
  }
  for (const a of await userRepository.findAdmins()) ids.add(idOf(a._id));
  ids.delete(null);
  const users = await userRepository.findChatUsersByIds([...ids].map(oid));
  return users.filter(inPanel).slice(0, REMINDER_PEOPLE_MAX);
}

/**
 * The morning run: every person with something to say gets the day's row and,
 * once, a notification. Quiet on Sundays and holidays. Returns what it did
 * (for the log and the tests).
 */
export async function runDailyReminders(now = new Date(), { send = sendToUsers, holidays } = {}) {
  const day = formatIsoDateIST(now);
  const result = { day, quiet: false, people: 0, withWork: 0, sent: 0, skipped: 0, already: 0, failed: 0 };
  if (isQuietDay(day, holidays)) return { ...result, quiet: true };
  const users = await candidates();
  result.people = users.length;
  for (const u of users) {
    try {
      const reminder = await buildReminder(u, day);
      if (!reminder) continue;
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
      const { title, body } = pushText(reminder);
      let devices = 0;
      try {
        devices = await send([{ userId: idOf(u._id), url: isAdmin(u) ? '/admin/tasks?view=projects' : PROJECTS_URL }], {
          title, body, tag: `project-reminder-${day}`, ttl: 6 * 3600,
        });
      } catch (err) {
        await StaffProjectReminder.updateOne({ _id: row._id }, { $set: { push: 'failed' } });
        throw err;
      }
      await StaffProjectReminder.updateOne({ _id: row._id }, { $set: { push: 'sent', pushedAt: new Date() } });
      result.sent += devices > 0 ? 1 : 0;
    } catch (err) {
      result.failed += 1;
      console.error('[ProjectReminder] person failed (others continue):', err.message);
    }
  }
  return result;
}
