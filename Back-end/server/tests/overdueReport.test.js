/**
 * Morning "Overdue orders" email (services/overdueReportService.js), driven by the
 * REAL workflow against an in-memory Mongo (setup copied from chatStuckDigest.test.js).
 * Email is a double that records what would be sent.
 *
 * What must hold:
 *   - info@ gets the full report every run, "nothing overdue" included
 *   - only teams with something overdue are emailed, one message per person,
 *     never to `.invalid` staff addresses or inactive staff
 *   - the report uses the chat digest's thresholds (same rule, same rows)
 *   - customer names / product names are escaped in the HTML
 *   - the cron wrapper sends once per IST day
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  getMediaQueue: () => mockQueue,
  variantJobId: () => 'x',
  enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ buffer, folder, basename }) => ({ publicId: `${folder}/${basename}`, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' }),
  deletePrivateAsset: async () => true,
  readPrivateAsset: async () => Buffer.alloc(0),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));
const sent = [];
const emailMock = { sendEmail: async (m) => { sent.push(m); return { success: true }; } };
jest.unstable_mockModule('../services/emailHandler.js', () => ({ default: emailMock }));

const { default: Order } = await import('../models/Order.js');
const { default: User } = await import('../models/User.js');
const { default: ChatChannel } = await import('../models/ChatChannel.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { sendOverdueReport, buildReport, reportRows, DEFAULT_REPORT_TO } = await import('../services/overdueReportService.js');
const { default: CronService } = await import('../services/cronService.js');
const cronService = new CronService();

const H = 3600 * 1000;
let n = 0;
const person = (team, { isHead = false, email, active = true } = {}) => User.create({
  name: `${team} ${++n}`, email: email || `${team}${n}@autobacs.test`, phone: '9000000001',
  passwordHash: 'x', role: 'staff', staff: { team, isHead, active },
});

async function paidOrder({ name = 'Ravi', item = 'Part 1' } = {}) {
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: item, price: 1000, quantity: 1 }],
    shippingAddress: { fullName: name, phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 1000, totalAmount: 1000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  const res = await orderStatusService.updateOrderStatus(String(order._id), 'processing', { isAdmin: true, reason: 'payment_verified' });
  if (!res?.success) throw new Error(res?.message);
  return Order.findById(order._id).lean();
}

beforeEach(() => { sent.length = 0; delete process.env.OVERDUE_REPORT_TO; });

describe('overdue orders email', () => {
  it('nothing overdue: info@ still gets a short "nothing overdue" report, nobody else', async () => {
    await person('procurement');
    const r = await sendOverdueReport(Date.now());
    expect(r).toMatchObject({ summarySent: true, total: 0, teams: {} });
    expect(sent.map((m) => m.to)).toEqual([DEFAULT_REPORT_TO]);
    expect(sent[0].subject).toBe('Overdue orders — nothing overdue today');
    expect(sent[0].text).toMatch(/Procurement — 0 overdue\n {2}Clear\./);
  });

  it('an unchecked order after 24h: info@ gets everything, procurement people get their section', async () => {
    const head = await person('procurement', { isHead: true });
    const member = await person('procurement');
    await person('procurement', { email: 'buyer@staff.autobacs.invalid' });
    await person('procurement', { active: false });
    await person('operations');
    await paidOrder({ name: 'Rahul Menon', item: 'Profender Suspension Kit' });

    const r = await sendOverdueReport(Date.now() + 25 * H);
    expect(r.total).toBe(1);
    expect(r.teams).toEqual({ procurement: 2 });

    const summary = sent.find((m) => m.to === DEFAULT_REPORT_TO);
    expect(summary.subject).toBe('Overdue orders — 1 item need action');
    expect(summary.text).toMatch(/Procurement — 1 overdue\n {2}#\S+ · Rahul Menon · Profender Suspension Kit · New Order · 1 day/);
    expect(summary.text).toMatch(/GTM — 0 overdue/);
    expect(summary.text).toMatch(/Operations — 0 overdue/);

    const teamMail = sent.filter((m) => m.to !== DEFAULT_REPORT_TO);
    expect(teamMail.map((m) => m.to).sort()).toEqual([head.email, member.email].sort());
    expect(teamMail[0].subject).toBe('Overdue orders — Procurement: 1 item need action');
    expect(teamMail[0].text).not.toMatch(/GTM —/);
  });

  it('before the threshold nothing is overdue', async () => {
    await person('procurement');
    await paidOrder();
    const r = await sendOverdueReport(Date.now() + 23 * H);
    expect(r.total).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('OVERDUE_REPORT_TO changes where the full report goes', async () => {
    process.env.OVERDUE_REPORT_TO = 'ops-lead@example.com';
    await sendOverdueReport(Date.now());
    expect(sent.map((m) => m.to)).toEqual(['ops-lead@example.com']);
  });

  it('escapes customer and product names in the HTML', () => {
    const order = { _id: new mongoose.Types.ObjectId(), items: [{ name: '<b>Kit</b>' }], shippingAddress: { fullName: '<script>x</script>' } };
    const byTeam = new Map([['procurement', new Map([['stock_check', [{ order, since: Date.now() - 30 * H }]]])]]);
    const { html } = buildReport(reportRows(byTeam), ['procurement']);
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;x');
    expect(html).toContain('&lt;b&gt;Kit');
  });
});

describe('once per day (cron wrapper)', () => {
  it('a second run the same IST day sends nothing; the next day sends again', async () => {
    const store = new Map();
    const realRedis = cronService.redis;
    cronService.redis = {
      set: async (k, v, nx) => { if (nx === 'NX' && store.has(k)) return null; store.set(k, v); return 'OK'; },
      del: async (k) => { store.delete(k); return 1; },
    };
    try {
      const morning = Date.UTC(2026, 9, 21, 3, 30); // 09:00 IST
      await cronService.runOverdueReportOnce(morning);
      await cronService.runOverdueReportOnce(morning + 2 * H);
      expect(sent).toHaveLength(1);
      await cronService.runOverdueReportOnce(morning + 24 * H);
      expect(sent).toHaveLength(2);
    } finally {
      cronService.redis = realRedis;
    }
  });
});
