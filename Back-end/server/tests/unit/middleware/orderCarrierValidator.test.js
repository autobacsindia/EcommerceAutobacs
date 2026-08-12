/**
 * Conditional `carrierName` rules on the order validators.
 *
 * The "Other" carrier is free text — the admin types the courier's name — so it
 * is the one carrier where a second field is mandatory. These tests pin that the
 * requirement fires ONLY for carrierCode === 'OTHER', because the condition is a
 * nested express-validator chain (`.if(body(...).equals(...))`) that fails open
 * if it is ever mis-wired: a built-in carrier must never start demanding a name,
 * and OTHER must never slip through without one.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const {
  validateOrderStatusUpdate,
  validateTrackingInfo,
} = await import('../../../middleware/validators/order.js');

const ORDER_ID = '507f1f77bcf86cd799439011';

const makeApp = (validators, path) => {
  const app = express();
  app.use(express.json());
  app.put(path, validators, (req, res) => res.json({ success: true, body: req.body }));
  app.post(path, validators, (req, res) => res.json({ success: true, body: req.body }));
  return app;
};

describe('order validators — carrierName for the "Other" carrier', () => {
  afterEach(() => jest.clearAllMocks());

  describe('validateOrderStatusUpdate', () => {
    const app = makeApp(validateOrderStatusUpdate, '/orders/:id/status');
    const ship = (body) => request(app).put(`/orders/${ORDER_ID}/status`).send(body);

    it('rejects OTHER without a courier name', async () => {
      const res = await ship({ status: 'shipped', trackingNumber: 'TRK-99', carrierCode: 'OTHER' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/Courier name is required/);
    });

    it('rejects a blank (whitespace-only) courier name', async () => {
      const res = await ship({
        status: 'shipped',
        trackingNumber: 'TRK-99',
        carrierCode: 'OTHER',
        carrierName: '   ',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a courier name over the length cap', async () => {
      const res = await ship({
        status: 'shipped',
        trackingNumber: 'TRK-99',
        carrierCode: 'OTHER',
        carrierName: 'x'.repeat(61),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/characters or fewer/);
    });

    it('accepts OTHER with a courier name', async () => {
      const res = await ship({
        status: 'shipped',
        trackingNumber: 'TRK-99',
        carrierCode: 'OTHER',
        carrierName: 'Trackon Couriers',
      });
      expect(res.status).toBe(200);
    });

    it('does not demand a courier name for a built-in carrier', async () => {
      const res = await ship({
        status: 'shipped',
        trackingNumber: '123456789012',
        carrierCode: 'DELHIVERY',
      });
      expect(res.status).toBe(200);
    });

    it('still requires tracking number + carrier to ship', async () => {
      const res = await ship({ status: 'shipped' });
      expect(res.status).toBe(400);
    });
  });

  describe('validateTrackingInfo', () => {
    const app = makeApp(validateTrackingInfo, '/orders/:id/tracking');
    const addTracking = (body) => request(app).post(`/orders/${ORDER_ID}/tracking`).send(body);

    it('rejects OTHER without a courier name', async () => {
      const res = await addTracking({ carrierCode: 'OTHER', trackingNumber: 'TRK-99' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/Courier name is required/);
    });

    it('accepts OTHER with a courier name', async () => {
      const res = await addTracking({
        carrierCode: 'OTHER',
        trackingNumber: 'TRK-99',
        carrierName: 'Trackon Couriers',
      });
      expect(res.status).toBe(200);
    });

    it('leaves built-in carriers unchanged', async () => {
      const res = await addTracking({ carrierCode: 'FEDEX' });
      expect(res.status).toBe(200);
    });
  });
});
