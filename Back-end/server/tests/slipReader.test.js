/**
 * Payment-slip reader (services/slipReader/*). The Claude API is a double — no
 * key, no network, no cost. Mongo is real (the duplicate-UTR lookup).
 *
 * What must hold:
 *   - off until ANTHROPIC_API_KEY is set: nothing is sent anywhere
 *   - a good slip → cleaned suggestions (UTR, IST date & time, amount, people, app) + a signed token
 *   - an unreadable slip, a refusal, junk output, a timeout or the API being down
 *     → a normal "please type it" answer, never an error (the upload still works)
 *   - amount different from the payment → a warning; a UTR already on another
 *     payment → a warning (but not the record's own UTR when editing it)
 *   - a wrong file type is refused before anything is sent
 *   - the slip's values are never logged
 *   - on save, "read from slip" vs "typed / changed" is decided from the signed
 *     token: forged, expired, someone else's, or a slip not being saved → nothing claimed
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';

jest.setTimeout(60000);

// ── Claude API double ───────────────────────────────────────────────────────
class APIError extends Error { constructor(status, message = 'api error') { super(message); this.status = status; } }
class APIConnectionError extends APIError { constructor() { super(undefined, 'connection'); } }
class APIConnectionTimeoutError extends APIConnectionError {}
class AuthenticationError extends APIError { constructor() { super(401); } }
class PermissionDeniedError extends APIError { constructor() { super(403); } }

const api = { calls: [], next: null };
const respond = async (params, options) => {
  api.calls.push({ params, options });
  const next = typeof api.next === 'function' ? api.next() : api.next;
  if (next instanceof Error) throw next;
  return next;
};
class FakeAnthropic {
  constructor(opts) { this.opts = opts; this.messages = { create: respond }; this.beta = { messages: { create: respond } }; }
}
Object.assign(FakeAnthropic, { APIError, APIConnectionError, APIConnectionTimeoutError, AuthenticationError, PermissionDeniedError });
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({ default: FakeAnthropic }));

const svc = await import('../services/slipReader/slipReaderService.js');
const { SLIP_TOKEN_TTL_MS } = await import('../config/slipReader.js');
const { default: BankTransfer } = await import('../models/BankTransfer.js');
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const { default: SupplierLedgerEntry } = await import('../models/SupplierLedgerEntry.js');

const reply = (fields, extra = {}) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  usage: { input_tokens: 1500, output_tokens: 300 },
  content: [{ type: 'text', text: JSON.stringify(fields) }],
  ...extra,
});
const GPAY = {
  readable: true, reference: '431122334455', referenceLabel: 'UPI transaction ID', otherReferences: ['CICAgOD1234'],
  amount: 52000, currency: 'INR', date: '2026-11-18', time: '14:05', paymentStatus: 'success',
  payerName: 'Ravi Kumar', payeeName: 'Autobacs India', payeeAccount: 'XXXX1234', appOrBank: 'Google Pay',
};

let JPEG;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const file = (buffer = JPEG, name = 'gpay.jpg', mimetype = 'image/jpeg') => ({ buffer, originalname: name, mimetype });
const actor = { _id: new mongoose.Types.ObjectId(), name: 'Sam' };

const ENV = { ...process.env };
beforeAll(async () => {
  JPEG = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
});
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
  delete process.env.SLIP_READER_ENABLED;
  delete process.env.SLIP_READER_MODEL;
  api.calls.length = 0;
  api.next = reply(GPAY);
});
afterAll(() => { process.env = ENV; });

describe('reading a slip', () => {
  it('is off until the API key is set — nothing is sent', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(svc.readSlip(actor, file())).resolves.toEqual({ status: 'off' });
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    process.env.SLIP_READER_ENABLED = 'false';
    await expect(svc.readSlip(actor, file())).resolves.toEqual({ status: 'off' });
    expect(api.calls).toHaveLength(0);
  });

  it('a good slip: cleaned suggestions, IST time, a signed token, no warnings', async () => {
    const res = await svc.readSlip(actor, file(), { expectedAmount: 52000 });
    expect(res.status).toBe('read');
    expect(res.fields).toMatchObject({
      reference: '431122334455', amount: 52000, date: '2026-11-18', time: '14:05',
      payerName: 'Ravi Kumar', payeeName: 'Autobacs India', appOrBank: 'Google Pay', paymentStatus: 'success',
      otherReferences: ['CICAgOD1234'],
    });
    expect(res.fields.transactionAt).toBe('2026-11-18T08:35:00.000Z'); // 14:05 IST
    expect(res.warnings).toEqual([]);
    expect(svc.verifyReadToken(res.token)).toMatchObject({ u: String(actor._id), f: { reference: '431122334455', amount: 52000 } });

    // One call, structured output, an image block shrunk to JPEG, the default model with server-side fallback.
    expect(api.calls).toHaveLength(1);
    const { params, options } = api.calls[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.fallbacks).toBe('default');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(options).toMatchObject({ maxRetries: 0, timeout: 15000 });
  });

  it('a PDF goes as a document; a cheaper model needs no fallback beta', async () => {
    process.env.SLIP_READER_MODEL = 'claude-haiku-5-5';
    await svc.readSlip(actor, file(PDF, 'advice.pdf', 'application/pdf'));
    const { params } = api.calls[0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.fallbacks).toBeUndefined();
    expect(params.messages[0].content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
  });

  it('values that are not what they claim are dropped, not passed on', async () => {
    api.next = reply({ ...GPAY, reference: 'ab', amount: -5, date: '2026-02-31', time: '99:99', payerName: 7 });
    const res = await svc.readSlip(actor, file());
    expect(res.status).toBe('unreadable'); // nothing usable left
    api.next = reply({ ...GPAY, amount: '1,200', date: '2026-11-18', time: '9:07 PM' });
    const ok = await svc.readSlip(actor, file());
    expect(ok.fields).toMatchObject({ amount: null, time: '21:07', reference: '431122334455' });
  });

  it('an unreadable slip asks for typing, with no token', async () => {
    api.next = reply({ ...GPAY, readable: false });
    const res = await svc.readSlip(actor, file());
    expect(res).toEqual({ status: 'unreadable', message: expect.stringMatching(/type/) });
  });

  it('warns when the slip amount is not the payment amount', async () => {
    const res = await svc.readSlip(actor, file(), { expectedAmount: '54000' });
    expect(res.warnings).toEqual([{ code: 'amount_mismatch', message: expect.stringMatching(/₹52,000.*₹54,000/) }]);
  });

  it('warns when the slip says the payment failed', async () => {
    api.next = reply({ ...GPAY, paymentStatus: 'failed' });
    const res = await svc.readSlip(actor, file());
    expect(res.warnings.map((w) => w.code)).toEqual(['not_successful']);
  });

  describe('duplicate UTR', () => {
    afterEach(async () => {
      await Promise.all([BankTransfer.deleteMany({}), PaymentRequest.deleteMany({}), SupplierLedgerEntry.deleteMany({})]);
    });

    it('on a bank transfer (any spelling) → warns, naming the order', async () => {
      await BankTransfer.collection.insertOne({ referenceKey: '431122334455', active: true, orderNumber: 'AB-1042' });
      api.next = reply({ ...GPAY, reference: '4311 2233 4455' });
      const res = await svc.readSlip(actor, file());
      expect(res.warnings).toEqual([{ code: 'duplicate_reference', message: expect.stringMatching(/order AB-1042/) }]);
    });

    it('on a paid supplier payment → warns, naming it; not when editing that same payment', async () => {
      const _id = new mongoose.Types.ObjectId();
      await PaymentRequest.collection.insertOne({ _id, number: 'PR-0091', status: 'paid', payment: { reference: '431122334455' } });
      expect((await svc.readSlip(actor, file())).warnings[0].message).toMatch(/payment PR-0091/);
      expect((await svc.readSlip(actor, file(), { excludeId: String(_id) })).warnings).toEqual([]);
    });

    it('on a supplier refund → warns; a rejected transfer or declined refund does not count', async () => {
      await SupplierLedgerEntry.collection.insertOne({ reference: '431122334455', status: 'pending', paymentRequestNumber: 'PR-0007', supplierName: 'Kaze' });
      expect((await svc.readSlip(actor, file())).warnings[0].message).toMatch(/supplier refund on PR-0007 \(Kaze\)/);
      await SupplierLedgerEntry.deleteMany({});
      await SupplierLedgerEntry.collection.insertOne({ reference: '431122334455', status: 'declined' });
      await BankTransfer.collection.insertOne({ referenceKey: '431122334455', active: false, orderNumber: 'AB-1' });
      expect((await svc.readSlip(actor, file())).warnings).toEqual([]);
    });
  });

  describe('when reading fails, the form just asks for typing', () => {
    it.each([
      ['the API is down', () => new APIError(529), 'unavailable'],
      ['the network is down', () => new APIConnectionError(), 'unavailable'],
      ['it takes too long', () => new APIConnectionTimeoutError(), 'timeout'],
      ['the key is wrong', () => new AuthenticationError(), 'config'],
      ['the model declines', () => reply(GPAY, { stop_reason: 'refusal' }), 'refused'],
      ['the answer is cut off', () => reply(GPAY, { stop_reason: 'max_tokens' }), 'bad_output'],
      ['the answer is not JSON', () => ({ ...reply(GPAY), content: [{ type: 'text', text: 'Sorry, I cannot' }] }), 'bad_output'],
      ['something unexpected throws', () => new TypeError('boom'), 'unavailable'],
    ])('%s', async (_label, make, reason) => {
      api.next = make;
      const res = await svc.readSlip(actor, file());
      expect(res).toEqual({ status: 'failed', reason, message: expect.stringMatching(/type the details/) });
    });

    it('a picture that cannot be opened is not sent', async () => {
      const broken = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(50, 1)]);
      const res = await svc.readSlip(actor, file(broken));
      expect(res).toMatchObject({ status: 'failed', reason: 'bad_image' });
      expect(api.calls).toHaveLength(0);
    });
  });

  it('refuses a file that is not a photo or PDF by its bytes, before sending anything', async () => {
    await expect(svc.readSlip(actor, file(Buffer.from('MZ not a slip at all'), 'slip.jpg'))).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.readSlip(actor, undefined)).rejects.toMatchObject({ statusCode: 400 });
    expect(api.calls).toHaveLength(0);
  });

  it('never logs what was on the slip', async () => {
    const lines = [];
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation((...a) => { lines.push(a.join(' ')); }));
    await svc.readSlip(actor, file());
    api.next = () => new APIError(500, `bad request containing ${GPAY.reference}`);
    await svc.readSlip(actor, file());
    spies.forEach((s) => s.mockRestore());
    const all = lines.join('\n');
    expect(all).toMatch(/\[SlipReader\]/);
    for (const secret of [GPAY.reference, 'Ravi Kumar', '52000', 'Autobacs India', 'XXXX1234']) expect(all).not.toContain(secret);
  });
});

describe('on save: which fields came from the slip', () => {
  let token;
  beforeEach(async () => { ({ token } = await svc.readSlip(actor, file())); });
  const at = (iso) => new Date(iso);

  it('saved as read → slip; changed → edited; not on the slip → typed', () => {
    expect(svc.slipProvenance(actor, token, {
      files: [file(PDF), file()], reference: '4311-2233-4455', transactionAt: at('2026-11-18T08:35:00Z'), amount: 52000,
    })).toMatchObject({ model: 'claude-opus-5-5', fields: { reference: 'slip', date: 'slip', amount: 'slip' } });

    expect(svc.slipProvenance(actor, token, {
      files: [file()], reference: '431122334456', transactionAt: at('2026-11-18T09:35:00Z'), amount: 50000,
    }).fields).toEqual({ reference: 'edited', date: 'edited', amount: 'edited' });

    // A day-only field compares the day.
    expect(svc.slipProvenance(actor, token, { files: [file()], date: new Date('2026-11-18T00:00:00Z') }).fields).toEqual({ date: 'slip' });
    expect(svc.slipProvenance(actor, token, { files: [file()], date: '2026-11-17' }).fields).toEqual({ date: 'edited' });
  });

  it('a field the slip did not show is typed', async () => {
    api.next = reply({ ...GPAY, reference: '', time: '' });
    const { token: t2 } = await svc.readSlip(actor, file());
    expect(svc.slipProvenance(actor, t2, { files: [file()], reference: 'TYPEDREF123', transactionAt: at('2026-11-17T18:30:00Z') }).fields)
      .toEqual({ reference: 'typed', date: 'slip' }); // no time on the slip: the day is what counts
  });

  it('claims nothing for a forged, expired or someone else\'s token, or a slip not being saved', () => {
    const saved = { files: [file()], reference: '431122334455' };
    expect(svc.slipProvenance(actor, '', saved)).toBeNull();
    expect(svc.slipProvenance(actor, `${token}x`, saved)).toBeNull();
    const [body] = token.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
    forged.f.reference = 'SOMETHINGELSE1';
    expect(svc.slipProvenance(actor, `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${token.split('.')[1]}`, saved)).toBeNull();
    expect(svc.slipProvenance({ _id: new mongoose.Types.ObjectId() }, token, saved)).toBeNull();
    expect(svc.slipProvenance(actor, token, { ...saved, files: [file(PDF)] })).toBeNull(); // read one slip, saved another
    const old = svc.signReadToken({ ...forged, f: { reference: '431122334455' }, at: Date.now() - SLIP_TOKEN_TTL_MS - 1000 });
    expect(svc.slipProvenance(actor, old, saved)).toBeNull();
  });

  it('a later correction of a field saved from the slip marks it changed', () => {
    const set = {};
    svc.markEdited({ fields: { reference: 'slip', date: 'typed' } }, set, 'reference');
    svc.markEdited({ fields: { reference: 'slip', date: 'typed' } }, set, 'date');
    svc.markEdited(null, set, 'amount');
    svc.markEdited({ fields: { reference: 'slip' } }, set, 'reference', 'payment.slipRead');
    expect(set).toEqual({ 'slipRead.fields.reference': 'edited', 'payment.slipRead.fields.reference': 'edited' });
  });

  it('the token cannot be minted without the server secret', () => {
    const [body] = token.split('.');
    const guess = crypto.createHmac('sha256', 'wrong-secret').update(`slip-read:v1.${body}`).digest('base64url');
    expect(svc.verifyReadToken(`${body}.${guess}`)).toBeNull();
  });
});
