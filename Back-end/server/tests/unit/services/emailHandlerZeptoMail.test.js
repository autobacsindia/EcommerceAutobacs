import { jest } from '@jest/globals';

// emailHandler is a singleton. These tests install the REAL ZeptoMailClient
// over a scripted fetch, so they cover emailHandler + client together with no
// network and no real credentials.
const { default: emailHandler } = await import('../../../services/emailHandler.js');
const { ZeptoMailClient } = await import('../../../services/email/zeptomailClient.js');

const ENV_KEYS = [
  'EMAIL_REDIRECT_TO', 'ENABLE_EMAIL_NOTIFICATIONS',
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

/** Install the real ZeptoMail client over a scripted fetch. */
const realZepto = (...responses) => {
  const fetchImpl = jest.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchImpl.mockRejectedValueOnce(r);
    else fetchImpl.mockResolvedValueOnce(r);
  }
  emailHandler.client = new ZeptoMailClient({ token: 'test-token', fetchImpl });
  return fetchImpl;
};
const sentBody = (fetchImpl, call = 0) => JSON.parse(fetchImpl.mock.calls[call][1].body);

beforeEach(() => {
  restoreEnv();
  delete process.env.EMAIL_REDIRECT_TO;
  emailHandler.isEnabled = true;
  emailHandler.fromEmail = 'noreply@autobacsindia.com';
  emailHandler.fromName = 'Autobacs India';
});

afterAll(() => {
  restoreEnv();
  emailHandler.initialize();
});

describe('emailHandler → ZeptoMail', () => {
  test('a send reaches ZeptoMail with the configured sender', async () => {
    const fetchImpl = realZepto(response(201, ACCEPTED('req-7')));

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res).toMatchObject({ success: true, provider: 'zeptomail', messageId: 'req-7', attempt: 1 });
    expect(sentBody(fetchImpl).from).toEqual({ address: 'noreply@autobacsindia.com', name: 'Autobacs India' });
    expect(sentBody(fetchImpl).to).toEqual([{ email_address: { address: 'buyer@example.com' } }]);
  });

  test('email switched off reports fallbackToConsole and sends nothing', async () => {
    const fetchImpl = realZepto();
    emailHandler.isEnabled = false;

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res).toMatchObject({ success: false, fallbackToConsole: true, provider: 'zeptomail' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('the .invalid guard runs before any request', async () => {
    const fetchImpl = realZepto();
    const res = await emailHandler.sendEmail({ to: 'staff@company.invalid', subject: 's', text: 't' });
    expect(res).toMatchObject({ success: false, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('EMAIL_REDIRECT_TO through ZeptoMail', () => {
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
    const body = sentBody(fetchImpl);
    expect(body.to).toEqual([{ email_address: { address: 'qa@autobacsindia.com' } }]);
    expect(body.subject).toBe('[test → real.customer@example.com] Your invoice');
    expect(body.attachments).toHaveLength(1);
  });

  test('set but invalid: no request is made at all', async () => {
    process.env.EMAIL_REDIRECT_TO = 'not-an-email';
    const fetchImpl = realZepto();

    const res = await emailHandler.sendEmail({ to: 'real.customer@example.com', subject: 's', text: 'x' });

    expect(res).toMatchObject({ success: false, retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ZeptoMail failures', () => {
  test('a 503 is retried in-process and the send lands exactly once', async () => {
    const fetchImpl = realZepto(response(503, { error: { code: 'TM_5000', message: 'busy' } }), response(201, ACCEPTED('req-9')));

    const res = await emailHandler.sendEmail({ to: 'buyer@example.com', subject: 's', text: 't' });

    expect(res).toMatchObject({ success: true, messageId: 'req-9', attempt: 2 });
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

  test('token + sender enable email', () => {
    init({ ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', EMAIL_FROM_ADDRESS: 'noreply@autobacsindia.com', EMAIL_FROM_NAME: 'Autobacs India' });
    expect(emailHandler.isEnabled).toBe(true);
    expect(emailHandler.client).toBeInstanceOf(ZeptoMailClient);
    expect(emailHandler.getStatus()).toMatchObject({
      enabled: true, provider: 'zeptomail', fromEmail: 'noreply@autobacsindia.com', fromName: 'Autobacs India',
    });
  });

  test('the API URL is configurable', () => {
    init({ ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', EMAIL_FROM_ADDRESS: 'noreply@autobacsindia.com', ZEPTOMAIL_API_URL: 'https://api.zeptomail.in/v1.1/email' });
    expect(emailHandler.client.apiUrl).toBe('https://api.zeptomail.in/v1.1/email');
  });

  test.each([
    ['no token', { EMAIL_FROM_ADDRESS: 'noreply@autobacsindia.com' }],
    ['no sender', { ZEPTOMAIL_SEND_MAIL_TOKEN: 'z' }],
    ['switched off', { ZEPTOMAIL_SEND_MAIL_TOKEN: 'z', EMAIL_FROM_ADDRESS: 'noreply@autobacsindia.com', ENABLE_EMAIL_NOTIFICATIONS: 'false' }],
  ])('%s → email disabled', (_label, env) => {
    init(env);
    expect(emailHandler.isEnabled).toBe(false);
    expect(emailHandler.client).toBeNull();
  });

  test('the welcome email uses EMAIL_WELCOME_FROM_*', async () => {
    process.env.EMAIL_WELCOME_FROM_ADDRESS = 'info@autobacsindia.com';
    process.env.EMAIL_WELCOME_FROM_NAME = 'Autobacs India';
    const fetchImpl = realZepto(response(201, ACCEPTED()));

    await emailHandler.sendWelcomeEmail('new.user@example.com', { name: 'Asha' });

    expect(sentBody(fetchImpl).from).toEqual({ address: 'info@autobacsindia.com', name: 'Autobacs India' });
  });
});
