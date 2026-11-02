/**
 * Time tracking on staff tasks: a Start/Stop timer, time added by hand, and
 * the totals a task and a list row show.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *   - one running timer per person: a double-clicked Start or a second tab
 *     never starts two (staff_task_time_running is unique), and starting on
 *     another task stops and saves the first
 *   - a Stop pressed twice saves once; Stop with nothing running says so
 *   - a timer left running stops itself at TIMER_CAP_SECONDS, marked so the
 *     person can correct it — totals never count a running timer past that
 *   - anyone who can see a task may track time on it; an archived task takes no
 *     new time; you change your own entries, the admin anyone's
 *   - totals are summed from the entries when shown, never kept on the task;
 *     time is not an edit of the task, so it bumps no rev and writes no Inbox line
 *   - a retried "Add time" (same clientId) adds once
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import staffTaskTimeRepository, { TIMER_CAP_SECONDS } from '../repositories/staffTaskTimeRepository.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import { canSee } from './staffTaskService.js';
import { formatIsoDateIST } from '../utils/datetime.js';

export { TIMER_CAP_SECONDS };
const CAP_MS = TIMER_CAP_SECONDS * 1000;
/** Time added by hand: 1 minute to 24 hours, for today or up to this many days back. */
export const MANUAL_MAX_MINUTES = 24 * 60;
export const MANUAL_PAST_DAYS = 90;
export const TIME_NOTE_MAX = 200;
export const TIME_PAGE_SIZE = 30;
const START_ATTEMPTS = 3;

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const same = (a, b) => !!a && !!b && idOf(a) === idOf(b);
const isAdmin = (u) => u?.role === 'admin';
const isDuplicate = (err) => err?.code === 11000;
const objectId = (raw, message, status = 400) => {
  if (!mongoose.isValidObjectId(raw)) throw fail(message, status);
  return new mongoose.Types.ObjectId(String(raw));
};
const cleanClientId = (raw) => (typeof raw === 'string' && /^[\w-]{8,64}$/.test(raw) ? raw : undefined);

/** Midnight IST at the start of `day` (YYYY-MM-DD). */
const startOfDayIST = (day) => new Date(`${day}T00:00:00+05:30`);
const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** How long a running row has run at `now`, capped. */
const elapsed = (row, now) => Math.floor(Math.min(Math.max(now - new Date(row.startedAt), 0), CAP_MS) / 1000);
const overCap = (row, now) => now - new Date(row.startedAt) >= CAP_MS;

async function loadVisible(actor, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Task not found.', 404);
  const t = await staffTaskRepository.findById(id);
  if (!t || !canSee(actor, t)) throw fail('Task not found.', 404);
  return t;
}

function assertOpenForTime(t) {
  if (t.bucket === 'archived') throw fail('This task is archived. Restore it to track time on it.', 409);
}

/** The running timer as the browser sees it. */
const timerOut = (row, task, viewer, now) => ({
  id: idOf(row._id),
  task: {
    id: idOf(row.task),
    code: `T-${row.number}`,
    // The live title while you can still open it; the copy taken at start otherwise.
    title: task && canSee(viewer, task) ? task.title : row.title,
  },
  startedAt: row.startedAt,
  seconds: elapsed(row, now),
  limitSeconds: TIMER_CAP_SECONDS,
});

/** One entry as `viewer` sees it. */
function entryOut(row, viewer, now) {
  const mine = same(row.user, viewer._id);
  const running = !!row.running;
  return {
    id: idOf(row._id),
    by: { id: idOf(row.user), name: row.userName || '' },
    source: row.source,
    day: row.day,
    startedAt: row.startedAt,
    endedAt: row.endedAt || null,
    seconds: running ? elapsed(row, now) : row.seconds ?? 0,
    running,
    autoStopped: !!row.autoStopped,
    edited: !!row.edited,
    note: row.note || '',
    can: {
      // A running timer is changed by stopping it; discarding it is allowed.
      edit: !running && (mine || isAdmin(viewer)),
      delete: mine || isAdmin(viewer),
    },
  };
}

/** Stop `row` at `now`, or at the limit when it ran past it. Null when another call stopped it first. */
function closeOut(row, now) {
  const capped = overCap(row, now);
  const endedAt = capped ? new Date(new Date(row.startedAt).getTime() + CAP_MS) : now;
  return staffTaskTimeRepository.close(row._id, { endedAt, seconds: elapsed(row, endedAt), autoStopped: capped });
}

/**
 * The caller's running timer, if any. One left past the limit is stopped here
 * and comes back as `autoStopped`, so the screen can say so.
 * @returns {Promise<{ timer: object|null, autoStopped: object|null }>}
 */
export async function currentTimer(actor, now = new Date()) {
  const row = await staffTaskTimeRepository.findRunning(actor._id);
  if (!row) return { timer: null, autoStopped: null };
  if (overCap(row, now)) {
    const closed = await closeOut(row, now);
    return { timer: null, autoStopped: closed ? entryOut(closed, actor, now) : null };
  }
  const task = await staffTaskRepository.findById(row.task);
  return { timer: timerOut(row, task, actor, now), autoStopped: null };
}

/**
 * Start a timer on task `id`. Already running on it: nothing changes. Running
 * on another task: that one stops and is saved (`stopped`) first.
 * @returns {Promise<{ timer: object, stopped: object|null }>}
 */
export async function startTimer(actor, id, now = new Date()) {
  const t = await loadVisible(actor, id);
  assertOpenForTime(t);
  let stopped = null;
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt += 1) {
    const running = await staffTaskTimeRepository.findRunning(actor._id);
    if (running && same(running.task, t._id) && !overCap(running, now)) {
      return { timer: timerOut(running, t, actor, now), stopped };
    }
    if (running) {
      const closed = await closeOut(running, now);
      if (closed) stopped = entryOut(closed, actor, now);
    }
    try {
      const row = await staffTaskTimeRepository.insert({
        user: actor._id, userName: actor.name || '', task: t._id, number: t.number, title: t.title,
        source: 'timer', startedAt: now, day: formatIsoDateIST(now), running: true,
      });
      return { timer: timerOut(row, t, actor, now), stopped };
    } catch (err) {
      // Another tab started one between our read and this write: look again.
      if (!isDuplicate(err)) throw err;
    }
  }
  throw fail('Your timer was changed in another tab. Reload and try again.', 409);
}

/**
 * Stop the caller's timer. Nothing running (or already stopped by another
 * click): `entry` is null — not an error.
 */
export async function stopTimer(actor, now = new Date()) {
  const row = await staffTaskTimeRepository.findRunning(actor._id);
  if (!row) return { entry: null };
  const closed = await closeOut(row, now);
  return { entry: closed ? entryOut(closed, actor, now) : null };
}

/**
 * A task's time: a page of entries (newest first) and the totals, per person,
 * over all of them.
 */
export async function listTime(actor, id, { cursor } = {}, now = new Date()) {
  const t = await loadVisible(actor, id);
  const before = cursor ? objectId(cursor, 'Invalid page cursor.') : null;
  const [rows, people] = await Promise.all([
    staffTaskTimeRepository.page(t._id, { before, limit: TIME_PAGE_SIZE + 1 }),
    staffTaskTimeRepository.totalsByPerson(t._id, now, CAP_MS),
  ]);
  const more = rows.length > TIME_PAGE_SIZE;
  const page = more ? rows.slice(0, TIME_PAGE_SIZE) : rows;
  return {
    entries: page.map((r) => entryOut(r, actor, now)),
    nextCursor: more ? idOf(page[page.length - 1]._id) : null,
    total: {
      seconds: people.reduce((s, p) => s + p.seconds, 0),
      people: people.map((p) => ({ id: idOf(p._id), name: p.name || '', seconds: p.seconds })),
    },
    can: { track: t.bucket !== 'archived' },
  };
}

function cleanMinutes(raw) {
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MANUAL_MAX_MINUTES) {
    throw fail('Enter between 1 minute and 24 hours.', 400);
  }
  return minutes;
}

function cleanDayOf(raw, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? ''));
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) throw fail('Pick a valid date.', 400);
  const today = formatIsoDateIST(now);
  if (m[0] > today) throw fail('Time can’t be added for a day that hasn’t come yet.', 400);
  if (m[0] < addDays(today, -MANUAL_PAST_DAYS)) throw fail(`Time can be added for the last ${MANUAL_PAST_DAYS} days only.`, 400);
  return m[0];
}

function cleanNote(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') throw fail('Invalid note.', 400);
  const note = raw.trim();
  if (note.length > TIME_NOTE_MAX) throw fail(`Keep the note under ${TIME_NOTE_MAX} characters.`, 400);
  return note;
}

/**
 * Add time by hand: `minutes` on `on` (an IST day), with an optional note.
 * A retry with the same clientId returns the first entry (`duplicate`).
 */
export async function addTime(actor, id, input = {}, now = new Date()) {
  const t = await loadVisible(actor, id);
  assertOpenForTime(t);
  const minutes = cleanMinutes(input.minutes);
  const day = cleanDayOf(input.on, now);
  const note = cleanNote(input.note);
  const clientId = cleanClientId(input.clientId);
  if (clientId) {
    const earlier = await staffTaskTimeRepository.findByClientId(actor._id, clientId);
    if (earlier) return { entry: entryOut(earlier, actor, now), duplicate: true };
  }
  const startedAt = startOfDayIST(day);
  const seconds = minutes * 60;
  try {
    const row = await staffTaskTimeRepository.insert({
      user: actor._id, userName: actor.name || '', task: t._id, number: t.number, title: t.title,
      source: 'manual', startedAt, endedAt: new Date(startedAt.getTime() + seconds * 1000), seconds, day, note,
      ...(clientId ? { clientId } : {}),
    });
    return { entry: entryOut(row, actor, now), duplicate: false };
  } catch (err) {
    // Two copies of the same "Add" raced; the first one is the answer.
    if (!isDuplicate(err) || !clientId) throw err;
    const earlier = await staffTaskTimeRepository.findByClientId(actor._id, clientId);
    if (!earlier) throw err;
    return { entry: entryOut(earlier, actor, now), duplicate: true };
  }
}

/** An entry on a task `actor` can see, that `actor` may change. */
async function loadOwnEntry(actor, id, entryId) {
  const t = await loadVisible(actor, id);
  const row = await staffTaskTimeRepository.findOnTask(t._id, objectId(entryId, 'Time entry not found.', 404));
  if (!row) throw fail('Time entry not found.', 404);
  if (!same(row.user, actor._id) && !isAdmin(actor)) throw fail('You can change only your own time.', 403);
  return { t, row };
}

/** Correct an entry: minutes, day and/or note. A running timer is stopped first, not edited. */
export async function editTime(actor, id, entryId, input = {}, now = new Date()) {
  const { t, row } = await loadOwnEntry(actor, id, entryId);
  if (row.running) throw fail('Stop the timer first, then correct it.', 409);
  const set = {};
  if (input.minutes !== undefined) {
    set.seconds = cleanMinutes(input.minutes) * 60;
    set.endedAt = new Date(new Date(row.startedAt).getTime() + set.seconds * 1000);
  }
  if (input.on !== undefined) set.day = cleanDayOf(input.on, now);
  if (input.note !== undefined) set.note = cleanNote(input.note);
  if (!Object.keys(set).length) return { entry: entryOut(row, actor, now) };
  const updated = await staffTaskTimeRepository.update(t._id, row._id, set);
  if (!updated) throw fail('Time entry not found.', 404);
  return { entry: entryOut(updated, actor, now) };
}

/** Delete an entry — a running timer too, which discards it. */
export async function deleteTime(actor, id, entryId) {
  const { t, row } = await loadOwnEntry(actor, id, entryId);
  await staffTaskTimeRepository.remove(t._id, row._id);
  return { id: idOf(row._id) };
}
