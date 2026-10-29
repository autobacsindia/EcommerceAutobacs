import { jest } from '@jest/globals';
import {
  ZeptoMailClient,
  DEFAULT_ZEPTOMAIL_API_URL,
  buildAuthHeader,
  parseMailbox,
  toZeptoMailPayload,
} from '../../../services/email/zeptomailClient.js';

// A minimal fetch Response double: status + a JSON body (or an unreadable one).
const response = (status, body, { badJson = false } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: badJson ? () => Promise.reject(new SyntaxError('Unexpected token')) : () => Promise.resolve(body),
});

const ACCEPTED = { data: [{ code: 'EM_104', message: 'Email request received' }], message: 'OK', request_id: 'req-abc' };

const fullMessage = () => ({
  From: 'Autobacs India <noreply@autobacsindia.com>',
  To: 'buyer@example.com',
  Subject: 'Order confirmed',
  TextBody: 'thanks',
  HtmlBody: '<p>thanks</p>',
  ReplyTo: 'support+t.ABI-1.abcd@autobacsindia.com',
  Headers: [
    { Name: 'Message-ID', Value: '<ticket.1@autobacsindia.com>' },
    { Name: 'Auto-Submitted', Value: 'auto-generated' },
  ],
  Attachments: [{ Name: 'invoice-59.pdf', Content: 'JVBERi0=', ContentType: 'application/pdf' }],
  MessageStream: 'outbound',
});

describe('ZeptoMail client — request shape', () => {
  test('POSTs JSON to the India host with the Zoho-enczapikey scheme', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(201, ACCEPTED));
    const client = new ZeptoMailClient({ token: 'tok123', fetchImpl });

    await client.sendEmail(fullMessage());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://cpaas.zoho.in/v1.1/email');
    expect(url).toBe(DEFAULT_ZEPTOMAIL_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Zoho-enczapikey tok123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.signal).toBeDefined();
  });

  test('maps every field emailHandler sets onto the ZeptoMail payload', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, ACCEPTED));
    await new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage());

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({
      from: { address: 'noreply@autobacsindia.com', name: 'Autobacs India' },
      to: [{ email_address: { address: 'buyer@example.com' } }],
      subject: 'Order confirmed',
      textbody: 'thanks',
      htmlbody: '<p>thanks</p>',
      reply_to: [{ address: 'support+t.ABI-1.abcd@autobacsindia.com' }],
      mime_headers: { 'Message-ID': '<ticket.1@autobacsindia.com>', 'Auto-Submitted': 'auto-generated' },
      attachments: [{ name: 'invoice-59.pdf', content: 'JVBERi0=', mime_type: 'application/pdf' }],
      // Pinned off: click tracking would rewrite password-reset and claim links.
      track_clicks: false,
      track_opens: false,
    });
    expect(body).not.toHaveProperty('MessageStream');
  });

  test('omits optional fields that were not set', () => {
    const payload = toZeptoMailPayload({ From: 'a@autobacsindia.com', To: 'b@example.com', Subject: 's', TextBody: 't' });
    expect(payload).not.toHaveProperty('htmlbody');
    expect(payload).not.toHaveProperty('reply_to');
    expect(payload).not.toHaveProperty('mime_headers');
    expect(payload).not.toHaveProperty('attachments');
    expect(payload.from).toEqual({ address: 'a@autobacsindia.com' });
  });

  test('accepts a token pasted with or without the scheme, never doubling it', () => {
    expect(buildAuthHeader('abc')).toBe('Zoho-enczapikey abc');
    expect(buildAuthHeader('  Zoho-enczapikey abc  ')).toBe('Zoho-enczapikey abc');
    expect(buildAuthHeader('zoho-enczapikey abc')).toBe('zoho-enczapikey abc');
  });

  test('honours a configured API URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, ACCEPTED));
    await new ZeptoMailClient({ token: 't', apiUrl: 'https://api.zeptomail.in/v1.1/email', fetchImpl })
      .sendEmail(fullMessage());
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.zeptomail.in/v1.1/email');
  });

  test('refuses to construct without a token', () => {
    expect(() => new ZeptoMailClient({ token: '  ' })).toThrow(/token is required/);
  });

  test.each([
    ['noreply@autobacsindia.com', { address: 'noreply@autobacsindia.com' }],
    ['Autobacs India <noreply@autobacsindia.com>', { address: 'noreply@autobacsindia.com', name: 'Autobacs India' }],
    ['"Autobacs, India" <info@autobacsindia.com>', { address: 'info@autobacsindia.com', name: 'Autobacs, India' }],
    ['<bare@autobacsindia.com>', { address: 'bare@autobacsindia.com' }],
  ])('parseMailbox(%s)', (input, expected) => {
    expect(parseMailbox(input)).toEqual(expected);
  });
});

describe('ZeptoMail client — responses and errors', () => {
  test('success resolves the request_id as the MessageID', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(201, ACCEPTED));
    await expect(new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage()))
      .resolves.toEqual({ MessageID: 'req-abc' });
  });

  test('an accepted (2xx) send with an unreadable body is still a success — never retried', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, null, { badJson: true }));
    await expect(new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage()))
      .resolves.toEqual({ MessageID: null });
  });

  test('a rejected token throws with the HTTP status and the ZeptoMail code', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(401, {
      error: { code: 'TM_4001', details: [{ code: 'SERR_157', message: 'Invalid API Token found' }], message: 'Access Denied' },
    }));

    const err = await new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('TM_4001');
    expect(err.message).toBe('Access Denied: Invalid API Token found');
    expect(err.retryable).toBeUndefined();
  });

  test('understands the older documented error shape too', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(400, { data: { error_code: 'TM_3004', message: 'Invalid request' }, message: 'error' }));
    const err = await new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage()).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('TM_3004');
    expect(err.message).toBe('Invalid request');
  });

  test('a 5xx with no JSON body still throws with the status', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(503, null, { badJson: true }));
    const err = await new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage()).catch((e) => e);
    expect(err.statusCode).toBe(503);
    expect(err.message).toBe('ZeptoMail responded 503');
  });

  test('a transient socket failure is flagged retryable with its code', async () => {
    const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const fetchImpl = jest.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause }));
    const err = await new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage()).catch((e) => e);
    expect(err.code).toBe('ECONNRESET');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/socket hang up/);
  });

  test('a timeout is reported as ETIMEDOUT and retryable', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    const err = await new ZeptoMailClient({ token: 't', timeoutMs: 1234, fetchImpl }).sendEmail(fullMessage()).catch((e) => e);
    expect(err.code).toBe('ETIMEDOUT');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/1234ms/);
  });

  test('an unrecognised network failure is not assumed transient', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const err = await new ZeptoMailClient({ token: 't', fetchImpl }).sendEmail(fullMessage()).catch((e) => e);
    expect(err.retryable).toBe(false);
  });
});
