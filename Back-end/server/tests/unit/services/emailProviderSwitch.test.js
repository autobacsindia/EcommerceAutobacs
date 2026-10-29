import { jest } from '@jest/globals';

// emailHandler is a singleton. These tests inject provider clients directly —
// fakes for the switch, the real ZeptoMailClient over a fake fetch for the
// end-to-end retry behaviour — so no network and no real credentials.
const { default: emailHandler, selectedProvider } = await import('../../../services/emailHandler.js');
const { ZeptoMailClient } = await import('../../../services/email/zeptomailClient.js');

const ENV_KEYS = [
  'EMAIL_PROVIDER', 'EMAIL_REDIRECT_TO', 'ENABLE_EMAIL_NOTIFICATIONS',
  'POSTMARK_SERVER_TOKEN', 'POSTMARK_FROM_EMAIL', 'POSTMARK_FROM_NAME',
  'POSTMARK_WELCOME_FROM_EMAIL', 'POSTMARK_WELCOME_FROM_NAME',
  'ZEPTOMAIL_SEND_MAIL_TOKEN', 'ZEPTOMAIL_API_URL', 'ZEPTOMAIL_TIMEOUT_MS',
  'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_WELCOME_FROM_ADDRESS', 'EMAIL_WELCOME_FROM_NAME',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => (body === undefined ? Promise.reject(new SyntaxError('no body')) : Promise.resolve(body)),
});
const ACCEPTED = (id = 'req-1') => ({ data: [{ code: 'EM_104' }], message: 'OK', request_id: id });

let postmark;
let zepto;

const enable = () => {
  postmark = { sendEmail: jest.fn().mockResolvedValue({ MessageID: 'pm-1' }) };
  zepto = { sendEmail: jest.fn().mockResolvedValue({ MessageID: 'zm-1' }) };
  emailHandler.client = postmark;
  emailHandler.zeptomailClient = zepto;
  emailHandler.isEnabled = true;
  emailHandler.fromEmail = 'noreply@autobacsindia.com';
  emailHandler.fromName = 'Autobacs India';
  emailHandler.defaultStream = 'outbound';
};

/** Install the REAL ZeptoMail client over a scripted fetch. */
const realZepto = (...responses) => {
  const fetchImpl = jest.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchImpl.mockRejectedValueOnce(r);
    else fetchImpl.mockResolvedValueOnce(r);
  }
  emailHandler.zeptomailClient = new ZeptoMailClient({ token: 'test-token', fetchImpl });
  return fetchImpl;
};

beforeEach(() => {
  restoreEnv();
  delete process.env.EMAIL_PROVIDER;
  delete process.env.EMAIL_REDIRECT_TO;
  enable();
});

afterAll(() => {
  restoreEnv();
  emailHandler.initialize();
});

describe('EMAIL_PROVIDER switch', () => {
  test('unset → Postmark (today\'s behaviour, the rollback target)', async () => {
    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res).toMatchObject({ success: true, provider: 'postmark', messageId: 'pm-1' });
    expect(postmark.sendEmail).toHaveBeenCalledTimes(1);
    expect(zepto.sendEmail).not.toHaveBeenCalled();
  });

  test('zeptomail → ZeptoMail, with the same message emailHandler always built', async () => {
    process.env.EMAIL_PROVIDER = 'zeptomail';

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res).toMatchObject({ success: true, provider: 'zeptomail', messageId: 'zm-1' });
    expect(postmark.sendEmail).not.toHaveBeenCalled();
    expect(zepto.sendEmail.mock.calls[0][0]).toMatchObject({
      From: 'Autobacs India <noreply@autobacsindia.com>',
      To: 'buyer@example.com',
    });
  });

  test('is read on every send — flipping it needs no re-initialisation', async () => {
    process.env.EMAIL_PROVIDER = 'zeptomail';
    await emailHandler.sendEmail({ to: 'a@example.com', subject: 's', text: 't' });
    process.env.EMAIL_PROVIDER = 'postmark';
    await emailHandler.sendEmail({ to: 'a@example.com', subject: 's', text: 't' });

    expect(zepto.sendEmail).toHaveBeenCalledTimes(1);
    expect(postmark.sendEmail).toHaveBeenCalledTimes(1);
  });

  test('tolerates case and whitespace in the value', () => {
    process.env.EMAIL_PROVIDER = '  ZeptoMail ';
    expect(selectedProvider()).toBe('zeptomail');
  });

  test.each([
    ['selected but not configured', 'zeptomail', () => { emailHandler.zeptomailClient = null; }],
    ['unknown provider name', 'sendgrid', () => {}],
  ])('%s → fails loudly and retryably, never falls back to the other provider', async (_label, value, arrange) => {
    process.env.EMAIL_PROVIDER = value;
    arrange();

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res.success).toBe(false);
    expect(res.retryable).toBe(true);
    // fallbackToConsole would make callers record "email is off" and drop it.
    expect(res).not.toHaveProperty('fallbackToConsole');
    expect(res.error).toMatch(new RegExp(value));
    expect(postmark.sendEmail).not.toHaveBeenCalled();
    expect(zepto.sendEmail).not.toHaveBeenCalled();
  });

  test('email switched off entirely still reports fallbackToConsole, as before', async () => {
    emailHandler.isEnabled = false;
    process.env.EMAIL_PROVIDER = 'zeptomail';

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res).toMatchObject({ success: false, fallbackToConsole: true, provider: 'zeptomail' });
  });

  test('the careers-mailbox and .invalid guards still run before any provider', async () => {
    process.env.EMAIL_PROVIDER = 'zeptomail';
    const res = await emailHandler.sendEmail({ to: 'staff@company.invalid', subject: 's', text: 't' });
    expect(res).toMatchObject({ success: false, skipped: true, provider: 'zeptomail' });
    expect(zepto.sendEmail).not.toHaveBeenCalled();
  });
});

describe('EMAIL_REDIRECT_TO through ZeptoMail', () => {
  beforeEach(() => { process.env.EMAIL_PROVIDER = 'zeptomail'; });

  test('reroutes the real request away from the customer and tags the subject', async () => {
    process.env.EMAIL_REDIRECT_TO = 'qa@autobacsindia.com';
    const fetchImpl = realZepto(response(201, ACCEPTED()));

    const res = await emailHandler.sendEmail({
      to: 'real.customer@example.com',
      subject: 'Your invoice',
      text: 'x',
      attachments: [{ Name: 'AB-1.pdf', Content: 'b64', ContentType: 'application/pdf' }],
    });

    expect(res).toMatchObject({ success: true, recipient: 'qa@autobacsindia.com', redirectedFrom: 'real.customer@example.com' });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.to).toEqual([{ email_address: { address: 'qa@autobacsindia.com' } }]);
    expect(body.subject).toBe('[test → real.customer@example.com] Your invoice');
    expect(body.attachments).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('real.customer@example.com"}');
  });

  test('set but invalid: no request is made at all', async () => {
    process.env.EMAIL_REDIRECT_TO = 'not-an-email';
    const fetchImpl = realZepto();

    const res = await emailHandler.sendEmail({ to: 'real.customer@example.com', subject: 's', text: 'x' });

    expect(res).toMatchObject({ success: false, retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ZeptoMail failures through emailHandler (real client, fake network)', () => {
  beforeEach(() => { process.env.EMAIL_PROVIDER = 'zeptomail'; });

  test('a 503 is retried in-process and the send lands exactly once', async () => {
    const fetchImpl = realZepto(response(503, { error: { code: 'TM_5000', message: 'busy' } }), response(201, ACCEPTED('req-9')));

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res).toMatchObject({ success: true, provider: 'zeptomail', messageId: 'req-9', attempt: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('a rejected token is not retried, and surfaces the ZeptoMail code', async () => {
    const fetchImpl = realZepto(response(401, {
      error: { code: 'TM_4001', details: [{ message: 'Invalid API Token found' }], message: 'Access Denied' },
    }));

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: false, retryable: false, statusCode: 401, providerErrorCode: 'TM_4001' });
    expect(res.error).toBe('Access Denied: Invalid API Token found (code TM_4001)');
  });

  test('a 400 (bad request) is not retried', async () => {
    const fetchImpl = realZepto(response(400, { error: { code: 'TM_3201', message: 'Mandatory field missing' } }));
    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.retryable).toBe(false);
  });

  test('a transient network error is retried; exhausting retries reports retryable for the queue', async () => {
    const reset = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
    const fetchImpl = realZepto(reset(), reset(), reset());

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(fetchImpl).toHaveBeenCalledTimes(emailHandler.retryAttempts);
    expect(res).toMatchObject({ success: false, retryable: true, provider: 'zeptomail' });
  });
});

describe('initialize() — configuration', () => {
  const init = (env) => {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env);
    emailHandler.initialize();
  };

  test('ZeptoMail alone is enough to enable email', () => {
    init({ ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', EMAIL_FROM_ADDRESS: 'noreply@autobacsindia.com' });
    expect(emailHandler.isEnabled).toBe(true);
    expect(emailHandler.getStatus()).toMatchObject({ provider: 'postmark', configuredProviders: ['zeptomail'] });
  });

  test('both providers configured side by side (the rollout state)', () => {
    init({ ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', POSTMARK_SERVER_TOKEN: 'p', POSTMARK_FROM_EMAIL: 'noreply@autobacsindia.com', EMAIL_PROVIDER: 'zeptomail' });
    expect(emailHandler.getStatus()).toMatchObject({ enabled: true, provider: 'zeptomail', configuredProviders: ['zeptomail', 'postmark'] });
  });

  test('sender: EMAIL_FROM_* wins, POSTMARK_FROM_* is the fallback', () => {
    init({ ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', POSTMARK_FROM_EMAIL: 'old@autobacsindia.com', POSTMARK_FROM_NAME: 'Old' });
    expect(emailHandler.fromEmail).toBe('old@autobacsindia.com');
    expect(emailHandler.fromName).toBe('Old');

    init({ ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', POSTMARK_FROM_EMAIL: 'old@autobacsindia.com', EMAIL_FROM_ADDRESS: 'new@autobacsindia.com', EMAIL_FROM_NAME: 'New' });
    expect(emailHandler.fromEmail).toBe('new@autobacsindia.com');
    expect(emailHandler.fromName).toBe('New');
  });

  test('ENABLE_EMAIL_NOTIFICATIONS=false still switches everything off', () => {
    init({ ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', EMAIL_FROM_ADDRESS: 'noreply@autobacsindia.com', ENABLE_EMAIL_NOTIFICATIONS: 'false' });
    expect(emailHandler.isEnabled).toBe(false);
  });

  test('the welcome email uses EMAIL_WELCOME_FROM_*, falling back to POSTMARK_WELCOME_FROM_*', async () => {
    enable();
    process.env.POSTMARK_WELCOME_FROM_EMAIL = 'info@autobacsindia.com';
    process.env.POSTMARK_WELCOME_FROM_NAME = 'Autobacs India';

    await emailHandler.sendWelcomeEmail('new.user@example.com', { name: 'Asha' });
    expect(postmark.sendEmail.mock.calls[0][0].From).toBe('Autobacs India <info@autobacsindia.com>');

    process.env.EMAIL_WELCOME_FROM_ADDRESS = 'hello@autobacsindia.com';
    process.env.EMAIL_WELCOME_FROM_NAME = 'Autobacs';
    await emailHandler.sendWelcomeEmail('new.user@example.com', { name: 'Asha' });
    expect(postmark.sendEmail.mock.calls[1][0].From).toBe('Autobacs <hello@autobacsindia.com>');
  });
});
