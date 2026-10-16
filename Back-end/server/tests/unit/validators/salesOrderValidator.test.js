/**
 * The sales-order request rules: mobile numbers as people type them, and a line
 * that is either a catalogue product or a named, priced custom item.
 */
import { validationResult } from 'express-validator';
import { validateSalesOrder, normalizeIndianMobile } from '../../../validators/staff.validator.js';

const run = async (body) => {
  const req = { body };
  for (const rule of validateSalesOrder) await rule.run(req);
  return { errors: validationResult(req).array().map((e) => `${e.path}: ${e.msg}`), body: req.body };
};
const base = (over = {}) => ({
  customer: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9876543210' },
  shippingAddress: { addressLine1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' },
  items: [{ product: '64b7f0c2a1b2c3d4e5f60718', quantity: 1 }],
  ...over,
});

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['098765-43210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['919876543210', '9876543210'],
  ])('%s → %s', (input, out) => expect(normalizeIndianMobile(input)).toBe(out));

  it.each(['12345', '5876543210', '98765432101', 'abcdefghij', '022 2345 6789'])('leaves %s invalid', (input) => {
    expect(normalizeIndianMobile(input)).not.toMatch(/^[6-9]\d{9}$/);
  });
});

describe('validateSalesOrder', () => {
  it('accepts a normal order and stores the phone as 10 digits', async () => {
    const { errors, body } = await run(base({ customer: { name: 'Ravi', email: 'r@example.com', phone: '+91 98765-43210' } }));
    expect(errors).toEqual([]);
    expect(body.customer.phone).toBe('9876543210');
  });

  it('rejects a phone that is not an Indian mobile', async () => {
    for (const phone of ['12345', '5876543210', '98765432109', '']) {
      const { errors } = await run(base({ customer: { name: 'Ravi', email: 'r@example.com', phone } }));
      expect(errors.join()).toMatch(/customer.phone: Enter a valid 10-digit Indian mobile/);
    }
  });

  it('accepts a custom line without a product, and requires its name and price', async () => {
    expect((await run(base({ items: [{ custom: true, name: 'Fitting labour', quantity: 1, price: 1500 }] }))).errors).toEqual([]);
    const { errors } = await run(base({ items: [{ custom: true, quantity: 1 }] }));
    expect(errors.join()).toMatch(/items\[0\]\.name/);
    expect(errors.join()).toMatch(/items\[0\]\.price/);
    expect(errors.join()).not.toMatch(/items\[0\]\.product/);
  });

  it('email is optional, but a typed one must be valid', async () => {
    expect((await run(base({ customer: { name: 'Ravi', email: '', phone: '9876543210' } }))).errors).toEqual([]);
    expect((await run(base({ customer: { name: 'Ravi', phone: '9876543210' } }))).errors).toEqual([]);
    const { errors } = await run(base({ customer: { name: 'Ravi', email: 'not-an-email', phone: '9876543210' } }));
    expect(errors.join()).toMatch(/customer.email/);
  });

  it('a catalogue line still needs a real product id', async () => {
    const { errors } = await run(base({ items: [{ product: 'nope', quantity: 1 }] }));
    expect(errors.join()).toMatch(/items\[0\]\.product: Invalid product/);
  });
});
