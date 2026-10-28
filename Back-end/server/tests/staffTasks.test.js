/**
 * Staff tasks (services/staffTaskService.js). Mongo is real; push is a double
 * that records what would have popped up.
 *
 * What must hold:
 *   - who gives to whom: admin → anyone; head → own team; member → only themselves
 *   - who sees: assignee, giver, head of the task's team, admin — nobody else
 *     (a hidden task is "not found", not "forbidden")
 *   - the assignee moves status but cannot rewrite the task; only the head or the
 *     admin reassigns
 *   - a double-click / retried create or comment lands once (clientId), even
 *     when both arrive at the same moment
 *   - two people editing at once: the second, stale edit is refused (409)
 *   - archive, never delete; an archived task takes no edits or comments
 *   - lists: sorted by due day (none last), keyset pages with no gaps or repeats,
 *     overdue / today filters; done newest-finished first
 *   - one pop-up to a new assignee, none to yourself, none on a duplicate; a
 *     failed pop-up never fails the task
 *   - the bell counts open tasks due by today (IST), and only for the assignee
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const pushes = [];
const push = { fail: false };
const pushMock = {
  pushConfigured: () => true,
  publicKey: () => 'k',
  cleanSubscription: (x) => x,
  subscribe: async () => ({ subscribed: true }),
  unsubscribe: async () => ({ subscribed: false }),
  sendToUsers: async (recipients, message) => {
    if (push.fail) throw new Error('push down');
    pushes.push({ recipients, message });
    return recipients.length;
  },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');
const tasks = await import('../services/staffTaskService.js');
const { summaryFor } = await import('../services/notificationService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const DAY = 24 * 60 * 60 * 1000;
const day = (offset = 0) => tasks.todayIST(new Date(Date.now() + offset * DAY));
const settle = () => new Promise((r) => setTimeout(r, 30)); // pop-ups are fire-and-forget

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `t${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};

const make = (actor, over = {}) => tasks.createTask(actor, { title: 'Call the supplier', ...over }, req).then((r) => r.task);
const status = (code, fn) => expect(fn()).rejects.toMatchObject({ statusCode: code });

let admin, procHead, procA, procB, salesHead, salesA, gone;
beforeAll(async () => { await StaffTask.init(); await StaffTaskComment.init(); });
beforeEach(async () => {
  pushes.length = 0;
  push.fail = false;
  admin = await person('admin', null, 'Owner');
  procHead = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  procA = await person('staff', { team: 'procurement' }, 'Arun');
  procB = await person('staff', { team: 'procurement' }, 'Bala');
  salesHead = await person('staff', { team: 'sales', isHead: true }, 'Hari');
  salesA = await person('staff', { team: 'sales' }, 'Sam');
  gone = await person('staff', { team: 'procurement', active: false }, 'Left');
});

describe('who gives tasks to whom', () => {
  it('the admin gives to anyone, including another team', async () => {
    const t = await make(admin, { assigneeId: String(salesA._id) });
    expect(t).toMatchObject({ assignee: { name: 'Sam' }, team: 'sales', teamLabel: 'GTM', createdBy: { name: 'Owner' }, status: 'todo', priority: 'normal' });
  });

  it('a head gives to people in their own team, never another team', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    expect(t.team).toBe('procurement');
    await status(403, () => make(procHead, { assigneeId: String(salesA._id) }));
  });

  it('a member adds tasks only for themselves', async () => {
    const own = await make(procA);
    expect(own.assignee.id).toBe(String(procA._id));
    await status(403, () => make(procA, { assigneeId: String(procB._id) }));
  });

  it('nobody can give a task to someone who has left', async () => {
    await status(400, () => make(admin, { assigneeId: String(gone._id) }));
    await status(400, () => make(admin, { assigneeId: String(new mongoose.Types.ObjectId()) }));
  });

  it('the picker lists exactly who you may give to', async () => {
    const names = async (u) => (await tasks.listAssignees(u)).map((p) => p.name).sort();
    expect(await names(procHead)).toEqual(['Arun', 'Bala', 'Priya']);
    expect(await names(procA)).toEqual(['Arun']);
    expect(await names(admin)).toEqual(expect.arrayContaining(['Owner', 'Priya', 'Arun', 'Bala', 'Hari', 'Sam']));
    expect(await names(admin)).not.toContain('Left');
  });

  it('numbers tasks T-1, T-2… and checks the input', async () => {
    const a = await make(procA);
    const b = await make(procA);
    expect(b.number).toBe(a.number + 1);
    expect(b.code).toBe(`T-${b.number}`);
    await status(400, () => make(procA, { title: '   ' }));
    await status(400, () => make(procA, { title: 'x'.repeat(201) }));
    await status(400, () => make(procA, { dueOn: '2026-02-30' }));
    await status(400, () => make(procA, { priority: 'asap' }));
    await status(400, () => make(procA, { description: 'x'.repeat(4001) }));
  });

  it('links an order by its invoice number, and refuses one that does not exist', async () => {
    const order = await Order.create({
      user: new mongoose.Types.ObjectId(), source: 'offline', wpId: 51234,
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Lift kit', price: 100, quantity: 1 }],
      shippingAddress: { fullName: 'Ravi', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 100, totalAmount: 100, status: 'processing', paymentStatus: 'paid',
    });
    const t = await make(procHead, { assigneeId: String(procA._id), orderId: String(order._id) });
    expect(t.order).toEqual({ id: String(order._id), code: '#51234' });
    await status(400, () => make(procHead, { orderId: String(new mongoose.Types.ObjectId()) }));
  });
});

describe('who sees a task', () => {
  it('the assignee, the giver, their team head and the admin — nobody else', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    for (const u of [procA, procHead, admin]) expect((await tasks.getTask(u, t.id)).id).toBe(t.id);
    // A teammate, another team's head, another team's member: "not found".
    for (const u of [procB, salesHead, salesA]) await status(404, () => tasks.getTask(u, t.id));
  });

  it('the admin\'s own tasks are seen by the admin only', async () => {
    const t = await make(admin);
    expect(t.team).toBeNull();
    expect(t.teamLabel).toBe('Admin');
    await status(404, () => tasks.getTask(procHead, t.id));
  });

  it('a malformed id is simply not found', async () => {
    await status(404, () => tasks.getTask(admin, 'nope'));
  });
});

describe('changing a task', () => {
  it('the assignee moves the status but cannot rewrite or reassign it', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    const moved = await tasks.updateTask(procA, t.id, { rev: t.rev, status: 'in_progress' }, req);
    expect(moved).toMatchObject({ status: 'in_progress', statusLabel: 'In progress', rev: t.rev + 1 });
    expect(moved.can).toMatchObject({ status: true, edit: false, reassign: false, archive: false });
    await status(403, () => tasks.updateTask(procA, t.id, { rev: moved.rev, title: 'Mine now' }, req));
    await status(403, () => tasks.updateTask(procA, t.id, { rev: moved.rev, assigneeId: String(procB._id) }, req));
  });

  it('done moves it to the done list, reopening brings it back by its due day', async () => {
    const t = await make(procA, { dueOn: day(2) });
    const done = await tasks.updateTask(procA, t.id, { rev: t.rev, status: 'done' }, req);
    expect(done.bucket).toBe('done');
    expect(done.completedAt).toBeTruthy();
    const back = await tasks.updateTask(procA, t.id, { rev: done.rev, status: 'todo' }, req);
    expect(back).toMatchObject({ bucket: 'open', completedAt: null });
    const row = await StaffTask.findById(t.id).lean();
    expect(row.rank).toBe(day(2));
  });

  it('the head reassigns within the team: the team follows the person, and they get a pop-up', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    await settle();
    pushes.length = 0;
    const r = await tasks.updateTask(procHead, t.id, { rev: t.rev, assigneeId: String(procB._id) }, req);
    expect(r.assignee.name).toBe('Bala');
    await settle();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].recipients).toEqual([{ userId: String(procB._id), url: `/team/tasks/${t.id}` }]);
    await status(403, () => tasks.updateTask(procHead, t.id, { rev: r.rev, assigneeId: String(salesA._id) }, req));
  });

  it('two people editing at once: the stale edit is refused, nothing is overwritten', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    const results = await Promise.allSettled([
      tasks.updateTask(procHead, t.id, { rev: t.rev, title: 'Head version' }, req),
      tasks.updateTask(admin, t.id, { rev: t.rev, title: 'Admin version' }, req),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.statusCode).toBe(409);
    const row = await StaffTask.findById(t.id).lean();
    expect(row.rev).toBe(t.rev + 1);
    // Later edits against the old rev keep being refused.
    await status(409, () => tasks.updateTask(procHead, t.id, { rev: t.rev, priority: 'high' }, req));
  });

  it('records who changed what, newest first', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    const a = await tasks.updateTask(procHead, t.id, { rev: t.rev, priority: 'urgent', dueOn: day(1) }, req);
    const b = await tasks.updateTask(procA, t.id, { rev: a.rev, status: 'waiting' }, req);
    expect(b.history.map((h) => [h.action, h.by])).toEqual([
      ['status', 'Arun'], ['due', 'Priya'], ['priority', 'Priya'], ['created', 'Priya'],
    ]);
    expect(b.history[2]).toMatchObject({ from: 'Normal', to: 'Urgent' });
  });

  it('an unchanged save is a no-op, not a new revision', async () => {
    const t = await make(procA, { priority: 'high' });
    const same = await tasks.updateTask(procA, t.id, { rev: t.rev, priority: 'high', title: t.title }, req);
    expect(same.rev).toBe(t.rev);
  });

  it('archive, never delete: no edits or comments until restored', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    await status(403, () => tasks.updateTask(procA, t.id, { rev: t.rev, archived: true }, req));
    const archived = await tasks.updateTask(procHead, t.id, { rev: t.rev, archived: true }, req);
    expect(archived).toMatchObject({ bucket: 'archived', can: { edit: false, comment: false, restore: true } });
    await status(409, () => tasks.updateTask(procHead, t.id, { rev: archived.rev, title: 'x' }, req));
    await status(409, () => tasks.addComment(procA, t.id, { text: 'hello' }));
    const restored = await tasks.updateTask(procHead, t.id, { rev: archived.rev, archived: false }, req);
    expect(restored.bucket).toBe('open');
    expect(await StaffTask.countDocuments({ _id: t.id })).toBe(1);
  });
});

describe('duplicates', () => {
  it('a double-clicked create makes one task and one pop-up', async () => {
    const input = { title: 'Pack order', assigneeId: String(procA._id), clientId: 'click-1234567' };
    const first = await tasks.createTask(procHead, input, req);
    const again = await tasks.createTask(procHead, input, req);
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ duplicate: true, task: { id: first.task.id } });
    await settle();
    expect(pushes).toHaveLength(1);
  });

  it('the same create arriving twice at the same moment still makes one', async () => {
    const input = { title: 'Pack order', clientId: 'race-12345678' };
    const both = await Promise.all([tasks.createTask(procA, input, req), tasks.createTask(procA, input, req)]);
    expect(new Set(both.map((r) => r.task.id)).size).toBe(1);
    expect(await StaffTask.countDocuments({ createdBy: procA._id })).toBe(1);
  });

  it('the same clientId from two different people is two tasks', async () => {
    await tasks.createTask(procA, { title: 'a', clientId: 'shared-12345' }, req);
    await tasks.createTask(procB, { title: 'b', clientId: 'shared-12345' }, req);
    expect(await StaffTask.countDocuments({ clientId: 'shared-12345' })).toBe(2);
  });
});

describe('pop-ups', () => {
  it('tell the new assignee, with a link to the task; never yourself', async () => {
    const t = await make(admin, { assigneeId: String(salesA._id), dueOn: day(1) });
    await make(procA);
    await settle();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].recipients).toEqual([{ userId: String(salesA._id), url: `/team/tasks/${t.id}` }]);
    expect(pushes[0].message).toMatchObject({ title: 'New task from Owner', tag: `task-${t.id}` });
    expect(pushes[0].message.body).toContain(`T-${t.number}`);
  });

  it('an admin assignee is sent to the admin panel', async () => {
    const other = await person('admin', null, 'Second admin');
    const t = await make(admin, { assigneeId: String(other._id) });
    await settle();
    expect(pushes[0].recipients[0].url).toBe(`/admin/tasks/${t.id}`);
  });

  it('a failed pop-up never fails the task', async () => {
    push.fail = true;
    const t = await make(procHead, { assigneeId: String(procA._id) });
    await settle();
    expect(await StaffTask.countDocuments({ _id: t.id })).toBe(1);
  });
});

describe('lists', () => {
  it('my tasks: by due day, undated last, with overdue / today flags and filters', async () => {
    const later = await make(procHead, { assigneeId: String(procA._id), title: 'later', dueOn: day(5) });
    const none = await make(procHead, { assigneeId: String(procA._id), title: 'none' });
    const late = await make(procHead, { assigneeId: String(procA._id), title: 'late', dueOn: day(-3) });
    const today = await make(procHead, { assigneeId: String(procA._id), title: 'today', dueOn: day(0) });
    await make(procHead, { assigneeId: String(procB._id), title: 'not mine', dueOn: day(-1) });

    const { tasks: mine } = await tasks.listTasks(procA, { view: 'mine' });
    expect(mine.map((t) => t.title)).toEqual(['late', 'today', 'later', 'none']);
    expect(mine.find((t) => t.id === late.id)).toMatchObject({ overdue: true, dueToday: false });
    expect(mine.find((t) => t.id === today.id)).toMatchObject({ overdue: false, dueToday: true });
    expect(mine.find((t) => t.id === later.id)).toMatchObject({ overdue: false, dueToday: false });
    expect(mine.find((t) => t.id === none.id).summary).toBe('');

    const titles = async (due) => (await tasks.listTasks(procA, { view: 'mine', due })).tasks.map((t) => t.title);
    expect(await titles('overdue')).toEqual(['late']);
    expect(await titles('today')).toEqual(['today']);
    expect(await titles('late')).toEqual(['late', 'today']);
  });

  it('team view: a head sees the team, a member is refused, the admin sees all and can narrow', async () => {
    await make(procHead, { assigneeId: String(procA._id), title: 'p1' });
    await make(procHead, { assigneeId: String(procB._id), title: 'p2' });
    await make(salesHead, { assigneeId: String(salesA._id), title: 's1' });
    const titles = async (u, opts) => (await tasks.listTasks(u, { view: 'team', ...opts })).tasks.map((t) => t.title).sort();
    expect(await titles(procHead)).toEqual(['p1', 'p2']);
    expect(await titles(procHead, { assignee: String(procB._id) })).toEqual(['p2']);
    expect(await titles(admin)).toEqual(['p1', 'p2', 's1']);
    expect(await titles(admin, { team: 'sales' })).toEqual(['s1']);
    await status(403, () => tasks.listTasks(procA, { view: 'team' }));
  });

  it('given by me lists what I handed out', async () => {
    await make(procHead, { assigneeId: String(procA._id), title: 'given' });
    await make(procA, { title: 'own' });
    expect((await tasks.listTasks(procHead, { view: 'created' })).tasks.map((t) => t.title)).toEqual(['given']);
  });

  it('pages through everything with no gaps and no repeats', async () => {
    const docs = Array.from({ length: 120 }, (_, i) => ({
      number: 100000 + i, title: `t${i}`, assignee: procA._id, assigneeName: 'Arun', team: 'procurement',
      createdBy: procHead._id, createdByName: 'Priya', status: 'todo', priority: 'normal',
      dueOn: i % 3 ? day(i % 7) : null, bucket: 'open', rank: i % 3 ? day(i % 7) : '9999-12-31',
    }));
    await StaffTask.insertMany(docs);
    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const page = await tasks.listTasks(procA, { view: 'mine', cursor });
      expect(page.tasks.length).toBeLessThanOrEqual(tasks.TASK_PAGE_SIZE);
      seen.push(...page.tasks);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen.map((t) => t.id)).size).toBe(120);
    const ranks = seen.map((t) => t.dueOn || '9999-12-31');
    expect(ranks).toEqual([...ranks].sort());
  });

  it('done is newest-finished first; archived has its own list', async () => {
    const a = await make(procA, { title: 'first done' });
    const b = await make(procA, { title: 'second done' });
    const c = await make(procA, { title: 'archived' });
    await tasks.updateTask(procA, a.id, { rev: a.rev, status: 'done' }, req);
    await new Promise((r) => setTimeout(r, 5));
    await tasks.updateTask(procA, b.id, { rev: b.rev, status: 'done' }, req);
    await tasks.updateTask(procA, c.id, { rev: c.rev, archived: true }, req);
    const titles = async (state) => (await tasks.listTasks(procA, { view: 'mine', state })).tasks.map((t) => t.title);
    expect(await titles('done')).toEqual(['second done', 'first done']);
    expect(await titles('archived')).toEqual(['archived']);
    expect(await titles('open')).toEqual([]);
  });

  it('rejects a forged cursor', async () => {
    await status(400, () => tasks.listTasks(procA, { view: 'mine', cursor: 'garbage' }));
  });
});

describe('comments', () => {
  it('everyone who sees the task can comment; the count follows; newest first', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    await tasks.addComment(procA, t.id, { text: 'Supplier says Friday' });
    await tasks.addComment(procHead, t.id, { text: 'OK' });
    await status(404, () => tasks.addComment(procB, t.id, { text: 'sneaky' }));
    await status(400, () => tasks.addComment(procA, t.id, { text: '  ' }));
    const { comments } = await tasks.listComments(procA, t.id);
    expect(comments.map((c) => [c.by.name, c.text])).toEqual([['Priya', 'OK'], ['Arun', 'Supplier says Friday']]);
    expect((await tasks.getTask(procA, t.id)).commentCount).toBe(2);
    await status(404, () => tasks.listComments(salesHead, t.id));
  });

  it('a comment does not block an edit made against the same revision', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id) });
    await tasks.addComment(procA, t.id, { text: 'note' });
    const r = await tasks.updateTask(procHead, t.id, { rev: t.rev, priority: 'high' }, req);
    expect(r.priority).toBe('high');
  });

  it('a double-sent comment posts once', async () => {
    const t = await make(procA);
    const one = await tasks.addComment(procA, t.id, { text: 'hi', clientId: 'cmt-1234567' });
    const two = await tasks.addComment(procA, t.id, { text: 'hi', clientId: 'cmt-1234567' });
    expect(two).toMatchObject({ duplicate: true, comment: { id: one.comment.id } });
    expect(await StaffTaskComment.countDocuments({ task: t.id })).toBe(1);
    expect((await tasks.getTask(procA, t.id)).commentCount).toBe(1);
  });

  it('pages older comments', async () => {
    const t = await make(procA);
    await StaffTaskComment.insertMany(Array.from({ length: 60 }, (_, i) => ({ task: t.id, by: procA._id, byName: 'Arun', text: `c${i}` })));
    const first = await tasks.listComments(procA, t.id);
    expect(first.comments).toHaveLength(tasks.COMMENT_PAGE_SIZE);
    const rest = await tasks.listComments(procA, t.id, { before: first.nextBefore });
    expect(rest.comments).toHaveLength(10);
    expect(rest.nextBefore).toBeNull();
    expect(new Set([...first.comments, ...rest.comments].map((c) => c.id)).size).toBe(60);
  });
});

describe('the bell', () => {
  it('counts my open tasks due today or overdue — not future, done, or someone else\'s', async () => {
    await make(procHead, { assigneeId: String(procA._id), dueOn: day(-2) });
    await make(procHead, { assigneeId: String(procA._id), dueOn: day(0) });
    await make(procHead, { assigneeId: String(procA._id), dueOn: day(3) });
    await make(procHead, { assigneeId: String(procA._id) });
    const done = await make(procHead, { assigneeId: String(procA._id), dueOn: day(-1) });
    await tasks.updateTask(procA, done.id, { rev: done.rev, status: 'done' }, req);
    await make(procHead, { assigneeId: String(procB._id), dueOn: day(-1) });

    const row = (await summaryFor(procA)).items.find((i) => i.key === 'tasks_due');
    expect(row).toEqual({ key: 'tasks_due', label: 'My tasks due or overdue', count: 2, href: '/team/tasks?due=late' });
    expect((await summaryFor(procHead)).items.find((i) => i.key === 'tasks_due')).toBeUndefined();
  });

  it('sends the admin to the admin panel', async () => {
    await make(admin, { dueOn: day(0) });
    expect((await summaryFor(admin)).items.find((i) => i.key === 'tasks_due').href).toBe('/admin/tasks?due=late');
  });
});

describe('one task for several people', () => {
  const ids = (...people) => people.map((p) => String(p._id));

  it('each person gets their own copy, numbered, in one group, and their own pop-up', async () => {
    const r = await tasks.createTask(admin, { title: 'Stock count', assigneeIds: ids(procA, salesA, admin), dueOn: day(1) }, req);
    expect(r.duplicate).toBe(false);
    expect(r.tasks.map((t) => t.assignee.name)).toEqual(['Arun', 'Sam', 'Owner']);
    expect(new Set(r.tasks.map((t) => t.number)).size).toBe(3);
    expect(new Set(r.tasks.map((t) => t.group.id)).size).toBe(1);
    expect(r.tasks.every((t) => t.group.size === 3)).toBe(true);
    expect(r.tasks.map((t) => t.team)).toEqual(['procurement', 'sales', null]);
    await settle();
    // Not to the admin's own copy.
    expect(pushes.map((p) => p.recipients[0].userId).sort()).toEqual(ids(procA, salesA).sort());
    // Each person's "for me" list has their own copy.
    expect((await tasks.listTasks(salesA, { view: 'mine' })).tasks.map((t) => t.title)).toEqual(['Stock count']);
  });

  it('a single person is still a plain task, with no group', async () => {
    const r = await tasks.createTask(procHead, { title: 'x', assigneeIds: ids(procA) }, req);
    expect(r.tasks).toHaveLength(1);
    expect(r.task.group).toBeNull();
  });

  it('a head picks several from their own team; one outsider and nothing is made', async () => {
    const ok = await tasks.createTask(procHead, { title: 'Pack', assigneeIds: ids(procA, procB) }, req);
    expect(ok.tasks).toHaveLength(2);
    await status(403, () => tasks.createTask(procHead, { title: 'Mixed', assigneeIds: ids(procA, salesA) }, req));
    await status(403, () => tasks.createTask(procA, { title: 'Me and Bala', assigneeIds: ids(procA, procB) }, req));
    await status(400, () => tasks.createTask(admin, { title: 'Gone', assigneeIds: ids(procA, gone) }, req));
    expect(await StaffTask.countDocuments({ title: { $in: ['Mixed', 'Me and Bala', 'Gone'] } })).toBe(0);
  });

  it('the same person picked twice gets one copy; more than the limit is refused', async () => {
    const r = await tasks.createTask(admin, { title: 'x', assigneeIds: [...ids(procA, procA), String(procB._id)] }, req);
    expect(r.tasks.map((t) => t.assignee.name)).toEqual(['Arun', 'Bala']);
    const many = Array.from({ length: tasks.MAX_ASSIGNEES + 1 }, () => String(new mongoose.Types.ObjectId()));
    await status(400, () => tasks.createTask(admin, { title: 'y', assigneeIds: many }, req));
  });

  it('a retried create makes no extra copies and no extra pop-ups', async () => {
    const input = { title: 'Audit', assigneeIds: ids(procA, procB), clientId: 'group-12345678' };
    const first = await tasks.createTask(procHead, input, req);
    await settle();
    const again = await tasks.createTask(procHead, input, req);
    await settle();
    expect(again.duplicate).toBe(true);
    expect(again.tasks.map((t) => t.id)).toEqual(first.tasks.map((t) => t.id));
    expect(await StaffTask.countDocuments({ title: 'Audit' })).toBe(2);
    expect(pushes).toHaveLength(2);
  });

  it('a retry after a half-finished create makes only the missing copy, in the same group', async () => {
    const input = { title: 'Half', assigneeIds: ids(procA, procB, procHead), clientId: 'half-12345678' };
    const first = await tasks.createTask(procHead, input, req);
    await StaffTask.deleteOne({ _id: first.tasks[1].id }); // as if the request died after the first copy
    const again = await tasks.createTask(procHead, input, req);
    expect(again.duplicate).toBe(false);
    const rows = await StaffTask.find({ title: 'Half' }).lean();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((t) => String(t.group))).size).toBe(1);
    expect(again.tasks[0].id).toBe(first.tasks[0].id);
  });

  it('the same several-people create twice at the same moment still makes one copy each', async () => {
    const input = { title: 'Race', assigneeIds: ids(procA, procB), clientId: 'race-group-1234' };
    await Promise.all([tasks.createTask(procHead, input, req), tasks.createTask(procHead, input, req)]);
    expect(await StaffTask.countDocuments({ title: 'Race' })).toBe(2);
  });

  it('the task page shows the other copies — to whoever may see them', async () => {
    const r = await tasks.createTask(admin, { title: 'Count', assigneeIds: ids(procA, procB, salesA) }, req);
    const [a, b] = r.tasks;
    await tasks.updateTask(procB, b.id, { rev: b.rev, status: 'done' }, req);

    const forAdmin = await tasks.getTask(admin, a.id);
    expect(forAdmin.siblings.map((s) => [s.assignee.name, s.statusLabel])).toEqual([['Bala', 'Done'], ['Sam', 'To do']]);
    // The procurement head sees their team's copies, not GTM's.
    expect((await tasks.getTask(procHead, a.id)).siblings.map((s) => s.assignee.name)).toEqual(['Bala']);
    // An assignee sees no one else's copy.
    expect((await tasks.getTask(procA, a.id)).siblings).toEqual([]);
    // A plain task has none.
    expect((await tasks.getTask(procA, (await make(procA)).id)).siblings).toEqual([]);
  });

  it('the picker lists you first, then team heads, then everyone else by name', async () => {
    const people = await tasks.listAssignees(admin);
    expect(people.slice(0, 3).map((p) => [p.name, p.isHead])).toEqual([['Owner', false], ['Hari', true], ['Priya', true]]);
    const rest = people.slice(3).map((p) => p.name);
    expect(rest).toEqual([...rest].sort((x, y) => x.localeCompare(y)));
  });
});

describe('checklists', () => {
  const steps = (t) => t.checklistItems.map((c) => [c.text, c.done]);

  it('steps typed at creation go on every copy, blanks dropped; cards show "x of y"', async () => {
    const r = await tasks.createTask(procHead, {
      title: 'Ship order', assigneeIds: [String(procA._id), String(procB._id)], checklist: ['Pack', '  ', 'Label', 'Book courier'],
    }, req);
    for (const t of r.tasks) expect(steps(t)).toEqual([['Pack', false], ['Label', false], ['Book courier', false]]);
    const row = (await tasks.listTasks(procA, { view: 'mine' })).tasks[0];
    expect(row.checklist).toEqual({ done: 0, total: 3 });
    expect(row.checklistItems).toBeUndefined();
    await status(400, () => tasks.createTask(procA, { title: 'x', checklist: Array.from({ length: 31 }, (_, i) => `s${i}`) }, req));
    await status(400, () => tasks.createTask(procA, { title: 'x', checklist: 'Pack' }, req));
  });

  it('the doer ticks steps; only the giver, head or admin adds, renames or removes them', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id), checklist: ['Pack', 'Label'] });
    const [pack, label] = t.checklistItems;
    const ticked = await tasks.updateChecklistItem(procA, t.id, pack.id, { done: true });
    expect(ticked.checklistItems[0]).toMatchObject({ done: true, doneBy: 'Arun' });
    expect(ticked.checklist).toEqual({ done: 1, total: 2 });
    // Ticking is not finishing: the task stays open.
    expect(ticked.status).toBe('todo');
    await status(403, () => tasks.addChecklistItem(procA, t.id, { text: 'More' }));
    await status(403, () => tasks.updateChecklistItem(procA, t.id, label.id, { text: 'Renamed' }));
    await status(403, () => tasks.removeChecklistItem(procA, t.id, label.id));
    await status(404, () => tasks.updateChecklistItem(procB, t.id, label.id, { done: true }));

    const added = await tasks.addChecklistItem(procHead, t.id, { text: 'Book courier' });
    const renamed = await tasks.updateChecklistItem(procHead, t.id, label.id, { text: 'Print label' });
    expect(steps(renamed)).toEqual([['Pack', true], ['Print label', false], ['Book courier', false]]);
    const removed = await tasks.removeChecklistItem(admin, t.id, added.checklistItems[2].id);
    expect(steps(removed)).toEqual([['Pack', true], ['Print label', false]]);
    expect(removed.history.slice(0, 4).map((h) => h.action)).toEqual(['check_removed', 'check_renamed', 'check_added', 'checked']);
  });

  it('a step does not bump the revision, so it never makes an open edit stale', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id), checklist: ['Pack'] });
    await tasks.updateChecklistItem(procA, t.id, t.checklistItems[0].id, { done: true });
    await tasks.addChecklistItem(procHead, t.id, { text: 'Label' });
    const edited = await tasks.updateTask(procHead, t.id, { rev: t.rev, priority: 'urgent' }, req);
    expect(edited.priority).toBe('urgent');
  });

  it('a double-clicked add lands once, even at the same moment; a double remove is harmless', async () => {
    const t = await make(procA);
    await tasks.addChecklistItem(procA, t.id, { text: 'Pack', clientId: 'step-12345678' });
    await tasks.addChecklistItem(procA, t.id, { text: 'Pack', clientId: 'step-12345678' });
    await Promise.all([
      tasks.addChecklistItem(procA, t.id, { text: 'Label', clientId: 'step-abcdefgh' }),
      tasks.addChecklistItem(procA, t.id, { text: 'Label', clientId: 'step-abcdefgh' }),
    ]);
    const now = await tasks.getTask(procA, t.id);
    expect(steps(now)).toEqual([['Pack', false], ['Label', false]]);
    const id = now.checklistItems[0].id;
    await Promise.all([tasks.removeChecklistItem(procA, t.id, id), tasks.removeChecklistItem(procA, t.id, id)]);
    expect(steps(await tasks.getTask(procA, t.id))).toEqual([['Label', false]]);
  });

  it('two people ticking different steps at once both land', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id), checklist: ['A', 'B'] });
    await Promise.all([
      tasks.updateChecklistItem(procA, t.id, t.checklistItems[0].id, { done: true }),
      tasks.updateChecklistItem(procHead, t.id, t.checklistItems[1].id, { done: true }),
    ]);
    expect((await tasks.getTask(procA, t.id)).checklist).toEqual({ done: 2, total: 2 });
  });

  it('stops at the limit, refuses blanks, and leaves archived tasks alone', async () => {
    const t = await make(procA, { checklist: Array.from({ length: tasks.CHECKLIST_MAX }, (_, i) => `s${i}`) });
    await status(400, () => tasks.addChecklistItem(procA, t.id, { text: 'one too many' }));
    await status(400, () => tasks.addChecklistItem(procA, t.id, { text: '   ' }));
    await status(404, () => tasks.updateChecklistItem(procA, t.id, String(new mongoose.Types.ObjectId()), { done: true }));
    const archived = await tasks.updateTask(procA, t.id, { rev: t.rev, archived: true }, req);
    expect(archived.can.checklist).toBe(false);
    await status(409, () => tasks.updateChecklistItem(procA, t.id, t.checklistItems[0].id, { done: true }));
    await status(409, () => tasks.removeChecklistItem(procA, t.id, t.checklistItems[0].id));
  });
});

describe('list rows (what the database sends for a page)', () => {
  it('carry checklist counts, not the steps — and every field the task page has', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id), checklist: ['Pack', 'Label', 'Ship'], orderId: undefined });
    await tasks.updateChecklistItem(procA, t.id, t.checklistItems[0].id, { done: true });
    const raw = (await StaffTask.db.collection('stafftasks').findOne({ _id: new mongoose.Types.ObjectId(t.id) }));
    expect(raw.checklist).toHaveLength(3);
    const row = (await tasks.listTasks(procA, { view: 'mine' })).tasks[0];
    expect(row.checklist).toEqual({ done: 1, total: 3 });
    // A field missing from LIST_PROJECTION would show up here as a difference.
    const full = await tasks.getTask(procA, t.id);
    const listOnly = ['summary'];
    const pageOnly = ['description', 'checklistItems', 'history', 'siblings'];
    for (const key of Object.keys(full).filter((k) => !pageOnly.includes(k))) expect(row[key]).toEqual(full[key]);
    expect(Object.keys(row).filter((k) => !listOnly.includes(k)).sort())
      .toEqual(Object.keys(full).filter((k) => !pageOnly.includes(k)).sort());
  });
});

describe('search, filters, counters and quick add', () => {
  it('searches title words or a T-number — only inside the list being shown', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id), title: 'Call Bosch about the lift kit' });
    await make(procHead, { assigneeId: String(procA._id), title: 'Pack order' });
    await make(procHead, { assigneeId: String(procB._id), title: 'Call Bosch too' });
    const titles = async (u, opts) => (await tasks.listTasks(u, { view: 'mine', ...opts })).tasks.map((t) => t.title);
    expect(await titles(procA, { q: 'bosch' })).toEqual(['Call Bosch about the lift kit']);
    expect(await titles(procA, { q: `T-${a.number}` })).toEqual(['Call Bosch about the lift kit']);
    expect(await titles(procA, { q: String(a.number) })).toEqual(['Call Bosch about the lift kit']);
    // Regex characters are matched literally, never as a pattern.
    expect(await titles(procA, { q: '.*' })).toEqual([]);
    expect(await titles(procA, { q: '(' })).toEqual([]);
    // The head searching the team finds both people's.
    expect((await titles(procHead, { view: 'team', q: 'Bosch' })).sort()).toEqual(['Call Bosch about the lift kit', 'Call Bosch too']);
  });

  it('filters by priority and by "this week"', async () => {
    await make(procA, { title: 'urgent soon', priority: 'urgent', dueOn: day(2) });
    await make(procA, { title: 'normal soon', dueOn: day(6) });
    await make(procA, { title: 'later', dueOn: day(8) });
    await make(procA, { title: 'late', dueOn: day(-1) });
    const titles = async (opts) => (await tasks.listTasks(procA, { view: 'mine', ...opts })).tasks.map((t) => t.title);
    expect(await titles({ priority: 'urgent' })).toEqual(['urgent soon']);
    expect(await titles({ due: 'week' })).toEqual(['urgent soon', 'normal soon']);
    await status(400, () => tasks.listTasks(procA, { view: 'mine', priority: 'asap' }));
  });

  it('counts my late and due-today tasks for the header', async () => {
    await make(procHead, { assigneeId: String(procA._id), dueOn: day(-2) });
    await make(procHead, { assigneeId: String(procA._id), dueOn: day(-1) });
    await make(procHead, { assigneeId: String(procA._id), dueOn: day(0) });
    await make(procHead, { assigneeId: String(procA._id), dueOn: day(3) });
    await make(procHead, { assigneeId: String(procB._id), dueOn: day(-1) });
    expect(await tasks.summaryFor(procA)).toEqual({ late: 2, today: 1 });
    expect(await tasks.summaryFor(salesA)).toEqual({ late: 0, today: 0 });
  });

  it('"+ Add task" in a status group starts the task there — never in Done', async () => {
    const t = await make(procA, { title: 'Quick', status: 'in_progress' });
    expect(t).toMatchObject({ status: 'in_progress', bucket: 'open' });
    await status(400, () => make(procA, { title: 'x', status: 'done' }));
  });
});
