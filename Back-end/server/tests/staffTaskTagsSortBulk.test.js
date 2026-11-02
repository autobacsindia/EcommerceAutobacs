/**
 * Staff tasks: tags, start dates, list order and bulk changes
 * (services/staffTaskService.js). Mongo is real; push is a double.
 *
 * What must hold:
 *   - tags are one word whoever typed them (lower-case, no '#', single spaces),
 *     each once, at most TAGS_MAX, and only whoever may edit the task sets them
 *   - a start date is never after the due date — on create, on edit, and when a
 *     bulk change moves the due date
 *   - "newest" and "recently changed" page with no gaps or repeats and keep the
 *     filters (the shared keyset paging itself is tests/taskListSort.test.js)
 *   - a bulk change applies the task's own rules to each task: one refusal never
 *     stops the others, a malformed change touches nothing, and a retried bulk
 *     change is "unchanged", not a conflict — and sends no second pop-up
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
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');
const tasks = await import('../services/staffTaskService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const DAY = 24 * 60 * 60 * 1000;
const day = (offset = 0) => tasks.todayIST(new Date(Date.now() + offset * DAY));
const settle = () => new Promise((r) => setTimeout(r, 30));

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `tsb${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const make = (actor, over = {}) => tasks.createTask(actor, { title: 'Call the supplier', ...over }, req).then((r) => r.task);
const status = (code, fn) => expect(fn()).rejects.toMatchObject({ statusCode: code });
const reload = (actor, t) => tasks.getTask(actor, t.id);

let admin, procHead, procA, procB, salesA;
beforeAll(async () => { await StaffTask.init(); await StaffTaskComment.init(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  procHead = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  procA = await person('staff', { team: 'procurement' }, 'Arun');
  procB = await person('staff', { team: 'procurement' }, 'Bala');
  salesA = await person('staff', { team: 'sales' }, 'Sam');
});

describe('tags', () => {
  it('are cleaned on create: lower-case, no #, single spaces, each once', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id), tags: ['Supplier', ' #supplier', '  Kochi   Warehouse ', 'URGENT', '## diwali'] });
    expect(t.tags).toEqual(['supplier', 'kochi warehouse', 'urgent', 'diwali']);
    expect((await make(procA)).tags).toEqual([]);
  });

  it('refuses blanks, long tags, too many, and a non-list', async () => {
    await status(400, () => make(procA, { tags: ['  '] }));
    await status(400, () => make(procA, { tags: ['#'] }));
    await status(400, () => make(procA, { tags: ['x'.repeat(tasks.TAG_MAX + 1)] }));
    await status(400, () => make(procA, { tags: Array.from({ length: tasks.TAGS_MAX + 1 }, (_, i) => `t${i}`) }));
    await status(400, () => make(procA, { tags: 'supplier' }));
    // Ten different spellings of one word are one tag, so they fit.
    const t = await make(procA, { tags: Array.from({ length: 11 }, (_, i) => (i % 2 ? 'Same' : 'same')) });
    expect(t.tags).toEqual(['same']);
  });

  it('only whoever may edit sets them; the change is in the history; the same set is a no-op', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id), tags: ['supplier'] });
    await status(403, () => tasks.updateTask(procA, t.id, { rev: t.rev, tags: ['mine'] }, req));
    const same = await tasks.updateTask(procHead, t.id, { rev: t.rev, tags: ['Supplier'] }, req);
    expect(same.rev).toBe(t.rev);
    const next = await tasks.updateTask(procHead, t.id, { rev: t.rev, tags: ['supplier', 'diwali'] }, req);
    expect(next.tags).toEqual(['supplier', 'diwali']);
    expect(next.history[0]).toMatchObject({ action: 'tags', from: 'supplier', to: 'supplier, diwali', by: 'Priya' });
    const cleared = await tasks.updateTask(procHead, t.id, { rev: next.rev, tags: [] }, req);
    expect(cleared.tags).toEqual([]);
  });

  it('filter a list, whatever the case typed — only inside that list', async () => {
    await make(procHead, { assigneeId: String(procA._id), title: 'A', tags: ['supplier'] });
    await make(procHead, { assigneeId: String(procA._id), title: 'B', tags: ['diwali'] });
    await make(procHead, { assigneeId: String(procB._id), title: 'C', tags: ['supplier'] });
    await make(salesA, { title: 'D', tags: ['supplier'] });
    const titles = async (u, opts) => (await tasks.listTasks(u, opts)).tasks.map((t) => t.title).sort();
    expect(await titles(procA, { view: 'mine', tag: 'Supplier' })).toEqual(['A']);
    expect(await titles(procHead, { view: 'team', tag: '#supplier' })).toEqual(['A', 'C']);
    expect(await titles(admin, { view: 'team', tag: 'supplier' })).toEqual(['A', 'C', 'D']);
    expect(await titles(procA, { view: 'mine', tag: 'nothing' })).toEqual([]);
  });
});

describe('start dates', () => {
  it('may be the due day or before it, never after; a bad day is refused', async () => {
    expect(await make(procA, { startOn: day(1), dueOn: day(3) })).toMatchObject({ startOn: day(1), dueOn: day(3) });
    expect(await make(procA, { startOn: day(3), dueOn: day(3) })).toMatchObject({ startOn: day(3) });
    expect(await make(procA, { startOn: day(3) })).toMatchObject({ startOn: day(3), dueOn: null });
    await status(400, () => make(procA, { startOn: day(4), dueOn: day(3) }));
    await status(400, () => make(procA, { startOn: '2026-02-30' }));
  });

  it('a month that does not exist is refused, not rolled into next year (regression)', async () => {
    await status(400, () => make(procA, { dueOn: '2026-13-01' }));
    await status(400, () => make(procA, { startOn: '2026-00-10' }));
    const t = await make(procA);
    await status(400, () => tasks.updateTask(procA, t.id, { rev: t.rev, dueOn: '2027-14-02' }, req));
  });

  it('an edit that would put the due day before the start is refused; clearing the start is fine', async () => {
    const t = await make(procHead, { assigneeId: String(procA._id), startOn: day(2), dueOn: day(5) });
    await status(400, () => tasks.updateTask(procHead, t.id, { rev: t.rev, dueOn: day(1) }, req));
    await status(400, () => tasks.updateTask(procHead, t.id, { rev: t.rev, startOn: day(6) }, req));
    // Both moved together, in a valid order, is fine.
    const both = await tasks.updateTask(procHead, t.id, { rev: t.rev, startOn: day(7), dueOn: day(8) }, req);
    expect(both).toMatchObject({ startOn: day(7), dueOn: day(8) });
    expect(both.history.map((h) => h.action).slice(0, 2).sort()).toEqual(['due', 'start']);
    const cleared = await tasks.updateTask(procHead, both.id, { rev: both.rev, startOn: null, dueOn: day(1) }, req);
    expect(cleared).toMatchObject({ startOn: null, dueOn: day(1) });
    // The doer cannot move the dates.
    await status(403, () => tasks.updateTask(procA, t.id, { rev: cleared.rev, startOn: day(0) }, req));
  });
});

describe('list order', () => {
  const seed = (count) => StaffTask.insertMany(Array.from({ length: count }, (_, i) => ({
    number: 200000 + i, title: `t${i}`, assignee: procA._id, assigneeName: 'Arun', team: 'procurement',
    assignees: [{ user: procA._id, name: 'Arun' }], teams: ['procurement'],
    createdBy: procHead._id, createdByName: 'Priya', status: 'todo', priority: 'normal',
    dueOn: day(i % 5), bucket: 'open', rank: day(i % 5),
    // Several tasks share a createdAt / updatedAt, so the _id tie-break is exercised.
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, Math.floor(i / 3))),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 4))),
  })), { timestamps: false });

  const all = async (actor, opts) => {
    const seen = [];
    let cursor;
    do {
      const page = await tasks.listTasks(actor, { view: 'mine', ...opts, cursor });
      seen.push(...page.tasks);
      cursor = page.nextCursor;
    } while (cursor);
    return seen;
  };

  it('newest first: every task once, by creation, across pages', async () => {
    await seed(120);
    const seen = await all(procA, { sort: 'newest' });
    expect(new Set(seen.map((t) => t.id)).size).toBe(120);
    const keys = seen.map((t) => `${new Date(t.createdAt).toISOString()}|${t.id}`);
    expect(keys).toEqual([...keys].sort().reverse());
  });

  it('recently changed first: every task once, ties broken by id, across pages', async () => {
    await seed(120);
    const seen = await all(procA, { sort: 'updated' });
    expect(new Set(seen.map((t) => t.id)).size).toBe(120);
    const keys = seen.map((t) => `${new Date(t.updatedAt).toISOString()}|${t.id}`);
    expect(keys).toEqual([...keys].sort().reverse());
  });

  it('a task just edited comes first in "recently changed"', async () => {
    const a = await make(procA, { title: 'old' });
    await make(procA, { title: 'new' });
    await new Promise((r) => setTimeout(r, 5));
    await tasks.updateTask(procA, a.id, { rev: a.rev, status: 'in_progress' }, req);
    expect((await tasks.listTasks(procA, { view: 'mine', sort: 'updated' })).tasks.map((t) => t.title)).toEqual(['old', 'new']);
    expect((await tasks.listTasks(procA, { view: 'mine', sort: 'newest' })).tasks.map((t) => t.title)).toEqual(['new', 'old']);
  });

  it('keeps the date filter in any order', async () => {
    await make(procA, { title: 'late', dueOn: day(-1) });
    await make(procA, { title: 'later', dueOn: day(9) });
    expect((await tasks.listTasks(procA, { view: 'mine', sort: 'newest', due: 'overdue' })).tasks.map((t) => t.title)).toEqual(['late']);
  });

  it('an unknown order reads as due day, so an old link still opens', async () => {
    await seed(60);
    const due = await tasks.listTasks(procA, { view: 'mine' });
    const odd = await tasks.listTasks(procA, { view: 'mine', sort: 'priority' });
    expect(odd.tasks.map((t) => t.id)).toEqual(due.tasks.map((t) => t.id));
    // A due-day cursor from before there was a choice of order still works.
    const legacy = Buffer.from(JSON.stringify({ r: due.tasks.at(-1).dueOn, i: due.tasks.at(-1).id })).toString('base64url');
    expect((await tasks.listTasks(procA, { view: 'mine', cursor: legacy })).tasks).toHaveLength(10);
  });
});

describe('bulk changes', () => {
  const items = (...ts) => ts.map((t) => ({ id: t.id, rev: t.rev }));
  const bulk = (actor, ts, changes) => tasks.bulkUpdate(actor, { items: items(...ts), changes }, req);

  it('a head moves several team tasks at once; each records it', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id) });
    const b = await make(procHead, { assigneeId: String(procB._id) });
    const c = await make(procA, { title: 'Arun’s own' });
    const res = await bulk(procHead, [a, b, c], { status: 'in_progress' });
    expect(res).toMatchObject({ changed: 3, unchanged: 0, failed: 0 });
    for (const t of [a, b, c]) {
      const now = await reload(procHead, t);
      expect(now.status).toBe('in_progress');
      expect(now.history[0]).toMatchObject({ action: 'status', by: 'Priya', to: 'In progress' });
    }
  });

  it('one refusal never stops the others, and each says why', async () => {
    const given = await make(procA, { assigneeId: String(procB._id), title: 'Arun gave this' });
    const doing = await make(procHead, { assigneeId: String(procA._id), title: 'Arun does this' });
    const hidden = await make(salesA, { title: 'Sales only' });
    const archived = await make(procA, { title: 'archived' });
    const gone = await tasks.updateTask(procA, archived.id, { rev: archived.rev, archived: true }, req);
    const res = await tasks.bulkUpdate(procA, { items: [...items(given, doing, hidden), { id: gone.id, rev: gone.rev }], changes: { priority: 'urgent' } }, req);
    expect(res).toMatchObject({ changed: 1, failed: 3 });
    const by = Object.fromEntries(res.results.map((r) => [r.id, r]));
    expect(by[given.id]).toMatchObject({ ok: true, changed: true });
    expect(by[doing.id]).toMatchObject({ ok: false, status: 403 });
    expect(by[hidden.id]).toMatchObject({ ok: false, status: 404 });
    expect(by[gone.id]).toMatchObject({ ok: false, status: 409 });
    expect((await reload(procHead, doing)).priority).toBe('normal');
  });

  it('a task changed by someone else meanwhile is refused; the rest still change', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id) });
    const b = await make(procHead, { assigneeId: String(procA._id) });
    await tasks.updateTask(procA, a.id, { rev: a.rev, status: 'waiting' }, req);
    const res = await bulk(procHead, [a, b], { priority: 'high' });
    expect(res.results.find((r) => r.id === a.id)).toMatchObject({ ok: false, status: 409 });
    expect(res.results.find((r) => r.id === b.id)).toMatchObject({ ok: true, changed: true });
    expect((await reload(procHead, a)).priority).toBe('normal');
  });

  it('a retried bulk change is "unchanged", not a conflict, and sends no second pop-up', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id) });
    const b = await make(procHead, { assigneeId: String(procA._id) });
    await settle();
    pushes.length = 0;
    const first = await bulk(procHead, [a, b], { assigneeId: String(procB._id) });
    expect(first).toMatchObject({ changed: 2, failed: 0 });
    await settle();
    expect(pushes).toHaveLength(2);
    expect(pushes.every((p) => p.recipients[0].userId === String(procB._id))).toBe(true);
    const again = await bulk(procHead, [a, b], { assigneeId: String(procB._id) });
    expect(again).toMatchObject({ changed: 0, unchanged: 2, failed: 0 });
    await settle();
    expect(pushes).toHaveLength(2);
    expect((await reload(procHead, a)).history.filter((h) => h.action === 'assignee')).toHaveLength(1);
  });

  it('adds and removes tags, keeping each task’s others; over the limit fails that task only', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id), tags: ['kochi', 'old'] });
    const full = await make(procHead, { assigneeId: String(procA._id), tags: Array.from({ length: tasks.TAGS_MAX }, (_, i) => `t${i}`) });
    const res = await bulk(procHead, [a, full], { addTags: ['Supplier'], removeTags: ['old'] });
    expect((await reload(procHead, a)).tags).toEqual(['kochi', 'supplier']);
    expect(res.results.find((r) => r.id === full.id)).toMatchObject({ ok: false, status: 400 });
  });

  it('moving the due date before a task’s start fails that task only', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id), startOn: day(5), dueOn: day(6) });
    const b = await make(procHead, { assigneeId: String(procA._id), dueOn: day(6) });
    const res = await bulk(procHead, [a, b], { dueOn: day(2) });
    expect(res.results.find((r) => r.id === a.id)).toMatchObject({ ok: false, status: 400 });
    expect((await reload(procHead, b)).dueOn).toBe(day(2));
  });

  it('archives and restores on their own, never mixed with other changes', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id) });
    expect(await bulk(procHead, [a], { archived: true })).toMatchObject({ changed: 1 });
    const gone = await reload(procHead, a);
    expect(gone.bucket).toBe('archived');
    expect(await bulk(procHead, [gone], { archived: false })).toMatchObject({ changed: 1 });
    await status(400, () => bulk(procHead, [a], { archived: true, priority: 'low' }));
  });

  it('a malformed change touches nothing', async () => {
    const a = await make(procHead, { assigneeId: String(procA._id) });
    await status(400, () => bulk(procHead, [a], {}));
    await status(400, () => bulk(procHead, [a], { status: 'finished' }));
    await status(400, () => bulk(procHead, [a], { priority: 'high', dueOn: '2026-13-01' }));
    await status(400, () => bulk(procHead, [a], { addTags: ['x'.repeat(tasks.TAG_MAX + 1)] }));
    await status(400, () => tasks.bulkUpdate(procHead, { items: [], changes: { priority: 'high' } }, req));
    await status(400, () => tasks.bulkUpdate(procHead, { items: [...items(a), ...items(a)], changes: { priority: 'high' } }, req));
    await status(400, () => tasks.bulkUpdate(procHead, {
      items: Array.from({ length: tasks.BULK_MAX + 1 }, () => ({ id: a.id, rev: 1 })), changes: { priority: 'high' },
    }, req));
    // Giving to someone outside the panel is refused before any task is touched.
    const customer = await person('customer', null, 'Ravi');
    await status(400, () => bulk(procHead, [a], { assigneeId: String(customer._id) }));
    const now = await reload(procHead, a);
    expect(now.rev).toBe(a.rev);
    expect(now.priority).toBe('normal');
  });
});
