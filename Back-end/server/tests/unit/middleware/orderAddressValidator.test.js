/**
 * Checkout address rules on validateOrder (POST /orders and /orders/guest).
 *
 * Regression: a checkout with PIN "12" and phone "1239876543210" reached the
 * order — the PIN was only checked for presence, and the phone rule kept the
 * last 10 digits of anything longer. Both now have to be real.
 */

import express from 'express';
import request from 'supertest';

const { validateOrder, isDialableIndianMobile, isIndianPinCode } =
  await import('../../../middleware/validators/order.js');

const app = express();
app.use(express.json());
app.post('/orders', validateOrder, (req, res) => res.json({ success: true }));

const address = (over = {}) => ({
  fullName: 'Rahul Menon', phone: '9876543210', addressLine1: '12 MG Road',
  city: 'Kochi', state: 'Kerala', postalCode: '682016', ...over,
});
const place = (over) => request(app).post('/orders')
  .send({ items: [{ product: '507f1f77bcf86cd799439011', quantity: 1 }], shippingAddress: address(over) });
const messages = (res) => JSON.stringify(res.body);

describe('validateOrder — PIN code', () => {
  it('accepts a 6-digit PIN, with stray spaces', async () => {
    expect((await place({ postalCode: '682016' })).status).toBe(200);
    expect((await place({ postalCode: ' 682016 ' })).status).toBe(200);
  });

  it.each(['12', '68201', '6820167', 'ABC123', '682 016'])('rejects "%s" with a plain message', async (pin) => {
    const res = await place({ postalCode: pin });
    expect(res.status).toBe(400);
    expect(messages(res)).toContain('Enter a valid 6-digit PIN code');
  });

  it('still says "required" for an empty PIN, not "invalid"', async () => {
    const res = await place({ postalCode: '' });
    expect(res.status).toBe(400);
    expect(messages(res)).toContain('Postal code is required');
    expect(messages(res)).not.toContain('6-digit');
  });
});

describe('validateOrder — phone', () => {
  it.each(['9876543210', '+91 98765 43210', '919876543210', '09876543210', '98765-43210', '(+91) 98765 43210'])(
    'accepts %s', async (phone) => {
      expect((await place({ phone })).status).toBe(200);
    },
  );

  it.each(['1239876543210', '5876543210', '987654321', '533201', '0019876543210', '9198765432100'])(
    'rejects %s', async (phone) => {
      const res = await place({ phone });
      expect(res.status).toBe(400);
      expect(messages(res)).toContain('Enter a valid 10-digit Indian mobile number');
    },
  );
});

describe('helpers', () => {
  it('isIndianPinCode handles non-strings', () => {
    expect(isIndianPinCode(682016)).toBe(true);
    expect(isIndianPinCode(null)).toBe(false);
    expect(isIndianPinCode(undefined)).toBe(false);
  });
  it('isDialableIndianMobile handles non-strings', () => {
    expect(isDialableIndianMobile(9876543210)).toBe(true);
    expect(isDialableIndianMobile(null)).toBe(false);
  });
});
