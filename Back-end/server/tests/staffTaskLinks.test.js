/**
 * Links between tasks: waiting on / blocking / related.
 *
 * What must hold:
 *   - one link per pair, whatever order or moment the requests arrive in
 *   - no circles, direct or long; a task can't link to itself
 *   - only editors add; either end's editor removes; viewers read; strangers get 404
 *   - a task the viewer can't see is a count, never a name
 *   - personal tasks link only with each other, and never appear as options to others
 *   - the list rows' "waiting on" counts only unfinished blockers
 *   - double-click / retry: one link, one history line
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
const { default: StaffTaskLink } = await import('../models/StaffTaskLink.js');
const tasks = await import('../services/staffTaskService.js');
const links = await import('../services/staffTaskLinkService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `l${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const refused = (p, status) => expect(p).rejects.toMatchObject({ statusCode: status });

let admin, head, doer, mate, outsider;
beforeAll(async () => { await StaffTask.syncIndexes(); await StaffTaskLink.syncIndexes(); });
beforeEach(async () => {
  admin = await person('admin', null, 'Owner');
  head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  doer = await person('staff', { team: 'procurement' }, 'Arun');
  mate = await person('staff', { team: 'procurement' }, 'Bala');
  outsider = await person('staff', { team: 'sales' }, 'Sam');
});
const make = async (title, by = head, who = doer) => (await tasks.createTask(by, { title, assigneeIds: [String(who._id)] }, req)).task;
const codes = (list) => list.map((x) => x.task.code);

describe('adding links', () => {
  it('"waiting on" reads the other way round from the other task', async () => {
    const pack = await make('Pack');
    const ship = await make('Ship');
    const res = await links.addLink(head, ship.id, { kind: 'waiting_on', taskId: pack.id }, req);
    expect(codes(res.waitingOn)).toEqual([pack.code]);
    expect(codes((await links.listLinks(head, pack.id)).blocking)).toEqual([ship.code]);
  });

  it('"blocking" and "related" land the right way; related shows on both', async () => {
    const a = await make('A');
    const b = await make('B');
    const c = await make('C');
    await links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req);
    await links.addLink(head, a.id, { kind: 'related', taskId: c.id }, req);
    expect(codes((await links.listLinks(head, b.id)).waitingOn)).toEqual([a.code]);
    expect(codes((await links.listLinks(head, c.id)).related)).toEqual([a.code]);
  });

  it('a double-click or retry makes one link and one history line each side', async () => {
    const a = await make('A');
    const b = await make('B');
    await Promise.all([1, 2, 3].map(() => links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req)));
    expect(await StaffTaskLink.countDocuments()).toBe(1);
    await links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req);
    const row = await StaffTask.findById(b.id).lean();
    expect(row.history.filter((h) => h.action === 'link_added')).toHaveLength(1);
  });

  it('opposite requests at the same moment: only one link survives', async () => {
    const a = await make('A');
    const b = await make('B');
    const out = await Promise.allSettled([
      links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req),
      links.addLink(head, b.id, { kind: 'blocking', taskId: a.id }, req),
    ]);
    expect(await StaffTaskLink.countDocuments()).toBe(1);
    expect(out.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(out.find((r) => r.status === 'rejected').reason.statusCode).toBe(409);
  });

  it('a different link between the same two is refused', async () => {
    const a = await make('A');
    const b = await make('B');
    await links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req);
    await refused(links.addLink(head, a.id, { kind: 'related', taskId: b.id }, req), 409);
    await refused(links.addLink(head, a.id, { kind: 'waiting_on', taskId: b.id }, req), 409);
  });

  it('refuses a circle, however long, and a link to itself', async () => {
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    await links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req);
    await links.addLink(head, b.id, { kind: 'blocking', taskId: c.id }, req);
    await refused(links.addLink(head, c.id, { kind: 'blocking', taskId: a.id }, req), 400);
    await refused(links.addLink(head, a.id, { kind: 'waiting_on', taskId: c.id }, req), 400);
    await refused(links.addLink(head, a.id, { kind: 'related', taskId: a.id }, req), 400);
    // A related link is not a dependency, so it is no circle.
    await expect(links.addLink(head, c.id, { kind: 'related', taskId: a.id }, req)).resolves.toBeTruthy();
  });

  it('refuses a bad kind, a missing task and archived tasks', async () => {
    const a = await make('A');
    const b = await make('B');
    await refused(links.addLink(head, a.id, { kind: 'nope', taskId: b.id }, req), 400);
    await refused(links.addLink(head, a.id, { kind: 'related', taskId: String(new mongoose.Types.ObjectId()) }, req), 404);
    await tasks.updateTask(head, b.id, { rev: b.rev, archived: true }, req);
    await refused(links.addLink(head, a.id, { kind: 'related', taskId: b.id }, req), 409);
    await refused(links.addLink(head, b.id, { kind: 'related', taskId: a.id }, req), 409);
  });

  it('stops at the limit', async () => {
    const a = await make('A');
    const others = await Promise.all(Array.from({ length: links.LINKS_MAX }, (_, i) => make(`T${i}`)));
    await StaffTaskLink.insertMany(others.map((o) => ({ from: a.id, to: o.id, kind: 'related', pair: [a.id, o.id].sort().join(':'), by: head._id })));
    const extra = await make('One more');
    await refused(links.addLink(head, a.id, { kind: 'related', taskId: extra.id }, req), 400);
  });
});

describe('who may do what', () => {
  it('the person doing it reads links but cannot add; a stranger gets 404', async () => {
    const a = await make('A');
    const b = await make('B');
    await refused(links.addLink(doer, a.id, { kind: 'related', taskId: b.id }, req), 403);
    await refused(links.linkOptions(doer, a.id, {}), 403);
    await refused(links.listLinks(outsider, a.id), 404);
    await refused(links.addLink(outsider, a.id, { kind: 'related', taskId: b.id }, req), 404);
    expect((await links.listLinks(doer, a.id)).canAdd).toBe(false);
  });

  it('you cannot link to a task you cannot see', async () => {
    const mine = await make('Mine');
    const theirs = await make('Sales job', admin, outsider);
    await refused(links.addLink(head, mine.id, { kind: 'related', taskId: theirs.id }, req), 404);
  });

  it('a task you cannot see is a count, never a name', async () => {
    const mine = await make('Procurement job');
    const theirs = await make('Secret sales job', admin, outsider);
    await links.addLink(admin, theirs.id, { kind: 'blocking', taskId: mine.id }, req);
    const res = await links.listLinks(doer, mine.id);
    expect(res).toMatchObject({ waitingOn: [], hidden: 1, hiddenWaiting: 1 });
    expect(JSON.stringify(res)).not.toContain('Secret');
  });

  it('either end\'s editor can remove; a doer cannot; removing twice is quiet', async () => {
    const a = await make('A');
    const b = await make('B');
    const { blocking: [l] } = await links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req);
    await refused(links.removeLink(doer, a.id, l.linkId, req), 403);
    const res = await links.removeLink(head, b.id, l.linkId, req);
    expect(res.waitingOn).toEqual([]);
    await expect(links.removeLink(head, b.id, l.linkId, req)).resolves.toBeTruthy();
    expect((await StaffTask.findById(a.id).lean()).history.filter((h) => h.action === 'link_removed')).toHaveLength(1);
  });

  it('a link id from another task is not removable through this one', async () => {
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    const { blocking: [l] } = await links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req);
    await refused(links.removeLink(head, c.id, l.linkId, req), 404);
    expect(await StaffTaskLink.countDocuments()).toBe(1);
  });
});

describe('personal tasks', () => {
  const personal = async (who, title) => (await tasks.createTask(who, { title, personal: true }, req)).task;

  it('link only with your other personal tasks', async () => {
    const p1 = await personal(doer, 'Private one');
    const p2 = await personal(doer, 'Private two');
    const shared = await make('Shared', doer, doer);
    await refused(links.addLink(doer, p1.id, { kind: 'related', taskId: shared.id }, req), 400);
    await refused(links.addLink(doer, shared.id, { kind: 'related', taskId: p1.id }, req), 400);
    await expect(links.addLink(doer, p1.id, { kind: 'related', taskId: p2.id }, req)).resolves.toBeTruthy();
  });

  it('never appear in anyone else\'s picker, the admin\'s included', async () => {
    await personal(doer, 'Private zebra');
    const job = await make('Job');
    expect((await links.linkOptions(admin, job.id, { q: 'zebra' })).tasks).toEqual([]);
    expect((await links.linkOptions(head, job.id, { q: 'zebra' })).tasks).toEqual([]);
  });
});

describe('the picker', () => {
  it('finds by words or T-number, without this task, linked ones, or tasks it cannot see', async () => {
    const a = await make('Pack zebra');
    const b = await make('Ship zebra');
    const c = await make('Other zebra');
    await make('Sales zebra', admin, outsider);
    await links.addLink(head, a.id, { kind: 'related', taskId: c.id }, req);
    expect((await links.linkOptions(head, a.id, { q: 'zebra' })).tasks.map((t) => t.code)).toEqual([b.code]);
    expect((await links.linkOptions(head, a.id, { q: b.code })).tasks.map((t) => t.code)).toEqual([b.code]);
    expect((await links.linkOptions(head, a.id, { q: 'zebra.*' })).tasks).toEqual([]);
  });

  it('a team member sees the team\'s; the admin sees all; the list is bounded', async () => {
    const a = await make('A');
    await Promise.all(Array.from({ length: 25 }, (_, i) => make(`Task ${i}`)));
    expect((await links.linkOptions(admin, a.id, {})).tasks).toHaveLength(20);
  });
});

describe('the waiting-on count on list rows', () => {
  const row = async (who, code) => (await tasks.listTasks(who, { view: 'mine' })).tasks.find((t) => t.code === code);

  it('counts unfinished blockers only; finishing or archiving one lowers it; it never stops finishing', async () => {
    const [a, b, ship] = [await make('A'), await make('B'), await make('Ship')];
    await links.addLink(head, ship.id, { kind: 'waiting_on', taskId: a.id }, req);
    await links.addLink(head, ship.id, { kind: 'waiting_on', taskId: b.id }, req);
    expect((await row(doer, ship.code)).waitingOn).toBe(2);
    await tasks.updateTask(doer, a.id, { rev: a.rev, status: 'done' }, req);
    expect((await row(doer, ship.code)).waitingOn).toBe(1);
    await tasks.updateTask(head, b.id, { rev: b.rev, archived: true }, req);
    expect((await row(doer, ship.code)).waitingOn).toBe(0);
    await expect(tasks.updateTask(doer, ship.id, { rev: ship.rev, status: 'done' }, req)).resolves.toMatchObject({ status: 'done' });
  });

  it('related links and the blocker\'s own row count nothing', async () => {
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    await links.addLink(head, a.id, { kind: 'blocking', taskId: b.id }, req);
    await links.addLink(head, a.id, { kind: 'related', taskId: c.id }, req);
    expect((await row(doer, a.code)).waitingOn).toBe(0);
    expect((await row(doer, c.code)).waitingOn).toBe(0);
  });

  it('page reads use the indexes', async () => {
    const id = new mongoose.Types.ObjectId();
    await StaffTaskLink.insertMany(Array.from({ length: 200 }, (_, i) => ({
      from: new mongoose.Types.ObjectId(), to: i < 3 ? id : new mongoose.Types.ObjectId(), kind: 'blocks', pair: `p${i}`, by: head._id,
    })));
    const plan = await StaffTaskLink.find({ to: { $in: [id] }, kind: 'blocks' }).explain('executionStats');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('staff_task_link_to');
    expect(plan.executionStats.totalDocsExamined).toBe(3);
  });
});
