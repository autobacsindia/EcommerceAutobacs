/**
 * Staff tasks: a new date for a late task (owner, 2026-11-24 — "everyone must
 * take approval if they didn't finish on time"). services/staffTaskService.js
 * askNewDate / decideNewDate. Mongo is real; push is a double.
 *
 * What must hold:
 *   - once the deadline has passed, the people doing it can't move it themselves
 *     (not even a head on their own task); they give a reason and a new date
 *   - whoever gave it approves (or a head of its team, or the admin) — never
 *     whoever asked; a decision lands once (rev)
 *   - every late move counts as a miss; two misses = danger; moving the date
 *     never wipes the record (dateMoves); asking early is not a miss, but is
 *     limited per task
 *   - a second miss also reaches the team head
 *   - the "Approve dates" list and its count show new dates to whoever decides
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
    name: name || `${role} ${n}`, email: `tnd${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const make = (actor, over = {}) => tasks.createTask(actor, { title: 'Send quote to RK', dueOn: day(1), ...over }, req).then((r) => r.task);
/** Make `t` late: its deadline moved to yesterday behind the service's back (time passing). */
const goLate = async (t) => {
  await StaffTask.updateOne({ _id: t.id }, { $set: { dueOn: day(-1), dueTime: null, rank: day(-1) } });
  return tasks.getTask(admin, t.id);
};
const ask = (actor, t, over = {}) => tasks.askNewDate(actor, t.id, { rev: t.rev, reason: 'more_work', note: 'Was on the Hilux delivery', dueOn: day(2), ...over }, req);
const decide = (actor, t, decision, over = {}) => tasks.decideNewDate(actor, t.id, { rev: t.rev, decision, ...over }, req);
const view = (actor, t) => tasks.getTask(actor, t.id);
const inbox = async (u, kind) => StaffTaskInbox.find({ user: u._id, kind }).lean();
const pushedTo = (u) => pushes.filter((p) => p.recipients.some((r) => r.userId === String(u._id)));

let admin, head, arun, bala, salesHead;
beforeAll(async () => { await StaffTask.init(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  bala = await person('staff', { team: 'procurement' }, 'Bala');
  salesHead = await person('staff', { team: 'sales', isHead: true }, 'Sana');
});

describe('a late task', () => {
  it('shows one miss and asks the person doing it for a reason', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const mine = await view(bala, t);
    expect(mine).toMatchObject({ overdue: true, misses: 1, danger: false, needsReason: true, lateRequest: null });
    expect(mine.can).toMatchObject({ askNewDate: true, decideNewDate: false });
    // Whoever gave it sees it late, but is not the one asked for a reason.
    expect((await view(arun, t)).needsReason).toBe(false);
  });

  it('can not be moved by the person doing it — not even a head on their own task', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    await status(403, () => tasks.updateTask(bala, t.id, { rev: t.rev, dueOn: day(3) }, req), /late/i);
    const own = await goLate(await make(admin, { assigneeId: String(head._id) }));
    await status(403, () => tasks.updateTask(head, own.id, { rev: own.rev, dueOn: day(3) }, req), /late/i);
  });

  it('is not late on its own day when it has no time', async () => {
    const t = await make(arun, { assigneeId: String(bala._id), dueOn: day(0) });
    expect((await view(bala, t)).overdue).toBe(false);
  });
});

describe('asking for a new date', () => {
  it('checks the reason, the note and the new date', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    await status(400, () => ask(bala, t, { reason: 'lazy' }), /reason/i);
    await status(400, () => ask(bala, t, { note: 'eh' }), /few words/i);
    await status(400, () => ask(bala, t, { dueOn: day(-1) }), /ahead/i);
    await status(400, () => ask(bala, t, { dueOn: day(-1), dueTime: null }), /ahead/i);
    // Only the people doing it ask.
    await status(403, () => ask(head, t), /people doing/i);
    await status(409, () => ask(bala, { ...t, rev: t.rev - 1 }));
  });

  it('waits for whoever gave it, who hears about it; a second ask is refused', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const asked = await ask(bala, t);
    await settle();
    expect(asked.lateRequest).toMatchObject({ status: 'pending', late: true, reason: 'more_work', dueOn: day(2), fromDue: day(-1) });
    // The date stays as it was until approved, and the task stays red — but the pop-up stops asking.
    expect(asked).toMatchObject({ dueOn: day(-1), overdue: true, needsReason: false });
    expect(asked.can.askNewDate).toBe(false);
    expect(await inbox(arun, 'late_requested')).toHaveLength(1);
    expect((await inbox(arun, 'late_requested'))[0].text).toMatch(/Too much other work: Was on the Hilux delivery/);
    expect(pushedTo(arun)).toHaveLength(1);
    // A first miss stays between the two of them.
    expect(await inbox(head, 'late_requested')).toHaveLength(0);
    await status(409, () => ask(bala, asked), /already waiting/i);
  });

  it('goes to the team head when whoever gave it asked it themselves', async () => {
    const t = await goLate(await make(bala, { assigneeId: String(bala._id) }));
    await ask(bala, t);
    expect(await inbox(head, 'late_requested')).toHaveLength(1);
  });
});

describe('deciding a new date', () => {
  it('only whoever gave it, a head of its team or the admin decides — never whoever asked', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const asked = await ask(bala, t);
    await status(403, () => decide(bala, asked, 'approve'), /someone else/i);
    await status(404, () => decide(salesHead, asked, 'approve'));
    expect((await view(head, asked)).can.decideNewDate).toBe(true);
    expect((await view(arun, asked)).can.decideNewDate).toBe(true);
  });

  it('approving moves the date, counts the miss and keeps the record', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const asked = await ask(bala, t);
    pushes.length = 0;
    const done = await decide(arun, asked, 'approve');
    await settle();
    expect(done).toMatchObject({ dueOn: day(2), overdue: false, misses: 1, danger: false });
    expect(done.lateRequest).toMatchObject({ status: 'approved', approvedDue: day(2), decidedBy: { name: 'Arun' } });
    expect(done.dateMoves).toEqual([expect.objectContaining({ fromDue: day(-1), toDue: day(2), late: true, how: 'request', reason: 'Too much other work' })]);
    expect(await inbox(bala, 'late_decided')).toHaveLength(1);
    expect(pushedTo(bala)).toHaveLength(1);
    // Decided once: a second click on the same rev changes nothing.
    await status(409, () => decide(arun, asked, 'approve'));
    expect((await StaffTask.findById(t.id).lean()).misses).toBe(1);
  });

  it('may give a different date than the one asked for', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const done = await decide(arun, await ask(bala, t, { dueOn: day(5) }), 'approve', { dueOn: day(1), dueTime: '17:00' });
    expect(done).toMatchObject({ dueOn: day(1), dueTime: '17:00' });
    expect(done.lateRequest.approvedDue).toBe(`${day(1)} 17:00`);
  });

  it('a refusal needs a note, keeps the date, and asks the person again', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const asked = await ask(bala, t);
    await status(400, () => decide(arun, asked, 'reject'), /why/i);
    const no = await decide(arun, asked, 'reject', { note: 'Needed today, call RK now' });
    expect(no).toMatchObject({ dueOn: day(-1), misses: 1 });
    expect(no.lateRequest).toMatchObject({ status: 'rejected', decisionNote: 'Needed today, call RK now' });
    const again = await view(bala, no);
    expect(again).toMatchObject({ needsReason: true });
    expect(again.can.askNewDate).toBe(true);
  });

  it('a far date needs a head or the admin, and is then approved for good', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const asked = await ask(bala, t, { dueOn: day(12) });
    await status(403, () => decide(arun, asked, 'approve'), /head or the admin/i);
    const done = await decide(head, asked, 'approve');
    expect(done.dueOn).toBe(day(12));
    expect(done.dueApproval).toMatchObject({ status: 'approved', dueOn: day(12) });
  });
});

describe('missing again', () => {
  it('a second miss is danger, and the team head hears about it', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const first = await decide(arun, await ask(bala, t), 'approve');
    const late2 = await goLate(first);
    const seen = await view(bala, late2);
    expect(seen).toMatchObject({ misses: 2, danger: true, needsReason: true });
    pushes.length = 0;
    await ask(bala, late2);
    await settle();
    expect(await inbox(head, 'late_requested')).toHaveLength(1);
    expect(pushedTo(head)[0].message.title).toMatch(/⚠/);
  });
});

describe('asking early', () => {
  it('is not a miss, and is allowed twice per task', async () => {
    let t = await make(arun, { assigneeId: String(bala._id), dueOn: day(1) });
    // Accepted first: before that, asking is "can't make this date" (staffTaskAccept.test.js).
    t = await tasks.acceptTask(bala, t.id, { rev: t.rev }, req);
    t = await decide(arun, await ask(bala, t, { dueOn: day(2) }), 'approve');
    expect(t).toMatchObject({ misses: 0, danger: false });
    expect(t.dateMoves[0]).toMatchObject({ late: false, how: 'request' });
    t = await decide(arun, await ask(bala, t, { dueOn: day(3) }), 'approve');
    await status(400, () => ask(bala, t, { dueOn: day(4) }), /2 times/);
  });
});

describe('whoever gave it changes the date themselves', () => {
  it('a late move still counts as a miss and answers an open ask', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    const asked = await ask(bala, t);
    const moved = await tasks.updateTask(arun, t.id, { rev: asked.rev, dueOn: day(3) }, req);
    expect(moved).toMatchObject({ dueOn: day(3), misses: 1, lateRequest: null });
    expect(moved.dateMoves[0]).toMatchObject({ late: true, how: 'edit' });
  });

  it('an early move is recorded, not counted', async () => {
    const t = await make(arun, { assigneeId: String(bala._id), dueOn: day(1) });
    const moved = await tasks.updateTask(arun, t.id, { rev: t.rev, dueOn: day(3) }, req);
    expect(moved).toMatchObject({ misses: 0 });
    expect(moved.dateMoves).toHaveLength(1);
  });
});

describe('the Approve dates list', () => {
  it('shows a new date to whoever decides it, and counts it', async () => {
    const t = await goLate(await make(arun, { assigneeId: String(bala._id) }));
    await ask(bala, t);
    const ids = async (u) => (await tasks.listTasks(u, { view: 'approvals' })).tasks.map((x) => x.id);
    expect(await ids(arun)).toEqual([t.id]);
    expect(await ids(head)).toEqual([t.id]);
    expect(await ids(admin)).toEqual([t.id]);
    expect(await ids(bala)).toEqual([]);
    expect(await ids(salesHead)).toEqual([]);
    expect((await tasks.summaryFor(arun)).approvals).toBe(1);
    expect((await tasks.summaryFor(bala)).approvals).toBe(0);
  });
});
