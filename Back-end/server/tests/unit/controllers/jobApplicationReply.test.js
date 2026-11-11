/**
 * HR → applicant reply from the admin careers inbox.
 *
 * Regression for "replying to a careers application doesn't work": the admin
 * inbox had no reply action at all. Covers:
 *   - a reply is emailed to the applicant AND recorded (who, when, text, status)
 *   - double-click / client retry with the same draft key → ONE email
 *   - concurrent submits of the same key → ONE email
 *   - provider failure / email disabled → 502 with a reason, recorded as failed
 *   - validation (empty subject/message, bad key, too long) → 400, nothing sent
 *   - unknown / malformed id → 404
 *   - the history cap → 409, nothing sent
 *
 * The provider (emailHandler) and the queue are mocked: no real email is sent.
 */

import { jest } from '@jest/globals';

const sendCareersReply = jest.fn();

jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendCareersReply, sendEmail: jest.fn() },
}));
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  enqueueNotification: jest.fn(),
  getSearchSyncQueue: () => ({ add: jest.fn() }),
  getNotificationsQueue: () => ({ add: jest.fn() }),
}));

const { default: JobApplication, REPLY_LIMIT } = await import('../../../models/JobApplication.js');
const controller = await import('../../../controllers/jobApplicationController.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const admin = { _id: new JobApplication.base.Types.ObjectId(), name: 'HR Admin' };
const seed = (over = {}) => JobApplication.create({
  roleTitle: 'Service Advisor', fullName: 'Test Applicant', city: 'Kochi', email: 'applicant@example.com',
  whatYouBring: 'x', ...over,
});
const draft = (over = {}) => ({ key: 'draft-key-0001', subject: 'Your application', message: 'Hello,\n\nCan you talk on Monday?', ...over });
const reply = (id, body, user = admin) => {
  const res = mockRes();
  return controller.replyToApplication({ params: { id: String(id) }, body, user }, res).then(() => res);
};

beforeEach(() => {
  sendCareersReply.mockReset();
  sendCareersReply.mockResolvedValue({ success: true, messageId: 'm-1' });
});
afterEach(async () => { await JobApplication.deleteMany({}); });

describe('replyToApplication', () => {
  test('emails the applicant and records who sent what, and when', async () => {
    const app = await seed();
    const res = await reply(app._id, draft());

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, outcome: 'sent' });
    expect(sendCareersReply).toHaveBeenCalledTimes(1);
    expect(sendCareersReply).toHaveBeenCalledWith({
      to: 'applicant@example.com', subject: 'Your application', message: 'Hello,\n\nCan you talk on Monday?',
    });

    const saved = await JobApplication.findById(app._id).lean();
    expect(saved.replies).toHaveLength(1);
    expect(saved.replies[0]).toMatchObject({
      status: 'sent', subject: 'Your application', text: 'Hello,\n\nCan you talk on Monday?',
      to: 'applicant@example.com', sentByName: 'HR Admin', messageId: 'm-1',
    });
    expect(String(saved.replies[0].sentBy)).toBe(String(admin._id));
    expect(saved.replies[0].sentAt).toBeInstanceOf(Date);
  });

  test('a double-click (same draft key twice) sends ONE email', async () => {
    const app = await seed();
    const first = await reply(app._id, draft());
    const second = await reply(app._id, draft());

    expect(first.body.outcome).toBe('sent');
    expect(second.statusCode).toBe(200);
    expect(second.body.outcome).toBe('duplicate');
    expect(sendCareersReply).toHaveBeenCalledTimes(1);
    expect((await JobApplication.findById(app._id).lean()).replies).toHaveLength(1);
  });

  test('concurrent submits of the same draft send ONE email', async () => {
    const app = await seed();
    let release;
    sendCareersReply.mockImplementation(() => new Promise((r) => { release = () => r({ success: true, messageId: 'm' }); }));

    const a = reply(app._id, draft());
    const b = reply(app._id, draft());
    // Let both requests reach the claim before the provider answers.
    await new Promise((r) => setTimeout(r, 100));
    release();
    const results = await Promise.all([a, b]);

    expect(sendCareersReply).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.body.outcome).sort()).toEqual(['duplicate', 'sent']);
    expect((await JobApplication.findById(app._id).lean()).replies).toHaveLength(1);
  });

  test('a new draft (new key) is a separate reply', async () => {
    const app = await seed();
    await reply(app._id, draft());
    await reply(app._id, draft({ key: 'draft-key-0002', message: 'Follow-up' }));
    expect(sendCareersReply).toHaveBeenCalledTimes(2);
    expect((await JobApplication.findById(app._id).lean()).replies.map((r) => r.text)).toEqual([
      'Hello,\n\nCan you talk on Monday?', 'Follow-up',
    ]);
  });

  test('provider failure → 502 with the reason, recorded as failed (never reported as sent)', async () => {
    const app = await seed();
    sendCareersReply.mockResolvedValue({ success: false, error: 'Sender not verified' });
    const res = await reply(app._id, draft());

    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Sender not verified/);
    const saved = await JobApplication.findById(app._id).lean();
    expect(saved.replies[0]).toMatchObject({ status: 'failed' });
    expect(saved.replies[0].sentAt).toBeNull();

    // Re-submitting the same failed draft does not silently "succeed".
    const again = await reply(app._id, draft());
    expect(again.statusCode).toBe(502);
    expect(sendCareersReply).toHaveBeenCalledTimes(1);
  });

  test('provider throws → 502, recorded as failed', async () => {
    const app = await seed();
    sendCareersReply.mockRejectedValue(new Error('socket hang up'));
    const res = await reply(app._id, draft());
    expect(res.statusCode).toBe(502);
    expect((await JobApplication.findById(app._id).lean()).replies[0].status).toBe('failed');
  });

  test('email switched off on the server → 502 saying nothing was sent', async () => {
    const app = await seed();
    sendCareersReply.mockResolvedValue({ success: false, fallbackToConsole: true, error: 'Email service not enabled' });
    const res = await reply(app._id, draft());
    expect(res.statusCode).toBe(502);
    expect(res.body.message).toMatch(/switched off/);
  });

  test.each([
    ['empty subject', { subject: '   ' }],
    ['empty message', { message: '' }],
    ['missing key', { key: undefined }],
    ['malformed key', { key: 'bad key!' }],
    ['subject too long', { subject: 'x'.repeat(201) }],
    ['message too long', { message: 'x'.repeat(5001) }],
  ])('%s → 400 and nothing sent', async (_label, over) => {
    const app = await seed();
    const res = await reply(app._id, draft(over));
    expect(res.statusCode).toBe(400);
    expect(sendCareersReply).not.toHaveBeenCalled();
    expect((await JobApplication.findById(app._id).lean()).replies).toHaveLength(0);
  });

  test('unknown or malformed id → 404', async () => {
    expect((await reply(new JobApplication.base.Types.ObjectId(), draft())).statusCode).toBe(404);
    expect((await reply('not-an-id', draft())).statusCode).toBe(404);
    expect(sendCareersReply).not.toHaveBeenCalled();
  });

  test(`history capped at ${REPLY_LIMIT} → 409, nothing sent`, async () => {
    const replies = Array.from({ length: REPLY_LIMIT }, (_, i) => ({
      key: `old-key-${String(i).padStart(4, '0')}`, subject: 's', text: 't', status: 'sent',
    }));
    const app = await seed({ replies });
    const res = await reply(app._id, draft());
    expect(res.statusCode).toBe(409);
    expect(sendCareersReply).not.toHaveBeenCalled();
  });

  test('detail view returns the reply history', async () => {
    const app = await seed();
    await reply(app._id, draft());
    const res = mockRes();
    await controller.getApplication({ params: { id: String(app._id) } }, res);
    expect(res.body.application.replies).toHaveLength(1);
    expect(res.body.application.replies[0].status).toBe('sent');
  });

  test('the inbox list leaves the reply history out (detail view only)', async () => {
    const app = await seed();
    await reply(app._id, draft());
    const res = mockRes();
    await controller.listApplications({ query: {} }, res);
    expect(res.body.applications).toHaveLength(1);
    expect(res.body.applications[0].replies).toBeUndefined();
    expect(res.body.applications[0].email).toBe('applicant@example.com');
  });
});
