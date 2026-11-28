/**
 * The delivery-address rule (utils/deliveryAddress.js) and every server door
 * that applies it: website checkout, staff sales/quotation orders, admin
 * offline orders, saved addresses, and the admin address edit.
 *
 * The case table in shared/delivery-address-cases.json is the SAME one the
 * website and mobile tests run, so the three copies of the rule cannot drift.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import request from 'supertest';
import { body, validationResult } from 'express-validator';
import {
  deliveryAddressProblems, firstAddressProblem, isAddressComplete, streetLines, looksLikeJunk,
  addressFieldRules, ADDRESS_MESSAGES,
} from '../../../utils/deliveryAddress.js';
import { normaliseAddressBook } from '../../../utils/addressBook.js';
import { buildNewAddress } from '../../../services/orderAddressService.js';
import { buildBillToLines } from '../../../services/invoiceService.js';
import { validateOrder } from '../../../middleware/validators/order.js';
import { validateSalesOrder } from '../../../validators/staff.validator.js';
import { createOfflineOrderRecord } from '../../../services/offlineOrderService.js';

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, '../../../../../shared/delivery-address-cases.json'), 'utf8'));

const good = { houseNumber: 'Flat 4B, Jomer Symphony', addressLine1: 'MG Road, Edappally', landmark: 'Opp. Lulu Mall' };
const full = (over = {}) => ({
  fullName: 'Rahul Menon', phone: '9876543210', ...good, city: 'Kochi', state: 'Kerala', postalCode: '682024', ...over,
});

describe('the rule — shared case table', () => {
  it.each(cases.map((c) => [c.name, c]))('%s', (_n, c) => {
    const problems = deliveryAddressProblems(c.address);
    if (c.ok) expect(problems).toEqual({});
    else expect(Object.keys(problems)).toContain(c.field);
  });

  it('a missing house number names an example', () => {
    expect(firstAddressProblem({ addressLine1: 'MG Road, Edappally' })).toBe(ADDRESS_MESSAGES.houseRequired);
    expect(ADDRESS_MESSAGES.houseRequired).toMatch(/Flat 4B/);
  });

  it('a one-word street says why', () => {
    expect(deliveryAddressProblems({ houseNumber: '12', addressLine1: 'Kochi' }).addressLine1).toBe(ADDRESS_MESSAGES.streetShort);
  });

  it.each(['-', '...', 'aaaa', 'NA', 'n/a', '0000', 'test test', 'xxx'])('"%s" is junk', (v) => {
    expect(looksLikeJunk(v)).toBe(true);
  });

  it.each(['Flat 4B', '12/345', 'MG Road', 'Near Lulu Mall', '7'])('"%s" is not junk', (v) => {
    expect(looksLikeJunk(v)).toBe(false);
  });

  it('an old address (no house number) is incomplete but still formats', () => {
    const old = { addressLine1: '12 MG Road', addressLine2: 'Near bus stop' };
    expect(isAddressComplete(old)).toBe(false);
    expect(streetLines(old)).toEqual(['12 MG Road', 'Near bus stop']);
  });

  it('streetLines puts the house first and labels the landmark', () => {
    expect(streetLines(good)).toEqual(['Flat 4B, Jomer Symphony', 'MG Road, Edappally', 'Landmark: Opp. Lulu Mall']);
    expect(streetLines(null)).toEqual([]);
  });
});

describe('addressFieldRules (express-validator)', () => {
  const app = express();
  app.use(express.json());
  app.post('/x', ...addressFieldRules(body, 'a'), (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    return res.json(req.body.a);
  });

  it('trims and passes a good address', async () => {
    const res = await request(app).post('/x').send({ a: { houseNumber: '  Flat 4B ', addressLine1: 'MG  Road,  Edappally' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ houseNumber: 'Flat 4B', addressLine1: 'MG Road, Edappally', landmark: '' });
  });

  it('reports each bad field by path', async () => {
    const res = await request(app).post('/x').send({ a: { houseNumber: '-', addressLine1: 'Kochi', landmark: '..' } });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.path).sort()).toEqual(['a.addressLine1', 'a.houseNumber', 'a.landmark']);
  });
});

// ── Each server door rejects a bad address ───────────────────────────────────

describe('website checkout (validateOrder — POST /orders and /orders/guest)', () => {
  const app = express();
  app.use(express.json());
  app.post('/orders', validateOrder, (req, res) => res.json({ ok: true, a: req.body.shippingAddress }));
  const place = (addr) => request(app).post('/orders')
    .send({ items: [{ product: '507f1f77bcf86cd799439011', quantity: 1 }], shippingAddress: addr });

  it('accepts a full address, landmark optional', async () => {
    expect((await place(full())).status).toBe(200);
    expect((await place(full({ landmark: undefined }))).status).toBe(200);
  });

  it.each([
    ['missing house no.', { houseNumber: '' }, 'house name or flat'],
    ['one-word street', { addressLine1: 'Kochi' }, 'one word'],
    ['junk street', { addressLine1: 'aaaa' }, "doesn't look right"],
    ['junk landmark', { landmark: '-' }, 'landmark'],
  ])('rejects %s', async (_n, over, text) => {
    const res = await place(full(over));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body).toLowerCase()).toContain(text.toLowerCase());
  });
});

describe('staff sales order / quotation (validateSalesOrder)', () => {
  const app = express();
  app.use(express.json());
  app.post('/q', validateSalesOrder, (req, res) => {
    const errs = validationResult(req).array().filter((e) => String(e.path).startsWith('shippingAddress'));
    return errs.length ? res.status(400).json({ errs }) : res.json({ ok: true });
  });
  const send = (over) => request(app).post('/q').send({
    customer: { name: 'Rahul', phone: '9876543210' },
    shippingAddress: full(over),
    items: [{ product: '507f1f77bcf86cd799439011', quantity: 1 }],
  });

  it('passes a full address', async () => expect((await send({})).status).toBe(200));
  it('rejects a missing house no.', async () => {
    const res = await send({ houseNumber: '' });
    expect(res.status).toBe(400);
    expect(res.body.errs[0].path).toBe('shippingAddress.houseNumber');
  });
  it('rejects a one-word street', async () => {
    const res = await send({ addressLine1: 'Kochi' });
    expect(res.body.errs[0].path).toBe('shippingAddress.addressLine1');
  });
});

describe('offline / sales / quotation-accept (createOfflineOrderRecord — the shared door)', () => {
  // The check runs before any database call, so no DB is needed to prove it.
  const call = (addr) => createOfflineOrderRecord({
    body: {}, email: 'a@b.com', phone: '9876543210', lineItems: [], shippingAddress: addr, paymentMode: 'paid', actorId: null,
  });

  it('refuses an address with no house number (e.g. an old quotation)', async () => {
    await expect(call(full({ houseNumber: undefined }))).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/house name or flat \/ building number/i) });
  });
  it('refuses a junk street', async () => {
    await expect(call(full({ addressLine1: '-' }))).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('saved addresses (normaliseAddressBook)', () => {
  it('keeps the house number and landmark', () => {
    const [a] = normaliseAddressBook([full()]);
    expect(a).toMatchObject({ houseNumber: 'Flat 4B, Jomer Symphony', landmark: 'Opp. Lulu Mall' });
  });

  it('drops an empty landmark', () => {
    const [a] = normaliseAddressBook([full({ landmark: '' })]);
    expect(a).not.toHaveProperty('landmark');
  });

  it('rejects a NEW address without a house number', () => {
    expect(() => normaliseAddressBook([full({ houseNumber: '' })])).toThrow(/house name or flat \/ building number/i);
  });

  it('lets an UNCHANGED old address through, so the customer can still manage the rest', () => {
    const old = { fullName: 'Rahul Menon', phone: '9876543210', addressLine1: 'Kochi', addressLine2: '', city: 'Kochi', state: 'Kerala', postalCode: '682024', country: 'India', isDefault: true };
    const out = normaliseAddressBook([old, full()], [old]);
    expect(out).toHaveLength(2);
    expect(out[0].addressLine1).toBe('Kochi');
  });

  it('but an EDITED old address must meet the rule', () => {
    const old = { fullName: 'Rahul Menon', phone: '9876543210', addressLine1: 'Kochi', city: 'Kochi', state: 'Kerala', postalCode: '682024' };
    expect(() => normaliseAddressBook([{ ...old, city: 'Aluva' }], [old])).toThrow(/house name or flat \/ building number/i);
  });
});

describe('admin address edit (buildNewAddress)', () => {
  const current = { fullName: 'Rahul', phone: '9876543210', addressLine1: 'Kochi', city: 'Kochi', state: 'Kerala', postalCode: '682024', country: 'India' };

  it('an old order must have the house number added before the edit saves', () => {
    expect(() => buildNewAddress(current, { phone: '9876543211' })).toThrow(/house name or flat \/ building number/i);
  });

  it('saves house number and landmark', () => {
    const next = buildNewAddress(current, { houseNumber: 'Flat 4B', addressLine1: 'MG Road, Edappally', landmark: 'Opp. Lulu Mall' });
    expect(next).toMatchObject({ houseNumber: 'Flat 4B', addressLine1: 'MG Road, Edappally', landmark: 'Opp. Lulu Mall', postalCode: '682024' });
  });

  it('rejects a junk street', () => {
    expect(() => buildNewAddress(current, { houseNumber: 'Flat 4B', addressLine1: 'aaaa' })).toThrow(/doesn't look right/);
  });
});

describe('documents show the house number and landmark', () => {
  it('invoice bill-to lines', () => {
    const { lines } = buildBillToLines({ shippingAddress: full() }, { email: 'a@b.com' });
    expect(lines.slice(0, 3)).toEqual(['Flat 4B, Jomer Symphony', 'MG Road, Edappally', 'Landmark: Opp. Lulu Mall']);
  });

  it('B2B "billing same as delivery" (house folded into line 1) adds no duplicate ship-to block', () => {
    const order = {
      shippingAddress: full(),
      buyer: { type: 'enterprise', legalName: 'ABC Motors', gstin: '32AAACA1234A1Z5', billingAddress: { addressLine1: 'Flat 4B, Jomer Symphony, MG Road, Edappally', city: 'Kochi', postalCode: '682024', state: 'Kerala' } },
    };
    expect(buildBillToLines(order, {}).shipTo).toBeNull();
  });

  it('an old order renders exactly as before', () => {
    const { lines } = buildBillToLines({ shippingAddress: { addressLine1: '12 MG Road', city: 'Kochi', postalCode: '682024', state: 'Kerala' } }, {});
    expect(lines[0]).toBe('12 MG Road');
  });
});
