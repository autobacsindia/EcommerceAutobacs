import { jest } from '@jest/globals';

/**
 * "Same job twice → one email", end to end through ZeptoMail.
 *
 * The order-confirmation (invoice) email is sent exactly once by an atomic claim
 * on the order (orderRepository.claimInvoiceEmail), released only on failure so
 * BullMQ can retry. Switching provider must not weaken that. These tests run the
 * REAL invoiceService + emailHandler + ZeptoMailClient over a fake network, with
 * an in-memory order whose claim has the same compare-and-set semantics as the
 * Mongo `updateOne({ invoiceEmailedAt: null })`.
 */

const store = { order: null };
const mockOrderRepo = {
  findById: jest.fn(async () => (store.order ? { ...store.order } : null)),
  // Compare-and-set, like the real `updateOne({ _id, invoiceEmailedAt: null })`.
  claimInvoiceEmail: jest.fn(async () => {
    if (store.order.invoiceEmailedAt) return false;
    store.order.invoiceEmailedAt = new Date();
    return true;
  }),
  save: jest.fn(async (doc) => {
    store.order = { ...store.order, ...doc };
    return true;
  }),
};
const mockCounter = { next: jest.fn() };

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../repositories/counterRepository.js', () => ({ default: mockCounter }));

const { emailOrderInvoice } = await import('../../../services/invoiceService.js');
const { default: emailHandler } = await import('../../../services/emailHandler.js');
const { ZeptoMailClient } = await import('../../../services/email/zeptomailClient.js');

const ZEPTO_URL = 'https://cpaas.zoho.in/v1.1/email';
const ok = () => ({ status: 201, ok: true, json: async () => ({ message: 'OK', request_id: 'req-1' }) });
const busy = () => ({ status: 503, ok: false, json: async () => ({ error: { code: 'TM_5000', message: 'busy' } }) });

/** Every POST that reached ZeptoMail and was accepted = one email in an inbox. */
// A plain function, not jest.fn: the jest config's resetMocks would wipe a
// jest.fn implementation between tests.
let zeptoCalls;
let script;
const fetchImpl = async (url, init) => {
  if (url !== ZEPTO_URL) throw new Error(`unexpected request to ${url}`);
  const next = script.shift() || ok;
  const res = next();
  zeptoCalls.push({ status: res.status, body: JSON.parse(init.body) });
  return res;
};
const delivered = () => zeptoCalls.filter((c) => c.status >= 200 && c.status < 300).length;

const originalFetch = global.fetch;

beforeAll(() => {
  // The invoice renderer fetches the company logo; fail it so the PDF degrades
  // to a text header and no test touches the network.
  global.fetch = jest.fn().mockRejectedValue(new Error('network disabled in tests'));
});

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  delete process.env.EMAIL_REDIRECT_TO;
  delete process.env.INVOICE_STORE_CLOUDINARY;
  zeptoCalls = [];
  script = [];
  mockCounter.next.mockResolvedValue(59);
  mockOrderRepo.findById.mockImplementation(async () => (store.order ? { ...store.order } : null));
  mockOrderRepo.claimInvoiceEmail.mockImplementation(async () => {
    if (store.order.invoiceEmailedAt) return false;
    store.order.invoiceEmailedAt = new Date();
    return true;
  });
  mockOrderRepo.save.mockImplementation(async (doc) => {
    store.order = { ...store.order, ...doc };
    return true;
  });

  emailHandler.isEnabled = true;
  emailHandler.fromEmail = 'noreply@autobacsindia.com';
  emailHandler.fromName = 'Autobacs India';
  emailHandler.client = new ZeptoMailClient({ token: 'test-token', fetchImpl });

  store.order = {
    _id: 'abcdef1234567890',
    status: 'confirmed',
    createdAt: new Date('2026-10-29T10:00:00Z'),
    items: [{ name: 'Car Wax', quantity: 1, price: 499 }],
    shippingAddress: { fullName: 'Test Buyer', addressLine1: '1 Test St', city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India' },
    subtotal: 499, shippingCost: 0, tax: 0, totalAmount: 499,
    guestEmail: 'buyer@example.com',
    invoiceEmailedAt: null,
  };
});

describe('order confirmation through ZeptoMail — exactly one email', () => {
  test('the same job replayed after success sends nothing more', async () => {
    await expect(emailOrderInvoice('abcdef1234567890')).resolves.toEqual({ status: 'sent' });
    await expect(emailOrderInvoice('abcdef1234567890')).resolves.toEqual({ status: 'skipped' });
    await expect(emailOrderInvoice('abcdef1234567890')).resolves.toEqual({ status: 'skipped' });

    expect(delivered()).toBe(1);
    const { body } = zeptoCalls[0];
    expect(body.to[0].email_address.address).toBe('buyer@example.com');
    expect(body.attachments[0]).toMatchObject({ name: 'invoice-59.pdf', mime_type: 'application/pdf' });
  });

  test('two workers racing on the same order → one email', async () => {
    const results = await Promise.all([
      emailOrderInvoice('abcdef1234567890'),
      emailOrderInvoice('abcdef1234567890'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['sent', 'skipped']);
    expect(delivered()).toBe(1);
  });

  test('a ZeptoMail outage fails the job (so BullMQ retries); the retry delivers once', async () => {
    // Every in-process attempt of the first job hits a 503.
    script = Array.from({ length: emailHandler.retryAttempts }, () => busy);

    await expect(emailOrderInvoice('abcdef1234567890')).rejects.toThrow(/Invoice email failed/);
    expect(delivered()).toBe(0);
    expect(store.order.invoiceEmailedAt).toBeNull(); // claim released for the retry

    // BullMQ's retry, then a stray duplicate of the same job.
    await expect(emailOrderInvoice('abcdef1234567890')).resolves.toEqual({ status: 'sent' });
    await expect(emailOrderInvoice('abcdef1234567890')).resolves.toEqual({ status: 'skipped' });

    expect(delivered()).toBe(1);
  });

  test('a rejected token fails the job without sending; after the fix the retry delivers once', async () => {
    const rejected = () => ({ status: 401, ok: false, json: async () => ({ error: { code: 'TM_4001', message: 'Access Denied' } }) });
    script = [rejected];

    await expect(emailOrderInvoice('abcdef1234567890')).rejects.toThrow(/Invoice email failed/);
    expect(zeptoCalls).toHaveLength(1); // a 401 is not retried in-process
    expect(delivered()).toBe(0);
    expect(store.order.invoiceEmailedAt).toBeNull();

    // Token fixed, BullMQ retries the job → delivered exactly once.
    await expect(emailOrderInvoice('abcdef1234567890')).resolves.toEqual({ status: 'sent' });
    expect(delivered()).toBe(1);
  });
});
