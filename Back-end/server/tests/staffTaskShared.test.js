/**
 * Tasks phase 4b — one shared task for several people, followers, and the
 * pop-ups around them.
 *
 * What must hold:
 *   - `shared` makes ONE task for everyone picked; a retry makes no second one
 *     and sends no second pop-up; without it, "own copy each" is unchanged
 *   - everyone doing it, its followers, the giver and the head of ANY team on it
 *     see it; nobody else does (404, not 403)
 *   - anyone doing it may move it; a follower may not (403), nor tick its steps
 *   - only the giver, a head on it or the admin change who does it; at least one
 *     person stays; a stale change is refused and sends nothing
 *   - following is one atomic write that never bumps `rev`: a double follow is
 *     one entry, two people following at once both land, the cap holds
 *   - the giver @mentioning someone outside the task makes them a follower
 *     first; anyone else may mention only the people on it
 *   - pop-ups go to the people on the task, never the actor, only after a real save
 *   - "Following" and the bell are single index ranges
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const pushes = [];
const pushMock = {
  pushConfigured: () => true,
  publicKey: () => 'k',
  cleanSubscription: (x) => x,
  subscribe: async () => ({ subscribed: true }),
  unsubscribe: async () => ({ subscribed: false }),
  sendToUsers: async (recipients, message) => {
    pushes.push({ to: recipients.map((r) => r.userId).sort(), title: message.title, urls: recipients.map((r) => r.url) });
    return recipients.length;
  },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');
const tasks = await import('../services/staffTaskService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const settle = () => new Promise((r) => setTimeout(r, 40)); // pop-ups are fire-and-forget
const ids = (...users) => users.map((u) => String(u._id)).sort();
const raw = (id) => StaffTask.findById(id).lean();
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `s${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const refused = async (promise, status) => {
  await expect(promise).rejects.toMatchObject({ statusCode: status });
};

let admin, procHead, procA, salesHead, salesA, accountsA;
beforeAll(async () => { await StaffTask.syncIndexes(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  procHead = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  procA = await person('staff', { team: 'procurement' }, 'Arun');
  salesHead = await person('staff', { team: 'sales', isHead: true }, 'Sita');
  salesA = await person('staff', { team: 'sales' }, 'Sam');
  accountsA = await person('staff', { team: 'accounts' }, 'Bala');
});

/** Priya gives one shared task to Arun (procurement) and Sam (sales). */
const sharedTask = async (extra = {}) => {
  const { task } = await tasks.createTask(procHead, {
    title: 'Count the Diwali stock', assigneeIds: [String(procA._id), String(salesA._id)], shared: true, ...extra,
  }, req);
  await settle();
  pushes.length = 0;
  return task;
};

describe('creating one shared task', () => {
  it('is one task with everyone on it, each with their team; each new person hears once', async () => {
    const { tasks: made, task } = await tasks.createTask(procHead, {
      title: 'Count the Diwali stock', assigneeIds: [String(procA._id), String(salesA._id)], shared: true, clientId: 'shared-0001',
    }, req);
    expect(made).toHaveLength(1);
    expect(task.group).toBeNull();
    expect(task.assignees).toEqual([{ id: String(procA._id), name: 'Arun' }, { id: String(salesA._id), name: 'Sam' }]);
    const t = await raw(task.id);
    expect(t.teams).toEqual(['procurement', 'sales']);
    expect(t.assignees.map((p) => p.team)).toEqual(['procurement', 'sales']);
    // The first person in the old fields, for older code and the 4a rollback.
    expect([String(t.assignee), t.assigneeName, t.team]).toEqual([String(procA._id), 'Arun', 'procurement']);
    expect(t.history[0]).toMatchObject({ action: 'created', to: 'Arun, Sam' });
    await settle();
    expect(pushes).toEqual([{ to: ids(procA, salesA), title: 'New task from Priya', urls: [`/team/tasks/${task.id}`, `/team/tasks/${task.id}`] }]);
  });

  it('a retry is the same task, and sends nothing more', async () => {
    const input = { title: 'Ring the courier', assigneeIds: [String(procA._id), String(salesA._id)], shared: true, clientId: 'shared-0002' };
    const first = await tasks.createTask(procHead, input, req);
    await settle();
    const again = await tasks.createTask(procHead, input, req);
    await settle();
    expect(again.duplicate).toBe(true);
    expect(again.task.id).toBe(first.task.id);
    expect(await StaffTask.countDocuments({ title: 'Ring the courier' })).toBe(1);
    expect(pushes).toHaveLength(1);
  });

  it('the giver on their own task hears nothing about it', async () => {
    await tasks.createTask(procHead, { title: 'Mine and Arun\'s', assigneeIds: [String(procHead._id), String(procA._id)], shared: true }, req);
    await settle();
    expect(pushes.map((p) => p.to)).toEqual([ids(procA)]);
  });

  it('without `shared` several people still get a copy each', async () => {
    const { tasks: made } = await tasks.createTask(procHead, { title: 'Read the policy', assigneeIds: [String(procA._id), String(salesA._id)] }, req);
    expect(made).toHaveLength(2);
    expect(made.map((t) => t.assignees.length)).toEqual([1, 1]);
  });

  it('someone no longer in the panel stops the whole create', async () => {
    await User.updateOne({ _id: salesA._id }, { $set: { 'staff.active': false } });
    await refused(tasks.createTask(procHead, { title: 'x', assigneeIds: [String(procA._id), String(salesA._id)], shared: true }, req), 400);
    expect(await StaffTask.countDocuments()).toBe(0);
  });
});

describe('who sees a shared task', () => {
  it('everyone doing it, in "Assigned to me", the bell and the header counts', async () => {
    const t = await sharedTask({ dueOn: tasks.todayIST() });
    for (const who of [procA, salesA]) {
      expect((await tasks.listTasks(who, { view: 'mine' })).tasks.map((x) => x.id)).toEqual([t.id]);
      expect(await tasks.countDueForBell(who)).toBe(1);
      expect(await tasks.summaryFor(who)).toEqual({ late: 0, today: 1 });
    }
  });

  it('the head of every team on it, in the team list; another team\'s head does not', async () => {
    const t = await sharedTask();
    expect((await tasks.listTasks(salesHead, { view: 'team' })).tasks.map((x) => x.id)).toEqual([t.id]);
    expect((await tasks.listTasks(procHead, { view: 'team' })).tasks.map((x) => x.id)).toEqual([t.id]);
    expect((await tasks.listTasks(admin, { view: 'team', team: 'sales' })).tasks.map((x) => x.id)).toEqual([t.id]);
    expect((await tasks.listTasks(salesHead, { view: 'team', assignee: String(salesA._id) })).tasks).toHaveLength(1);
    const accountsHead = await person('staff', { team: 'accounts', isHead: true }, 'Ravi');
    await refused(tasks.getTask(accountsHead, t.id), 404);
    await refused(tasks.getTask(accountsA, t.id), 404);
  });

  it('a head on it may edit it, though someone else gave it', async () => {
    const t = await sharedTask();
    const next = await tasks.updateTask(salesHead, t.id, { rev: t.rev, priority: 'high' }, req);
    expect(next.priority).toBe('high');
  });

  it('a task the backfill missed still opens for its one person', async () => {
    const legacy = await StaffTask.collection.insertOne({
      number: 4242, title: 'old', assignee: procA._id, assigneeName: 'Arun', team: 'procurement', createdBy: procHead._id,
      status: 'todo', priority: 'normal', bucket: 'open', rank: '9999-12-31', rev: 1, history: [],
    });
    const t = await tasks.getTask(procA, String(legacy.insertedId));
    expect(t.assignees).toEqual([{ id: String(procA._id), name: 'Arun' }]);
    expect(t.can.status).toBe(true);
    await refused(tasks.getTask(salesHead, String(legacy.insertedId)), 404);
  });
});

describe('moving a shared task', () => {
  it('anyone doing it may move it; everyone else on it hears, the mover does not', async () => {
    const t = await sharedTask();
    await tasks.changeFollowers(procHead, t.id, { add: [String(accountsA._id)] });
    const next = await tasks.updateTask(salesA, t.id, { rev: t.rev, status: 'in_progress' }, req);
    expect(next.status).toBe('in_progress');
    await settle();
    expect(pushes).toEqual([{
      to: ids(procHead, procA, accountsA), title: 'Sam moved T-1 to In progress', urls: expect.any(Array),
    }]);
  });

  it('a follower may not move it or tick its steps', async () => {
    const t = await sharedTask({ checklist: ['Shelf A'] });
    const { task } = await tasks.changeFollowers(procHead, t.id, { add: [String(accountsA._id)] });
    expect(task.followers).toEqual([{ id: String(accountsA._id), name: 'Bala' }]);
    const seen = await tasks.getTask(accountsA, t.id);
    expect(seen.can).toMatchObject({ status: false, edit: false, comment: true, follow: true, followers: false });
    await refused(tasks.updateTask(accountsA, t.id, { rev: seen.rev, status: 'done' }, req), 403);
    await refused(tasks.updateChecklistItem(accountsA, t.id, seen.checklistItems[0].id, { done: true }), 403);
    await settle();
    expect(pushes).toHaveLength(0);
  });

  it('a stale move is refused and sends nothing', async () => {
    const t = await sharedTask();
    await tasks.updateTask(procA, t.id, { rev: t.rev, status: 'waiting' }, req);
    await settle();
    pushes.length = 0;
    await refused(tasks.updateTask(salesA, t.id, { rev: t.rev, status: 'done' }, req), 409);
    await settle();
    expect(pushes).toHaveLength(0);
  });
});

describe('changing who does it', () => {
  it('the giver adds and removes people; only the new one hears; the removed one loses it', async () => {
    const t = await sharedTask();
    const next = await tasks.updateTask(procHead, t.id, { rev: t.rev, assigneeIds: [String(salesA._id), String(accountsA._id)] }, req);
    expect(next.assignees.map((p) => p.name)).toEqual(['Sam', 'Bala']);
    const stored = await raw(t.id);
    expect(stored.teams).toEqual(['sales', 'accounts']);
    expect([String(stored.assignee), stored.team]).toEqual([String(salesA._id), 'sales']);
    expect(stored.history.at(-1)).toMatchObject({ action: 'assignee', from: 'Arun, Sam', to: 'Sam, Bala' });
    await settle();
    expect(pushes).toEqual([{ to: ids(accountsA), title: 'New task from Priya', urls: expect.any(Array) }]);
    await refused(tasks.getTask(procA, t.id), 404);
  });

  it('the same people in another order, or once more, changes nothing', async () => {
    const t = await sharedTask();
    const same = await tasks.updateTask(procHead, t.id, { rev: t.rev, assigneeIds: [String(salesA._id), String(procA._id), String(procA._id)] }, req);
    expect(same.rev).toBe(t.rev);
  });

  it('at least one person stays, and the people doing it cannot change who does it', async () => {
    const t = await sharedTask();
    await refused(tasks.updateTask(procHead, t.id, { rev: t.rev, assigneeIds: [] }, req), 400);
    await refused(tasks.updateTask(procA, t.id, { rev: t.rev, assigneeIds: [String(procA._id)] }, req), 403);
    await refused(tasks.updateTask(procHead, t.id, { rev: t.rev, assigneeIds: ['nope'] }, req), 400);
    expect((await raw(t.id)).rev).toBe(t.rev);
  });

  it('someone who has left the panel does not block taking a colleague off', async () => {
    const t = await sharedTask();
    await User.updateOne({ _id: procA._id }, { $set: { 'staff.active': false } });
    const next = await tasks.updateTask(procHead, t.id, { rev: t.rev, assigneeIds: [String(procA._id)] }, req);
    expect(next.assignees).toEqual([{ id: String(procA._id), name: 'Arun' }]);
    expect((await raw(t.id)).teams).toEqual(['procurement']);
  });

  it('a backfilled one-person task keeps its team when someone joins', async () => {
    const { insertedId } = await StaffTask.collection.insertOne({
      number: 4343, title: 'old', assignee: procA._id, assigneeName: 'Arun', team: 'procurement',
      assignees: [{ user: procA._id, name: 'Arun' }], teams: ['procurement'], createdBy: procHead._id,
      status: 'todo', priority: 'normal', bucket: 'open', rank: '9999-12-31', rev: 1, history: [],
    });
    await tasks.updateTask(procHead, String(insertedId), { rev: 1, assigneeIds: [String(procA._id), String(salesA._id)] }, req);
    expect((await raw(insertedId)).teams).toEqual(['procurement', 'sales']);
  });

  it('`assigneeId` (one person, the bulk bar) gives a shared task to just them', async () => {
    const t = await sharedTask();
    const res = await tasks.bulkUpdate(procHead, { items: [{ id: t.id, rev: t.rev }], changes: { assigneeId: String(salesA._id) } }, req);
    expect(res.changed).toBe(1);
    expect((await raw(t.id)).assignees.map((p) => String(p.user))).toEqual([String(salesA._id)]);
    const again = await tasks.bulkUpdate(procHead, { items: [{ id: t.id, rev: t.rev }], changes: { assigneeId: String(salesA._id) } }, req);
    expect(again).toMatchObject({ changed: 0, unchanged: 1, failed: 0 });
  });
});

describe('followers', () => {
  it('anyone who sees it follows and stops following themselves, without bumping rev', async () => {
    const t = await sharedTask();
    const { task } = await tasks.changeFollowers(salesHead, t.id, { add: [String(salesHead._id)] });
    expect(task.following).toBe(true);
    expect(task.rev).toBe(t.rev);
    expect((await tasks.listTasks(salesHead, { view: 'following' })).tasks.map((x) => x.id)).toEqual([t.id]);
    // A double follow is one entry; unfollowing twice is fine.
    await tasks.changeFollowers(salesHead, t.id, { add: [String(salesHead._id)] });
    expect((await raw(t.id)).followers).toHaveLength(1);
    await tasks.changeFollowers(salesHead, t.id, { remove: [String(salesHead._id)] });
    const off = await tasks.changeFollowers(salesHead, t.id, { remove: [String(salesHead._id)] });
    expect(off.task.following).toBe(false);
    expect((await raw(t.id)).history.filter((h) => h.action.startsWith('follower_')).map((h) => h.action)).toEqual(['follower_added', 'follower_removed']);
  });

  it('a follower who stops following a task they could only follow loses it', async () => {
    const t = await sharedTask();
    await tasks.changeFollowers(procHead, t.id, { add: [String(accountsA._id)] });
    expect((await tasks.listTasks(accountsA, { view: 'following' })).tasks).toHaveLength(1);
    expect((await tasks.listTasks(accountsA, { view: 'mine' })).tasks).toHaveLength(0);
    const { task } = await tasks.changeFollowers(accountsA, t.id, { remove: [String(accountsA._id)] });
    expect(task).toBeNull();
    await refused(tasks.getTask(accountsA, t.id), 404);
  });

  it('only the editors choose for someone else; someone doing it is not made a follower', async () => {
    const t = await sharedTask();
    await refused(tasks.changeFollowers(procA, t.id, { add: [String(accountsA._id)] }), 403);
    await refused(tasks.changeFollowers(accountsA, t.id, { add: [String(accountsA._id)] }), 404);
    const { task } = await tasks.changeFollowers(procHead, t.id, { add: [String(procA._id), String(accountsA._id)] });
    expect(task.followers.map((p) => p.name)).toEqual(['Bala']);
    await refused(tasks.changeFollowers(procHead, t.id, { add: [String(admin._id)], remove: [String(admin._id)] }), 400);
    await refused(tasks.changeFollowers(procHead, t.id, { add: ['nope'] }), 400);
  });

  it('two people following at the same moment both land', async () => {
    const t = await sharedTask();
    await Promise.all([salesHead, admin].map((u) => tasks.changeFollowers(u, t.id, { add: [String(u._id)] })));
    expect((await raw(t.id)).followers.map((p) => String(p.user)).sort()).toEqual(ids(salesHead, admin));
  });

  it('the cap holds: nothing is added past it', async () => {
    const t = await sharedTask();
    const many = Array.from({ length: tasks.FOLLOWERS_MAX }, () => ({ user: new mongoose.Types.ObjectId(), name: 'x' }));
    await StaffTask.updateOne({ _id: t.id }, { $set: { followers: many } });
    await refused(tasks.changeFollowers(admin, t.id, { add: [String(admin._id)] }), 400);
    expect((await raw(t.id)).followers).toHaveLength(tasks.FOLLOWERS_MAX);
  });

  it('an archived task can be unfollowed, not followed', async () => {
    const t = await sharedTask();
    await tasks.changeFollowers(salesHead, t.id, { add: [String(salesHead._id)] });
    const archived = await tasks.updateTask(procHead, t.id, { rev: t.rev, archived: true }, req);
    await refused(tasks.changeFollowers(admin, archived.id, { add: [String(admin._id)] }), 409);
    const { task } = await tasks.changeFollowers(salesHead, t.id, { remove: [String(salesHead._id)] });
    expect(task.following).toBe(false);
  });
});

describe('comments and mentions on a shared task', () => {
  it('a comment reaches the people doing it, the followers and the giver — not the writer', async () => {
    const t = await sharedTask();
    await tasks.changeFollowers(procHead, t.id, { add: [String(accountsA._id)] });
    await tasks.addComment(procA, t.id, { text: 'Shelf A done' });
    expect(pushes).toEqual([{ to: ids(procHead, salesA, accountsA), title: 'Arun commented on T-1', urls: expect.any(Array) }]);
  });

  it('the giver @mentioning someone outside makes them a follower first; a retry adds nothing', async () => {
    const t = await sharedTask();
    const body = { text: '@Bala can you help?', mentions: [String(accountsA._id)], clientId: 'mention-0001' };
    await tasks.addComment(procHead, t.id, body);
    const stored = await raw(t.id);
    expect(stored.followers.map((p) => [String(p.user), p.name])).toEqual([[String(accountsA._id), 'Bala']]);
    expect(stored.rev).toBe(t.rev);
    expect(pushes).toEqual([
      { to: ids(accountsA), title: 'Priya mentioned you', urls: expect.any(Array) },
      { to: ids(procA, salesA), title: 'Priya commented on T-1', urls: expect.any(Array) },
    ]);
    pushes.length = 0;
    const again = await tasks.addComment(procHead, t.id, body);
    expect(again.duplicate).toBe(true);
    expect((await raw(t.id)).followers).toHaveLength(1);
    expect(pushes).toHaveLength(0);
    // Bala can now open the comment they were called to.
    expect((await tasks.listComments(accountsA, t.id)).comments).toHaveLength(1);
  });

  it('the people doing it may mention only the people on it', async () => {
    const t = await sharedTask();
    await refused(tasks.addComment(procA, t.id, { text: '@Bala', mentions: [String(accountsA._id)] }), 400);
    expect(await StaffTaskComment.countDocuments()).toBe(0);
    expect((await raw(t.id)).followers).toBeUndefined();
  });

  it('the mention list: on the task first; everyone in the panel for the giver, only the task for the rest', async () => {
    const t = await sharedTask();
    const forGiver = (await tasks.listMentionable(procHead, t.id)).people;
    expect(forGiver.filter((p) => p.onTask).map((p) => p.name)).toEqual(['Arun', 'Sam', 'Sita']);
    expect(forGiver.filter((p) => !p.onTask).map((p) => p.name)).toEqual(['Bala', 'Owner']);
    const forDoer = (await tasks.listMentionable(procA, t.id)).people;
    expect(forDoer.map((p) => p.name)).toEqual(['Priya', 'Sam', 'Sita']);
    expect(forDoer.every((p) => p.onTask)).toBe(true);
  });
});

describe('index use', () => {
  const stats = (plan) => {
    const s = plan.executionStats;
    const text = JSON.stringify(plan.queryPlanner.winningPlan);
    return { index: (text.match(/"indexName":"([^"]+)"/) || [])[1], sorted: text.includes('"SORT"'), keys: s.totalKeysExamined, docs: s.totalDocsExamined, returned: s.nReturned };
  };

  it('"Following" is one range on staff_task_followers, sorted by the index', async () => {
    const watcher = new mongoose.Types.ObjectId();
    await StaffTask.insertMany(Array.from({ length: 300 }, (_, i) => ({
      number: 50000 + i, title: `t${i}`, assignee: procA._id, assignees: [{ user: procA._id, name: '' }], teams: ['procurement'],
      ...(i % 3 === 0 ? { followers: [{ user: watcher, name: 'w' }, { user: new mongoose.Types.ObjectId(), name: 'v' }] } : {}),
      createdBy: procHead._id, status: 'todo', priority: 'normal', bucket: 'open', rank: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
    })));
    const s = stats(await StaffTask.find({ 'followers.user': watcher, bucket: 'open' }).sort({ rank: 1, _id: 1 }).limit(51).explain('executionStats'));
    expect(s.index).toBe('staff_task_followers');
    expect(s.sorted).toBe(false);
    expect(s.docs).toBe(s.returned);
    expect(s.returned).toBe(51);
  });
});
