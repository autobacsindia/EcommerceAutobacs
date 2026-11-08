/**
 * Assigned comments and the team Overview.
 *
 * What must hold:
 *   - a comment goes only to someone who can open the task; personal tasks only to their owner
 *   - once assigned, only the people involved or an editor change it; strangers get 404
 *   - retries change nothing and notify once; a deleted comment leaves the list
 *   - the list pages by cursor and hides the words of a task the person can no longer open
 *   - the Overview is one team's, never counts personal tasks, and is bounded
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => true, publicKey: () => 'k', cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async (r) => r.length, sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const tasks = await import('../services/staffTaskService.js');

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `ac${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const refused = (p, status) => expect(p).rejects.toMatchObject({ statusCode: status });

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let admin; let head; let arun; let priya; let other;
beforeAll(async () => { await StaffTask.syncIndexes(); await StaffTaskComment.syncIndexes(); await StaffTaskInbox.syncIndexes(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Admin');
  head = await person('staff', { team: 'sales', isHead: true }, 'Head');
  arun = await person('staff', { team: 'sales' }, 'Arun');
  priya = await person('staff', { team: 'sales' }, 'Priya');
  other = await person('staff', { team: 'accounts' }, 'Other');
});

const makeTask = async (by = head, extra = {}) => (await tasks.createTask(by, { title: 'Call', assigneeIds: [String(arun._id)], ...extra }, req)).task;
const say = async (t, by = arun, text = 'Please check') => (await tasks.addComment(by, t.id, { text })).comment;

describe('assigning a comment', () => {
  it('shows who has it, puts it on their list and tells them once', async () => {
    const t = await makeTask();
    const c = await say(t);
    const { comment } = await tasks.assignComment(head, t.id, c.id, String(priya._id));
    expect(comment.assignment).toMatchObject({ to: { name: 'Priya' }, by: { name: 'Head' }, resolvedAt: null, canChange: true });
    await tasks.assignComment(head, t.id, c.id, String(priya._id)); // a double-click
    const inbox = await StaffTaskInbox.find({ user: priya._id, kind: 'comment_assigned' }).lean();
    expect(inbox).toHaveLength(1);
    const list = await tasks.listAssignedComments(priya, {});
    expect(list.comments).toHaveLength(1);
    expect(list.comments[0]).toMatchObject({ canOpen: true, text: 'Please check', assignedBy: 'Head', task: { title: 'Call' } });
    expect((await tasks.summaryFor(priya)).assignedComments).toBe(1);
    const history = (await StaffTask.findById(t.id).lean()).history.filter((h) => h.action === 'comment_assigned');
    expect(history).toHaveLength(1);
  });

  it('refuses a stranger (404), an outsider target from a non-editor, and archived tasks', async () => {
    const t = await makeTask();
    const c = await say(t);
    await refused(tasks.assignComment(other, t.id, c.id, String(arun._id)), 404);
    await refused(tasks.assignComment(arun, t.id, c.id, String(other._id)), 400);
    await StaffTask.updateOne({ _id: t.id }, { bucket: 'archived', archivedAt: new Date() });
    await refused(tasks.assignComment(head, t.id, c.id, String(priya._id)), 409);
  });

  it('an editor giving it to an outsider makes them a follower, so they can open it', async () => {
    const t = await makeTask();
    const c = await say(t);
    await tasks.assignComment(head, t.id, c.id, String(other._id));
    const list = await tasks.listAssignedComments(other, {});
    expect(list.comments[0].canOpen).toBe(true);
  });

  it('once assigned, a bystander cannot take it over', async () => {
    const t = await makeTask();
    const c = await say(t, head);
    await tasks.assignComment(head, t.id, c.id, String(arun._id));
    await refused(tasks.assignComment(priya, t.id, c.id, String(priya._id)), 403);
    await refused(tasks.resolveComment(priya, t.id, c.id, true), 403);
  });

  it('personal tasks: only to their owner', async () => {
    const t = (await tasks.createTask(arun, { title: 'Mine', personal: true }, req)).task;
    const c = await say(t);
    await refused(tasks.assignComment(arun, t.id, c.id, String(priya._id)), 400);
    await refused(tasks.assignComment(admin, t.id, c.id, String(admin._id)), 404);
    const { comment } = await tasks.assignComment(arun, t.id, c.id, String(arun._id));
    expect(comment.assignment.to.name).toBe('Arun');
  });

  it('reassigning reopens it; unassigning takes it off the list and a retry is harmless', async () => {
    const t = await makeTask();
    const c = await say(t);
    await tasks.assignComment(head, t.id, c.id, String(priya._id));
    await tasks.resolveComment(priya, t.id, c.id, true);
    const back = await tasks.assignComment(head, t.id, c.id, String(arun._id));
    expect(back.comment.assignment.resolvedAt).toBeNull();
    const off = await tasks.assignComment(head, t.id, c.id, null);
    expect(off.comment.assignment).toBeNull();
    expect((await tasks.assignComment(head, t.id, c.id, null)).comment.assignment).toBeNull();
    expect((await tasks.listAssignedComments(arun, {})).comments).toHaveLength(0);
  });

  it('two people assigning at once leave one assignee', async () => {
    const t = await makeTask();
    const c = await say(t);
    await Promise.all([tasks.assignComment(head, t.id, c.id, String(priya._id)), tasks.assignComment(admin, t.id, c.id, String(head._id))]);
    const row = await StaffTaskComment.findById(c.id).lean();
    expect([String(priya._id), String(head._id)]).toContain(String(row.assignedTo));
  });
});

describe('resolving', () => {
  it('moves between lists, tells the giver once, and reopens', async () => {
    const t = await makeTask();
    const c = await say(t, head);
    await tasks.assignComment(head, t.id, c.id, String(priya._id));
    await tasks.resolveComment(priya, t.id, c.id, true);
    const again = await tasks.resolveComment(priya, t.id, c.id, true);
    expect(again.comment.assignment).toMatchObject({ resolvedBy: 'Priya' });
    expect(await StaffTaskInbox.countDocuments({ user: head._id, kind: 'comment_resolved' })).toBe(1);
    expect((await tasks.listAssignedComments(priya, {})).comments).toHaveLength(0);
    expect((await tasks.listAssignedComments(priya, { state: 'resolved' })).comments).toHaveLength(1);
    expect((await tasks.summaryFor(priya)).assignedComments).toBe(0);
    await tasks.resolveComment(priya, t.id, c.id, false);
    expect((await tasks.listAssignedComments(priya, {})).comments).toHaveLength(1);
  });

  it('refuses a comment nobody has', async () => {
    const t = await makeTask();
    const c = await say(t);
    await refused(tasks.resolveComment(head, t.id, c.id, true), 409);
  });

  it('a comment deleted by its author leaves the list', async () => {
    const t = await makeTask();
    const c = await say(t);
    await tasks.assignComment(head, t.id, c.id, String(priya._id));
    await tasks.deleteComment(arun, t.id, c.id);
    expect((await tasks.listAssignedComments(priya, {})).comments).toHaveLength(0);
    await refused(tasks.resolveComment(priya, t.id, c.id, true), 409);
  });

  it('after losing the task: a line without the words, which they can still clear', async () => {
    const t = await makeTask();
    const c = await say(t, head, 'secret plan');
    await tasks.assignComment(head, t.id, c.id, String(priya._id));
    await User.updateOne({ _id: priya._id }, { 'staff.team': 'accounts' });
    await StaffTask.updateOne({ _id: t.id }, { followers: [] });
    const moved = await User.findById(priya._id);
    const row = (await tasks.listAssignedComments(moved, {})).comments[0];
    expect(row).toMatchObject({ canOpen: false, text: '', by: null, task: { title: '', code: '' } });
    expect(await tasks.resolveComment(moved, t.id, c.id, true)).toEqual({ comment: null });
    expect((await tasks.summaryFor(moved)).assignedComments).toBe(0);
  });
});

describe('the list', () => {
  it('pages newest first by cursor, without repeats', async () => {
    const t = await makeTask();
    const docs = [];
    for (let i = 0; i < 32; i += 1) docs.push({ task: t.id, by: arun._id, byName: 'Arun', text: `c${i}`, assignedTo: priya._id, assignedBy: head._id, assignedAt: new Date() });
    await StaffTaskComment.insertMany(docs);
    const one = await tasks.listAssignedComments(priya, {});
    expect(one.comments).toHaveLength(30);
    expect(one.comments[0].text).toBe('c31');
    const two = await tasks.listAssignedComments(priya, { before: one.nextBefore });
    expect(two.comments.map((c) => c.text)).toEqual(['c1', 'c0']);
    expect(two.nextBefore).toBeNull();
  });

  it('is empty for someone with none', async () => {
    expect(await tasks.listAssignedComments(other, {})).toEqual({ comments: [], nextBefore: null });
  });

  it('reads through its index', async () => {
    await StaffTaskComment.syncIndexes();
    const plan = await StaffTaskComment.find({ assignedTo: priya._id, resolvedAt: null, deletedAt: null }).sort({ _id: -1 }).limit(5).explain('queryPlanner');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('staff_task_comment_assigned');
  });
});

describe('the header numbers', () => {
  it('counts my in-progress tasks and what I finished this week, nobody else\'s', async () => {
    const a = await makeTask();
    const b = await makeTask();
    await tasks.updateTask(head, a.id, { status: 'in_progress', rev: a.rev }, req);
    await tasks.updateTask(head, b.id, { status: 'done', rev: b.rev }, req);
    expect(await tasks.summaryFor(arun)).toMatchObject({ inProgress: 1, doneWeek: 1 });
    expect(await tasks.summaryFor(priya)).toMatchObject({ inProgress: 0, doneWeek: 0 });
  });
});

describe('team overview', () => {
  const today = tasks.todayIST();
  const shift = (d) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

  it('counts late, today, the week, no date, unassigned, status and people', async () => {
    await tasks.createTask(head, { title: 'Late', assigneeIds: [String(arun._id)], dueOn: shift(-3) }, req);
    await tasks.createTask(head, { title: 'Today', assigneeIds: [String(arun._id)], dueOn: today }, req);
    await tasks.createTask(head, { title: 'Soon', assigneeIds: [String(priya._id)], dueOn: shift(3) }, req);
    await tasks.createTask(head, { title: 'Far', assigneeIds: [String(priya._id)], dueOn: shift(30) }, req);
    await tasks.createTask(head, { title: 'Nodate', assigneeIds: [String(priya._id)] }, req);
    const r = await tasks.teamOverview(arun, {});
    expect(r.counts).toMatchObject({ open: 5, late: 1, today: 1, nextWeek: 1, noDate: 1, unassigned: 0, doneWeek: 0 });
    expect(r.byStatus).toEqual([{ status: 'todo', label: expect.any(String), count: 5 }]);
    expect(r.people[0]).toMatchObject({ name: 'Priya', open: 3, late: 0 });
    expect(r.people[1]).toMatchObject({ name: 'Arun', open: 2, late: 1 });
    expect(r.late.map((x) => x.title)).toEqual(['Late']);
    expect(r.capped).toBe(false);
  });

  it('never counts personal tasks or another team', async () => {
    await tasks.createTask(arun, { title: 'Mine', personal: true }, req);
    await tasks.createTask(other, { title: 'Theirs', assigneeIds: [String(other._id)] }, req);
    expect((await tasks.teamOverview(arun, {})).counts.open).toBe(0);
    expect((await tasks.teamOverview(admin, { team: 'admin' })).counts.open).toBe(0);
  });

  it('counts recently done', async () => {
    const t = await makeTask();
    await tasks.updateTask(head, t.id, { status: 'done', rev: t.rev }, req);
    const r = await tasks.teamOverview(priya, {});
    expect(r.counts).toMatchObject({ open: 0, doneWeek: 1 });
    expect(r.recentDone.map((x) => x.title)).toEqual(['Call']);
  });

  it('is empty, not broken, for a team with nothing', async () => {
    const r = await tasks.teamOverview(other, {});
    expect(r).toMatchObject({ counts: { open: 0 }, byStatus: [], people: [], late: [], recentDone: [] });
  });

  it('permissions: own team only; an admin must pick one', async () => {
    await refused(tasks.teamOverview(arun, { team: 'accounts' }), 403);
    await refused(tasks.teamOverview(admin, {}), 400);
    const noTeam = await person('staff', null, 'Plain');
    await refused(tasks.teamOverview(noTeam, {}), 403);
    expect((await tasks.teamOverview(admin, { team: 'sales' })).team).toBe('sales');
  });
});
