/**
 * WhatsApp building blocks, no database:
 *   toE164India           — which numbers we will message at all
 *   whatsappConsentFields — only a real boolean is consent
 *   getWhatsAppConfig     — off unless both required vars are set
 *   sendTemplateMessage   — request shape, transient vs permanent errors, no token leak
 *   enqueueOrderWhatsApp  — deterministic job id, the payment-failed delay, a no-op when
 *                           off, never throws
 */

import { jest } from '@jest/globals';

const added = [];
let addImpl = async (name, data, opts) => { added.push({ name, data, opts }); };
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getNotificationsQueue: () => ({ add: (...a) => addImpl(...a) }),
}));

const { toE164India } = await import('../../../utils/identity.js');
const { whatsappConsentFields } = await import('../../../utils/whatsappConsent.js');
const { getWhatsAppConfig, _resetWhatsAppWarning } = await import('../../../config/whatsapp.js');
const { sendTemplateMessage, cleanParam } = await import('../../../services/whatsapp/whatsappClient.js');
const { enqueueOrderWhatsApp, WHATSAPP_JOB } = await import('../../../services/whatsapp/orderWhatsAppService.js');

const ENV_KEYS = [
  'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TEST_RECIPIENTS',
  'WHATSAPP_TEMPLATE_ORDER_SHIPPED', 'WHATSAPP_GRAPH_VERSION', 'REDIS_URL', 'QUEUE_REDIS_URL',
  'PAYMENT_FAILED_EMAIL_DELAY_MINUTES',
];
const savedEnv = {};
beforeAll(() => { for (const k of ENV_KEYS) savedEnv[k] = process.env[k]; });
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  added.length = 0;
  addImpl = async (name, data, opts) => { added.push({ name, data, opts }); };
  _resetWhatsAppWarning();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const on = () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = '555';
  process.env.WHATSAPP_ACCESS_TOKEN = 'SECRET-TOKEN';
  process.env.REDIS_URL = 'redis://localhost:6379';
};

describe('toE164India', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['(+91) 6000 000 000', '+916000000000'],
  ])('%s → %s', (input, out) => expect(toE164India(input)).toBe(out));

  it.each([
    [''], [null], [undefined], ['12345'], ['5876543210'], ['04842345678'],
    ['+44 7700 900123'], ['98765432101'], ['+1 555 702 4783'],
  ])('rejects %p', (input) => expect(toE164India(input)).toBeNull());
});

describe('whatsappConsentFields', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  it('records a yes and a no, with who and when', () => {
    expect(whatsappConsentFields(true, 'customer', now))
      .toEqual({ whatsappOptIn: true, whatsappOptInAt: now, whatsappOptInBy: 'customer' });
    expect(whatsappConsentFields(false, 'staff', now))
      .toEqual({ whatsappOptIn: false, whatsappOptInAt: now, whatsappOptInBy: 'staff' });
  });
  it.each([[undefined], [null], ['true'], [1], [{}]])('stores nothing for %p (never an assumed yes)', (v) => {
    expect(whatsappConsentFields(v, 'customer', now)).toEqual({});
  });
});

describe('getWhatsAppConfig', () => {
  it('is off (null) unless BOTH the number id and the token are set, warning once', () => {
    expect(getWhatsAppConfig(toE164India)).toBeNull();
    process.env.WHATSAPP_PHONE_NUMBER_ID = '555';
    expect(getWhatsAppConfig(toE164India)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('reads defaults, template overrides and the test allow-list', () => {
    on();
    process.env.WHATSAPP_TEMPLATE_ORDER_SHIPPED = 'order_shipped_v2';
    process.env.WHATSAPP_TEST_RECIPIENTS = '98765 43210, junk, +91 6000000000';
    const cfg = getWhatsAppConfig(toE164India);
    expect(cfg.graphVersion).toBe('v23.0');
    expect(cfg.language).toBe('en');
    expect(cfg.templates.shipped).toBe('order_shipped_v2');
    expect(cfg.templates.refunded).toBe('refund_processed');
    expect([...cfg.testRecipients]).toEqual(['+919876543210', '+916000000000']);
  });
});

describe('sendTemplateMessage', () => {
  const cfg = { phoneNumberId: '555', accessToken: 'SECRET-TOKEN', graphVersion: 'v23.0' };
  const msg = { to: '+919876543210', template: 'order_shipped', language: 'en', params: ['Asha\nK', 'AB-1'] };
  const reply = (status, json) => jest.fn(async () => ({ ok: status < 400, status, json: async () => json }));

  it('posts one template message and returns Meta\'s id', async () => {
    const fetchImpl = reply(200, { messages: [{ id: 'wamid.XYZ' }] });
    await expect(sendTemplateMessage(msg, cfg, fetchImpl)).resolves.toEqual({ messageId: 'wamid.XYZ' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/555/messages');
    expect(init.headers.Authorization).toBe('Bearer SECRET-TOKEN');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '919876543210', type: 'template' });
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Asha K' }, { type: 'text', text: 'AB-1' },
    ]);
  });

  it.each([
    ['HTTP 500', 500, {}, true],
    ['HTTP 429', 429, {}, true],
    ['Meta throttling code on a 400', 400, { error: { code: 130429, message: 'rate' } }, true],
    ['invalid recipient', 400, { error: { code: 131026, message: 'undeliverable' } }, false],
    ['template not approved', 404, { error: { code: 132001, message: 'no template' } }, false],
    ['bad token', 401, { error: { code: 190, message: 'expired' } }, false],
  ])('%s → transient=%p', async (_l, status, json, transient) => {
    const err = await sendTemplateMessage(msg, cfg, reply(status, json)).catch((e) => e);
    expect(err.name).toBe('WhatsAppSendError');
    expect(err.transient).toBe(transient);
    expect(err.message).not.toContain('SECRET-TOKEN');
  });

  it('a network error or timeout is transient', async () => {
    const err = await sendTemplateMessage(msg, cfg, jest.fn(async () => { throw new Error('ECONNRESET'); })).catch((e) => e);
    expect(err.transient).toBe(true);
  });

  it('a 200 without a message id is not treated as sent', async () => {
    const err = await sendTemplateMessage(msg, cfg, reply(200, {})).catch((e) => e);
    expect(err.name).toBe('WhatsAppSendError');
  });

  it('cleanParam flattens whitespace Meta would reject and bounds length', () => {
    expect(cleanParam('a\t\tb\n\nc     d')).toBe('a b c d');
    expect(cleanParam('x'.repeat(500))).toHaveLength(300);
    expect(cleanParam(null)).toBe('');
  });
});

describe('enqueueOrderWhatsApp', () => {
  it('queues one job with a deterministic, colon-free id', async () => {
    on();
    await enqueueOrderWhatsApp('ord1', 'out_for_delivery', { shipmentId: 'shp1', occurrence: 3 });
    expect(added).toEqual([{
      name: WHATSAPP_JOB,
      data: { orderId: 'ord1', status: 'out_for_delivery', shipmentId: 'shp1', occurrence: 3 },
      opts: expect.objectContaining({ jobId: 'wa|ord1|out_for_delivery|shp1|3', attempts: 5 }),
    }]);
    expect(added[0].opts.jobId).not.toContain(':');
  });

  it('"payment failed" waits like the email does', async () => {
    on();
    process.env.PAYMENT_FAILED_EMAIL_DELAY_MINUTES = '15';
    await enqueueOrderWhatsApp('ord1', 'payment_failed');
    expect(added[0].opts.delay).toBe(15 * 60 * 1000);
  });

  it('does nothing when the channel is off, Redis is unset, or the event has no template', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(enqueueOrderWhatsApp('ord1', 'shipped')).toBeNull();
    on();
    delete process.env.REDIS_URL;
    expect(enqueueOrderWhatsApp('ord1', 'shipped')).toBeNull();
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(enqueueOrderWhatsApp('ord1', 'returned')).toBeNull();
    expect(added).toHaveLength(0);
  });

  it('never throws when the queue is down', async () => {
    on();
    addImpl = async () => { throw new Error('ECONNREFUSED'); };
    await expect(enqueueOrderWhatsApp('ord1', 'shipped')).resolves.toBeUndefined();
    addImpl = () => { throw new Error('sync boom'); };
    expect(() => enqueueOrderWhatsApp('ord1', 'shipped')).not.toThrow();
  });
});
