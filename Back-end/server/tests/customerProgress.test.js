/**
 * Customer progress — the pure rules (no database, no queue).
 *
 *   • the journey is read off real state: stock decision → preparing, parcel → packed,
 *     dispatch → shipped; nothing advances on a timer;
 *   • which messages an order is owed (dueProgressMessages): each milestone, the
 *     packed-vs-courier-booked split, the "still on it" note after 2 OFFICE days, at
 *     most once per step, never for a stale backlog, never while an item is out of
 *     stock, never for a cancelled order;
 *   • the timeline payload (steps, dates, estimate) the order page renders;
 *   • the email copy: no charges, no "call us", the right step line.
 */
import { customerJourney, reassuranceStage } from '../utils/customerJourney.js';
import { customerOrderProgress } from '../utils/customerOrderProgress.js';
import { stillRelevant, notificationKey } from '../services/orderNotificationRules.js';
import { dueProgressMessages } from '../services/orderProgressService.js';
import { orderProgressEmail } from '../utils/orderProgressEmail.js';

const OFFICE = { startMinute: 570, endMinute: 1110, days: [1, 2, 3, 4, 5, 6], holidays: new Set() };
const CFG = {
  enabled: true,
  reassureAfterMin: 2 * 540,
  reassureMaxAgeMs: 14 * 24 * 3600 * 1000,
  preparingDelayMs: 20 * 60 * 1000,
  office: OFFICE,
};

/** India time → Date. */
const ist = (s) => new Date(`${s}+05:30`);
/** A 24-hex ObjectId string created at `date` (the journey reads parcel time from it). */
const oid = (date, tail = '0000000000000001') => Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0') + tail;

// Mon 23 Nov 2026, 10:00 IST: paid.
const PAID = ist('2026-11-23T10:00:00');

const baseOrder = (over = {}) => ({
  _id: '65aaaaaaaaaaaaaaaaaaaaaa',
  user: 'u1',
  status: 'processing',
  createdAt: PAID,
  paidAt: PAID,
  items: [{ _id: 'i1', name: 'Seat cover', quantity: 1, product: { _id: 'p1', name: 'Seat cover' } }],
  shippingAddress: { fullName: 'Asha K' },
  workflow: { enteredAt: PAID, open: true, lines: [{ itemId: 'i1', stock: 'pending' }], history: [{ at: PAID, action: 'entered' }] },
  shipments: [],
  notifiedStatuses: ['confirmed'],
  ...over,
});

const prepared = (at = ist('2026-11-23T11:00:00'), action = 'stock_ordered') => ({
  workflow: {
    enteredAt: PAID, open: true,
    lines: [{ itemId: 'i1', stock: action === 'stock_ordered' ? 'ordered' : 'in_stock' }],
    history: [{ at: PAID, action: 'entered' }, { at, action, itemId: 'i1' }],
  },
});

const parcel = (over = {}) => ({
  _id: oid(ist('2026-11-24T12:00:00')), sequence: 1, status: 'packed',
  lines: [{ itemId: 'i1', quantity: 1 }], ...over,
});

describe('customerJourney — real state only', () => {
  it('a paid order with no stock decision is on "preparing" (working), placed done', () => {
    const j = customerJourney(baseOrder());
    expect(j.current).toBe('preparing');
    expect(j.steps.map((s) => s.done)).toEqual([true, false, false, false, false]);
    expect(j.steps[0].at.toISOString()).toBe(PAID.toISOString());
    expect(reassuranceStage(j)).toBe('placed');
  });

  it.each(['stock_in_stock', 'stock_own_stock', 'stock_ordered', 'payment_pending'])(
    '%s marks "preparing" done at that moment', (action) => {
      const at = ist('2026-11-23T12:00:00');
      const j = customerJourney(baseOrder(prepared(at, action)));
      expect(j.steps[1]).toEqual({ key: 'preparing', at, done: true });
      expect(j.current).toBe('packed');
    });

  it('out of stock is NOT progress, and holds the order', () => {
    const order = baseOrder({
      workflow: { enteredAt: PAID, lines: [{ itemId: 'i1', stock: 'out_of_stock' }], history: [{ at: PAID, action: 'stock_out_of_stock' }] },
    });
    const j = customerJourney(order);
    expect(j.steps[1].done).toBe(false);
    expect(j.onHold).toBe(true);
    expect(reassuranceStage(j)).toBeNull();
  });

  it('a packed parcel → packed; dispatched → shipped; delivered → delivered', () => {
    const packed = customerJourney(baseOrder({ ...prepared(), shipments: [parcel()] }));
    expect(packed.current).toBe('shipped');
    expect(packed.steps[2].done).toBe(true);

    const shippedAt = ist('2026-11-25T15:00:00');
    const shipped = customerJourney(baseOrder({ ...prepared(), status: 'shipped', shipments: [parcel({ status: 'shipped', shippedAt })] }));
    expect(shipped.current).toBe('delivered');
    expect(shipped.steps[3].at.toISOString()).toBe(shippedAt.toISOString());

    const deliveredAt = ist('2026-11-28T15:00:00');
    const delivered = customerJourney(baseOrder({ status: 'delivered', deliveredAt, shipments: [parcel({ status: 'delivered', shippedAt, deliveredAt })] }));
    expect(delivered.current).toBe('delivered');
    expect(delivered.steps.every((s) => s.done)).toBe(true);
  });

  it('shipped straight away (no separate stock decision) still shows every earlier step with a date', () => {
    const shippedAt = ist('2026-11-23T16:00:00');
    const j = customerJourney(baseOrder({ status: 'shipped', shipments: [parcel({ _id: oid(shippedAt), status: 'shipped', shippedAt })] }));
    expect(j.steps.slice(0, 4).every((s) => s.done && s.at)).toBe(true);
  });

  it('a lost parcel does not count', () => {
    const j = customerJourney(baseOrder({ ...prepared(), shipments: [parcel({ status: 'lost' })] }));
    expect(j.steps[2].done).toBe(false);
  });

  it.each(['cancelled', 'returned', 'awaiting_payment'])('%s orders have no journey', (status) => {
    expect(customerJourney(baseOrder({ status }))).toBeNull();
  });
});

describe('dueProgressMessages — what the sweep queues', () => {
  it('preparing: after the short delay, within a day, once', () => {
    const at = ist('2026-11-23T11:00:00');
    const order = baseOrder(prepared(at));
    expect(dueProgressMessages(order, ist('2026-11-23T11:10:00'), CFG)).toEqual([]);
    expect(dueProgressMessages(order, ist('2026-11-23T11:30:00'), CFG)).toEqual([{ kind: 'preparing' }]);
    // Already sent → nothing.
    expect(dueProgressMessages({ ...order, notifiedStatuses: ['confirmed', 'preparing'] }, ist('2026-11-23T11:30:00'), CFG)).toEqual([]);
    // Older than a day → old news, not sent late (e.g. the first run after deploy).
    expect(dueProgressMessages(order, ist('2026-11-24T12:00:00'), CFG).some((m) => m.kind === 'preparing')).toBe(false);
  });

  it('packed without an AWB → packed; with an AWB → courier booked (never both)', () => {
    const now = ist('2026-11-24T12:30:00');
    const p = parcel();
    expect(dueProgressMessages(baseOrder({ ...prepared(), shipments: [p] }), now, CFG))
      .toEqual([{ kind: 'packed', shipmentId: p._id }]);
    const booked = parcel({ trackingNumber: 'AWB123', carrier: { name: 'Delhivery' } });
    expect(dueProgressMessages(baseOrder({ ...prepared(), shipments: [booked] }), now, CFG))
      .toEqual([{ kind: 'courier_booked', shipmentId: booked._id }]);
  });

  it('a tracking number added to an already-announced packed parcel → courier booked once', () => {
    const p = parcel({ trackingNumber: 'AWB9' });
    const order = baseOrder({ ...prepared(), shipments: [p], notifiedStatuses: ['confirmed', 'preparing', notificationKey('packed', p._id)] });
    expect(dueProgressMessages(order, ist('2026-11-24T15:00:00'), CFG)).toEqual([{ kind: 'courier_booked', shipmentId: p._id }]);
    order.notifiedStatuses.push(notificationKey('courier_booked', p._id));
    expect(dueProgressMessages(order, ist('2026-11-24T15:00:00'), CFG)).toEqual([]);
  });

  describe('still on it', () => {
    // Prepared Mon 23 Nov 11:00 IST. Two office days = 1080 office minutes →
    // Mon 11:00–18:30 (450) + Tue (540) + Wed 09:30–11:00 (90) = Wed 25 Nov 11:00.
    const order = () => baseOrder({ ...prepared(), notifiedStatuses: ['confirmed', 'preparing'] });

    it('not before two OFFICE days on the step', () => {
      expect(dueProgressMessages(order(), ist('2026-11-25T10:59:00'), CFG)).toEqual([]);
      expect(dueProgressMessages(order(), ist('2026-11-25T11:00:00'), CFG)).toEqual([{ kind: 'still_on_it', stage: 'preparing' }]);
    });

    it('nights and Sundays do not count', () => {
      // Prepared Sat 28 Nov 17:00 → Sat 90 + Mon 540 = 630 by Mon close: not yet.
      const sat = baseOrder({ ...prepared(ist('2026-11-28T17:00:00')), notifiedStatuses: ['preparing'] });
      expect(dueProgressMessages(sat, ist('2026-11-30T18:29:00'), CFG)).toEqual([]);
      // Tue 1 Dec 17:00 → 630 + 450 = 1080.
      expect(dueProgressMessages(sat, ist('2026-12-01T17:00:00'), CFG)).toEqual([{ kind: 'still_on_it', stage: 'preparing' }]);
    });

    it('at most ONE per step — never daily', () => {
      const o = order();
      o.notifiedStatuses.push(notificationKey('still_on_it', null, 'preparing'));
      for (const day of ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30']) {
        expect(dueProgressMessages(o, ist(`${day}T12:00:00`), CFG)).toEqual([]);
      }
    });

    it('a new step earns its own note, counted from that step', () => {
      const p = parcel({ _id: oid(ist('2026-11-26T10:00:00')) });
      const o = baseOrder({
        ...prepared(), shipments: [p],
        notifiedStatuses: ['confirmed', 'preparing', notificationKey('still_on_it', null, 'preparing'), notificationKey('packed', p._id)],
      });
      expect(dueProgressMessages(o, ist('2026-11-27T12:00:00'), CFG)).toEqual([]);
      expect(dueProgressMessages(o, ist('2026-11-28T10:00:00'), CFG)).toEqual([{ kind: 'still_on_it', stage: 'packed' }]);
    });

    it('placed with no stock decision yet → about "placed"', () => {
      expect(dueProgressMessages(baseOrder(), ist('2026-11-25T10:00:00'), CFG)).toEqual([{ kind: 'still_on_it', stage: 'placed' }]);
    });

    it('a step stuck past the max age gets nothing (no launch-day blast to old backlog)', () => {
      expect(dueProgressMessages(order(), ist('2026-12-09T12:00:00'), CFG)).toEqual([]);
    });

    it('nothing while an item is out of stock (sales is talking to the customer)', () => {
      const o = order();
      o.workflow.lines.push({ itemId: 'i2', stock: 'out_of_stock' });
      expect(dueProgressMessages(o, ist('2026-11-26T12:00:00'), CFG)).toEqual([]);
    });

    it('nothing once anything has shipped', () => {
      const o = baseOrder({ ...prepared(), notifiedStatuses: ['preparing'], shipments: [parcel({ status: 'shipped', shippedAt: ist('2026-11-24T12:00:00') })] });
      expect(dueProgressMessages(o, ist('2026-11-30T12:00:00'), CFG)).toEqual([]);
    });
  });

  it.each(['cancelled', 'returned', 'shipped', 'delivered'])('a %s order is owed nothing', (status) => {
    expect(dueProgressMessages(baseOrder({ ...prepared(), status }), ist('2026-11-30T12:00:00'), CFG)).toEqual([]);
  });
});

describe('stillRelevant — re-checked at send time', () => {
  it('cancelled after queueing → every progress message is stale', () => {
    const o = baseOrder({ ...prepared(), status: 'cancelled', shipments: [parcel()] });
    expect(stillRelevant(o, 'preparing', null)).toBe(false);
    expect(stillRelevant(o, 'packed', o.shipments[0])).toBe(false);
    expect(stillRelevant(o, 'still_on_it', null, 'preparing')).toBe(false);
  });

  it('preparing is stale once a parcel exists; packed is stale once it has an AWB or is dispatched', () => {
    const p = parcel();
    expect(stillRelevant(baseOrder({ ...prepared(), shipments: [p] }), 'preparing', null)).toBe(false);
    expect(stillRelevant(baseOrder({ ...prepared(), shipments: [p] }), 'packed', p)).toBe(true);
    expect(stillRelevant(baseOrder({ ...prepared(), shipments: [p] }), 'courier_booked', p)).toBe(false);
    const booked = { ...p, trackingNumber: 'A1' };
    expect(stillRelevant(baseOrder({ ...prepared(), shipments: [booked] }), 'packed', booked)).toBe(false);
    expect(stillRelevant(baseOrder({ ...prepared(), shipments: [booked] }), 'courier_booked', booked)).toBe(true);
    const gone = { ...booked, status: 'shipped', shippedAt: new Date() };
    expect(stillRelevant(baseOrder({ ...prepared(), shipments: [gone] }), 'courier_booked', gone)).toBe(false);
  });

  it('still_on_it is stale when the order moved on to another step', () => {
    const o = baseOrder({ ...prepared(), shipments: [parcel()] });
    expect(stillRelevant(o, 'still_on_it', null, 'preparing')).toBe(false);
    expect(stillRelevant(o, 'still_on_it', null, 'packed')).toBe(true);
  });
});

describe('customerOrderProgress — the order page timeline', () => {
  it('steps with ISO dates, no staff data, and the 7–10 day window from the placed date', () => {
    const p = customerOrderProgress(baseOrder(prepared()));
    expect(p.current).toBe('packed');
    expect(p.steps.map((s) => s.key)).toEqual(['placed', 'preparing', 'packed', 'shipped', 'delivered']);
    expect(p.steps[0].at).toBe(PAID.toISOString());
    expect(p.estimate).toEqual({ kind: 'window', from: PAID.toISOString(), minDays: 7, maxDays: 10, heavy: false });
    expect(JSON.stringify(p)).not.toMatch(/stock_|supplier|history|byName/);
  });

  it('a heavy item uses the 10–15 day window', () => {
    const order = baseOrder({ items: [{ _id: 'i1', quantity: 1, product: { _id: 'p', shippingClass: 'xl' } }] });
    expect(customerOrderProgress(order).estimate).toMatchObject({ minDays: 10, maxDays: 15, heavy: true });
  });

  it('a parcel in transit with a courier date shows that date (latest of several)', () => {
    const order = baseOrder({
      status: 'shipped',
      shipments: [
        parcel({ status: 'shipped', shippedAt: PAID, eta: { day: '2026-12-02' } }),
        parcel({ _id: oid(PAID, '0000000000000002'), status: 'shipped', shippedAt: PAID, eta: { day: '2026-12-04' } }),
      ],
    });
    expect(customerOrderProgress(order).estimate).toEqual({ kind: 'courier', day: '2026-12-04' });
  });

  it('delivered → no estimate; cancelled → no timeline', () => {
    expect(customerOrderProgress(baseOrder({ status: 'delivered', deliveredAt: PAID })).estimate).toBeNull();
    expect(customerOrderProgress(baseOrder({ status: 'cancelled' }))).toBeNull();
  });
});

describe('orderProgressEmail — copy', () => {
  const order = baseOrder({ ...prepared(), shipments: [parcel({ trackingNumber: 'AWB<1>', carrier: { name: 'DTDC', trackingUrl: 'https://dtdc.example/t' } })] });

  it.each([
    ['preparing', {}, "We're preparing your order"],
    ['packed', { shipment: order.shipments[0] }, 'Your order is packed'],
    ['courier_booked', { shipment: order.shipments[0] }, "We've booked your courier"],
    ['still_on_it', { stage: 'preparing' }, 'Your order is still our priority'],
  ])('%s: heading, order ref, never charges or "call us"', (kind, extra, heading) => {
    const { subject, text, html } = orderProgressEmail({ order, kind, company: { name: 'Autobacs India', email: 'support@x.in' }, ...extra });
    expect(subject).toContain('AB-AAAAAAAA');
    expect(html).toContain(heading.replace("'", '&#x27;'));
    for (const body of [text, html]) {
      expect(body).not.toMatch(/₹|charge|fee|call us|phone/i);
    }
  });

  it('courier booked carries the courier and the AWB, escaped in HTML', () => {
    const { text, html } = orderProgressEmail({ order, kind: 'courier_booked', shipment: order.shipments[0] });
    expect(text).toContain('DTDC');
    expect(text).toContain('AWB<1>');
    expect(html).toContain('AWB&lt;1&gt;');
    expect(html).not.toContain('AWB<1>');
  });

  it('still on it names where the order is', () => {
    expect(orderProgressEmail({ order, kind: 'still_on_it', stage: 'packed' }).text)
      .toContain('your parcel is packed and waiting for the courier to collect it');
    expect(orderProgressEmail({ order, kind: 'still_on_it', stage: 'placed' }).text)
      .toContain('our team is confirming your item');
  });
});
