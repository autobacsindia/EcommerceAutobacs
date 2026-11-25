/**
 * What one deadline-alert pass costs (services/taskAlertService.js). It runs every
 * 5 minutes in office time and walks every open task due in the last 7 days, so
 * its steady state — nothing new to send — must stay cheap: a few page reads and
 * no writes. Measured here with 3,000 tasks in the window (far above today's load).
 */
import { jest } from '@jest/globals';

jest.setTimeout(300000);

const pushMock = { sendToUsers: async (r) => r.length, pushConfigured: () => true };
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { runTaskAlertSweep } = await import('../services/taskAlertService.js');

const N = 3000;
const NOW = new Date('2026-12-02T12:00:00+05:30');
const DAYS = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30', '2026-12-01', '2026-12-02'];

it(`a pass over ${N} tasks: one bookkeeping write per page, page reads only once claimed`, async () => {
  await StaffTask.init();
  const giver = await User.create({ name: 'Arun', email: 'perf@autobacs.test', phone: '9000000001', passwordHash: 'x', role: 'staff', staff: { active: true, team: 'sales' } });
  await StaffTask.collection.insertMany(Array.from({ length: N }, (_, i) => ({
    number: 500000 + i, title: `t${i}`, rank: `r${i}`, status: 'todo', bucket: 'open',
    createdBy: giver._id, team: 'sales', teams: ['sales'], assignees: [{ user: giver._id, name: 'Arun' }],
    dueOn: DAYS[i % DAYS.length], dueTime: i % 2 ? '10:00' : null,
  })));
  const send = async () => {};
  const spies = {
    find: jest.spyOn(StaffTask, 'find'),
    updateOne: jest.spyOn(StaffTask, 'updateOne'),
    bulkWrite: jest.spyOn(StaffTask, 'bulkWrite'),
  };
  const counts = () => Object.fromEntries(Object.entries(spies).map(([k, v]) => [k, v.mock.calls.length]));
  const reset = () => Object.values(spies).forEach((v) => v.mockClear());

  const t0 = Date.now();
  const first = await runTaskAlertSweep({ now: NOW, env: { TASK_ALERTS_MODE: 'live' }, deps: { send } });
  const firstMs = Date.now() - t0;
  const firstCounts = counts();
  expect(first.scanned).toBe(N);

  reset();
  const t1 = Date.now();
  const again = await runTaskAlertSweep({ now: new Date(NOW.getTime() + 5 * 60e3), env: { TASK_ALERTS_MODE: 'live' }, deps: { send } });
  const steadyMs = Date.now() - t1;
  const steadyCounts = counts();

  console.log(`[perf] first pass ${firstMs} ms ${JSON.stringify(firstCounts)} sent ${JSON.stringify(first.sent)} silent ${first.silent}; steady pass ${steadyMs} ms ${JSON.stringify(steadyCounts)}`);
  // First pass: the bookkeeping is one write per page (15); one claim per alert actually sent.
  const sentNow = Object.values(first.sent).reduce((a, b) => a + b, 0);
  expect(firstCounts.bulkWrite).toBeLessThanOrEqual(Math.ceil(N / 200));
  expect(firstCounts.updateOne).toBe(sentNow);
  // Steady state: page reads only, no writes.
  expect(again.scanned).toBe(N);
  expect(Object.values(again.sent).every((x) => x === 0)).toBe(true);
  expect(steadyCounts).toEqual({ find: Math.ceil(N / 200) + (N % 200 ? 0 : 1), updateOne: 0, bulkWrite: 0 });
});
