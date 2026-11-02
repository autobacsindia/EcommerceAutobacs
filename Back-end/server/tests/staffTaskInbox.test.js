/**
 * Tasks phase 6a — the Inbox (server).
 *
 * What must hold:
 *   - a new task, a status change, a comment, an @mention and a sub-task each
 *     leave a line in the Inbox of the people who hear about it — never of the
 *     person who did it
 *   - one event is one line per person: a retried create or comment adds
 *     nothing, and finishes a line a failed first attempt missed (with no second
 *     pop-up)
 *   - the change is saved even when the Inbox write fails
 *   - you list and change only your own lines; anyone else's is "not found"
 *   - "Mark all read" stops at the newest line the screen had
 *   - a line whose task you can no longer open still reads right and says so
 *   - pages are keyset and bounded, the unread count is capped, and both read
 *     one range of staff_task_inbox_list
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
  sendToUsers: async (recipients, message) => {
    pushes.push({ to: recipients.map((r) => r.userId).sort(), title: message.title });
    return recipients.length;
  },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const { default: staffTaskInboxRepository } = await import('../repositories/staffTaskInboxRepository.js');
const tasks = await import('../services/staffTaskService.js');
const inbox = await import('../services/staffTaskInboxService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const settle = () => new Promise((r) => setTimeout(r, 40));
const raw = (id) => StaffTask.findById(id).lean();
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `inbox${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const refused = async (promise, status) => {
  await expect(promise).rejects.toMatchObject({ statusCode: status });
};
/** Everyone's lines, as "<name>:<kind>:<text>" — sorted, so order never matters. */
const lines = async () => {
  const names = new Map((await User.find({}, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  return (await StaffTaskInbox.find({}).lean()).map((r) => `${names.get(String(r.user))}:${r.kind}:${r.text}`).sort();
};
const linesOf = (who) => StaffTaskInbox.find({ user: who._id }).sort({ _id: -1 }).lean();
const patch = async (actor, id, input) => tasks.updateTask(actor, id, { rev: (await raw(id)).rev, ...input }, req);

let priya, arun, bala, sam;
beforeAll(async () => { await StaffTask.syncIndexes(); await StaffTaskInbox.syncIndexes(); });
beforeEach(async () => {
  pushes.length = 0;
  priya = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  bala = await person('staff', { team: 'procurement' }, 'Bala');
  sam = await person('staff', { team: 'sales' }, 'Sam');
});
afterEach(() => { jest.restoreAllMocks(); });

const give = async (who, extra = {}, actor = priya) => (await tasks.createTask(actor, {
  title: 'Count the Bosch pads', assigneeIds: who.map((u) => String(u._id)), shared: true, ...extra,
}, req)).task;

describe('what lands in the Inbox', () => {
  it('a new task: each person given it — never whoever gave it', async () => {
    await give([arun, bala], { dueOn: '2026-11-20' });
    expect(await lines()).toEqual(['Arun:assigned:due 2026-11-20', 'Bala:assigned:due 2026-11-20']);
    const [row] = await linesOf(arun);
    expect(row).toMatchObject({ number: expect.any(Number), title: 'Count the Bosch pads', byName: 'Priya', state: 'unread' });
  });

  it('a task you give yourself leaves nothing', async () => {
    await give([priya]);
    expect(await lines()).toEqual([]);
  });

  it('a status change: everyone on it but the mover; someone just added hears "new task" instead', async () => {
    const t = await give([arun]);
    await StaffTaskInbox.deleteMany({});
    await patch(arun, t.id, { status: 'in_progress' });
    expect(await lines()).toEqual(['Priya:status:In progress']);

    await StaffTaskInbox.deleteMany({});
    await patch(priya, t.id, { status: 'done', assigneeIds: [String(arun._id), String(bala._id)] });
    expect(await lines()).toEqual(['Arun:status:Done', 'Bala:assigned:']);
  });

  it('a comment: "mentioned you" to those named, "commented" to the rest, nothing to the writer', async () => {
    const t = await give([arun, bala]);
    await StaffTaskInbox.deleteMany({});
    await tasks.addComment(priya, t.id, { text: 'Count  the\nboxes too', clientId: 'cmt-00000001', mentions: [String(arun._id)] });
    expect(await lines()).toEqual(['Arun:mention:Count the boxes too', 'Bala:comment:Count the boxes too']);
  });

  it('a sub-task: its people hear "new task", the rest of the parent hears "sub-task added"', async () => {
    const parent = await give([arun, bala]);
    await StaffTaskInbox.deleteMany({});
    const child = (await tasks.createTask(priya, {
      title: 'Wiper blades', parentId: parent.id, assigneeIds: [String(arun._id)], shared: true,
    }, req)).task;
    expect(await lines()).toEqual(['Arun:assigned:', `Bala:subtask:${child.code} · Wiper blades`]);
    const [line] = await linesOf(bala);
    expect(String(line.task)).toBe(parent.id);
  });

  it('a checklist step made into a sub-task tells the parent too', async () => {
    const parent = await give([arun]);
    const withStep = await tasks.addChecklistItem(priya, parent.id, { text: 'Count filters' });
    const step = withStep.checklistItems[0];
    await StaffTaskInbox.deleteMany({});
    await tasks.subtaskFromStep(priya, parent.id, step.id, { clientId: 'step-0000001', assigneeIds: [String(bala._id)] }, req);
    const got = await lines();
    expect(got).toHaveLength(2);
    expect(got[0]).toMatch(/^Arun:subtask:T-\d+ · Count filters$/);
    expect(got[1]).toBe('Bala:assigned:');
  });
});

describe('one event, one line', () => {
  it('a retried create adds nothing, and sends no second pop-up', async () => {
    await give([arun], { clientId: 'task-0000001' });
    await give([arun], { clientId: 'task-0000001' });
    await settle();
    expect(await lines()).toEqual(['Arun:assigned:']);
    expect(pushes.filter((p) => p.title.startsWith('New task'))).toHaveLength(1);
  });

  it('a retried create finishes the line a failed first attempt missed — still one pop-up', async () => {
    jest.spyOn(staffTaskInboxRepository, 'insertMany').mockRejectedValueOnce(new Error('primary stepped down'));
    const t = await give([arun], { clientId: 'task-0000002' });
    expect(await raw(t.id)).toBeTruthy(); // the task is saved anyway
    expect(await lines()).toEqual([]);

    await give([arun], { clientId: 'task-0000002' });
    await settle();
    expect(await lines()).toEqual(['Arun:assigned:']);
    expect(pushes.filter((p) => p.title.startsWith('New task'))).toHaveLength(1);
  });

  it('a retry after the task changed does not re-announce it to its new people', async () => {
    const t = await give([arun], { clientId: 'task-0000003' });
    await StaffTaskInbox.deleteMany({});
    await patch(priya, t.id, { title: 'Count the Bosch pads (all)' });
    await give([arun], { clientId: 'task-0000003' });
    expect(await lines()).toEqual([]);
  });

  it('a retried comment adds nothing, and finishes a missed line', async () => {
    const t = await give([arun, bala]);
    await StaffTaskInbox.deleteMany({});
    const spy = jest.spyOn(staffTaskInboxRepository, 'insertMany');
    spy.mockRejectedValueOnce(new Error('timeout')); // the mention line (Arun) is lost
    await tasks.addComment(priya, t.id, { text: 'Check the date', clientId: 'cmt-00000002', mentions: [String(arun._id)] });
    expect(await lines()).toEqual(['Bala:comment:Check the date']);

    const again = await tasks.addComment(priya, t.id, { text: 'Check the date', clientId: 'cmt-00000002', mentions: [String(arun._id)] });
    expect(again.duplicate).toBe(true);
    expect(await lines()).toEqual(['Arun:mention:Check the date', 'Bala:comment:Check the date']);
  });

  it('a failed Inbox write never fails the change', async () => {
    const t = await give([arun]);
    jest.spyOn(staffTaskInboxRepository, 'insertMany').mockRejectedValue(new Error('disk full'));
    const moved = await patch(arun, t.id, { status: 'done' });
    expect(moved.status).toBe('done');
    expect((await raw(t.id)).status).toBe('done');
  });

  it('a duplicate key from the database is the same as "already there"', async () => {
    const t = await give([arun]);
    const [row] = await linesOf(arun);
    const again = await staffTaskInboxRepository.insertMany([
      { user: arun._id, key: row.key, kind: 'assigned', task: t.id, number: 1 },
      { user: bala._id, key: row.key, kind: 'assigned', task: t.id, number: 1 },
    ]);
    expect(again).toBe(1);
    expect(await StaffTaskInbox.countDocuments({ user: arun._id })).toBe(1);
  });
});

describe('reading your Inbox', () => {
  /** `count` lines for `who`, oldest first, written straight in. */
  const seed = async (who, count, extra = {}) => {
    const t = await give([who]);
    await StaffTaskInbox.deleteMany({ user: who._id });
    const rows = Array.from({ length: count }, (_, i) => ({
      user: who._id, key: `seed:${i}`, kind: 'comment', task: t.id, number: 7, title: 'Old title', text: `line ${i}`, ...extra,
    }));
    for (const r of rows) await StaffTaskInbox.create(r); // one by one: _id order = time order
    return t;
  };

  it('newest first, 30 at a time, with a cursor to the next page', async () => {
    await seed(arun, 32);
    const first = await inbox.listInbox(arun);
    expect(first.items).toHaveLength(inbox.INBOX_PAGE_SIZE);
    expect(first.items[0].text).toBe('line 31');
    expect(first.unread).toBe(32);
    const second = await inbox.listInbox(arun, { cursor: first.nextCursor });
    expect(second.items.map((i) => i.text)).toEqual(['line 1', 'line 0']);
    expect(second.nextCursor).toBeNull();
  });

  it('an empty Inbox is an empty page', async () => {
    expect(await inbox.listInbox(sam)).toEqual({ items: [], nextCursor: null, unread: 0 });
  });

  it('shows only your own lines', async () => {
    await give([arun]);
    expect((await inbox.listInbox(bala)).items).toEqual([]);
    expect((await inbox.listInbox(arun)).items).toHaveLength(1);
  });

  it('"unread" lists only unread; cleared lines leave both lists', async () => {
    await seed(arun, 3);
    const { items } = await inbox.listInbox(arun);
    await inbox.setInboxState(arun, items[0].id, 'read');
    await inbox.setInboxState(arun, items[1].id, 'cleared');
    expect((await inbox.listInbox(arun, { state: 'unread' })).items.map((i) => i.text)).toEqual(['line 0']);
    const all = await inbox.listInbox(arun);
    expect(all.items.map((i) => [i.text, i.read])).toEqual([['line 2', true], ['line 0', false]]);
    expect(all.unread).toBe(1);
  });

  it('marks a line unread again', async () => {
    await seed(arun, 1);
    const [item] = (await inbox.listInbox(arun)).items;
    await inbox.setInboxState(arun, item.id, 'read');
    expect(await inbox.setInboxState(arun, item.id, 'unread')).toMatchObject({ state: 'unread', unread: 1 });
  });

  it('someone else\'s line is "not found"; a bad id or state is refused', async () => {
    await seed(arun, 1);
    const [item] = (await inbox.listInbox(arun)).items;
    await refused(inbox.setInboxState(bala, item.id, 'read'), 404);
    expect((await StaffTaskInbox.findById(item.id).lean()).state).toBe('unread');
    await refused(inbox.setInboxState(arun, 'nope', 'read'), 400);
    await refused(inbox.setInboxState(arun, item.id, 'gone'), 400);
    await refused(inbox.listInbox(arun, { state: 'old' }), 400);
    await refused(inbox.listInbox(arun, { cursor: 'x' }), 400);
  });

  it('"Mark all read" stops at the newest line the screen had', async () => {
    await seed(arun, 3);
    const shown = await inbox.listInbox(arun);
    // A line arrives after the screen loaded.
    await StaffTaskInbox.create({ user: arun._id, key: 'late', kind: 'mention', task: shown.items[0].task.id, number: 7, text: 'just now' });
    // And Bala's own unread line must not be touched.
    await give([bala]);

    expect(await inbox.readAllInbox(arun, shown.items[0].id)).toEqual({ marked: 3, unread: 1 });
    expect((await inbox.listInbox(arun, { state: 'unread' })).items.map((i) => i.text)).toEqual(['just now']);
    expect((await inbox.listInbox(bala)).unread).toBe(1);
    await refused(inbox.readAllInbox(arun, 'bad'), 400);
  });

  it('the unread count stops at the cap', async () => {
    const t = await give([arun]);
    await StaffTaskInbox.insertMany(Array.from({ length: inbox.INBOX_UNREAD_CAP + 5 }, (_, i) => ({
      user: arun._id, key: `bulk:${i}`, kind: 'comment', task: t.id, number: 1,
    })));
    expect(await inbox.countUnread(arun)).toBe(inbox.INBOX_UNREAD_CAP);
  });

  it('a line on a task you were taken off still reads right, and says it no longer opens', async () => {
    const t = await give([arun]);
    await patch(priya, t.id, { title: 'Count the Bosch pads — urgent' });
    let [item] = (await inbox.listInbox(arun)).items;
    expect(item).toMatchObject({ kind: 'assigned', canOpen: true, task: { id: t.id, code: t.code, title: 'Count the Bosch pads — urgent' } });
    expect(item.by).toEqual({ id: String(priya._id), name: 'Priya' });

    await patch(priya, t.id, { assigneeIds: [String(bala._id)], title: 'Secret new name' });
    [item] = (await inbox.listInbox(arun)).items;
    expect(item).toMatchObject({ canOpen: false, task: { code: t.code, title: 'Count the Bosch pads' } });
  });

  it('a line whose task is gone from the database still lists', async () => {
    const t = await give([arun]);
    await StaffTask.deleteOne({ _id: t.id });
    const [item] = (await inbox.listInbox(arun)).items;
    expect(item).toMatchObject({ canOpen: false, task: { title: 'Count the Bosch pads' } });
  });
});

describe('indexes', () => {
  /** The index a query used, and how much it read. */
  const plan = async (cursor) => {
    const e = await cursor.explain('executionStats');
    const s = JSON.stringify(e.queryPlanner.winningPlan);
    return {
      index: (s.match(/"indexName":"([^"]+)"/) || [])[1],
      keys: e.executionStats.totalKeysExamined,
      docs: e.executionStats.totalDocsExamined,
    };
  };

  it('a page and the unread count each read one range of staff_task_inbox_list', async () => {
    const t = await give([arun]);
    const many = (who, count, state) => Array.from({ length: count }, (_, i) => ({
      user: who._id, key: `${state}:${String(who._id)}:${i}`, kind: 'comment', task: t.id, number: 1, state,
    }));
    await StaffTaskInbox.insertMany([...many(arun, 80, 'read'), ...many(arun, 40, 'unread'), ...many(bala, 300, 'unread')]);

    const unreadPage = await plan(StaffTaskInbox.find({ user: arun._id, state: 'unread' }).sort({ _id: -1 }).limit(31));
    expect(unreadPage).toMatchObject({ index: 'staff_task_inbox_list', docs: 31 });

    const allPage = await plan(StaffTaskInbox.find({ user: arun._id, state: { $in: ['unread', 'read'] } }).sort({ _id: -1 }).limit(31));
    expect(allPage.index).toBe('staff_task_inbox_list');
    expect(allPage.docs).toBeLessThanOrEqual(31);

    // The badge: a COUNT_SCAN over Arun's unread keys — no documents read, none of Bala's 300 keys.
    const count = await StaffTaskInbox.db.db.command({
      explain: { count: 'stafftaskinbox', query: { user: arun._id, state: 'unread' }, limit: 100 },
      verbosity: 'executionStats',
    });
    expect(JSON.stringify(count.queryPlanner.winningPlan)).toContain('staff_task_inbox_list');
    expect(count.executionStats.totalDocsExamined).toBe(0);
    expect(count.executionStats.totalKeysExamined).toBeLessThanOrEqual(42); // his 41 unread (40 + "new task"), plus the one key that ends the range
  });

  it('declares a unique event key and a 90-day expiry', () => {
    const idx = Object.fromEntries(StaffTaskInbox.schema.indexes().map(([, o]) => [o.name, o]));
    expect(idx.staff_task_inbox_key.unique).toBe(true);
    expect(idx.staff_task_inbox_ttl.expireAfterSeconds).toBe(90 * 24 * 60 * 60);
  });
});
