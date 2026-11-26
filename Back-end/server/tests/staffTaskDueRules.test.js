/**
 * Staff tasks: the due-date rules (services/taskDueRules.js, services/staffTaskService.js).
 * Mongo is real; push is a double that records what was sent.
 *
 * What must hold:
 *   - a task under way outside a project has a due date, and it can't be taken
 *     off (To Do and project tasks may have none: staffTaskOptionalDue.test.js)
 *   - a date more than 9 days away waits for a manager: day 9 is fine, day 10 waits
 *   - each priority has a latest date (Urgent today, High today or tomorrow,
 *     Normal 30 days, Low 60) — a hard limit, checked when the date or the
 *     priority changes, counted in IST calendar days
 *   - the manager is a head of a team on the task, or the admin; nobody approves
 *     their own request; a manager setting the date approves it there and then
 *   - a decision lands once (rev), is told to the people concerned, and is in the
 *     task's history
 *   - the admin changes the numbers; the change affects the next date set only
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
const { default: TaskRulesConfig } = await import('../models/TaskRulesConfig.js');
const tasks = await import('../services/staffTaskService.js');
const rules = await import('../services/taskDueRules.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const DAY = 24 * 60 * 60 * 1000;
const day = (offset = 0) => tasks.todayIST(new Date(Date.now() + offset * DAY));
const settle = () => new Promise((r) => setTimeout(r, 30)); // pop-ups are fire-and-forget
const status = (code, fn, message) => expect(fn()).rejects.toMatchObject({ statusCode: code, ...(message && { message: expect.stringMatching(message) }) });

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({
    name: name || `${role} ${n}`, email: `tdr${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
};
const make = (actor, over = {}) => tasks.createTask(actor, { title: 'Count the stock', dueOn: day(0), ...over }, req).then((r) => r.task);
const edit = (actor, t, patch) => tasks.updateTask(actor, t.id, { rev: t.rev, ...patch }, req);
const decide = (actor, t, decision, note) => tasks.decideDueApproval(actor, t.id, { rev: t.rev, decision, note }, req);
const inboxOf = async (u) => (await StaffTaskInbox.find({ user: u._id }).lean()).map((r) => r.kind);
const pushedTo = (u) => pushes.filter((p) => p.recipients.some((r) => r.userId === String(u._id)));

let admin, head, arun, bala, salesHead, salesMember;
beforeAll(async () => { await StaffTask.init(); });
beforeEach(async () => {
  pushes.length = 0;
  admin = await person('admin', null, 'Owner');
  head = await person('staff', { team: 'procurement', isHead: true }, 'Priya');
  arun = await person('staff', { team: 'procurement' }, 'Arun');
  bala = await person('staff', { team: 'procurement' }, 'Bala');
  salesHead = await person('staff', { team: 'sales', isHead: true }, 'Sana');
  salesMember = await person('staff', { team: 'sales' }, 'Sam');
});

// ── The pure rules ─────────────────────────────────────────────────────────

describe('the rules themselves', () => {
  const R = rules.normaliseRules(null);
  const check = (days, priority, today = '2026-11-17') => rules.checkDue({ dueOn: rules.addDays(today, days), priority, today, rules: R });

  it('counts calendar days across months and years', () => {
    expect(rules.daysAhead('2026-12-01', '2026-11-30')).toBe(1);
    expect(rules.daysAhead('2027-01-08', '2026-12-30')).toBe(9);
    expect(rules.daysAhead('2026-11-16', '2026-11-17')).toBe(-1);
    // Across a leap day too.
    expect(rules.daysAhead('2028-03-01', '2028-02-28')).toBe(2);
  });

  it('day 9 needs no approval; day 10 does', () => {
    expect(check(9, 'normal')).toEqual({ days: 9, needsApproval: false });
    expect(check(10, 'normal')).toEqual({ days: 10, needsApproval: true });
    expect(check(10, 'low')).toEqual({ days: 10, needsApproval: true });
  });

  it('High: today or tomorrow (the "24 hours"), never the day after', () => {
    expect(check(0, 'high').needsApproval).toBe(false);
    expect(check(1, 'high').needsApproval).toBe(false);
    expect(() => check(2, 'high')).toThrow(/High priority task must be due today or tomorrow/);
  });

  it('Urgent: today only; Normal: up to 30 days; Low: up to 60', () => {
    expect(() => check(0, 'urgent')).not.toThrow();
    expect(() => check(1, 'urgent')).toThrow(/Urgent priority task must be due today/);
    expect(() => check(30, 'normal')).not.toThrow();
    expect(() => check(31, 'normal')).toThrow(/within 30 days/);
    expect(() => check(60, 'low')).not.toThrow();
    expect(() => check(61, 'low')).toThrow(/within 60 days/);
  });

  it('a past date is within every limit (a late task is still allowed, with a warning in the form)', () => {
    expect(check(-3, 'urgent')).toEqual({ days: -3, needsApproval: false });
  });

  it('IST decides "today": 23:59 IST and 00:01 IST the next day are different days', () => {
    const lateEvening = new Date('2026-11-17T18:29:00Z'); // 23:59 IST, 17 Nov
    const justAfter = new Date('2026-11-17T18:31:00Z'); // 00:01 IST, 18 Nov
    expect(tasks.todayIST(lateEvening)).toBe('2026-11-17');
    expect(tasks.todayIST(justAfter)).toBe('2026-11-18');
    const highOn = (now, due) => rules.checkDue({ dueOn: due, priority: 'high', today: tasks.todayIST(now), rules: R });
    // At 23:59 on the 17th, High may be due on the 18th — not the 19th.
    expect(() => highOn(lateEvening, '2026-11-18')).not.toThrow();
    expect(() => highOn(lateEvening, '2026-11-19')).toThrow(/High/);
    // Two minutes later it is the 18th, and the 19th is "tomorrow".
    expect(() => highOn(justAfter, '2026-11-19')).not.toThrow();
    // The 9-day line moves at IST midnight too.
    const normalOn = (now, due) => rules.checkDue({ dueOn: due, priority: 'normal', today: tasks.todayIST(now), rules: R });
    expect(normalOn(lateEvening, '2026-11-27').needsApproval).toBe(true);
    expect(normalOn(justAfter, '2026-11-27').needsApproval).toBe(false);
  });

  it('missing or broken stored numbers fall back to the defaults', () => {
    expect(rules.normaliseRules({ approvalAfterDays: -1, maxDays: { high: 2.5, low: 90 } })).toEqual({
      approvalAfterDays: 9, maxDays: { urgent: 0, high: 1, normal: 30, low: 90 },
    });
  });
});

// ── A due date is required ─────────────────────────────────────────────────

describe('when a due date is required (the rest: staffTaskOptionalDue.test.js)', () => {
  it('a To Do task may have none; one under way may not', async () => {
    expect((await make(arun, { dueOn: undefined })).dueOn).toBeNull();
    await status(400, () => make(arun, { dueOn: null, status: 'in_progress' }), /out of To Do/);
  });

  it('a date on a task under way can be moved but not taken off — alone or in a bulk change', async () => {
    const t = await edit(arun, await make(arun), { status: 'in_progress' });
    await status(400, () => edit(arun, t, { dueOn: null }), /needs a due date/);
    await status(400, () => edit(arun, t, { dueOn: '' }));
    const bulk = await tasks.bulkUpdate(arun, { items: [{ id: t.id, rev: t.rev }], changes: { dueOn: null } }, req);
    expect(bulk).toMatchObject({ changed: 0, failed: 1 });
    expect((await tasks.getTask(arun, t.id)).dueOn).toBe(day(0));
  });

  it('a task saved before the rule still takes other changes; only a new date is checked', async () => {
    const t = await make(head, { assigneeId: String(arun._id) });
    await StaffTask.updateOne({ _id: t.id }, { $set: { dueOn: null, rank: '9999-12-31' } });
    const renamed = await edit(head, t, { title: 'Count the stock again' });
    expect(renamed).toMatchObject({ dueOn: null, title: 'Count the stock again' });
    // Raising its priority is fine too: there is no date to measure.
    const raised = await edit(head, renamed, { priority: 'urgent' });
    expect(raised.priority).toBe('urgent');
    // Giving it a date runs the rules.
    await status(400, () => edit(head, raised, { dueOn: day(1) }), /Urgent/);
    expect((await edit(head, raised, { dueOn: day(0) })).dueOn).toBe(day(0));
  });
});

// ── The priority limit ─────────────────────────────────────────────────────

describe('the latest date for each priority', () => {
  it('is checked on create', async () => {
    await status(400, () => make(arun, { priority: 'high', dueOn: day(2) }), /High/);
    await status(400, () => make(arun, { priority: 'urgent', dueOn: day(1) }), /Urgent/);
    await status(400, () => make(arun, { priority: 'normal', dueOn: day(31) }), /Normal/);
    expect((await make(arun, { priority: 'high', dueOn: day(1) })).priority).toBe('high');
    expect((await make(arun, { priority: 'low', dueOn: day(60) })).dueApproval.status).toBe('pending');
  });

  it('cannot be passed even by the admin — a manager approves within it, not beyond', async () => {
    await status(400, () => make(admin, { priority: 'normal', dueOn: day(31) }), /Normal/);
  });

  it('is checked when the priority goes up on a task that is due later', async () => {
    const t = await make(arun, { dueOn: day(5) });
    await status(400, () => edit(arun, t, { priority: 'high' }), /High priority task must be due today or tomorrow/);
    // Date and priority together: fine.
    const both = await edit(arun, t, { priority: 'high', dueOn: day(1) });
    expect(both).toMatchObject({ priority: 'high', dueOn: day(1) });
    // And in a bulk change, refused per task.
    const other = await make(arun, { dueOn: day(4) });
    const res = await tasks.bulkUpdate(arun, { items: [{ id: other.id, rev: other.rev }], changes: { priority: 'urgent' } }, req);
    expect(res.results[0]).toMatchObject({ ok: false, status: 400 });
  });

  it('a time on the same day changes nothing about the rules', async () => {
    const t = await make(arun, { priority: 'high', dueOn: day(1) });
    expect((await edit(arun, t, { dueTime: '17:00' })).dueTime).toBe('17:00');
  });
});

// ── Approval ───────────────────────────────────────────────────────────────

describe('a date more than 9 days away', () => {
  it('day 9: saved as usual; day 10: saved, waiting for the team head', async () => {
    const nine = await make(arun, { dueOn: day(9) });
    expect(nine.dueApproval).toBeNull();
    const ten = await make(arun, { dueOn: day(10) });
    expect(ten.dueApproval).toMatchObject({ status: 'pending', dueOn: day(10), requestedBy: { name: 'Arun' }, decidedBy: null });
    expect(ten.history[0]).toMatchObject({ action: 'due_approval', to: `asked: due ${day(10)}` });
    await settle();
    // The head hears (Inbox + pop-up); nobody else does; the asker never hears their own request.
    expect(await inboxOf(head)).toContain('approval_requested');
    expect(pushedTo(head).some((p) => /approve a due date/.test(p.message.title))).toBe(true);
    expect(pushedTo(admin)).toHaveLength(0);
    expect(pushedTo(salesHead)).toHaveLength(0);
    expect(await inboxOf(arun)).not.toContain('approval_requested');
  });

  it('the task is real while it waits: listed, workable, and marked', async () => {
    const t = await make(arun, { dueOn: day(12) });
    const { tasks: mine } = await tasks.listTasks(arun, { view: 'mine' });
    expect(mine.find((x) => x.id === t.id).dueApproval.status).toBe('pending');
    expect((await edit(arun, t, { status: 'in_progress' })).status).toBe('in_progress');
  });

  it('a manager setting the date approves it there and then', async () => {
    const byHead = await make(head, { assigneeId: String(arun._id), dueOn: day(15) });
    expect(byHead.dueApproval).toMatchObject({ status: 'approved', auto: true, decidedBy: { name: 'Priya' } });
    const byAdmin = await make(admin, { assigneeId: String(salesMember._id), dueOn: day(15) });
    expect(byAdmin.dueApproval).toMatchObject({ status: 'approved', auto: true });
    const adminOwn = await make(admin, { dueOn: day(15) });
    expect(adminOwn.dueApproval.status).toBe('approved');
    await settle();
    expect(pushes.filter((p) => /approve/.test(p.message.title))).toHaveLength(0);
  });

  it('a head\'s date for their own task goes to the admin, not to themselves', async () => {
    const own = await make(head, { dueOn: day(10) });
    expect(own.dueApproval.status).toBe('pending');
    expect(own.can.approveDue).toBe(false);
    await status(403, () => decide(head, own, 'approve'), /someone else must approve/);
    await settle();
    expect(pushedTo(admin).some((p) => /approve a due date/.test(p.message.title))).toBe(true);
    const ok = await decide(admin, own, 'approve');
    expect(ok.dueApproval).toMatchObject({ status: 'approved', decidedBy: { name: 'Owner' } });
  });

  it('a head who gives a task to another team does not approve for that team', async () => {
    const t = await make(head, { assigneeId: String(salesMember._id), dueOn: day(10) });
    expect(t.dueApproval.status).toBe('pending');
    await settle();
    expect(pushedTo(salesHead).some((p) => /approve a due date/.test(p.message.title))).toBe(true);
    const fresh = await tasks.getTask(salesHead, t.id);
    expect(fresh.can.approveDue).toBe(true);
    expect((await decide(salesHead, fresh, 'approve')).dueApproval.status).toBe('approved');
  });

  it('a team with no head sends the request to the admin', async () => {
    const loner = await person('staff', { team: 'marketing' }, 'Mia');
    await make(loner, { dueOn: day(11) });
    await settle();
    expect(pushedTo(admin).some((p) => /approve a due date/.test(p.message.title))).toBe(true);
  });

  it('a personal task is seen by its maker alone, so it never waits', async () => {
    const mine = await make(arun, { personal: true, dueOn: day(20) });
    expect(mine.dueApproval).toBeNull();
  });

  it('one copy each: every copy has its own manager', async () => {
    const r = await tasks.createTask(arun, { title: 'Count', dueOn: day(10), assigneeIds: [String(bala._id), String(salesMember._id)] }, req);
    expect(r.tasks.map((t) => t.dueApproval.status)).toEqual(['pending', 'pending']);
    const [proc, sales] = r.tasks;
    expect((await tasks.getTask(head, proc.id)).can.approveDue).toBe(true);
    await status(404, () => tasks.getTask(head, sales.id));
    expect((await tasks.getTask(salesHead, sales.id)).can.approveDue).toBe(true);
  });
});

describe('deciding', () => {
  it('only a manager: not the person doing it, not a teammate, not another team\'s head', async () => {
    const t = await make(arun, { dueOn: day(10) });
    expect(t.can.approveDue).toBe(false);
    await status(403, () => decide(arun, t, 'approve'), /someone else/);
    await status(403, () => decide(bala, t, 'approve'), /head of this task’s team or the admin/);
    await status(404, () => decide(salesHead, t, 'approve'));
    expect((await tasks.getTask(head, t.id)).can.approveDue).toBe(true);
  });

  it('approve: the asker and the people on it hear; the history says who and when', async () => {
    const t = await make(arun, { dueOn: day(10), assigneeIds: [String(arun._id), String(bala._id)], shared: true });
    await settle();
    pushes.length = 0;
    const done = await decide(head, t, 'approve');
    expect(done.dueApproval).toMatchObject({ status: 'approved', decidedBy: { name: 'Priya' }, note: '' });
    expect(done.history[0]).toMatchObject({ action: 'due_approval', by: 'Priya', from: 'waiting for approval', to: 'approved' });
    await settle();
    expect(await inboxOf(arun)).toContain('approval_decided');
    expect(await inboxOf(bala)).toContain('approval_decided');
    expect(pushedTo(arun).some((p) => /approved the due date/.test(p.message.title))).toBe(true);
    expect(pushedTo(head)).toHaveLength(0);
  });

  it('reject needs a reason, and the task then says the date was not approved', async () => {
    const t = await make(arun, { dueOn: day(14) });
    await status(400, () => decide(head, t, 'reject'), /Say why/);
    await status(400, () => decide(head, t, 'reject', '   '), /Say why/);
    const no = await decide(head, t, 'reject', 'Finish by Friday');
    expect(no.dueApproval).toMatchObject({ status: 'rejected', note: 'Finish by Friday' });
    await settle();
    expect(pushedTo(arun).some((p) => /did not approve/.test(p.message.title) && /Finish by Friday/.test(p.message.body))).toBe(true);
    // Moving the date within 9 days clears it.
    const fixed = await edit(arun, no, { dueOn: day(4) });
    expect(fixed.dueApproval).toBeNull();
    expect(fixed.history[0]).toMatchObject({ action: 'due_approval', from: 'not approved', to: 'not needed' });
  });

  it('decides once: a second click, or two managers at the same moment', async () => {
    const t = await make(arun, { dueOn: day(10) });
    expect((await decide(head, t, 'approve')).dueApproval.status).toBe('approved');
    await status(409, () => decide(head, t, 'approve'));
    const t2 = await make(arun, { dueOn: day(11) });
    const both = await Promise.allSettled([decide(head, t2, 'approve'), decide(admin, t2, 'reject', 'No')]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(both.find((r) => r.status === 'rejected').reason.statusCode).toBe(409);
    const stored = await StaffTask.findById(t2.id).lean();
    expect(stored.history.filter((h) => h.action === 'due_approval')).toHaveLength(2); // asked + one decision
  });

  it('nothing to decide when nothing waits, and not on an archived task', async () => {
    const t = await make(arun, { dueOn: day(3) });
    await status(409, () => decide(head, t, 'approve'), /isn’t waiting/);
    const far = await make(arun, { dueOn: day(10) });
    const gone = await edit(head, far, { archived: true });
    await status(409, () => decide(head, gone, 'approve'), /archived/);
    await status(400, () => tasks.decideDueApproval(head, far.id, { rev: far.rev, decision: 'maybe' }, req));
  });
});

describe('changing the date later', () => {
  it('a new day asks again; a shorter one clears it; a new time on the same day asks nothing', async () => {
    let t = await make(arun, { dueOn: day(10) });
    t = await decide(head, t, 'approve');
    // The approval was for that date. Another far date asks again.
    t = await edit(arun, t, { dueOn: day(12) });
    expect(t.dueApproval).toMatchObject({ status: 'pending', dueOn: day(12) });
    t = await edit(arun, t, { dueTime: '10:00' });
    expect(t.dueApproval.status).toBe('pending');
    t = await edit(arun, t, { dueOn: day(9) });
    expect(t.dueApproval).toBeNull();
  });

  it('a bulk date change runs the rules for each task', async () => {
    const a = await make(arun, { dueOn: day(1) });
    const b = await make(head, { assigneeId: String(arun._id), dueOn: day(1) });
    await tasks.bulkUpdate(head, { items: [a, b].map((t) => ({ id: t.id, rev: t.rev })), changes: { dueOn: day(20) } }, req);
    // The head changed both, and is their manager: both approved there and then.
    expect((await tasks.getTask(head, a.id)).dueApproval).toMatchObject({ status: 'approved', auto: true });
    expect((await tasks.getTask(head, b.id)).dueApproval).toMatchObject({ status: 'approved', auto: true });
  });
});

describe('the "Waiting for my approval" list and count', () => {
  it('a head sees their team\'s, the admin everyone\'s, a member none — never their own requests', async () => {
    const proc = await make(arun, { title: 'proc far', dueOn: day(10) });
    const sales = await make(salesMember, { title: 'sales far', dueOn: day(11) });
    await make(head, { title: 'head own', dueOn: day(12) });
    await make(arun, { title: 'near', dueOn: day(2) });
    const titles = async (u, opts = {}) => (await tasks.listTasks(u, { view: 'approvals', ...opts })).tasks.map((t) => t.title);
    expect(await titles(head)).toEqual(['proc far']);
    expect(await titles(salesHead)).toEqual(['sales far']);
    expect(await titles(admin)).toEqual(['proc far', 'sales far', 'head own']);
    expect(await titles(admin, { team: 'sales' })).toEqual(['sales far']);
    // A member approves no far dates (only new dates on tasks they gave: staffTaskNewDate.test.js).
    expect(await titles(arun)).toEqual([]);
    // The open list is what waits; nothing done is waiting.
    expect(await titles(head, { state: 'done' })).toEqual([]);

    expect((await tasks.summaryFor(head)).approvals).toBe(1);
    expect((await tasks.summaryFor(admin)).approvals).toBe(3);
    expect((await tasks.summaryFor(arun)).approvals).toBe(0);
    await decide(head, proc, 'approve');
    expect(await titles(head)).toEqual([]);
    expect((await tasks.summaryFor(head)).approvals).toBe(0);
    expect(sales).toBeTruthy();
  });

  it('pages with a cursor like every task list', async () => {
    for (let i = 0; i < tasks.TASK_PAGE_SIZE + 2; i += 1) {
      await StaffTask.create({
        number: 1000 + i, title: `far ${i}`, priority: 'normal', status: 'todo', dueOn: day(10), assignee: arun._id,
        assignees: [{ user: arun._id, name: 'Arun', team: 'procurement' }], teams: ['procurement'], team: 'procurement',
        createdBy: arun._id, bucket: 'open', rank: day(10),
        dueApproval: { status: 'pending', dueOn: day(10), requestedBy: arun._id, requestedAt: new Date() },
      });
    }
    const first = await tasks.listTasks(head, { view: 'approvals' });
    expect(first.tasks).toHaveLength(tasks.TASK_PAGE_SIZE);
    const second = await tasks.listTasks(head, { view: 'approvals', cursor: first.nextCursor });
    expect(second.tasks).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
});

describe('sub-tasks', () => {
  it('follow the same rules', async () => {
    const parent = await make(arun, { dueOn: day(3) });
    // Starts in To Do, so the date may wait; once under way (outside a project) it may not.
    const later = (await tasks.createTask(arun, { title: 'part', parentId: parent.id }, req)).task;
    expect(later.dueOn).toBeNull();
    await status(400, () => edit(arun, later, { status: 'done' }), /out of To Do/);
    const far = (await tasks.createTask(arun, { title: 'part', parentId: parent.id, dueOn: day(10) }, req)).task;
    expect(far.dueApproval.status).toBe('pending');
  });

  it('a checklist step made into a sub-task is due with its parent, at its priority', async () => {
    const parent = await make(head, { assigneeId: String(arun._id), priority: 'high', dueOn: day(1), dueTime: '15:00', checklist: ['Pack'] });
    const step = (await tasks.getTask(head, parent.id)).checklistItems[0];
    const { subtask } = await tasks.subtaskFromStep(head, parent.id, step.id, { clientId: 'step-to-sub-1' }, req);
    expect(subtask).toMatchObject({ dueOn: day(1), dueTime: '15:00', priority: 'high' });
  });

  it('…and today when the parent is from before dates were required', async () => {
    const parent = await make(head, { assigneeId: String(arun._id), checklist: ['Pack'] });
    await StaffTask.updateOne({ _id: parent.id }, { $set: { dueOn: null, rank: '9999-12-31' } });
    const step = (await tasks.getTask(head, parent.id)).checklistItems[0];
    const { subtask } = await tasks.subtaskFromStep(head, parent.id, step.id, { clientId: 'step-to-sub-2' }, req);
    expect(subtask.dueOn).toBe(day(0));
  });
});

describe('the admin\'s numbers', () => {
  it('only the admin changes them, within 0–365 whole days', async () => {
    await status(403, () => rules.updateTaskRules(head, { approvalAfterDays: 5 }, req));
    await status(400, () => rules.updateTaskRules(admin, { approvalAfterDays: -1 }, req));
    await status(400, () => rules.updateTaskRules(admin, { approvalAfterDays: 2.5 }, req));
    await status(400, () => rules.updateTaskRules(admin, { maxDays: { high: 400 } }, req));
    await status(400, () => rules.updateTaskRules(admin, {}, req), /Nothing/);
    expect(await rules.readTaskRules()).toMatchObject({ approvalAfterDays: 9, maxDays: { urgent: 0, high: 1, normal: 30, low: 60 }, updatedAt: null });
  });

  it('a change applies to the next date set, never to saved tasks', async () => {
    const saved = await make(arun, { dueOn: day(7) });
    const after = await rules.updateTaskRules(admin, { approvalAfterDays: 5, maxDays: { high: 2 } }, req);
    expect(after).toMatchObject({ approvalAfterDays: 5, maxDays: { high: 2, normal: 30 }, updatedByName: 'Owner' });
    expect(await TaskRulesConfig.countDocuments()).toBe(1);
    // The saved task is untouched…
    expect((await tasks.getTask(arun, saved.id)).dueApproval).toBeNull();
    // …the next ones follow the new numbers.
    expect((await make(arun, { dueOn: day(6) })).dueApproval.status).toBe('pending');
    expect((await make(arun, { priority: 'high', dueOn: day(2) })).priority).toBe('high');
    // A second change keeps the first.
    expect(await rules.updateTaskRules(admin, { maxDays: { low: 90 } }, req)).toMatchObject({ approvalAfterDays: 5, maxDays: { high: 2, low: 90 } });
  });
});
