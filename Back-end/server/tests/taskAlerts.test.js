/**
 * Task deadline alerts (services/taskAlertService.js, config/taskAlerts.js) — owner,
 * 2026-11-24: "you have only X time left, please do this", then a reason when it is
 * missed, then the managers hear. Mongo is real; the sweep is run at fixed moments.
 *
 * What must hold:
 *   - the people doing it hear "due today", then "only Xh left", then "late — say
 *     why"; whoever gave it hears it is late; the heads 4 office hours later; the
 *     admins 1 office day later — each ONCE, even with two sweeps at the same moment
 *   - nothing at night, on Sundays, on holidays: the next office pass sends it
 *   - a new date starts the ladder again
 *   - a new date asked and waiting: not escalated (the reason is given)
 *   - first deploy: deadlines long gone are claimed silently, no burst
 *   - personal and done tasks: nothing; shadow: claims, sends nothing; off: nothing
 *   - the walk reads through staff_task_due_sweep, never a collection scan
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
const { runTaskAlertSweep, ladderFor, leftText } = await import('../services/taskAlertService.js');
const { loadTaskAlertConfig } = await import('../config/taskAlerts.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const DAY = 24 * 60 * 60 * 1000;
const ENV = { TASK_ALERTS_MODE: 'live' };
// Wednesday 2 Dec 2026 (Thursday 3rd, Saturday 5th, Sunday 6th).
const WED = '2026-12-02';
const THU = '2026-12-03';
const at = (dayYmd, hhmm) => new Date(`${dayYmd}T${hhmm}:00+05:30`);

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name, email: `talert${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};

let admin, head, arun, bala;
let sent;
const send = async (t, ids, m) => { sent.push({ task: t.number, ids: ids.map(String), ...m }); };
const sweep = (when, env = ENV) => runTaskAlertSweep({ now: when, env, deps: { send } });
const levels = () => sent.map((s) => s.key.split(':').pop());
const to = (u) => sent.filter((s) => s.ids.includes(String(u._id)));

/** A task Arun gives Bala, then dated `dueOn` `dueTime` behind the service's back (time passing). */
async function given(dueOn, dueTime = null, over = {}) {
  const { task } = await tasks.createTask(arun, {
    title: 'Send quote to RK', dueOn: tasks.todayIST(new Date(Date.now() + DAY)), assigneeId: String(bala._id), ...over,
  }, req);
  await StaffTask.updateOne({ _id: task.id }, { $set: { dueOn, dueTime } });
  return task;
}

beforeAll(async () => { await StaffTask.init(); });
beforeEach(async () => {
  sent = [];
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  bala = await person('staff', { team: 'procurement' }, 'Bala');
});
afterEach(async () => {
  await StaffTask.collection.deleteMany({});
  await StaffTaskInbox.deleteMany({});
  await User.deleteMany({});
});

describe('the ladder for one deadline', () => {
  it('due today → only Xh left → late (+ giver) → head → admin, each once', async () => {
    const t = await given(WED, '17:00');

    await sweep(at(WED, '09:35'));
    expect(levels()).toEqual(['today']);
    expect(sent[0]).toMatchObject({ ids: [String(bala._id)], kind: 'due_soon', text: 'Due today at 17:00 — 7h 25m left' });

    await sweep(at(WED, '09:40'));
    expect(levels()).toEqual(['today']);

    await sweep(at(WED, '14:05'));
    expect(levels()).toEqual(['today', 'soon']);
    expect(sent[1]).toMatchObject({ ids: [String(bala._id)], title: '⏰ Only 2h 55m left: T-' + t.number });

    await sweep(at(WED, '17:05'));
    expect(levels()).toEqual(['today', 'soon', 'late', 'late']);
    expect(to(bala).at(-1)).toMatchObject({ kind: 'due_late', text: `Late — was due ${WED} 17:00. Say why and give a new date.` });
    expect(to(arun)).toEqual([expect.objectContaining({ kind: 'due_late', title: `Bala's T-${t.number} is late` })]);

    // Night: nothing, whatever is due.
    expect(await sweep(at(WED, '21:00'))).toMatchObject({ skipped: 'outside_office' });

    // 17:00 + 4 office hours = 90 min on Wednesday + 150 on Thursday → 12:00.
    await sweep(at(THU, '11:55'));
    expect(to(head)).toEqual([]);
    await sweep(at(THU, '12:05'));
    expect(to(head)).toEqual([expect.objectContaining({ kind: 'due_escalated', title: expect.stringMatching(/^⚠ Bala's T-\d+ is 19h 5m late$/) })]);
    expect(to(admin)).toEqual([]);

    // + 1 office day (540 min) → Thursday 17:00.
    await sweep(at(THU, '17:05'));
    expect(to(admin)).toEqual([expect.objectContaining({ kind: 'due_escalated' })]);
    expect(to(bala).map((s) => s.key.split(':').pop())).toEqual(['today', 'soon', 'late']);

    await sweep(at(THU, '17:30'));
    expect(levels()).toEqual(['today', 'soon', 'late', 'late', 'head', 'admin']);
  });

  it('two sweeps at the same moment send each level once', async () => {
    await given(WED, '17:00');
    await Promise.all([sweep(at(WED, '17:05')), sweep(at(WED, '17:05')), sweep(at(WED, '17:05'))]);
    // today and soon are history at 17:05 (claimed silently); late once to Bala, once to Arun.
    expect(levels()).toEqual(['late', 'late']);
  });

  it('a task due before opening hears "only Xh left" at opening, not "due today"', async () => {
    await given(WED, '10:00');
    await sweep(at(WED, '09:30'));
    expect(levels()).toEqual(['soon']);
    expect(sent[0].text).toBe('Only 30m left — due 10:00');
  });

  it('untimed: "left" counts to closing time; late from the next office morning', async () => {
    await given(WED);
    await sweep(at(WED, '09:30'));
    expect(sent[0].text).toBe('Due today — 9h left');
    await sweep(at(WED, '15:35'));
    expect(sent[1].text).toBe('Only 2h 55m left — due today');
    await sweep(at(WED, '18:25'));
    expect(levels()).toEqual(['today', 'soon']);
    await sweep(at(THU, '09:30'));
    expect(levels()).toEqual(['today', 'soon', 'late', 'late']);
  });
});

describe('what stops or restarts it', () => {
  it('a new date starts the ladder again', async () => {
    const t = await given(WED, '17:00');
    await sweep(at(WED, '17:05'));
    expect(levels()).toEqual(['late', 'late']);
    await StaffTask.updateOne({ _id: t.id }, { $set: { dueOn: THU, dueTime: '16:00' } });
    await sweep(at(THU, '09:35'));
    expect(levels()).toEqual(['late', 'late', 'today']);
    expect((await StaffTask.findById(t.id).lean()).alerts).toMatchObject({ due: `${THU} 16:00`, late: null });
  });

  it('a new date asked and waiting is not escalated; once refused, it is', async () => {
    const t = await given(WED, '17:00');
    await sweep(at(WED, '17:05'));
    await StaffTask.updateOne({ _id: t.id }, { $set: { lateRequest: { status: 'pending', late: true, reason: 'other', note: 'RK late', fromDue: WED, dueOn: '2026-12-04', requestedBy: bala._id, requestedAt: new Date() } } });
    await sweep(at(THU, '17:05'));
    expect(to(head)).toEqual([]);
    expect(to(admin)).toEqual([]);
    await StaffTask.updateOne({ _id: t.id }, { $set: { 'lateRequest.status': 'rejected' } });
    await sweep(at(THU, '17:10'));
    expect(to(head)).toHaveLength(1);
    expect(to(admin)).toHaveLength(1);
  });

  it('first deploy: deadlines long gone are claimed silently — no burst', async () => {
    await given('2026-11-28', '12:00');
    const out = await sweep(at(WED, '10:00'));
    expect(sent).toEqual([]);
    expect(out.silent).toBe(5);
    await sweep(at(WED, '10:05'));
    expect(sent).toEqual([]);
  });

  it('personal and done tasks hear nothing', async () => {
    const own = await tasks.createTask(bala, { title: 'Mine', dueOn: tasks.todayIST(new Date(Date.now() + DAY)), personal: true }, req);
    await StaffTask.updateOne({ _id: own.task.id }, { $set: { dueOn: WED, dueTime: '17:00' } });
    const done = await given(WED, '17:00');
    await StaffTask.updateOne({ _id: done.id }, { $set: { bucket: 'done' } });
    await sweep(at(WED, '17:05'));
    expect(sent).toEqual([]);
  });

  it('shadow claims and sends nothing (and does not resend when turned live); off does nothing', async () => {
    await given(WED, '17:00');
    expect(await sweep(at(WED, '09:35'), { TASK_ALERTS_MODE: 'off' })).toMatchObject({ skipped: 'off' });
    const shadow = await sweep(at(WED, '09:35'), { TASK_ALERTS_MODE: 'shadow' });
    expect(shadow.silent).toBe(1);
    await sweep(at(WED, '09:40'));
    expect(sent).toEqual([]);
  });

  it('Sunday and holidays: nothing, the next office pass sends', async () => {
    await given('2026-12-05', '17:00');
    expect(await sweep(at('2026-12-06', '11:00'))).toMatchObject({ skipped: 'outside_office' });
    const env = { ...ENV, STAFF_HOLIDAYS: '2026-12-07' };
    expect(await sweep(at('2026-12-07', '11:00'), env)).toMatchObject({ skipped: 'outside_office' });
    await sweep(at('2026-12-08', '09:30'), env);
    // Due Saturday 17:00: late more than a day ago by Tuesday → silent; the head's
    // moment (Saturday 17:00 + 4 office h = Tuesday 12:00 with Monday off) is still ahead.
    expect(sent).toEqual([]);
    await sweep(at('2026-12-08', '12:05'), env);
    expect(to(head)).toHaveLength(1);
  });
});

describe('the real Inbox and pop-up', () => {
  it('writes one Inbox line per person per level, and a push to their panel', async () => {
    const t = await given(WED, '17:00');
    await runTaskAlertSweep({ now: at(WED, '17:05'), env: ENV });
    await runTaskAlertSweep({ now: at(WED, '17:06'), env: ENV });
    await new Promise((r) => setTimeout(r, 30));
    const rows = await StaffTaskInbox.find({ kind: 'due_late' }).lean();
    expect(rows.map((r) => String(r.user)).sort()).toEqual([String(arun._id), String(bala._id)].sort());
    expect(rows.every((r) => r.by == null && r.number === t.number)).toBe(true);
    const late = pushes.filter((p) => /is late$/.test(p.message.title));
    expect(late.map((p) => p.recipients[0].userId).sort()).toEqual([String(arun._id), String(bala._id)].sort());
    expect(late.every((p) => p.recipients[0].url === `/team/tasks/${t.id}`)).toBe(true);
  });
});

describe('pure parts', () => {
  it('time left reads naturally', () => {
    expect([leftText(45 * 60e3), leftText(2 * 3600e3), leftText(130 * 60e3), leftText(3 * 86400e3)]).toEqual(['45m', '2h', '2h 10m', '3 days']);
  });
  it('the ladder uses the office clock for head and admin', () => {
    const l = ladderFor({ dueOn: WED, dueTime: '17:00' }, loadTaskAlertConfig({}));
    expect(new Date(l.at.head).toISOString()).toBe(at(THU, '12:00').toISOString());
    expect(new Date(l.at.admin).toISOString()).toBe(at(THU, '17:00').toISOString());
  });
});

describe('the walk', () => {
  it('reads through staff_task_due_sweep, never a collection scan', async () => {
    const rows = [];
    for (let i = 0; i < 600; i += 1) {
      rows.push({
        number: 100000 + i, title: `x${i}`, rank: `r${i}`, createdBy: arun._id, team: 'procurement', teams: ['procurement'],
        status: i % 3 ? 'todo' : 'done', bucket: i % 3 ? 'open' : 'done',
        dueOn: i % 5 ? `2026-1${i % 2}-${String((i % 28) + 1).padStart(2, '0')}` : null,
      });
    }
    await StaffTask.collection.insertMany(rows);
    const ex = await StaffTask.find({ bucket: 'open', dueOn: { $type: 'string', $gte: '2026-11-25', $lte: WED } })
      .sort({ dueOn: 1, _id: 1 }).limit(200).explain('executionStats');
    const plan = JSON.stringify(ex.queryPlanner.winningPlan);
    expect(plan).toContain('staff_task_due_sweep');
    expect(plan).not.toContain('COLLSCAN');
    expect(ex.executionStats.totalDocsExamined).toBeLessThan(80);
  });
});
