/**
 * Staff tasks: a time on the due day (services/staffTaskService.js). Mongo is
 * real; push is a double.
 *
 * What must hold:
 *   - a due time is 'HH:mm' (24-hour, IST), never without a due day; clearing
 *     the day clears the time, and a new day keeps the time
 *   - a timed task is late from its minute (not a minute before); an untimed
 *     one only from the next day — in the task itself, the "overdue" filter,
 *     the header counts (late + today never count one task twice) and the bell
 *   - within a day, untimed tasks sort first, then timed ones by time
 *   - only whoever may edit the task sets the time; an archived task refuses it
 *   - a bulk date change keeps each task's own time
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => true,
  publicKey: () => 'k',
  cleanSubscription: (x) => x,
  subscribe: async () => ({ subscribed: true }),
  unsubscribe: async () => ({ subscribed: false }),
  sendToUsers: async (recipients) => recipients.length,
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const tasks = await import('../services/staffTaskService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const DAY = 24 * 60 * 60 * 1000;
const day = (offset = 0) => tasks.todayIST(new Date(Date.now() + offset * DAY));

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `tdt${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const make = (actor, over = {}) => tasks.createTask(actor, { title: 'Call the supplier', ...over }, req).then((r) => r.task);
const status = (code, fn) => expect(fn()).rejects.toMatchObject({ statusCode: code });
const edit = (actor, t, patch) => tasks.updateTask(actor, t.id, { rev: t.rev, ...patch }, req);

/*
  The minute-sensitive tests use 00:00 (already past) and 23:59 (still to come)
  today. In the two minutes where that is not true they would be wrong, so they
  skip themselves there rather than flake.
*/
const midDay = () => { const now = tasks.timeIST(); return now > '00:00' && now < '23:59'; };

let head, member;
beforeAll(async () => { await StaffTask.init(); });
beforeEach(async () => {
  head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  member = await person('staff', { team: 'procurement' }, 'Arun');
});

describe('the time itself', () => {
  it('is kept with the day, and sorts the task inside its day', async () => {
    const t = await make(head, { assigneeId: String(member._id), dueOn: day(2), dueTime: '17:30' });
    expect(t).toMatchObject({ dueOn: day(2), dueTime: '17:30' });
    expect((await StaffTask.findById(t.id).lean()).rank).toBe(`${day(2)} 17:30`);
    expect((await make(head, { dueOn: day(2) })).dueTime).toBeNull();
  });

  it('refuses a time without a day, and anything but HH:mm', async () => {
    await status(400, () => make(head, { dueTime: '17:30' }));
    for (const bad of ['25:00', '5:30', '17:3', '17:30:00', '12:60', 'noon']) {
      await status(400, () => make(head, { dueOn: day(1), dueTime: bad }));
    }
  });

  it('a time alone can be set, changed and taken off; the history says so', async () => {
    let t = await make(head, { assigneeId: String(member._id), dueOn: day(3) });
    t = await edit(head, t, { dueTime: '09:15' });
    expect(t.dueTime).toBe('09:15');
    expect(t.history.find((h) => h.action === 'due')).toMatchObject({ action: 'due', from: day(3), to: `${day(3)} 09:15` });
    t = await edit(head, t, { dueTime: null });
    expect(t).toMatchObject({ dueOn: day(3), dueTime: null });
  });

  it('a new day keeps the time; no day means no time', async () => {
    let t = await make(head, { dueOn: day(1), dueTime: '11:00' });
    t = await edit(head, t, { dueOn: day(4) });
    expect(t).toMatchObject({ dueOn: day(4), dueTime: '11:00' });
    expect((await StaffTask.findById(t.id).lean()).rank).toBe(`${day(4)} 11:00`);
    t = await edit(head, t, { dueOn: null });
    expect(t).toMatchObject({ dueOn: null, dueTime: null });
    await status(400, () => edit(head, t, { dueTime: '10:00' }));
    await status(400, () => edit(head, t, { dueOn: null, dueTime: '10:00' }));
  });

  it('sending the same time again changes nothing (no new revision)', async () => {
    const t = await make(head, { dueOn: day(1), dueTime: '11:00' });
    expect((await edit(head, t, { dueOn: day(1), dueTime: '11:00' })).rev).toBe(t.rev);
  });

  it('only whoever may edit the task sets the time; an archived task refuses it', async () => {
    const t = await make(head, { assigneeId: String(member._id), dueOn: day(1) });
    await status(403, () => edit(member, t, { dueTime: '10:00' }));
    const gone = await edit(head, t, { archived: true });
    await status(409, () => edit(head, gone, { dueTime: '10:00' }));
  });
});

describe('late from the minute', () => {
  const at = (t, today, now) => tasks.shape(t, head, { today, now });
  const doc = (over) => ({ _id: '0123456789abcdef01234567', number: 1, title: 'x', status: 'todo', priority: 'normal', bucket: 'open', ...over });

  it('a timed task turns late at its minute, not before; an untimed one only the next day', () => {
    const today = '2026-11-04';
    expect(at(doc({ dueOn: today, dueTime: '17:30' }), today, '17:29').overdue).toBe(false);
    expect(at(doc({ dueOn: today, dueTime: '17:30' }), today, '17:30').overdue).toBe(true);
    expect(at(doc({ dueOn: today }), today, '23:59').overdue).toBe(false);
    expect(at(doc({ dueOn: '2026-11-03' }), today, '00:00').overdue).toBe(true);
    expect(at(doc({ dueOn: today, dueTime: '00:00', bucket: 'done', status: 'done' }), today, '12:00').overdue).toBe(false);
    // Still "due today", whichever: the screen shows late first.
    expect(at(doc({ dueOn: today, dueTime: '17:30' }), today, '18:00').dueToday).toBe(true);
  });

  it('the overdue filter, the header counts and the bell agree', async () => {
    if (!midDay()) return;
    const mine = { assigneeId: String(member._id) };
    const past = await make(head, { ...mine, title: 'past time today', dueOn: day(0), dueTime: '00:00' });
    const coming = await make(head, { ...mine, title: 'later today', dueOn: day(0), dueTime: '23:59' });
    const allDay = await make(head, { ...mine, title: 'today, no time', dueOn: day(0) });
    const yesterday = await make(head, { ...mine, title: 'yesterday', dueOn: day(-1) });
    await make(head, { ...mine, title: 'tomorrow', dueOn: day(1), dueTime: '00:00' });

    const titles = async (due) => (await tasks.listTasks(member, { view: 'mine', due })).tasks.map((t) => t.title);
    expect(await titles('overdue')).toEqual([yesterday.title, past.title]);
    // Untimed first, then by time.
    expect(await titles('today')).toEqual([allDay.title, past.title, coming.title]);
    expect(await titles('late')).toEqual([yesterday.title, allDay.title, past.title, coming.title]);

    const shown = (await tasks.listTasks(member, { view: 'mine', due: 'today' })).tasks;
    expect(shown.find((t) => t.title === past.title).overdue).toBe(true);
    expect(shown.find((t) => t.title === coming.title).overdue).toBe(false);

    expect(await tasks.summaryFor(member)).toMatchObject({ late: 2, today: 2 });
    expect(await tasks.countDueForBell(member)).toBe(4);
  });
});

describe('a bulk date change', () => {
  it('keeps each task its own time, and clearing the day clears it', async () => {
    const a = await make(head, { dueOn: day(1), dueTime: '09:00' });
    const b = await make(head, { dueOn: day(1) });
    await tasks.bulkUpdate(head, { items: [a, b].map((t) => ({ id: t.id, rev: t.rev })), changes: { dueOn: day(5) } }, req);
    const [a2, b2] = await Promise.all([tasks.getTask(head, a.id), tasks.getTask(head, b.id)]);
    expect(a2).toMatchObject({ dueOn: day(5), dueTime: '09:00' });
    expect(b2).toMatchObject({ dueOn: day(5), dueTime: null });
    await tasks.bulkUpdate(head, { items: [{ id: a2.id, rev: a2.rev }], changes: { dueOn: null } }, req);
    expect(await tasks.getTask(head, a.id)).toMatchObject({ dueOn: null, dueTime: null });
  });
});
