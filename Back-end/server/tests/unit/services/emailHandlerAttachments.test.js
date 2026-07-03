import { jest } from '@jest/globals';

// emailHandler is a singleton; inject a fake Postmark client so we can assert the
// exact message object it builds (no network, no real credentials).
const { default: emailHandler } = await import('../../../services/emailHandler.js');

describe('emailHandler.sendEmail — attachments passthrough', () => {
  let fakeClient;

  beforeEach(() => {
    fakeClient = { sendEmail: jest.fn().mockResolvedValue({ MessageID: 'test-123' }) };
    emailHandler.client = fakeClient;
    emailHandler.isEnabled = true;
    emailHandler.fromEmail = 'noreply@autobacsindia.com';
    emailHandler.fromName = 'Autobacs India';
    emailHandler.defaultStream = 'outbound';
  });

  test('forwards Attachments to Postmark when provided', async () => {
    const attachments = [{ Name: 'AB-1234.pdf', Content: 'base64data', ContentType: 'application/pdf' }];

    const res = await emailHandler.sendEmail({
      to: 'buyer@example.com',
      subject: 'Order confirmed',
      text: 'thanks',
      attachments,
    });

    expect(res.success).toBe(true);
    const msg = fakeClient.sendEmail.mock.calls[0][0];
    expect(msg.Attachments).toEqual(attachments);
    expect(msg.To).toBe('buyer@example.com');
  });

  test('omits the Attachments field entirely when none are provided', async () => {
    await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 'Hi', text: 'x' });

    const msg = fakeClient.sendEmail.mock.calls[0][0];
    expect(msg).not.toHaveProperty('Attachments');
  });

  test('omits Attachments when an empty array is provided', async () => {
    await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 'Hi', text: 'x', attachments: [] });

    const msg = fakeClient.sendEmail.mock.calls[0][0];
    expect(msg).not.toHaveProperty('Attachments');
  });
});

describe('emailHandler — sender override + welcome email', () => {
  let fakeClient;

  beforeEach(() => {
    fakeClient = { sendEmail: jest.fn().mockResolvedValue({ MessageID: 'test-123' }) };
    emailHandler.client = fakeClient;
    emailHandler.isEnabled = true;
    emailHandler.fromEmail = 'noreply@autobacsindia.com';
    emailHandler.fromName = 'Autobacs India';
    emailHandler.defaultStream = 'outbound';
  });

  test('uses a valid fromEmail override', async () => {
    await emailHandler.sendEmail({ to: 'a@b.com', subject: 's', text: 't', fromEmail: 'hi@autobacsindia.com', fromName: 'Autobacs' });
    expect(fakeClient.sendEmail.mock.calls[0][0].From).toBe('Autobacs <hi@autobacsindia.com>');
  });

  test('falls back to the default sender when the override is invalid', async () => {
    await emailHandler.sendEmail({ to: 'a@b.com', subject: 's', text: 't', fromEmail: 'not-an-email' });
    expect(fakeClient.sendEmail.mock.calls[0][0].From).toBe('Autobacs India <noreply@autobacsindia.com>');
  });

  test('sendWelcomeEmail sends from POSTMARK_WELCOME_FROM_EMAIL with a welcome subject', async () => {
    process.env.POSTMARK_WELCOME_FROM_EMAIL = 'hi@autobacsindia.com';
    process.env.POSTMARK_WELCOME_FROM_NAME = 'Autobacs India';

    const res = await emailHandler.sendWelcomeEmail('newuser@example.com', { name: 'Asha Rao' });

    expect(res.success).toBe(true);
    const msg = fakeClient.sendEmail.mock.calls[0][0];
    expect(msg.From).toBe('Autobacs India <hi@autobacsindia.com>');
    expect(msg.To).toBe('newuser@example.com');
    expect(msg.Subject).toMatch(/welcome/i);
    expect(msg.HtmlBody).toContain('Asha'); // first name personalization

    delete process.env.POSTMARK_WELCOME_FROM_EMAIL;
    delete process.env.POSTMARK_WELCOME_FROM_NAME;
  });

  test('sendWelcomeEmail falls back to the default sender when the welcome sender is unset', async () => {
    delete process.env.POSTMARK_WELCOME_FROM_EMAIL;
    delete process.env.POSTMARK_WELCOME_FROM_NAME;

    await emailHandler.sendWelcomeEmail('newuser@example.com', { name: 'Sam' });

    expect(fakeClient.sendEmail.mock.calls[0][0].From).toBe('Autobacs India <noreply@autobacsindia.com>');
  });
});
