import express from 'express';
import request from 'supertest';
import {
  validateOfflineReturnCreate,
  validateReturnRefundBody,
  validateOfflineReceived,
} from '../../../middleware/validators/returnRefund.js';

/**
 * Shape validation for the offline return/refund endpoints.
 *
 * The rule worth pinning down: an item line is identified by its own `itemId` OR by
 * `productId`. Hard-requiring productId (as the customer-facing validator does) would
 * 400 an imported WooCommerce line — which legitimately has no catalogue product —
 * before the controller could give the operator the real reason.
 */
const app = (chain) => {
  const a = express();
  a.use(express.json());
  a.post('/t/:id', chain, (_req, res) => res.json({ ok: true }));
  return a;
};

const OID = '507f1f77bcf86cd799439011';
const base = { orderId: OID, note: 'Walk-in return' };

describe('validateOfflineReturnCreate', () => {
  const post = (body) => request(app(validateOfflineReturnCreate)).post(`/t/${OID}`).send(body);

  it('accepts a line identified only by its order line id', async () => {
    const res = await post({ ...base, items: [{ itemId: OID, quantity: 1, reason: 'wrong_item' }] });
    expect(res.status).toBe(200);
  });

  it('accepts a line identified only by product id', async () => {
    const res = await post({ ...base, items: [{ productId: OID, quantity: 1, reason: 'wrong_item' }] });
    expect(res.status).toBe(200);
  });

  it('accepts an explicit variant alongside the product', async () => {
    const res = await post({ ...base, items: [{ productId: OID, variantId: OID, quantity: 1, reason: 'wrong_item' }] });
    expect(res.status).toBe(200);
  });

  it('rejects a line with neither identifier', async () => {
    const res = await post({ ...base, items: [{ quantity: 1, reason: 'wrong_item' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/order line id or a product id/i);
  });

  it('rejects a reason outside the policy set', async () => {
    const res = await post({ ...base, items: [{ itemId: OID, quantity: 1, reason: 'changed_mind' }] });
    expect(res.status).toBe(400);
  });

  it('requires the operator note', async () => {
    const res = await post({ orderId: OID, items: [{ itemId: OID, quantity: 1, reason: 'wrong_item' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/note/i);
  });
});

describe('validateReturnRefundBody', () => {
  const post = (body) => request(app(validateReturnRefundBody)).post(`/t/${OID}`).send(body);

  it('lets a gateway refund through with no offline fields', async () => {
    expect((await post({})).status).toBe(200);
  });

  it('requires the payout method and reference when recording an offline refund', async () => {
    const res = await post({ method: 'offline' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/how the money was paid back|reference/i);
  });

  it('accepts a complete offline refund', async () => {
    const res = await post({ method: 'offline', offlineMethod: 'upi', reference: 'UTR-42' });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown method', async () => {
    expect((await post({ method: 'store_credit' })).status).toBe(400);
  });

  it('rejects a negative deduction', async () => {
    expect((await post({ shippingDeduction: -5 })).status).toBe(400);
  });
});

describe('validateOfflineReceived', () => {
  it('requires a note', async () => {
    const res = await request(app(validateOfflineReceived)).post(`/t/${OID}`).send({});
    expect(res.status).toBe(400);
  });

  it('accepts a note', async () => {
    const res = await request(app(validateOfflineReceived)).post(`/t/${OID}`).send({ note: 'Counter drop-off' });
    expect(res.status).toBe(200);
  });
});
