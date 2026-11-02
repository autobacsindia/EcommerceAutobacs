/**
 * Tasks phase 6a — how many Inbox writes one event costs. Every task change now
 * waits for its Inbox lines before answering, so each extra round trip is felt.
 */
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskInbox } = await import('../models/StaffTaskInbox.js');
const { default: staffTaskInboxRepository } = await import('../repositories/staffTaskInboxRepository.js');
const tasks = await import('../services/staffTaskService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const person = (name, staff) => {
  n += 1;
  return User.create({ name, email: `writes${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role: 'staff', staff: { active: true, isHead: false, ...staff } });
};

beforeAll(async () => { await StaffTask.syncIndexes(); await StaffTaskInbox.syncIndexes(); });

it('a comment that @mentions someone writes all its Inbox lines in one round trip', async () => {
  const priya = await person('Priya', { team: 'procurement', isHead: true });
  const arun = await person('Arun', { team: 'procurement' });
  const bala = await person('Bala', { team: 'procurement' });
  const t = (await tasks.createTask(priya, { title: 'Count pads', assigneeIds: [String(arun._id), String(bala._id)], shared: true }, req)).task;

  const spy = jest.spyOn(staffTaskInboxRepository, 'insertMany');
  await tasks.addComment(priya, t.id, { text: 'Check the date', clientId: 'cmt-writes-01', mentions: [String(arun._id)] });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(await StaffTaskInbox.countDocuments({ key: { $regex: '^c:' } })).toBe(2);
});
