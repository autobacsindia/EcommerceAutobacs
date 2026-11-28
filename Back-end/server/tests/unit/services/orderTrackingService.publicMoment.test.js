/**
 * Public tracking (GET /orders/track/:trackingNumber, no login) carries the
 * order-moment picture — and nothing about money or staff work.
 */
import { jest } from '@jest/globals';

const orderQuery = { select: jest.fn(), populate: jest.fn(), lean: jest.fn() };
orderQuery.select.mockReturnValue(orderQuery);
orderQuery.populate.mockReturnValue(orderQuery);
const mockOrder = { findOne: jest.fn(() => orderQuery), findById: jest.fn(), aggregate: jest.fn() };

const returnsQuery = { select: jest.fn(), limit: jest.fn(), lean: jest.fn() };
returnsQuery.select.mockReturnValue(returnsQuery);
returnsQuery.limit.mockReturnValue(returnsQuery);
const mockReturns = { find: jest.fn(() => returnsQuery) };

jest.unstable_mockModule('../../../models/Order.js', () => ({ default: mockOrder }));
jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturns }));

const { default: orderTrackingService } = await import('../../../services/orderTrackingService.js');
const { publicOrderMoment } = await import('../../../utils/orderMoment.js');

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

/** Everything a full order holds that a stranger with a tracking number must not see. */
const privateBits = {
  _id: '64b000000000000000000001',
  total: 18999,
  subtotal: 16100,
  paymentStatus: 'paid',
  refundDetails: { status: 'completed', requestedAt: ago(1), amount: 18999, reason: 'customer asked' },
  workflow: { enteredAt: ago(3), history: [{ action: 'stock_checked', at: ago(2), by: 'Ravi (staff)' }], lines: [] },
  salesUser: 'staff-1',
  user: { email: 'buyer@example.com' },
  shipments: [],
  items: [],
};

const baseOrder = (over = {}) => ({
  ...privateBits,
  trackingNumber: 'AWB1234567890',
  carrier: { name: 'Delhivery', code: 'DELHIVERY' },
  trackingEvents: [],
  status: 'shipped',
  createdAt: ago(3),
  paidAt: ago(3),
  shippingAddress: { name: 'A Buyer', phone: '9999999999', line1: '1 Road', city: 'Pune', state: 'MH', postalCode: '411001' },
  ...over,
});

const PUBLIC_KEYS = ['success', 'trackingNumber', 'carrier', 'currentStatus', 'estimatedDelivery', 'deliveredAt', 'destination', 'events', 'moment'];

beforeEach(() => {
  // jest.config resetMocks wipes implementations before each test: set them again.
  mockOrder.findOne.mockImplementation(() => orderQuery);
  mockReturns.find.mockImplementation(() => returnsQuery);
  orderQuery.select.mockReturnValue(orderQuery);
  orderQuery.populate.mockReturnValue(orderQuery);
  returnsQuery.select.mockReturnValue(returnsQuery);
  returnsQuery.limit.mockReturnValue(returnsQuery);
  returnsQuery.lean.mockResolvedValue([]);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => console.error.mockRestore());

describe('trackByNumber — order moment on the public tracking page', () => {
  test('a refunded order: the picture says refunded, and no amount leaves the server', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({ status: 'delivered', paymentStatus: 'refunded' }));

    const res = await orderTrackingService.trackByNumber('AWB1234567890');

    expect(res.success).toBe(true);
    expect(res.moment).toEqual({ key: 'refunded' });
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/amount|refund"|total|subtotal|18999|16100/i);
    expect(json).not.toMatch(/workflow|Ravi|salesUser|buyer@example\.com|9999999999|1 Road/);
  });

  test('the response carries only the public fields', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder());
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(Object.keys(res).sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(Object.keys(res.destination).sort()).toEqual(['city', 'postalCode', 'state']);
  });

  test('the database read never asks for the refund amount or order totals', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder());
    await orderTrackingService.trackByNumber('AWB1234567890');
    const selected = orderQuery.select.mock.calls[0][0];
    expect(selected).not.toMatch(/amount|total|price|payment\b|user\b|salesUser/);
    expect(selected).not.toMatch(/(^|\s)refundDetails(\s|$)/); // whole subdoc never selected
    expect(orderQuery.populate).toHaveBeenCalledWith('items.product', 'shippingSize listedSize shippingClass');
  });

  test('shipped → the shipped scene', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({ refundDetails: undefined }));
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.moment).toEqual({ key: 'shipped' });
  });

  test('a paid order that was cancelled → refundDue is a plain true, no figure', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({ status: 'cancelled', refundDetails: undefined }));
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.moment).toEqual({ key: 'cancelled', refundDue: true });
  });

  test('a return being picked up → returning, step 1', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({ status: 'delivered', deliveredAt: ago(1), refundDetails: undefined }));
    returnsQuery.lean.mockResolvedValue([{ status: 'courier_booked', refund: { amount: 500 } }]);
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.moment).toEqual({ key: 'returning', returnStep: 1 });
    expect(JSON.stringify(res)).not.toMatch(/500|amount/);
    expect(mockReturns.find).toHaveBeenCalledWith({
      order: privateBits._id, status: { $in: ['pending', 'approved', 'courier_booked', 'received'] },
    });
  });

  test('past the promised day → late with the day we promised', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({
      status: 'processing', paidAt: ago(30), createdAt: ago(30), refundDetails: undefined,
    }));
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.moment.key).toBe('late');
    expect(res.moment.late.dueDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(res.moment).sort()).toEqual(['key', 'late']);
  });

  test('out for delivery: the team note and time go out, never who recorded it', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({
      refundDetails: undefined,
      shipments: [{
        _id: '64b0000000000000000000aa', status: 'shipped', shippedAt: ago(2),
        trackingSteps: [{ status: 'out_for_delivery', note: 'Arriving before 6 pm', at: ago(0.1), by: 'u1', byName: 'Ravi (ops)' }],
      }],
    }));
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.moment).toEqual({ key: 'out_for_delivery', note: 'Arriving before 6 pm', at: expect.any(String) });
    expect(JSON.stringify(res)).not.toMatch(/Ravi|byName|"by"/);
  });

  test('date moved: the new day goes out, not who moved it', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({
      refundDetails: undefined,
      shipments: [{
        _id: '64b0000000000000000000ab', status: 'shipped', shippedAt: ago(2), eta: { day: '2099-01-05', setByName: 'Ravi (ops)' },
        etaHistory: [{ from: '2099-01-02', to: '2099-01-05', at: ago(0.2), byName: 'Ravi (ops)' }],
      }],
    }));
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.moment).toEqual({ key: 'date_moved', newDay: '2099-01-05', at: expect.any(String) });
    expect(JSON.stringify(res)).not.toMatch(/Ravi|setByName|byName/);
  });

  test('the database read names only the parcel fields it needs (no byName, no overdue reasons)', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder());
    await orderTrackingService.trackByNumber('AWB1234567890');
    const selected = orderQuery.select.mock.calls[0][0];
    expect(selected).not.toMatch(/byName|setBy|overdue|(^|\s)shipments(\s|$)/);
    expect(selected).toMatch(/shipments\.trackingSteps\.note/);
  });

  test('the returns lookup failing still shows the order-state picture', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({ refundDetails: undefined }));
    returnsQuery.lean.mockRejectedValue(new Error('mongo down'));
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.success).toBe(true);
    expect(res.moment).toEqual({ key: 'shipped' });
  });

  test('an unpaid order has no picture (null), and tracking still answers', async () => {
    orderQuery.lean.mockResolvedValue(baseOrder({ status: 'awaiting_payment', paymentStatus: 'pending', refundDetails: undefined }));
    const res = await orderTrackingService.trackByNumber('AWB1234567890');
    expect(res.success).toBe(true);
    expect(res.moment).toBeNull();
  });

  test('unknown tracking number → not found, no moment work', async () => {
    orderQuery.lean.mockResolvedValue(null);
    const res = await orderTrackingService.trackByNumber('NOPE');
    expect(res).toEqual({ success: false, message: 'Tracking number not found' });
    expect(mockReturns.find).not.toHaveBeenCalled();
  });
});

describe('publicOrderMoment — allowlist', () => {
  test('drops the refund amount and any unknown field', () => {
    expect(publicOrderMoment({ key: 'refunded', refund: { amount: 1200 }, extra: 'x' })).toEqual({ key: 'refunded' });
  });

  test('keeps refundDue, returnStep and late.dueDay only when well-formed', () => {
    expect(publicOrderMoment({ key: 'cancelled', refundDue: false })).toEqual({ key: 'cancelled', refundDue: false });
    expect(publicOrderMoment({ key: 'returning', returnStep: 2 })).toEqual({ key: 'returning', returnStep: 2 });
    expect(publicOrderMoment({ key: 'late', late: { dueDay: '2026-11-20', note: 'x' } }))
      .toEqual({ key: 'late', late: { dueDay: '2026-11-20' } });
    expect(publicOrderMoment({ key: 'late', late: { dueDay: 'soon' } })).toEqual({ key: 'late' });
    expect(publicOrderMoment({ key: 'cancelled', refundDue: 'yes' })).toEqual({ key: 'cancelled' });
  });

  test('keeps a delivery update note (capped), new day and time; drops malformed ones', () => {
    expect(publicOrderMoment({ key: 'in_transit', note: 'x'.repeat(500), at: '2026-11-26T10:00:00.000Z', byName: 'Ravi' }))
      .toEqual({ key: 'in_transit', note: 'x'.repeat(120), at: '2026-11-26T10:00:00.000Z' });
    expect(publicOrderMoment({ key: 'date_moved', newDay: 'next week', at: 'nope' })).toEqual({ key: 'date_moved' });
  });

  test('null in, null out', () => {
    expect(publicOrderMoment(null)).toBeNull();
    expect(publicOrderMoment({})).toBeNull();
  });
});
