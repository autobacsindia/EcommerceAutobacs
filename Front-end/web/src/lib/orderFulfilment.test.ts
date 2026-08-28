/**
 * Per-line delivery dates (frontend mirror of Back-end/server/utils/orderFulfilment.js).
 *
 * These cases mirror the backend suite deliberately. The return window is enforced on
 * BOTH sides — the button and the form here, the actual gate there — and if the two
 * disagree the customer either sees a Return button that leads to a rejection, or no
 * button at all for something they are entitled to send back.
 */

import { deliveredAtForItem, canReturnItem, daysSince } from './orderFulfilment';
import type { FulfilmentOrder } from './orderFulfilment';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const splitOrder = (aDays: number, bDays: number): FulfilmentOrder => ({
  shipments: [
    { _id: 's1', status: 'delivered', deliveredAt: daysAgo(aDays), lines: [{ itemId: 'a', quantity: 1 }] },
    { _id: 's2', status: 'delivered', deliveredAt: daysAgo(bDays), lines: [{ itemId: 'b', quantity: 1 }] },
  ],
  deliveredAt: daysAgo(Math.min(aDays, bDays)),
});

describe('deliveredAtForItem', () => {
  it('returns the date of the parcel that line arrived in', () => {
    const order = splitOrder(9, 1);
    expect(deliveredAtForItem(order, 'a')!.getTime())
      .toBeLessThan(deliveredAtForItem(order, 'b')!.getTime());
  });

  it('is null for a line still in transit, even when another parcel landed', () => {
    const order: FulfilmentOrder = {
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: daysAgo(1), lines: [{ itemId: 'a', quantity: 1 }] },
        { _id: 's2', status: 'shipped', lines: [{ itemId: 'b', quantity: 1 }] },
      ],
    };
    expect(deliveredAtForItem(order, 'a')).not.toBeNull();
    expect(deliveredAtForItem(order, 'b')).toBeNull();
  });

  it('takes the LATEST date when a line spans parcels — ambiguity favours the buyer', () => {
    const order: FulfilmentOrder = {
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: daysAgo(9), lines: [{ itemId: 'a', quantity: 1 }] },
        { _id: 's2', status: 'delivered', deliveredAt: daysAgo(1), lines: [{ itemId: 'a', quantity: 1 }] },
      ],
    };
    expect(daysSince(deliveredAtForItem(order, 'a')!)).toBeLessThan(2);
  });

  it('ignores a lost parcel', () => {
    const order: FulfilmentOrder = {
      shipments: [{ _id: 's1', status: 'lost', deliveredAt: daysAgo(1), lines: [{ itemId: 'a', quantity: 1 }] }],
    };
    expect(deliveredAtForItem(order, 'a')).toBeNull();
  });

  // Every order placed before parcels existed must behave exactly as it did.
  it('falls back to the order-level date when there are no parcels', () => {
    expect(deliveredAtForItem({ shipments: [], deliveredAt: daysAgo(2) }, 'anything')).not.toBeNull();
    expect(deliveredAtForItem({ fulfillmentMetrics: { deliveredAt: daysAgo(2) } }, 'anything')).not.toBeNull();
    expect(deliveredAtForItem({}, 'anything')).toBeNull();
  });
});

describe('canReturnItem', () => {
  const WINDOW = 4;

  // The bug this exists to stop: parcel A landed 9 days ago, but the order's own date
  // is 1 day old because parcel B arrived yesterday. Measuring from the order would
  // offer a Return button the server then rejects.
  it('refuses a line whose own parcel is out of window, though the order looks recent', () => {
    expect(canReturnItem(splitOrder(9, 1), 'a', WINDOW)).toBe(false);
  });

  it('allows a line whose own parcel is in window, though another line is stale', () => {
    expect(canReturnItem(splitOrder(9, 1), 'b', WINDOW)).toBe(true);
  });

  it('refuses a line that has not arrived', () => {
    const order: FulfilmentOrder = {
      shipments: [{ _id: 's2', status: 'shipped', lines: [{ itemId: 'b', quantity: 1 }] }],
    };
    expect(canReturnItem(order, 'b', WINDOW)).toBe(false);
  });

  // The window is a continuous cutoff, never floored — 4d23h is outside it.
  it('rejects at 4 days 23 hours', () => {
    const order: FulfilmentOrder = {
      shipments: [],
      deliveredAt: new Date(Date.now() - (4 * 24 + 23) * 60 * 60 * 1000).toISOString(),
    };
    expect(canReturnItem(order, 'a', WINDOW)).toBe(false);
  });

  it('accepts just inside the window', () => {
    const order: FulfilmentOrder = { shipments: [], deliveredAt: daysAgo(3) };
    expect(canReturnItem(order, 'a', WINDOW)).toBe(true);
  });
});
