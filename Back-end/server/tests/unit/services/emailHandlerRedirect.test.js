import { jest } from '@jest/globals';

// emailHandler is a singleton; inject a fake Postmark client so we can assert the
// exact message object it builds (no network, no real credentials).
const { default: emailHandler } = await import('../../../services/emailHandler.js');

describe('emailHandler.sendEmail — EMAIL_REDIRECT_TO recipient guard', () => {
  let fakeClient;
  const ORIGINAL_REDIRECT = process.env.EMAIL_REDIRECT_TO;

  beforeEach(() => {
    fakeClient = { sendEmail: jest.fn().mockResolvedValue({ MessageID: 'test-123' }) };
    emailHandler.client = fakeClient;
    emailHandler.isEnabled = true;
    emailHandler.fromEmail = 'noreply@autobacsindia.com';
    emailHandler.fromName = 'Autobacs India';
    emailHandler.defaultStream = 'outbound';
    delete process.env.EMAIL_REDIRECT_TO;
  });

  afterAll(() => {
    if (ORIGINAL_REDIRECT === undefined) delete process.env.EMAIL_REDIRECT_TO;
    else process.env.EMAIL_REDIRECT_TO = ORIGINAL_REDIRECT;
  });

  test('unset (production): delivers to the real recipient, subject untouched', async () => {
    const res = await emailHandler.sendEmail({
      to: 'real.customer@example.com',
      subject: 'Your invoice',
      text: 'x',
    });

    expect(res.success).toBe(true);
    expect(res.recipient).toBe('real.customer@example.com');
    expect(res).not.toHaveProperty('redirectedFrom');

    const msg = fakeClient.sendEmail.mock.calls[0][0];
    expect(msg.To).toBe('real.customer@example.com');
    expect(msg.Subject).toBe('Your invoice');
  });

  test('set: reroutes away from the real recipient and tags the subject', async () => {
    process.env.EMAIL_REDIRECT_TO = 'qa@autobacsindia.com';

    const res = await emailHandler.sendEmail({
      to: 'real.customer@example.com',
      subject: 'Your invoice',
      text: 'x',
    });

    expect(res.success).toBe(true);
    expect(res.recipient).toBe('qa@autobacsindia.com');
    expect(res.redirectedFrom).toBe('real.customer@example.com');

    const msg = fakeClient.sendEmail.mock.calls[0][0];
    expect(msg.To).toBe('qa@autobacsindia.com');
    expect(msg.Subject).toBe('[test → real.customer@example.com] Your invoice');
  });

  test('set: still redirects when the mail carries an invoice attachment', async () => {
    process.env.EMAIL_REDIRECT_TO = 'qa@autobacsindia.com';

    await emailHandler.sendEmail({
      to: 'real.customer@example.com',
      subject: 'Invoice AB-1234',
      text: 'x',
      attachments: [{ Name: 'AB-1234.pdf', Content: 'b64', ContentType: 'application/pdf' }],
    });

    const msg = fakeClient.sendEmail.mock.calls[0][0];
    expect(msg.To).toBe('qa@autobacsindia.com');
    expect(msg.Attachments).toHaveLength(1);
  });

  test('set but invalid: fails closed — never falls back to the real recipient', async () => {
    process.env.EMAIL_REDIRECT_TO = 'not-an-email';

    const res = await emailHandler.sendEmail({
      to: 'real.customer@example.com',
      subject: 'Your invoice',
      text: 'x',
    });

    expect(res.success).toBe(false);
    expect(res.retryable).toBe(false);
    expect(fakeClient.sendEmail).not.toHaveBeenCalled();
  });

  test('set: an invalid `to` is still rejected before redirect applies', async () => {
    process.env.EMAIL_REDIRECT_TO = 'qa@autobacsindia.com';

    const res = await emailHandler.sendEmail({ to: 'garbage', subject: 'x', text: 'x' });

    expect(res.success).toBe(false);
    expect(fakeClient.sendEmail).not.toHaveBeenCalled();
  });
});
