/**
 * A project's Details box, its slips and the owner's daily reminder
 * (services/staffProjectDetailsService.js, projectSlipService.js,
 * projectReminderService.js). Mongo is real; push is a double.
 *
 * What must hold:
 *   - only fields of the chosen form are stored, each checked for its type;
 *     empty fields are dropped, a wrong form or unknown field is refused
 *   - the owner, the admin and the project's people change details; a head who
 *     only sees it through their team reads; a deleted project is read-only
 *   - a stale rev is refused (two people editing never overwrite silently)
 *   - "fill from order" needs an order-handling team, and saves nothing
 *   - a slip prints from stored details; a missing field is a blank line and is
 *     listed, never a refusal; the balance is worked out on the server
 *   - the reminder: once per owner per day — a doubled or retried run notifies
 *     once, someone who already saw the pop-up is not notified, "Got it" sticks
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushes = [];
const pushMock = {
  pushConfigured: () => true, publicKey: () => 'k', cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}),
  sendToUsers: async (recipients, message) => { pushes.push({ to: recipients.map((r) => r.userId), ...message }); return recipients.length; },
  sendTest: async () => ({ sent: 1 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: mongoose } = await import('mongoose');
const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const { default: StaffProjectReminder } = await import('../models/StaffProjectReminder.js');
const { default: Order } = await import('../models/Order.js');
const projects = await import('../services/staffProjectService.js');
const details = await import('../services/staffProjectDetailsService.js');
const reminders = await import('../services/projectReminderService.js');
const slips = await import('../services/slipTemplateService.js');
const { renderProjectSlip, printed } = await import('../services/projectSlipService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `pd${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const as = async (u) => User.findById(u._id);
const status = (code, promise, msg) => expect(promise).rejects.toMatchObject({ statusCode: code, ...(msg && { message: expect.stringMatching(msg) }) });

const HILUX = {
  customerName: 'Vicky', customerPhone: '+91 98470 12345', customerAddress: '12 MG Road,\nKochi',
  vehicleModel: 'Toyota Hilux 2024', vehicleReg: 'kl 07 ab 1234', vehicleReceivedOn: '2026-11-10',
  odometerKm: '18,250', workToDo: 'Seat covers, roof rack, ceramic coating', deliveryOn: '2026-11-20',
  amountQuoted: '85,000.50', advancePaid: 25000,
};

let admin, nevin, opsMember, salesHead, devMember;
let project;
const save = async (actor, input, p = project) => {
  const fresh = await StaffProject.findById(p.id).lean();
  return details.updateDetails(await as(actor), p.id, { rev: fresh.rev, template: 'sales', ...input }, req);
};

beforeAll(async () => { await StaffProject.init(); await StaffProjectReminder.init(); await StaffTask.init(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Vyshnav');
  nevin = await person('staff', { team: 'operations', isHead: true }, 'Nevin');
  opsMember = await person('staff', { team: 'operations' }, 'Ravi');
  salesHead = await person('staff', { team: 'sales', isHead: true }, 'Sam');
  devMember = await person('staff', { team: 'developer' }, 'Dev');
  project = (await projects.createProject(await as(admin), {
    name: 'Vicky’s Hilux', ownerId: String(nevin._id), memberIds: [String(opsMember._id), String(devMember._id)],
  }, req)).project;
});

describe('details: what is stored', () => {
  it('stores the sales form, cleaned and typed, and shows the balance', async () => {
    await save(opsMember, { values: HILUX, custom: [{ label: 'Key tag', value: '14' }, { label: '', value: '' }] });
    const p = await projects.getProject(await as(nevin), project.id);
    expect(p.details).toMatchObject({
      template: 'sales',
      values: {
        customerName: 'Vicky', vehicleReg: 'KL 07 AB 1234', odometerKm: 18250,
        amountQuoted: 85000.5, advancePaid: 25000, customerAddress: '12 MG Road,\nKochi',
      },
      custom: [{ label: 'Key tag', value: '14' }],
      balance: 60000.5,
      updatedByName: 'Ravi',
    });
    expect(p.slips.map((s) => s.key)).toEqual(['delivery', 'job_card', 'vehicle_authorisation', 'rto_letter', 'office_supplies', 'summary']);
    expect(p.slips.find((s) => s.key === 'delivery').missing).toEqual([]);
    expect(p.slips.find((s) => s.key === 'job_card').missing).toEqual([]);
    expect(p.can).toMatchObject({ editDetails: true });
  });

  it('empty fields are dropped, not stored as blanks; an empty form is fine', async () => {
    await save(opsMember, { values: { customerName: '   ', customerPhone: '', vehicleModel: null, workToDo: 'Wrap' } });
    let stored = (await StaffProject.findById(project.id).lean()).details;
    expect(stored.values).toEqual({ workToDo: 'Wrap' });
    await save(opsMember, { values: {} });
    stored = (await StaffProject.findById(project.id).lean()).details;
    expect(stored.values).toEqual({});
    const p = await projects.getProject(await as(nevin), project.id);
    expect(p.details.balance).toBeNull();
    expect(p.slips.find((s) => s.key === 'delivery').missing).toEqual(
      ['Customer name', 'Phone', 'Vehicle model', 'Registration no.', 'Work being done', 'Amount quoted (₹)'],
    );
  });

  it('a project with no details yet shows none', async () => {
    expect((await projects.getProject(await as(nevin), project.id)).details).toBeNull();
  });

  it('refuses a wrong form, an unknown field, and badly typed values', async () => {
    await status(400, save(opsMember, { template: 'spaceship' }), /Pick one of the forms/);
    await status(400, save(opsMember, { template: undefined }), /Pick one of the forms/);
    await status(400, save(opsMember, { values: { colour: 'red' } }), /not a field of the Sales/);
    // A general project has no set fields: a sales field is unknown there.
    await status(400, save(opsMember, { template: 'general', values: { customerName: 'Vicky' } }), /not a field of the General/);
    await status(400, save(opsMember, { values: { vehicleReceivedOn: '2026-02-30' } }), /valid date/);
    await status(400, save(opsMember, { values: { amountQuoted: '-5' } }), /0 or more/);
    await status(400, save(opsMember, { values: { amountQuoted: '12abc' } }), /enter a number/);
    await status(400, save(opsMember, { values: { amountQuoted: 1e12 } }), /too large/);
    await status(400, save(opsMember, { values: { customerPhone: 'call me' } }), /phone number/);
    await status(400, save(opsMember, { values: { customerName: 'x'.repeat(81) } }), /under 80/);
    await status(400, save(opsMember, { values: { customerName: { $gt: '' } } }), /enter text/);
    await status(400, save(opsMember, { values: ['a'] }), /list of fields/);
    await status(400, save(opsMember, { custom: [{ label: '', value: 'orphan' }] }), /name/);
    await status(400, save(opsMember, { custom: Array.from({ length: 21 }, (_, i) => ({ label: `f${i}`, value: 'v' })) }), /at most 20/);
    expect((await StaffProject.findById(project.id).lean()).details).toBeNull();
  });

  it('money keeps paise exactly: 0.1 + 0.2 never reaches a slip as 0.30000000000000004', async () => {
    await save(opsMember, { values: { amountQuoted: 0.3, advancePaid: 0.1 } });
    const p = await projects.getProject(await as(nevin), project.id);
    expect(p.details.balance).toBe(0.2);
    expect(details.balanceOf({ amountQuoted: 100, advancePaid: 150 })).toBe(-50);
  });

  it('a stale rev is refused, so two people never overwrite each other', async () => {
    const fresh = await StaffProject.findById(project.id).lean();
    await details.updateDetails(await as(opsMember), project.id, { rev: fresh.rev, template: 'sales', values: { customerName: 'Vicky' } }, req);
    await status(409, details.updateDetails(await as(nevin), project.id, { rev: fresh.rev, template: 'sales', values: { customerName: 'Vikki' } }, req));
    await status(400, details.updateDetails(await as(nevin), project.id, { template: 'sales' }, req), /Reload/);
    expect((await StaffProject.findById(project.id).lean()).details.values.customerName).toBe('Vicky');
  });
});

describe('details: who may change them', () => {
  it('the owner, the admin and the project’s people may; a head who only sees it may not', async () => {
    await save(nevin, { values: { customerName: 'A' } });
    await save(admin, { values: { customerName: 'B' } });
    await save(devMember, { values: { customerName: 'C' } });
    const outsider = await person('staff', { team: 'sales' }, 'Out');
    await status(404, save(outsider, { values: { customerName: 'X' } }));
    // Head of a member's team (operations: Nevin is head AND owner) — use developer's head.
    const devHead = await person('staff', { team: 'developer', isHead: true }, 'DevHead');
    await status(403, save(devHead, { values: { customerName: 'X' } }), /project’s people/);
    const seen = await projects.getProject(await as(devHead), project.id);
    expect(seen.can.editDetails).toBe(false);
    expect(seen.details.values.customerName).toBe('C');
  });

  it('a deleted project cannot be changed', async () => {
    const fresh = await StaffProject.findById(project.id).lean();
    await projects.updateProject(await as(admin), project.id, { rev: fresh.rev, archived: true }, req);
    await status(409, save(admin, { values: { customerName: 'X' } }), /Restore it first/);
  });
});

describe('details: filling from an order', () => {
  let orderId;
  beforeEach(async () => {
    orderId = new mongoose.Types.ObjectId();
    await Order.collection.insertOne({
      _id: orderId, wpId: 45123, listDate: new Date(), status: 'processing',
      shippingAddress: { fullName: 'Vicky Kumar', phone: '9847012345', addressLine1: '12 MG Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    });
  });

  it('finds the order by link, website number or short panel number, and saves nothing', async () => {
    const want = { values: { customerName: 'Vicky Kumar', customerPhone: '9847012345', customerAddress: '12 MG Road, Kochi, Kerala, 682001' } };
    const short = `#${String(orderId).slice(-8).toUpperCase()}`;
    for (const q of [`https://x.test/team/orders/${orderId}`, '#45123', '45123', short]) {
      expect(await details.previewFromOrder(await as(opsMember), project.id, q)).toMatchObject(want);
    }
    expect((await StaffProject.findById(project.id).lean()).details).toBeNull();
    await status(404, details.previewFromOrder(await as(opsMember), project.id, '#99999'), /No order found/);
    await status(404, details.previewFromOrder(await as(opsMember), project.id, ''), /No order found/);
  });

  it('a short number of digits only is still found (it is not mistaken for a website number)', async () => {
    const digits = new mongoose.Types.ObjectId('6afc02a6515b687c12345678');
    await Order.collection.insertOne({ _id: digits, listDate: new Date(), shippingAddress: { fullName: 'Digits' } });
    expect(String((await details.findOrder('#12345678'))._id)).toBe(String(digits));
    expect(String((await details.findOrder('12345678'))._id)).toBe(String(digits));
    // A real website number still wins.
    await Order.collection.insertOne({ _id: new mongoose.Types.ObjectId(), wpId: 12345678, listDate: new Date(), shippingAddress: { fullName: 'Website' } });
    expect((await details.findOrder('#12345678')).wpId).toBe(12345678);
  });

  it('a short number older than the look-back window is not searched for', async () => {
    const old = new mongoose.Types.ObjectId();
    await Order.collection.insertOne({ _id: old, listDate: new Date('2020-01-01'), shippingAddress: { fullName: 'Old' } });
    expect(await details.findOrder(String(old).slice(-8))).toBeNull();
  });

  it('only order-handling teams (or the admin) may fill from an order or link one', async () => {
    await status(403, details.previewFromOrder(await as(devMember), project.id, '#45123'), /sales, operations, accounts/);
    await status(403, save(devMember, { orderId: String(orderId) }), /link an order/);
    await save(opsMember, { orderId: String(orderId), values: { customerName: 'Vicky Kumar' } });
    const p = await projects.getProject(await as(nevin), project.id);
    expect(p.details.order).toEqual({ id: String(orderId), number: '#45123' });
    // Saving again without orderId keeps the link; null clears it.
    await save(devMember, { values: { customerName: 'Vicky' } });
    expect((await projects.getProject(await as(nevin), project.id)).details.order?.number).toBe('#45123');
    await save(opsMember, { orderId: null });
    expect((await projects.getProject(await as(nevin), project.id)).details.order).toBeNull();
    await status(400, save(opsMember, { orderId: String(new mongoose.Types.ObjectId()) }), /no longer exists/);
  });
});

describe('slips', () => {
  it('a delivery slip prints every stored field and the server’s balance', async () => {
    await save(opsMember, { values: HILUX });
    const s = await slips.loadSlip(await as(opsMember), project.id, 'delivery');
    expect(s).toMatchObject({ title: 'DELIVERY SLIP', projectName: 'Vicky’s Hilux', owner: 'Nevin', missing: [] });
    const rows = Object.fromEntries(s.blocks.flatMap((x) => x.rows || []).map((r) => [r.key, r.value]));
    expect(rows).toMatchObject({ customerName: 'Vicky', vehicleReg: 'KL 07 AB 1234', balance: 60000.5 });
    const pdf = await renderProjectSlip(s);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('a slip with missing fields still prints: blanks, and the list of what is missing', async () => {
    await save(opsMember, { values: { customerName: 'Vicky' } });
    const s = await slips.loadSlip(await as(opsMember), project.id, 'delivery');
    expect(s.missing).toEqual(['Phone', 'Vehicle model', 'Registration no.', 'Work being done', 'Amount quoted (₹)']);
    const phone = s.blocks.flatMap((x) => x.rows || []).find((r) => r.key === 'customerPhone');
    expect(phone.value).toBe('');
    expect(printed(phone)).toBe('');
    expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses a slip the form does not offer, an unknown slip, or a sales slip with no details', async () => {
    await status(409, slips.loadSlip(await as(opsMember), project.id, 'delivery'), /Fill in the project’s details on the Sales job/);
    await status(404, slips.loadSlip(await as(opsMember), project.id, 'invoice'), /Pick one of the slips/);
    await save(opsMember, { template: 'general', custom: [{ label: 'Venue', value: 'Lulu Mall' }] });
    await status(409, slips.loadSlip(await as(opsMember), project.id, 'job_card'), /needs the Sales/);
    const summary = await slips.loadSlip(await as(opsMember), project.id, 'summary');
    expect(summary.blocks).toEqual([{ type: 'section', title: 'Other details', rows: [expect.objectContaining({ label: 'Venue', value: 'Lulu Mall' })] }]);
  });

  it('the summary slip works on a project with no details at all', async () => {
    const s = await slips.loadSlip(await as(nevin), project.id, 'summary');
    expect(s.blocks).toEqual([]);
    expect((await renderProjectSlip(s)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('only people who see the project get its slip', async () => {
    await save(opsMember, { values: HILUX });
    const outsider = await person('staff', { team: 'sales' }, 'Out');
    await status(404, slips.loadSlip(await as(outsider), project.id, 'delivery'));
  });

  it('the slip reference uses the project code once projects are numbered', () => {
    expect(slips.projectRef({ _id: new mongoose.Types.ObjectId('0123456789abcdef01234567'), number: 7 })).toBe('PRJ-0007');
    expect(slips.projectRef({ _id: new mongoose.Types.ObjectId('0123456789abcdef01234567') })).toBe('#234567');
  });

  it('formats printed values', () => {
    expect(printed({ type: 'date', value: '2026-11-20' })).toBe('20 Nov 2026');
    expect(printed({ type: 'number', value: 18250 })).toBe('18,250');
    expect(printed({ type: 'money', value: 60000.5 })).toMatch(/60,000\.50$/);
  });
});

describe('the daily reminder', () => {
  // 10:30 IST on 10 March 2030, and 09:30 IST the same day.
  const AT_1030 = new Date('2030-03-10T05:00:00Z');
  const AT_0930 = new Date('2030-03-10T04:00:00Z');
  let num = 0;
  const task = (title, dueOn, over = {}) => StaffTask.collection.insertOne({
    number: (num += 1), title, dueOn, project: new mongoose.Types.ObjectId(project.id), bucket: 'open', rank: dueOn || '9999-12-31', personal: false, ...over,
  });

  beforeEach(async () => {
    await task('Fit seat covers', '2030-03-08');
    await task('Roof rack', '2030-03-10');
    await task('Ceramic coating', '2030-03-15');
    await task('Done already', '2030-03-01', { bucket: 'done' });
    await task('Someone’s personal note', '2030-03-01', { personal: true });
  });

  it('tells the owner what is open, due today and late — and nobody else', async () => {
    const r = await reminders.getReminder(await as(nevin), AT_1030);
    expect(r.day).toBe('2030-03-10');
    expect(r.projects).toEqual([expect.objectContaining({
      name: 'Vicky’s Hilux', open: 3, late: 1, dueToday: 1,
      lateTasks: [expect.objectContaining({ title: 'Fit seat covers' })],
      dueTodayTasks: [expect.objectContaining({ title: 'Roof rack' })],
    })]);
    expect(r.totals).toEqual({ open: 3, late: 1, dueToday: 1 });
    expect(await reminders.getReminder(await as(opsMember), AT_1030)).toBeNull();
    expect(await reminders.getReminder(await as(admin), AT_1030)).toBeNull();
  });

  it('not before the reminder hour, and not when nothing is open', async () => {
    expect(await reminders.getReminder(await as(nevin), AT_0930)).toBeNull();
    await StaffTask.collection.updateMany({}, { $set: { bucket: 'done' } });
    expect(await reminders.getReminder(await as(nevin), AT_1030)).toBeNull();
    expect(await StaffProjectReminder.countDocuments()).toBe(0);
  });

  it('“Got it” keeps it away for the rest of the day; repeating it is harmless', async () => {
    const r = await reminders.getReminder(await as(nevin), AT_1030);
    await reminders.dismissReminder(await as(nevin), r.day, AT_1030);
    await reminders.dismissReminder(await as(nevin), r.day, AT_1030);
    expect(await reminders.getReminder(await as(nevin), AT_1030)).toBeNull();
    await status(400, reminders.dismissReminder(await as(nevin), 'today'));
    // Tomorrow it comes back.
    expect(await reminders.getReminder(await as(nevin), new Date('2030-03-11T05:00:00Z'))).not.toBeNull();
  });

  it('the 10:00 run notifies once: a second, retried or simultaneous run sends nothing more', async () => {
    const a = await reminders.runDailyReminders(AT_1030);
    expect(a).toMatchObject({ withWork: 1, sent: 1 });
    const b = await reminders.runDailyReminders(AT_1030);
    expect(b).toMatchObject({ withWork: 1, sent: 0, already: 1 });
    await Promise.all([reminders.runDailyReminders(AT_1030), reminders.runDailyReminders(AT_1030)]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      to: [String(nevin._id)], title: 'Your projects today — some are late',
      body: 'Vicky’s Hilux: 3 open, 1 late, 1 due today', tag: 'project-reminder-2030-03-10',
    });
    expect(await StaffProjectReminder.countDocuments({ user: nevin._id, day: '2030-03-10' })).toBe(1);
  });

  it('simultaneous first runs still make one row and one notification', async () => {
    await Promise.all([1, 2, 3, 4].map(() => reminders.runDailyReminders(AT_1030)));
    expect(pushes).toHaveLength(1);
    expect(await StaffProjectReminder.countDocuments()).toBe(1);
  });

  it('a notification that failed mid-send is not retried (at most once)', async () => {
    const boom = async () => { throw new Error('push service down'); };
    const a = await reminders.runDailyReminders(AT_1030, { send: boom });
    expect(a.failed).toBe(1);
    await reminders.runDailyReminders(AT_1030);
    expect(pushes).toHaveLength(0);
    // The pop-up still shows: it is the reliable channel.
    expect(await reminders.getReminder(await as(nevin), AT_1030)).not.toBeNull();
  });

  it('someone who already saw the pop-up is not notified as well', async () => {
    await reminders.getReminder(await as(nevin), AT_1030);
    const r = await reminders.runDailyReminders(AT_1030);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(pushes).toHaveLength(0);
  });

  it('a deleted project, or one marked done, is not reminded about', async () => {
    await StaffProject.updateOne({ _id: project.id }, { $set: { statusOverride: 'done' } });
    expect(await reminders.getReminder(await as(nevin), AT_1030)).toBeNull();
    await StaffProject.updateOne({ _id: project.id }, { $set: { statusOverride: null, archivedAt: new Date() } });
    expect(await reminders.getReminder(await as(nevin), AT_1030)).toBeNull();
    expect((await reminders.runDailyReminders(AT_1030)).withWork).toBe(0);
  });

  it('an owner who left the panel gets nothing', async () => {
    await User.updateOne({ _id: nevin._id }, { $set: { 'staff.active': false } });
    expect((await reminders.runDailyReminders(AT_1030)).owners).toBe(0);
    expect(pushes).toHaveLength(0);
  });

  it('summarises many projects in one line', () => {
    const p = (name, open, late = 0, dueToday = 0) => ({ name, open, late, dueToday });
    expect(reminders.summaryLine([p('A', 2), p('B', 1, 1), p('C', 4, 0, 2), p('D', 1), p('E', 1)]))
      .toBe('A: 2 open · B: 1 open, 1 late · C: 4 open, 2 due today · +2 more');
  });
});
