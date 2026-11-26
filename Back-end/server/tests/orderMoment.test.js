/**
 * Order moments — which picture the customer sees (utils/orderMoment.js).
 * Every rule in the file header, the priority between them, and the "late" edge:
 * late only AFTER the promised day (India time), never on it.
 */
import { orderMoment, promisedDay, istDayPlus, MOMENT } from '../utils/orderMoment.js';

const ist = (s) => new Date(`${s}+05:30`).getTime();
const steps = (doneCount) => ['placed', 'preparing', 'packed', 'shipped', 'delivered']
  .map((key, i) => ({ key, at: null, done: i < doneCount }));
const progress = (doneCount, extra = {}) => ({
  current: 'x',
  onHold: false,
  steps: steps(doneCount),
  parcels: { total: 0, shipped: 0, delivered: 0 },
  estimate: { kind: 'window', from: new Date(ist('2026-11-20T10:00:00')).toISOString(), minDays: 7, maxDays: 10, heavy: false },
  ...extra,
});
const live = { status: 'processing', paymentStatus: 'paid' };
const NOW = ist('2026-11-25T12:00:00'); // well inside the window (due Mon 30 Nov)

describe('orderMoment — the scene for each order state', () => {
  test('payment failed or expired on an unpaid order', () => {
    expect(orderMoment({ status: 'awaiting_payment', paymentStatus: 'failed' }, null)).toEqual({ key: MOMENT.PAYMENT_FAILED });
    expect(orderMoment({ status: 'awaiting_payment', paymentStatus: 'expired' }, null)).toEqual({ key: MOMENT.PAYMENT_FAILED });
  });

  test('an unpaid order still waiting for its payment gets no picture (never optimistic)', () => {
    expect(orderMoment({ status: 'awaiting_payment', paymentStatus: 'pending' }, null)).toBeNull();
  });

  test('refund completed → refunded, with the server amount', () => {
    const order = { status: 'cancelled', paymentStatus: 'paid', refundDetails: { requestedAt: new Date(), amount: 2450, status: 'completed' } };
    expect(orderMoment(order, null)).toEqual({ key: MOMENT.REFUNDED, refund: { amount: 2450 } });
  });

  test('paymentStatus refunded without an amount → refunded, no amount shown', () => {
    expect(orderMoment({ status: 'cancelled', paymentStatus: 'refunded' }, null)).toEqual({ key: MOMENT.REFUNDED, refund: null });
  });

  test('a refund that is only pending is NOT shown as refunded', () => {
    const order = { status: 'cancelled', paymentStatus: 'paid', refundDetails: { requestedAt: new Date(), amount: 2450, status: 'pending' } };
    expect(orderMoment(order, null)).toEqual({ key: MOMENT.CANCELLED, refundDue: true });
  });

  test('phantom refundDetails (no requestedAt) are ignored', () => {
    const order = { status: 'cancelled', paymentStatus: 'pending', refundDetails: { status: 'completed' } };
    expect(orderMoment(order, null)).toEqual({ key: MOMENT.CANCELLED, refundDue: false });
  });

  test('a return that is moving beats delivered; the furthest step wins', () => {
    const order = { status: 'delivered', paymentStatus: 'paid' };
    expect(orderMoment(order, progress(5), { returns: [{ status: 'pending' }, { status: 'courier_booked' }] }))
      .toEqual({ key: MOMENT.RETURNING, returnStep: 1 });
    expect(orderMoment(order, progress(5), { returns: [{ status: 'received' }] })).toEqual({ key: MOMENT.RETURNING, returnStep: 2 });
  });

  test('finished or withdrawn returns fall back to delivered', () => {
    const order = { status: 'delivered', paymentStatus: 'paid' };
    for (const status of ['refunded', 'rejected', 'cancelled']) {
      expect(orderMoment(order, progress(5), { returns: [{ status }] })).toEqual({ key: MOMENT.DELIVERED });
    }
  });

  test('legacy order.returnRequest counts only when really requested', () => {
    const base = { status: 'delivered', paymentStatus: 'paid' };
    expect(orderMoment({ ...base, returnRequest: { status: 'item_received', requestedAt: new Date() } }, progress(5)))
      .toEqual({ key: MOMENT.RETURNING, returnStep: 2 });
    expect(orderMoment({ ...base, returnRequest: { status: 'pending' } }, progress(5))).toEqual({ key: MOMENT.DELIVERED });
  });

  test('delivered', () => {
    expect(orderMoment({ status: 'delivered', paymentStatus: 'paid' }, progress(5, { estimate: null }))).toEqual({ key: MOMENT.DELIVERED });
  });

  test('on hold beats late and partly', () => {
    const p = progress(4, { onHold: true, parcels: { total: 2, shipped: 1, delivered: 0 } });
    expect(orderMoment(live, p, { now: ist('2026-12-20T12:00:00') })).toEqual({ key: MOMENT.ON_HOLD });
  });

  test('each live step maps to its own scene while on time', () => {
    expect(orderMoment(live, progress(1), { now: NOW })).toEqual({ key: MOMENT.PLACED });
    expect(orderMoment(live, progress(2), { now: NOW })).toEqual({ key: MOMENT.PREPARING });
    expect(orderMoment(live, progress(3), { now: NOW })).toEqual({ key: MOMENT.PACKED });
    expect(orderMoment({ ...live, status: 'shipped' }, progress(4), { now: NOW })).toEqual({ key: MOMENT.SHIPPED });
  });

  test('partly shipped', () => {
    const p = progress(4, { parcels: { total: 2, shipped: 1, delivered: 0 } });
    expect(orderMoment(live, p, { now: NOW })).toEqual({ key: MOMENT.PARTLY });
  });

  describe('late — only after the promised day, in India time', () => {
    // Placed Fri 20 Nov + 10 days = Mon 30 Nov.
    test('on the promised day itself: not late', () => {
      expect(orderMoment(live, progress(2), { now: ist('2026-11-30T23:59:00') }).key).toBe(MOMENT.PREPARING);
    });
    test('the day after: late, with the date we promised', () => {
      expect(orderMoment(live, progress(2), { now: ist('2026-12-01T00:01:00') }))
        .toEqual({ key: MOMENT.LATE, late: { dueDay: '2026-11-30' } });
    });
    test('a courier date overrides the window', () => {
      const p = progress(4, { estimate: { kind: 'courier', day: '2026-12-03' } });
      expect(orderMoment(live, p, { now: ist('2026-12-02T12:00:00') }).key).toBe(MOMENT.SHIPPED);
      expect(orderMoment(live, p, { now: ist('2026-12-04T09:00:00') })).toEqual({ key: MOMENT.LATE, late: { dueDay: '2026-12-03' } });
    });
    test('no estimate → never late', () => {
      expect(orderMoment(live, progress(2, { estimate: null }), { now: ist('2027-01-01T12:00:00') }).key).toBe(MOMENT.PREPARING);
    });
    test('late beats partly (the customer is waiting on the rest)', () => {
      const p = progress(4, { parcels: { total: 2, shipped: 1, delivered: 0 } });
      expect(orderMoment(live, p, { now: ist('2026-12-05T12:00:00') }).key).toBe(MOMENT.LATE);
    });
  });

  test('cancelled unpaid order: no refund due', () => {
    expect(orderMoment({ status: 'cancelled', paymentStatus: 'cancelled' }, null)).toEqual({ key: MOMENT.CANCELLED, refundDue: false });
  });

  test('no progress (legacy/unknown) and nothing else → no picture', () => {
    expect(orderMoment({ status: 'processing', paymentStatus: 'paid' }, null)).toBeNull();
    expect(orderMoment(null, null)).toBeNull();
  });
});

describe('promisedDay', () => {
  test('window end skips a Sunday, like the page', () => {
    // Placed Fri 27 Nov + 9 days = Sun 6 Dec → Mon 7 Dec.
    expect(istDayPlus(ist('2026-11-27T10:00:00'), 9)).toBe('2026-12-07');
  });
  test('placed late in the India evening counts from the India day', () => {
    // 23:30 IST on 20 Nov is 18:00 UTC the same day; 00:30 IST on 21 Nov is 19:00 UTC on 20 Nov.
    expect(istDayPlus(ist('2026-11-21T00:30:00'), 10)).toBe('2026-12-01');
  });
  test('bad input → null', () => {
    expect(promisedDay(null)).toBeNull();
    expect(promisedDay({ kind: 'courier', day: 'soon' })).toBeNull();
    expect(promisedDay({ kind: 'window', from: 'nope', maxDays: 10 })).toBeNull();
  });
});
