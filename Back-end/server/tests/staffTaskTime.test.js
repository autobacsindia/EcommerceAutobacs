/**
 * Tasks phase 6b — time on tasks (server).
 *
 * What must hold:
 *   - one running timer per person: Start twice, two tabs at once, or two tasks
 *     at once never leave two running; starting on another task saves the first
 *   - Stop with nothing running says so; Stop twice saves once
 *   - a timer left past the limit stops itself there and is marked; totals never
 *     count a running timer past the limit
 *   - time added by hand: 1 minute to 24 hours, not in the future, not too old;
 *     a retry with the same clientId adds once, even when the two race
 *   - you change your own entries, the admin anyone's; a running timer is not
 *     edited; a task you cannot see is "not found"; an archived one takes no time
 *   - pages are keyset and bounded; totals are per person and per list row
 *   - time does not change the task (no rev bump, no Inbox line)
 *   - every read is one range of its index, never a collection scan
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const { default: StaffTaskTime } = await import('../models/StaffTaskTime.js');
const { default: staffTaskTimeRepository } = await import('../repositories/staffTaskTimeRepository.js');
const tasks = await import('../services/staffTaskService.js');
const time = await import('../services/staffTaskTimeService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const HOUR = 3600 * 1000;
// 2026-11-02 11:30 IST.
const T0 = new Date('2026-11-02T06:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `time${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const refused = async (promise, status, message) => {
  await expect(promise).rejects.toMatchObject({ statusCode: status, ...(message ? { message: expect.stringMatching(message) } : {}) });
};
const raw = (id) => StaffTask.findById(id).lean();
const runningOf = (who) => StaffTaskTime.find({ user: who._id, running: true }).lean();

let priya, arun, sam, admin;
beforeAll(async () => { await StaffTask.syncIndexes(); await StaffTaskTime.syncIndexes(); });
beforeEach(async () => {
  priya = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  sam = await person('staff', { team: 'sales' }, 'Sam');
  admin = await person('admin', null, 'Boss');
});
afterEach(() => { jest.restoreAllMocks(); });

const give = async (who = arun, extra = {}) => (await tasks.createTask(priya, {
  title: 'Count the Bosch pads', assigneeId: String(who._id), ...extra,
}, req)).task;

describe('the timer', () => {
  it('starts with nothing: no timer, no time, and Stop says nothing was running', async () => {
    const t = await give();
    expect(await time.currentTimer(arun, T0)).toEqual({ timer: null, autoStopped: null });
    expect(await time.stopTimer(arun, T0)).toEqual({ entry: null });
    expect(await time.listTime(arun, t.id, {}, T0)).toEqual({
      entries: [], nextCursor: null, total: { seconds: 0, people: [] }, can: { track: true },
    });
  });

  it('runs, shows how long, and stops into a saved entry', async () => {
    const t = await give();
    const { timer, stopped } = await time.startTimer(arun, t.id, T0);
    expect(stopped).toBeNull();
    expect(timer).toMatchObject({ task: { id: t.id, code: t.code, title: 'Count the Bosch pads' }, seconds: 0, limitSeconds: 36000 });
    expect((await time.currentTimer(arun, at(42 * 60 * 1000))).timer).toMatchObject({ id: timer.id, seconds: 2520 });
    // Someone else's timer is theirs alone.
    expect((await time.currentTimer(priya, T0)).timer).toBeNull();

    const { entry } = await time.stopTimer(arun, at(HOUR + 5000));
    expect(entry).toMatchObject({ id: timer.id, seconds: 3605, running: false, source: 'timer', day: '2026-11-02', autoStopped: false });
    expect((await time.currentTimer(arun, at(2 * HOUR))).timer).toBeNull();
  });

  it('Start on the same task again changes nothing; on another task it stops and saves the first', async () => {
    const a = await give();
    const b = await give(arun, { title: 'Ring the courier' });
    const first = await time.startTimer(arun, a.id, T0);
    const again = await time.startTimer(arun, a.id, at(60000));
    expect(again).toMatchObject({ timer: { id: first.timer.id, seconds: 60 }, stopped: null });

    const other = await time.startTimer(arun, b.id, at(30 * 60000));
    expect(other.stopped).toMatchObject({ id: first.timer.id, seconds: 1800, running: false });
    expect(other.stopped.task).toEqual({ id: a.id, code: a.code });
    expect(other.timer.task.id).toBe(b.id);
    expect(await runningOf(arun)).toHaveLength(1);
    expect(await StaffTaskTime.countDocuments({})).toBe(2);
  });

  it('two Starts at once — same task or two tasks — leave exactly one timer running', async () => {
    const a = await give();
    const b = await give(arun, { title: 'Ring the courier' });
    await Promise.all([time.startTimer(arun, a.id, T0), time.startTimer(arun, a.id, T0)]);
    expect(await runningOf(arun)).toHaveLength(1);

    const results = await Promise.allSettled([time.startTimer(arun, a.id, at(60000)), time.startTimer(arun, b.id, at(60000))]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await runningOf(arun)).toHaveLength(1);
  });

  it('a second Start that keeps losing the race says so instead of looping', async () => {
    const a = await give();
    const clash = Object.assign(new Error('dup'), { code: 11000 });
    jest.spyOn(staffTaskTimeRepository, 'insert').mockRejectedValue(clash);
    await refused(time.startTimer(arun, a.id, T0), 409, /another tab/);
    expect(staffTaskTimeRepository.insert).toHaveBeenCalledTimes(3);
  });

  it('Stop pressed twice at once saves the time once', async () => {
    const a = await give();
    await time.startTimer(arun, a.id, T0);
    const [x, y] = await Promise.all([time.stopTimer(arun, at(HOUR)), time.stopTimer(arun, at(HOUR))]);
    expect([x.entry, y.entry].filter(Boolean)).toHaveLength(1);
    const rows = await StaffTaskTime.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seconds: 3600 });
    expect(rows[0].running).toBeUndefined();
  });

  it('a timer left running stops itself at 10 hours, marked so it can be corrected', async () => {
    const a = await give();
    await time.startTimer(arun, a.id, T0);
    // While nobody looks, the totals still stop counting at the limit.
    expect((await time.listTime(arun, a.id, {}, at(14 * HOUR))).total.seconds).toBe(36000);
    const { timer, autoStopped } = await time.currentTimer(arun, at(14 * HOUR));
    expect(timer).toBeNull();
    expect(autoStopped).toMatchObject({ seconds: 36000, autoStopped: true, running: false, endedAt: at(10 * HOUR) });
    // It names its task, so the screen can link to it after a reload.
    expect(autoStopped.task).toEqual({ id: a.id, code: a.code });
    expect(await runningOf(arun)).toHaveLength(0);
  });

  it('Stop and a new Start after the limit also save only the 10 hours', async () => {
    const a = await give();
    const b = await give(arun, { title: 'Ring the courier' });
    await time.startTimer(arun, a.id, T0);
    expect((await time.stopTimer(arun, at(11 * HOUR))).entry).toMatchObject({ seconds: 36000, autoStopped: true });
    await time.startTimer(arun, a.id, at(12 * HOUR));
    // Same task, but past the limit: saved and a fresh one started.
    const next = await time.startTimer(arun, a.id, at(23 * HOUR));
    expect(next.stopped).toMatchObject({ seconds: 36000, autoStopped: true });
    expect(next.timer.seconds).toBe(0);
    const switched = await time.startTimer(arun, b.id, at(23 * HOUR + 60000));
    expect(switched.stopped).toMatchObject({ seconds: 60, autoStopped: false });
  });

  it('keeps running for someone taken off the task, under the title it had, and still stops', async () => {
    const a = await give();
    await time.startTimer(arun, a.id, T0);
    await tasks.updateTask(priya, a.id, { rev: (await raw(a.id)).rev, title: 'Renamed', assigneeId: String(priya._id) }, req);
    const { timer } = await time.currentTimer(arun, at(60000));
    expect(timer.task).toMatchObject({ code: a.code, title: 'Count the Bosch pads' });
    expect((await time.currentTimer(priya, at(60000))).timer).toBeNull();
    expect((await time.stopTimer(arun, at(120000))).entry).toMatchObject({ seconds: 120 });
    await refused(time.listTime(arun, a.id, {}, T0), 404);
  });
});

describe('time added by hand', () => {
  it('adds minutes on a day, with a note', async () => {
    const a = await give();
    const { entry, duplicate } = await time.addTime(arun, a.id, { minutes: 90, on: '2026-11-01', note: '  Called supplier ' }, T0);
    expect(duplicate).toBe(false);
    expect(entry).toMatchObject({
      seconds: 5400, day: '2026-11-01', source: 'manual', note: 'Called supplier', running: false,
      by: { name: 'Arun' }, can: { edit: true, delete: true },
    });
  });

  it('refuses amounts and days that make no sense', async () => {
    const a = await give();
    for (const minutes of [0, -5, 1441, 1.5, 'abc', null]) {
      await refused(time.addTime(arun, a.id, { minutes, on: '2026-11-02' }, T0), 400, /between 1 minute and 24 hours/);
    }
    await refused(time.addTime(arun, a.id, { minutes: 30, on: '2026-11-03' }, T0), 400, /hasn’t come yet/);
    await refused(time.addTime(arun, a.id, { minutes: 30, on: '2026-08-03' }, T0), 400, /last 90 days/);
    for (const on of ['2026-02-30', 'yesterday', '', undefined]) {
      await refused(time.addTime(arun, a.id, { minutes: 30, on }, T0), 400, /valid date/);
    }
    await refused(time.addTime(arun, a.id, { minutes: 30, on: '2026-11-02', note: 'x'.repeat(201) }, T0), 400, /200 characters/);
    // Today (IST) and the 90th day back are fine.
    await time.addTime(arun, a.id, { minutes: 30, on: '2026-11-02' }, T0);
    await time.addTime(arun, a.id, { minutes: 30, on: '2026-08-04' }, T0);
    expect(await StaffTaskTime.countDocuments({})).toBe(2);
  });

  it('a retried Add — one after another, or both at once — adds once', async () => {
    const a = await give();
    const input = { minutes: 15, on: '2026-11-02', clientId: 'add-time-1234' };
    const first = await time.addTime(arun, a.id, input, T0);
    const retry = await time.addTime(arun, a.id, input, T0);
    expect(retry).toMatchObject({ duplicate: true, entry: { id: first.entry.id } });

    const both = await Promise.all([
      time.addTime(arun, a.id, { ...input, clientId: 'add-time-5678' }, T0),
      time.addTime(arun, a.id, { ...input, clientId: 'add-time-5678' }, T0),
    ]);
    expect(both[0].entry.id).toBe(both[1].entry.id);
    expect(await StaffTaskTime.countDocuments({})).toBe(2);
    // The same key from someone else is their own.
    await time.addTime(priya, a.id, input, T0);
    expect(await StaffTaskTime.countDocuments({})).toBe(3);
  });
});

describe('who may do what', () => {
  it('anyone who sees the task tracks time; a task you cannot see does not exist for you', async () => {
    const a = await give();
    await time.addTime(priya, a.id, { minutes: 10, on: '2026-11-02' }, T0);
    await time.startTimer(admin, a.id, T0);
    await refused(time.startTimer(sam, a.id, T0), 404);
    await refused(time.addTime(sam, a.id, { minutes: 10, on: '2026-11-02' }, T0), 404);
    await refused(time.listTime(sam, a.id, {}, T0), 404);
    await refused(time.startTimer(arun, 'not-an-id', T0), 404);
    await refused(time.startTimer(arun, String(new mongoose.Types.ObjectId()), T0), 404);
  });

  it('an archived task takes no new time, but its time can still be read and corrected', async () => {
    const a = await give();
    const { entry } = await time.addTime(arun, a.id, { minutes: 10, on: '2026-11-02' }, T0);
    await tasks.updateTask(priya, a.id, { rev: (await raw(a.id)).rev, archived: true }, req);
    await refused(time.startTimer(arun, a.id, T0), 409, /archived/);
    await refused(time.addTime(arun, a.id, { minutes: 10, on: '2026-11-02' }, T0), 409, /archived/);
    const list = await time.listTime(arun, a.id, {}, T0);
    expect(list).toMatchObject({ can: { track: false }, total: { seconds: 600 } });
    expect((await time.editTime(arun, a.id, entry.id, { minutes: 20 }, T0)).entry.seconds).toBe(1200);
  });

  it('you change your own entries; the admin anyone’s; nobody else', async () => {
    const a = await give();
    const { entry } = await time.addTime(arun, a.id, { minutes: 10, on: '2026-11-02' }, T0);
    const asPriya = (await time.listTime(priya, a.id, {}, T0)).entries[0];
    expect(asPriya.can).toEqual({ edit: false, delete: false });
    await refused(time.editTime(priya, a.id, entry.id, { minutes: 5 }, T0), 403, /only your own/);
    await refused(time.deleteTime(priya, a.id, entry.id), 403);

    const edited = await time.editTime(admin, a.id, entry.id, { minutes: 45, on: '2026-11-01', note: 'Fixed by admin' }, T0);
    expect(edited.entry).toMatchObject({ seconds: 2700, day: '2026-11-01', note: 'Fixed by admin', edited: true });
    await refused(time.editTime(arun, a.id, entry.id, { minutes: 0 }, T0), 400);
    await refused(time.editTime(arun, a.id, entry.id, { on: '2026-11-09' }, T0), 400);
    // Nothing to change: the entry back as it is.
    expect((await time.editTime(arun, a.id, entry.id, {}, T0)).entry.seconds).toBe(2700);

    expect(await time.deleteTime(arun, a.id, entry.id)).toEqual({ id: entry.id });
    await refused(time.deleteTime(arun, a.id, entry.id), 404);
  });

  it('an entry is found only on its own task', async () => {
    const a = await give();
    const b = await give(arun, { title: 'Ring the courier' });
    const { entry } = await time.addTime(arun, a.id, { minutes: 10, on: '2026-11-02' }, T0);
    await refused(time.editTime(arun, b.id, entry.id, { minutes: 5 }, T0), 404);
    await refused(time.deleteTime(arun, b.id, entry.id), 404);
    await refused(time.editTime(arun, a.id, 'nope', { minutes: 5 }, T0), 404);
  });

  it('a running timer is stopped before it is corrected, but may be discarded', async () => {
    const a = await give();
    const { timer } = await time.startTimer(arun, a.id, T0);
    const listed = (await time.listTime(arun, a.id, {}, at(60000))).entries[0];
    expect(listed).toMatchObject({ running: true, seconds: 60, can: { edit: false, delete: true } });
    await refused(time.editTime(arun, a.id, timer.id, { minutes: 5 }, T0), 409, /Stop the timer first/);
    await time.deleteTime(arun, a.id, timer.id);
    expect((await time.currentTimer(arun, at(60000))).timer).toBeNull();
  });
});

describe('totals and pages', () => {
  it('adds up per person, counting a running timer up to now', async () => {
    const a = await give();
    await time.addTime(priya, a.id, { minutes: 60, on: '2026-11-02' }, T0);
    await time.addTime(arun, a.id, { minutes: 30, on: '2026-11-02' }, T0);
    await time.addTime(arun, a.id, { minutes: 30, on: '2026-11-01' }, T0);
    await time.startTimer(arun, a.id, T0);
    const { total } = await time.listTime(priya, a.id, {}, at(20 * 60000));
    expect(total).toEqual({
      seconds: 3600 + 3600 + 1200,
      people: [
        { id: String(arun._id), name: 'Arun', seconds: 4800 },
        { id: String(priya._id), name: 'Priya', seconds: 3600 },
      ],
    });
  });

  it('pages newest first, 30 at a time, with no row twice or missed', async () => {
    const a = await give();
    for (let i = 0; i < 35; i += 1) await time.addTime(arun, a.id, { minutes: i + 1, on: '2026-11-02' }, T0);
    const first = await time.listTime(arun, a.id, {}, T0);
    expect(first.entries).toHaveLength(30);
    expect(first.entries[0].seconds).toBe(35 * 60);
    const second = await time.listTime(arun, a.id, { cursor: first.nextCursor }, T0);
    expect(second.entries.map((e) => e.seconds)).toEqual([5, 4, 3, 2, 1].map((m) => m * 60));
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map((e) => e.id)).size).toBe(35);
    await refused(time.listTime(arun, a.id, { cursor: 'nope' }, T0), 400);
  });

  it('list rows carry their time, and time never changes the task or writes an Inbox line', async () => {
    const a = await give();
    const b = await give(arun, { title: 'Ring the courier' });
    await StaffTaskInbox.deleteMany({});
    const before = await raw(a.id);
    await time.addTime(priya, a.id, { minutes: 25, on: '2026-11-02' }, T0);
    await time.startTimer(arun, a.id, new Date(Date.now() - 60000));
    const rows = (await tasks.listTasks(arun, { view: 'mine' })).tasks;
    const rowA = rows.find((t) => t.id === a.id);
    expect(rowA.timeSeconds).toBeGreaterThanOrEqual(25 * 60 + 60);
    expect(rowA.timeSeconds).toBeLessThan(25 * 60 + 120);
    expect(rows.find((t) => t.id === b.id).timeSeconds).toBe(0);
    expect(rowA.can.time).toBe(true);
    const after = await raw(a.id);
    expect(after.rev).toBe(before.rev);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await StaffTaskInbox.countDocuments({})).toBe(0);
  });
});

describe('index use', () => {
  const chosen = (explain) => {
    const plan = JSON.stringify(explain.queryPlanner?.winningPlan ?? explain.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ?? explain);
    if (plan.includes('COLLSCAN')) return 'COLLSCAN';
    return (plan.match(/"indexName":"([^"]+)"/) || [])[1] || 'UNKNOWN';
  };

  it('the running timer, a task’s page, the totals and the retry check each read one index', async () => {
    const users = Array.from({ length: 20 }, () => new mongoose.Types.ObjectId());
    const taskIds = Array.from({ length: 50 }, () => new mongoose.Types.ObjectId());
    const docs = [];
    for (let i = 0; i < 2000; i += 1) {
      docs.push({
        user: users[i % 20], task: taskIds[i % 50], number: i, source: i % 2 ? 'timer' : 'manual',
        startedAt: T0, endedAt: T0, seconds: 60, day: '2026-11-02', ...(i % 2 ? {} : { clientId: `client-${i}` }),
      });
    }
    docs.push({ user: users[0], task: taskIds[0], number: 1, source: 'timer', startedAt: T0, day: '2026-11-02', running: true });
    await StaffTaskTime.insertMany(docs);

    const running = await StaffTaskTime.find({ user: users[0], running: true }).explain('executionStats');
    expect(chosen(running)).toBe('staff_task_time_running');
    expect(running.executionStats.totalDocsExamined).toBe(1);

    const page = await StaffTaskTime.find({ task: taskIds[3] }).sort({ _id: -1 }).limit(31).explain('executionStats');
    expect(chosen(page)).toBe('staff_task_time_task');
    expect(page.executionStats.totalKeysExamined).toBeLessThanOrEqual(31);

    const retry = await StaffTaskTime.find({ user: users[2], clientId: { $eq: 'client-2', $type: 'string' } }).explain('executionStats');
    expect(chosen(retry)).toBe('staff_task_time_client_id');
    expect(retry.executionStats.totalDocsExamined).toBe(1);

    const totals = await StaffTaskTime.aggregate([{ $match: { task: { $in: taskIds.slice(0, 5) } } }, { $group: { _id: '$task' } }])
      .explain('executionStats');
    expect(chosen(totals)).toBe('staff_task_time_task');
    expect((await staffTaskTimeRepository.totalsByTask(taskIds.slice(0, 2).map(String), T0)).map((r) => r.seconds).sort())
      .toEqual([40 * 60, 40 * 60]);
  });
});
