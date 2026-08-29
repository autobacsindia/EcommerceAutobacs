/**
 * Per-line delivery dates (frontend mirror of Back-end/server/utils/orderFulfilment.js).
 *
 * These cases mirror the backend suite deliberately. The return window is enforced on
 * BOTH sides — the button and the form here, the actual gate there — and if the two
 * disagree the customer either sees a Return button that leads to a rejection, or no
 * button at all for something they are entitled to send back.
 */

import {
  deliveredAtForItem,
  canReturnItem,
  daysSince,
  fulfilmentStateForItem,
  parcelProgress,
  outstandingParcels,
} from './orderFulfilment';
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

describe('fulfilmentStateForItem', () => {
  // The whole point: on a split order these two lines are in different places, and the
  // order status ('shipped') is honest about neither of them.
  it('reports each line independently on a split order', () => {
    const order: FulfilmentOrder = {
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: daysAgo(1), lines: [{ itemId: 'a', quantity: 1 }] },
        { _id: 's2', status: 'shipped', lines: [{ itemId: 'b', quantity: 1 }] },
      ],
    };
    expect(fulfilmentStateForItem(order, 'a')).toBe('delivered');
    expect(fulfilmentStateForItem(order, 'b')).toBe('shipped');
    expect(fulfilmentStateForItem(order, 'c')).toBe('pending');
  });

  it('reports a packed-but-not-dispatched line as packed', () => {
    const order: FulfilmentOrder = {
      shipments: [{ _id: 's1', status: 'packed', lines: [{ itemId: 'a', quantity: 1 }] }],
    };
    expect(fulfilmentStateForItem(order, 'a')).toBe('packed');
  });

  // A lost parcel's units go back to the to-ship pool, so the customer is waiting again.
  // Calling it anything else claims they hold goods the courier destroyed.
  it('treats a line whose only parcel was lost as pending', () => {
    const order: FulfilmentOrder = {
      shipments: [{ _id: 's1', status: 'lost', deliveredAt: daysAgo(1), lines: [{ itemId: 'a', quantity: 1 }] }],
    };
    expect(fulfilmentStateForItem(order, 'a')).toBe('pending');
  });

  // Least-advanced wins. A green "Delivered" over a line where 1 of 2 units is still in
  // a warehouse hides the missing unit — the expensive direction of this error.
  it('takes the LEAST advanced state when a line spans parcels', () => {
    const order: FulfilmentOrder = {
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: daysAgo(1), lines: [{ itemId: 'a', quantity: 1 }] },
        { _id: 's2', status: 'shipped', lines: [{ itemId: 'a', quantity: 1 }] },
      ],
    };
    expect(fulfilmentStateForItem(order, 'a', 2)).toBe('shipped');
  });

  it('is pending when the parcels are short of the ordered quantity', () => {
    const order: FulfilmentOrder = {
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: daysAgo(1), lines: [{ itemId: 'a', quantity: 1 }] },
      ],
    };
    // 1 of 3 units delivered: the line is NOT delivered.
    expect(fulfilmentStateForItem(order, 'a', 3)).toBe('pending');
    // Without a quantity there is nothing to compare against, so the parcels speak.
    expect(fulfilmentStateForItem(order, 'a')).toBe('delivered');
  });

  // Every order placed before parcels existed. A chip on those would be invented state.
  it('returns null for an order with no parcels', () => {
    expect(fulfilmentStateForItem({}, 'a')).toBeNull();
    expect(fulfilmentStateForItem({ shipments: [] }, 'a')).toBeNull();
  });
});

describe('parcelProgress', () => {
  const parcels = (...statuses: Array<'packed' | 'shipped' | 'delivered' | 'lost'>): FulfilmentOrder => ({
    shipments: statuses.map((status, i) => ({ _id: `s${i}`, status, lines: [] })),
  });

  // The bug the badge exists to fix: both of these render as "Shipped" on a list.
  it('distinguishes a partly delivered split order from an untouched one', () => {
    expect(parcelProgress(parcels('delivered', 'shipped')).label).toBe('1 of 2 parcels delivered');
    expect(parcelProgress(parcels('shipped', 'shipped')).label).toBe('2 of 2 parcels shipped');
  });

  it('says so when every parcel has landed', () => {
    expect(parcelProgress(parcels('delivered', 'delivered')).label).toBe('All 2 parcels delivered');
  });

  it('reports parcels still being packed', () => {
    expect(parcelProgress(parcels('packed', 'packed')).label).toBe('2 parcels · preparing');
  });

  // Lost parcels are excluded: nobody is waiting on a box that was written off, and
  // counting it would make "1 of 3" understate how much actually shipped.
  it('excludes lost parcels from the count', () => {
    const p = parcelProgress(parcels('delivered', 'shipped', 'lost'));
    expect(p.total).toBe(2);
    expect(p.label).toBe('1 of 2 parcels delivered');
  });

  // Self-hiding: one box adds nothing the order status has not already said, and a
  // legacy order has no boxes at all.
  it('renders no label for a single-parcel or parcel-less order', () => {
    expect(parcelProgress(parcels('shipped')).label).toBeNull();
    expect(parcelProgress(parcels('delivered', 'lost')).label).toBeNull();
    expect(parcelProgress({}).label).toBeNull();
    expect(parcelProgress({ shipments: [] }).isSplit).toBe(false);
  });
});

describe('outstandingParcels', () => {
  // Must match the server's deliverAllOutstanding, which moves shipped AND packed.
  // The count is shown to an admin before an irreversible, customer-emailing action.
  it('counts parcels in transit and still being packed', () => {
    expect(outstandingParcels({
      shipments: [
        { _id: 's1', status: 'shipped', lines: [] },
        { _id: 's2', status: 'packed', lines: [] },
      ],
    })).toBe(2);
  });

  // Delivering an already-delivered parcel is a no-op server-side, so quoting it would
  // overstate what the click does.
  it('ignores parcels already delivered, and ones written off as lost', () => {
    expect(outstandingParcels({
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: daysAgo(1), lines: [] },
        { _id: 's2', status: 'lost', lines: [] },
        { _id: 's3', status: 'shipped', lines: [] },
      ],
    })).toBe(1);
  });

  it('is zero for an order with no parcels', () => {
    expect(outstandingParcels({})).toBe(0);
  });
});
