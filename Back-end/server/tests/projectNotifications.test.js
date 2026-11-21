/**
 * Project notifications (services/projectAlertService.js,
 * services/projectReminderService.js, staffTaskInboxService recentAlerts):
 *
 *   - added to a project → an Inbox line and ONE notification, never twice,
 *     never to whoever did it, never to someone who left the panel
 *   - the panel's "new work" pop-up reads the newest unread lines
 *   - the morning reminder for every member: overdue → today → soon, undated
 *     on Mondays only, done/deleted work never, once per person per day even on
 *     a doubled or retried run, quiet on Sundays and holidays, days in IST
 *   - owners see who has late work; the admin sees everyone with late work
 *
 * Mongo is real; push is a double that records what would have been sent —
 * nothing reaches a real device.
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushes = [];
const pushMock = {
  pushConfigured: () => true, publicKey: () => 'k', cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}),
  sendToUsers: async (recipients, message) => { pushes.push({ to: recipients.map((r) => r.userId), url: recipients[0]?.url, ...message }); return recipients.length; },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: mongoose } = await import('mongoose');
const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const { default: StaffProjectReminder } = await import('../models/StaffProjectReminder.js');
const projects = await import('../services/staffProjectService.js');
const inbox = await import('../services/staffTaskInboxService.js');
const { notifyAddedToProject } = await import('../services/projectAlertService.js');
const { summaryFor } = await import('../services/notificationService.js');
const reminders = await import('../services/projectReminderService.js');
const { staffHolidays } = await import('../config/projectTemplates.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `pn${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = async (u) => User.findById(u._id);
const ids = (list) => list.map((u) => String(u._id));

let admin, vicky, nevin, ravi;
beforeAll(async () => {
  await Promise.all([StaffProject.init(), StaffTask.init(), StaffTaskInbox.syncIndexes(), StaffProjectReminder.init()]);
});
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Vyshnav');
  vicky = await person('staff', { team: 'sales', isHead: true }, 'Vicky');
  nevin = await person('staff', { team: 'marketing' }, 'Nevin');
  ravi = await person('staff', { team: 'operations' }, 'Ravi');
});

const createHilux = async (by = vicky, memberIds = ids([nevin]), extra = {}) => (await projects.createProject(
  await as(by), { name: 'Vicky’s Hilux', memberIds, ...extra }, req,
)).project;
const rows = (user, kind = 'project_added') => StaffTaskInbox.find({ user: user._id, kind }).lean();

describe('added to a project: told straight away, once', () => {
  it('Vicky creates “Vicky’s Hilux” with Nevin on it → Nevin gets one Inbox line and one notification; Vicky gets none', async () => {
    const p = await createHilux(vicky, ids([nevin]), { dueOn: '2030-03-20' });
    expect(await rows(nevin)).toHaveLength(1);
    expect(await rows(vicky)).toHaveLength(0);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      to: [String(nevin._id)], title: 'Vicky added you to a project', body: 'Vicky’s Hilux · deadline 2030-03-20',
      tag: `project-${p.id}`, url: `/team/tasks?view=project&project=${p.id}`,
    });
  });

  it('the admin starting it for Vicky tells Vicky (as owner) and Nevin', async () => {
    await createHilux(admin, ids([nevin]), { ownerId: String(vicky._id) });
    expect(pushes[0].to.sort()).toEqual(ids([vicky, nevin]).sort());
    expect((await rows(vicky))[0].text).toBe('you own it');
  });

  it('the same notice twice (a retry) writes and sends nothing more', async () => {
    const p = await createHilux();
    const doc = await StaffProject.findById(p.id).lean();
    expect(await notifyAddedToProject(doc, await as(vicky), [nevin._id])).toBe(0);
    expect(await rows(nevin)).toHaveLength(1);
    expect(pushes).toHaveLength(1);
  });

  it('a double-clicked create (same clientId) tells Nevin once', async () => {
    await createHilux(vicky, ids([nevin]), { clientId: 'create-hilux-0001' });
    await createHilux(vicky, ids([nevin]), { clientId: 'create-hilux-0001' });
    expect(await rows(nevin)).toHaveLength(1);
    expect(pushes).toHaveLength(1);
  });

  it('adding Ravi later tells only Ravi; a rename tells nobody; off and back on tells again', async () => {
    const p = await createHilux();
    pushes.length = 0;
    const rev = async () => (await StaffProject.findById(p.id).lean()).rev;
    await projects.updateProject(await as(vicky), p.id, { rev: await rev(), memberIds: ids([nevin, ravi]) }, req);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].to).toEqual(ids([ravi]));
    await projects.updateProject(await as(vicky), p.id, { rev: await rev(), name: 'Vicky’s Hilux 2024' }, req);
    expect(pushes).toHaveLength(1);
    await projects.updateProject(await as(vicky), p.id, { rev: await rev(), memberIds: ids([ravi]) }, req);
    await projects.updateProject(await as(vicky), p.id, { rev: await rev(), memberIds: ids([ravi, nevin]) }, req);
    expect(pushes).toHaveLength(2);
    expect(pushes[1].to).toEqual(ids([nevin]));
    expect(await rows(nevin)).toHaveLength(2);
  });

  it('someone who left the panel is not told', async () => {
    await User.updateOne({ _id: nevin._id }, { $set: { 'staff.active': false } });
    expect(await notifyAddedToProject({ _id: new mongoose.Types.ObjectId(), rev: 1, name: 'X' }, await as(vicky), [nevin._id])).toBe(0);
    expect(pushes).toHaveLength(0);
  });

  it('a lost notification never undoes the project', async () => {
    const boom = async () => { throw new Error('push down'); };
    const doc = { _id: new mongoose.Types.ObjectId(), rev: 3, name: 'Y', owner: { user: vicky._id } };
    await expect(notifyAddedToProject(doc, await as(vicky), [nevin._id], { send: boom })).resolves.toBe(0);
  });

  it('the Inbox shows the line with the project’s name, and says when it no longer opens', async () => {
    const p = await createHilux();
    let page = await inbox.listInbox(await as(nevin));
    expect(page.items).toEqual([expect.objectContaining({
      kind: 'project_added', task: null, project: { id: p.id, name: 'Vicky’s Hilux' }, by: { id: String(vicky._id), name: 'Vicky' }, canOpen: true, read: false,
    })]);
    const rev = (await StaffProject.findById(p.id).lean()).rev;
    await projects.updateProject(await as(vicky), p.id, { rev, memberIds: [] }, req);
    page = await inbox.listInbox(await as(nevin));
    expect(page.items[0]).toMatchObject({ canOpen: false, project: { name: 'Vicky’s Hilux' } });
  });
});

describe('the panel’s “new work” pop-up', () => {
  it('lists the newest unread new-task and added-to-project lines; read ones and old ones drop out', async () => {
    const p = await createHilux();
    const summary = await summaryFor(await as(nevin));
    expect(summary.alerts).toEqual([expect.objectContaining({
      kind: 'project_added', by: 'Vicky', title: 'Vicky’s Hilux', href: `/team/tasks?view=project&project=${p.id}`,
    })]);
    // Read → gone.
    const [row] = await rows(nevin);
    await inbox.setInboxState(await as(nevin), String(row._id), 'read');
    expect((await summaryFor(await as(nevin))).alerts).toEqual([]);
    // Older than the window → gone (still in the Inbox).
    await StaffTaskInbox.updateOne({ _id: row._id }, { $set: { state: 'unread' } });
    const later = new Date(Date.now() + (inbox.ALERT_WINDOW_HOURS + 1) * 3600_000);
    expect(await inbox.recentAlerts(await as(nevin), later)).toEqual([]);
  });

  it('a comment line never pops up', async () => {
    await StaffTaskInbox.create({ user: nevin._id, key: 'c:x', kind: 'comment', task: new mongoose.Types.ObjectId(), number: 4, title: 'T' });
    expect(await inbox.recentAlerts(await as(nevin))).toEqual([]);
  });

  it('the admin’s link goes to the admin panel', async () => {
    const p = await createHilux(vicky, ids([admin]));
    expect((await summaryFor(await as(admin))).alerts[0].href).toBe(`/admin/tasks?view=project&project=${p.id}`);
  });
});

describe('the morning reminder for every member', () => {
  // Tuesday 12 March 2030. 10:30 IST = 05:00 UTC.
  const TUE = '2030-03-12';
  const AT = (day, utc = '05:00') => new Date(`${day}T${utc}:00Z`);
  const NO_HOLIDAYS = new Set();
  let project, num = 0;
  const task = (title, dueOn, people = [nevin], over = {}) => StaffTask.collection.insertOne({
    number: (num += 1), title, dueOn, project: new mongoose.Types.ObjectId(project.id), bucket: 'open',
    rank: dueOn || '9999-12-31', personal: false, status: 'todo',
    assignee: people[0]._id, assignees: people.map((u) => ({ user: u._id, name: u.name })), updatedAt: new Date('2030-03-05T05:00:00Z'), ...over,
  });

  beforeEach(async () => {
    project = await createHilux(vicky, ids([nevin, ravi]));
    pushes.length = 0;
  });

  it('Nevin: overdue first, then today, then due within 2 days; later work only counted; undated not listed on a Tuesday', async () => {
    await task('Fit roof rack', '2030-03-10');
    await task('Order mats', TUE);
    await task('Book alignment', '2030-03-14');
    await task('Ceramic coating', '2030-03-20');
    await task('Find a supplier', null);
    await task('Done already', '2030-03-01', [nevin], { bucket: 'done' });
    await task('Deleted', '2030-03-01', [nevin], { bucket: 'archived' });
    await task('Ravi’s job', '2030-03-01', [ravi]);
    const r = await reminders.getReminder(await as(nevin), AT(TUE), { holidays: NO_HOLIDAYS });
    expect(r.mine.overdue.map((t) => [t.title, t.daysLate])).toEqual([['Fit roof rack', 2]]);
    expect(r.mine.today.map((t) => t.title)).toEqual(['Order mats']);
    expect(r.mine.soon.map((t) => t.title)).toEqual(['Book alignment']);
    expect(r.mine.noDate).toEqual([]);
    expect(r.mine.counts).toEqual({ overdue: 1, today: 1, soon: 1, noDate: 1, later: 1 });
    expect(r.mine.overdue[0].project).toEqual({ id: project.id, name: 'Vicky’s Hilux', colour: 'blue' });
    expect(r.projects).toEqual([]); // Nevin owns nothing
  });

  it('undated work is listed on Mondays only', async () => {
    await task('Find a supplier', null);
    expect(await reminders.getReminder(await as(nevin), AT(TUE), { holidays: NO_HOLIDAYS })).toBeNull();
    const mon = await reminders.getReminder(await as(nevin), AT('2030-03-11'), { holidays: NO_HOLIDAYS });
    expect(mon.weekly).toBe(true);
    expect(mon.mine.noDate.map((t) => t.title)).toEqual(['Find a supplier']);
  });

  it('nothing overdue, due or near → no reminder at all', async () => {
    await task('Ceramic coating', '2030-03-20');
    expect(await reminders.getReminder(await as(nevin), AT(TUE), { holidays: NO_HOLIDAYS })).toBeNull();
    const run = await reminders.runDailyReminders(AT(TUE), { holidays: NO_HOLIDAYS });
    expect(pushes.filter((p) => p.to.includes(String(nevin._id)))).toHaveLength(0);
    expect(run.failed).toBe(0);
  });

  it('done work, a deleted project and a project marked done are never in it', async () => {
    await task('Fit roof rack', '2030-03-10');
    await StaffTask.collection.updateMany({}, { $set: { bucket: 'done' } });
    expect(await reminders.getReminder(await as(nevin), AT(TUE), { holidays: NO_HOLIDAYS })).toBeNull();
    await StaffTask.collection.updateMany({}, { $set: { bucket: 'open' } });
    await StaffProject.updateOne({ _id: project.id }, { $set: { statusOverride: 'done' } });
    expect(await reminders.getReminder(await as(nevin), AT(TUE), { holidays: NO_HOLIDAYS })).toBeNull();
    await StaffProject.updateOne({ _id: project.id }, { $set: { statusOverride: null, archivedAt: new Date() } });
    expect(await reminders.getReminder(await as(nevin), AT(TUE), { holidays: NO_HOLIDAYS })).toBeNull();
  });

  it('one notification per person per day, even when the run is doubled, retried or simultaneous', async () => {
    await task('Fit roof rack', '2030-03-10');
    await reminders.runDailyReminders(AT(TUE), { holidays: NO_HOLIDAYS });
    await reminders.runDailyReminders(AT(TUE), { holidays: NO_HOLIDAYS });
    await Promise.all([1, 2, 3].map(() => reminders.runDailyReminders(AT(TUE), { holidays: NO_HOLIDAYS })));
    const mine = pushes.filter((p) => p.to.includes(String(nevin._id)));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      title: '1 item overdue — please update', body: '1 overdue', tag: `project-reminder-${TUE}`, url: '/team/tasks?view=projects',
    });
    expect(await StaffProjectReminder.countDocuments({ user: nevin._id, day: TUE })).toBe(1);
    // Wednesday is a new day.
    await reminders.runDailyReminders(AT('2030-03-13'), { holidays: NO_HOLIDAYS });
    expect(pushes.filter((p) => p.to.includes(String(nevin._id)))).toHaveLength(2);
  });

  it('quiet on Sundays and on the holiday list: no pop-up, no notification, no row', async () => {
    await task('Fit roof rack', '2030-03-08');
    const sun = await reminders.runDailyReminders(AT('2030-03-10'), { holidays: NO_HOLIDAYS });
    expect(sun).toMatchObject({ quiet: true, sent: 0 });
    expect(await reminders.getReminder(await as(nevin), AT('2030-03-10'), { holidays: NO_HOLIDAYS })).toBeNull();
    const holi = new Set([TUE]);
    expect((await reminders.runDailyReminders(AT(TUE), { holidays: holi })).quiet).toBe(true);
    expect(await reminders.getReminder(await as(nevin), AT(TUE), { holidays: holi })).toBeNull();
    expect(pushes).toHaveLength(0);
    expect(await StaffProjectReminder.countDocuments()).toBe(0);
  });

  it('the holiday list comes from STAFF_HOLIDAYS, else SUPPORT_HOLIDAYS; typos are dropped', () => {
    expect([...staffHolidays({ STAFF_HOLIDAYS: '2030-03-12, nope,2030-10-02' })]).toEqual(['2030-03-12', '2030-10-02']);
    expect([...staffHolidays({ SUPPORT_HOLIDAYS: '2030-01-26' })]).toEqual(['2030-01-26']);
    expect([...staffHolidays({ STAFF_HOLIDAYS: '', SUPPORT_HOLIDAYS: '2030-01-26' })]).toEqual([]);
  });

  it('times and days are India time: from 09:30 IST, and 00:30 IST is already the next day', async () => {
    await task('Fit roof rack', '2030-03-11');
    // 09:29 IST = 03:59 UTC: not yet.
    expect(await reminders.getReminder(await as(nevin), AT(TUE, '03:59'), { holidays: NO_HOLIDAYS })).toBeNull();
    // 09:30 IST = 04:00 UTC: now.
    expect(await reminders.getReminder(await as(nevin), AT(TUE, '04:00'), { holidays: NO_HOLIDAYS })).not.toBeNull();
    // 23:00 UTC on the 12th is 04:30 IST on the 13th — the IST day, not the UTC one (and before 09:30).
    expect(await reminders.getReminder(await as(nevin), new Date('2030-03-12T23:00:00Z'), { holidays: NO_HOLIDAYS })).toBeNull();
    expect(reminders.reminderCron()).toBe('30 9 * * *');
    expect(reminders.weekdayOf('2030-03-10')).toBe(0);
  });

  it('a member is warned about a near project deadline; the owner sees who has late work', async () => {
    await StaffProject.updateOne({ _id: project.id }, { $set: { dueOn: '2030-03-13' } });
    await task('Fit roof rack', '2030-03-09');
    const nev = await reminders.getReminder(await as(nevin), AT(TUE), { holidays: NO_HOLIDAYS });
    expect(nev.deadlines).toEqual([expect.objectContaining({ name: 'Vicky’s Hilux', dueOn: '2030-03-13', daysLate: 0, open: 1 })]);
    const vic = await reminders.getReminder(await as(vicky), AT(TUE), { holidays: NO_HOLIDAYS });
    expect(vic.deadlines).toEqual([]); // the owner sees it in their own section
    expect(vic.projects[0].notUpdated).toEqual([{
      id: String(nevin._id), name: 'Nevin', late: 1, daysLate: 3, lastUpdate: '2030-03-05T05:00:00.000Z',
    }]);
  });

  it('the admin sees everyone with late project work', async () => {
    await task('Fit roof rack', '2030-03-09');
    await task('Wash', '2030-03-11', [ravi]);
    const r = await reminders.getReminder(await as(admin), AT(TUE), { holidays: NO_HOLIDAYS });
    expect(r.team.map((p) => [p.name, p.late, p.daysLate])).toEqual([['Nevin', 1, 3], ['Ravi', 1, 1]]);
    expect(reminders.pushText(r).body).toBe('2 people with late work');
  });
});
