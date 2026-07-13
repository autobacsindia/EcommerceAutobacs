import { buildJourney } from './leadJourney';
import type { Lead, OrderHistoryItem } from './leads';

function makeLead(over: Partial<Lead>): Lead {
  return {
    _id: 'lead1',
    sources: [],
    status: 'new',
    hasPurchased: false,
    activities: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as Lead;
}

describe('buildJourney', () => {
  it('returns a single group for a first-time lead, events newest-first', () => {
    const lead = makeLead({
      cycleStartedAt: '2026-01-01T00:00:00Z',
      sources: [{ type: 'payment_failed', capturedAt: '2026-01-03T00:00:00Z' }],
      activities: [{ type: 'call', at: '2026-01-02T00:00:00Z', notes: 'rang' }],
    });
    const orders: OrderHistoryItem[] = [
      { _id: 'o1', orderNumber: 'A1', totalAmount: 100, status: 'cancelled', paymentStatus: 'paid', cancelledBy: 'admin', createdAt: '2026-01-04T00:00:00Z' },
    ];

    const groups = buildJourney(lead, orders);

    expect(groups).toHaveLength(1);
    expect(groups[0].cycleNo).toBe(1);
    expect(groups[0].outcome).toBe('open');
    expect(groups[0].events.map((e) => e.kind)).toEqual(['order', 'signal', 'activity']);
    // The order event carries the cancel attribution the row will render.
    expect(groups[0].events[0]).toMatchObject({ kind: 'order', status: 'cancelled', cancelledBy: 'admin' });
  });

  it('groups a reopened lead by cycle, newest cycle first', () => {
    const lead = makeLead({
      status: 'contacted',
      reopenCount: 1,
      cycleStartedAt: '2026-02-01T00:00:00Z',
      assignedRep: { _id: 'r2', name: 'Anil' },
      sources: [{ type: 'order_cancelled', capturedAt: '2026-02-02T00:00:00Z', snapshot: { cancelledBy: 'customer', wasPaid: true } }],
      cycles: [{
        startedAt: '2026-01-01T00:00:00Z',
        closedAt: '2026-01-20T00:00:00Z',
        outcome: 'won',
        assignedRep: { _id: 'r1', name: 'Priya' },
        convertedOrder: { _id: 'o-won', orderNumber: 'W1' },
        sources: [{ type: 'dormant_user', capturedAt: '2026-01-02T00:00:00Z' }],
      }],
      activities: [
        { type: 'call', at: '2026-01-05T00:00:00Z', notes: 'c1 call' },
        { type: 'note', at: '2026-02-03T00:00:00Z', notes: 'c2 note' },
      ],
    });

    const groups = buildJourney(lead, []);

    expect(groups.map((g) => g.cycleNo)).toEqual([2, 1]);
    const [c2, c1] = groups;
    expect(c2.outcome).toBe('open');
    expect(c2.rep).toBe('Anil');
    expect(c1.outcome).toBe('won');
    expect(c1.rep).toBe('Priya');
    // Archived signal stays in its cycle; live signal in the current one.
    expect(c1.events.some((e) => e.kind === 'signal' && e.sourceType === 'dormant_user')).toBe(true);
    expect(c2.events.some((e) => e.kind === 'signal' && e.sourceType === 'order_cancelled')).toBe(true);
    // Activities are one flat stream → attributed to a cycle by timestamp.
    expect(c1.events.some((e) => e.kind === 'activity' && 'notes' in e && e.notes === 'c1 call')).toBe(true);
    expect(c2.events.some((e) => e.kind === 'activity' && 'notes' in e && e.notes === 'c2 note')).toBe(true);
  });

  it('anchors a cycle\'s closing order to that cycle even if its date says otherwise', () => {
    const lead = makeLead({
      status: 'new',
      reopenCount: 1,
      cycleStartedAt: '2026-02-01T00:00:00Z',
      cycles: [{
        startedAt: '2026-01-01T00:00:00Z',
        closedAt: '2026-01-20T00:00:00Z',
        outcome: 'won',
        convertedOrder: { _id: 'o-won' },
      }],
    });
    // createdAt falls inside the CURRENT cycle window, but convertedOrder wins.
    const orders: OrderHistoryItem[] = [
      { _id: 'o-won', orderNumber: 'W1', totalAmount: 500, status: 'delivered', paymentStatus: 'paid', createdAt: '2026-02-10T00:00:00Z' },
    ];

    const [current, first] = buildJourney(lead, orders);

    expect(first.cycleNo).toBe(1);
    expect(first.events.some((e) => e.kind === 'order' && e.orderId === 'o-won')).toBe(true);
    expect(current.events.some((e) => e.kind === 'order')).toBe(false);
  });

  it('buckets an event predating all cycles into the earliest cycle', () => {
    const lead = makeLead({
      reopenCount: 1,
      cycleStartedAt: '2026-02-01T00:00:00Z',
      cycles: [{ startedAt: '2026-01-01T00:00:00Z', closedAt: '2026-01-20T00:00:00Z', outcome: 'lost' }],
      activities: [{ type: 'note', at: '2025-12-01T00:00:00Z', notes: 'ancient' }],
    });

    const groups = buildJourney(lead, []);
    const first = groups.find((g) => g.cycleNo === 1)!;
    expect(first.events.some((e) => e.kind === 'activity' && 'notes' in e && e.notes === 'ancient')).toBe(true);
  });

  it('marks a terminal current cycle with its outcome and never throws on empties', () => {
    const lost = buildJourney(makeLead({ status: 'lost', cycleStartedAt: '2026-01-01T00:00:00Z' }), []);
    expect(lost).toHaveLength(1);
    expect(lost[0].outcome).toBe('lost');
    expect(lost[0].events).toHaveLength(0);
  });
});
