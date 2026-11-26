/**
 * Taking a task on (owner, 2026-11-24 — slice 3 of the deadline plan): whoever is
 * given a task by someone else either Accepts its date or says "I can't make this
 * date" with a reason and a date they can make, which whoever gave it approves.
 * services/staffTaskService.js acceptTask / askNewDate / decideNewDate.
 *
 * What must hold:
 *   - only people given it by someone else are asked; giving it to yourself,
 *     personal tasks and tasks given before this existed ask nothing
 *   - accepting lands once (rev); starting it yourself counts as accepting
 *   - "can't make this date" waits for approval, is not a miss and not one of the
 *     two early asks; approved, the date moves and they have accepted it; refused,
 *     they are asked again
 *   - adding someone later asks them; the others keep their answer
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushes = [];
const pushMock = {
  pushConfigured: () => true,
  publicKey: () => 'k',
  cleanSubscription: (x) => x,
  subscribe: async () => ({ subscribed: true }),
  unsubscribe: async () => ({ subscribed: false }),
  sendToUsers: async (recipients, message) => { pushes.push({ recipients, message }); return recipients.length; },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const tasks = await import('../services/staffTaskService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const DAY = 24 * 60 * 60 * 1000;
const day = (offset = 0) => tasks.todayIST(new Date(Date.now() + offset * DAY));
const settle = () => new Promise((r) => setTimeout(r, 30));
const status = (code, fn, message) => expect(fn()).rejects.toMatchObject({ statusCode: code, ...(message && { message: expect.stringMatching(message) }) });

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `tacc${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const make = (actor, over = {}) => tasks.createTask(actor, { title: 'Send quote to RK', dueOn: day(2), ...over }, req).then((r) => r.task);
const view = (actor, t) => tasks.getTask(actor, t.id);
const accept = (actor, t) => tasks.acceptTask(actor, t.id, { rev: t.rev }, req);
const cantMake = (actor, t, over = {}) => tasks.askNewDate(actor, t.id, { rev: t.rev, reason: 'more_work', note: 'On the Hilux job till Friday', dueOn: day(4), ...over }, req);
const decide = (actor, t, decision, over = {}) => tasks.decideNewDate(actor, t.id, { rev: t.rev, decision, ...over }, req);
const ids = (list) => list.map((p) => p.name);

let admin, arun, bala, chitra;
beforeAll(async () => { await StaffTask.init(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  bala = await person('staff', { team: 'procurement' }, 'Bala');
  chitra = await person('staff', { team: 'procurement' }, 'Chitra');
});
afterEach(async () => {
  await StaffTask.collection.deleteMany({});
  await StaffTaskInbox.deleteMany({});
  await User.deleteMany({});
});

describe('who is asked', () => {
  it('the person given it by someone else — and whoever gave it sees they have not yet', async () => {
    const t = await make(arun, { assigneeId: String(bala._id) });
    const mine = await view(bala, t);
    expect(mine).toMatchObject({ needsAccept: true });
    expect(mine.can.accept).toBe(true);
    const theirs = await view(arun, t);
    expect(theirs.needsAccept).toBe(false);
    expect(ids(theirs.notAccepted)).toEqual(['Bala']);
  });

  it('not when you give it to yourself, not a personal task, not a task given before this existed', async () => {
    const own = await make(bala, { assigneeId: String(bala._id) });
    expect((await view(bala, own)).needsAccept).toBe(false);
    expect((await view(bala, own)).notAccepted).toEqual([]);
    const personal = await make(bala, { personal: true });
    expect((await view(bala, personal)).needsAccept).toBe(false);
    const old = await make(arun, { assigneeId: String(bala._id) });
    await StaffTask.updateOne({ _id: old.id }, { $unset: { 'assignees.0.acceptedAt': 1 } });
    expect((await view(bala, old)).needsAccept).toBe(false);
    expect((await view(arun, old)).notAccepted).toEqual([]);
  });

  it('on a shared task, each person answers for themselves', async () => {
    const t = await make(arun, { assigneeIds: [String(bala._id), String(chitra._id)], shared: true });
    const after = await accept(bala, await view(bala, t));
    expect(after.needsAccept).toBe(false);
    expect(ids(after.notAccepted)).toEqual(['Chitra']);
    expect((await view(chitra, t)).needsAccept).toBe(true);
  });
});

describe('accepting', () => {
  it('lands once, and is in the history', async () => {
    const t = await make(arun, { assigneeId: String(bala._id) });
    const done = await accept(bala, t);
    expect(done).toMatchObject({ needsAccept: false, notAccepted: [] });
    expect(done.can.accept).toBe(false);
    expect(done.history.some((h) => h.action === 'accepted')).toBe(true);
    await status(409, () => accept(bala, t));
    await status(409, () => accept(bala, done), /nothing to accept/i);
    // Only the person given it.
    const other = await make(arun, { assigneeId: String(bala._id) });
    await status(409, () => accept(chitra, other));
  });

  it('starting it yourself counts as accepting', async () => {
    const t = await make(arun, { assigneeId: String(bala._id) });
    const started = await tasks.updateTask(bala, t.id, { rev: t.rev, status: 'in_progress' }, req);
    expect(started).toMatchObject({ needsAccept: false, notAccepted: [] });
    // Whoever gave it moving it does not answer for them.
    const u = await make(arun, { assigneeId: String(bala._id) });
    await tasks.updateTask(arun, u.id, { rev: u.rev, status: 'in_progress' }, req);
    expect((await view(bala, u)).needsAccept).toBe(true);
  });

  it('adding someone later asks them; the others keep their answer; adding yourself is accepted', async () => {
    const t = await make(arun, { assigneeId: String(bala._id) });
    const ok = await accept(bala, t);
    const more = await tasks.updateTask(arun, t.id, { rev: ok.rev, assigneeIds: [String(bala._id), String(chitra._id), String(arun._id)] }, req);
    expect(ids(more.notAccepted)).toEqual(['Chitra']);
    expect((await view(bala, t)).needsAccept).toBe(false);
  });
});

describe('"I can\'t make this date"', () => {
  it('waits for whoever gave it, who hears "can\'t make the date"', async () => {
    const t = await make(arun, { assigneeId: String(bala._id) });
    const asked = await cantMake(bala, t);
    await settle();
    expect(asked.lateRequest).toMatchObject({ status: 'pending', late: false, atStart: true, dueOn: day(4) });
    expect(asked).toMatchObject({ dueOn: day(2), needsAccept: true });
    expect(asked.can.accept).toBe(false);
    const line = await StaffTaskInbox.findOne({ user: arun._id, kind: 'late_requested' }).lean();
    expect(line.text).toMatch(/^Can’t make this date · Too much other work/);
    expect(pushes.find((p) => p.recipients[0].userId === String(arun._id)).message.title).toMatch(/Bala can’t make the date on T-\d+/);
  });

  it('approved: the date moves, they have accepted it, it is no miss and no early ask', async () => {
    const t = await make(arun, { assigneeId: String(bala._id) });
    const asked = await cantMake(bala, t);
    const ok = await decide(arun, asked, 'approve');
    expect(ok).toMatchObject({ dueOn: day(4), needsAccept: false, notAccepted: [], misses: 0 });
    const full = await view(arun, t);
    expect(full.dateMoves[0]).toMatchObject({ how: 'start', late: false });
    // Both early asks are still there.
    let cur = await view(bala, t);
    for (const d of [5, 6]) {
      cur = await cantMake(bala, cur, { dueOn: day(d) });
      cur = await decide(arun, cur, 'approve');
    }
    await status(400, () => cantMake(bala, cur, { dueOn: day(7) }), /2 times/);
  });

  it('refused: still theirs to accept, or to ask again', async () => {
    const t = await make(arun, { assigneeId: String(bala._id) });
    const asked = await cantMake(bala, t);
    const no = await decide(arun, asked, 'reject', { note: 'Needed by Thursday — hand the Hilux to Chitra' });
    const mine = await view(bala, t);
    expect(mine).toMatchObject({ dueOn: day(2), needsAccept: true });
    expect(mine.can.accept).toBe(true);
    expect(mine.can.askNewDate).toBe(true);
    expect((await accept(bala, mine)).needsAccept).toBe(false);
    expect(no.lateRequest.status).toBe('rejected');
  });
});
