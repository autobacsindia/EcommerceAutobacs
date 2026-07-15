import { render, screen } from '@testing-library/react';
import JourneyTimeline from './JourneyTimeline';
import type { JourneyGroup } from '@/lib/leadJourney';

describe('JourneyTimeline', () => {
  it('renders cycle headers and events for a multi-cycle lead', () => {
    const groups: JourneyGroup[] = [
      {
        cycleNo: 2, outcome: 'open', start: Date.parse('2026-02-01'), end: Number.POSITIVE_INFINITY, rep: 'Anil',
        events: [
          { kind: 'signal', at: Date.parse('2026-02-02'), sourceType: 'order_cancelled', snapshot: { cancelledBy: 'customer', wasPaid: true } },
          { kind: 'activity', at: Date.parse('2026-02-01'), activityType: 'call', notes: 'left voicemail', actor: 'Anil' },
        ],
      },
      {
        cycleNo: 1, outcome: 'won', start: Date.parse('2026-01-01'), end: Date.parse('2026-01-20'), rep: 'Priya',
        events: [
          { kind: 'order', at: Date.parse('2026-01-10'), orderId: 'o-won', orderNumber: 'W1', total: 500, status: 'delivered', paymentStatus: 'paid' },
        ],
      },
    ];

    render(<JourneyTimeline groups={groups} />);

    expect(screen.getByText('Cycle #2')).toBeInTheDocument();
    expect(screen.getByText('Cycle #1')).toBeInTheDocument();
    // Cancel attribution surfaces on the order_cancelled signal.
    expect(screen.getByText('by customer')).toBeInTheDocument();
    expect(screen.getByText('was paid')).toBeInTheDocument();
    // Activity notes + the linked order both render.
    expect(screen.getByText(/left voicemail/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Order W1/ })).toHaveAttribute('href', '/admin/orders/o-won');
  });

  it('shows the cart items + amount on a "left at checkout" payment signal', () => {
    const groups: JourneyGroup[] = [
      {
        cycleNo: 1, outcome: 'open', events: [
          {
            kind: 'signal', at: Date.parse('2026-03-01'), sourceType: 'payment_pending',
            snapshot: {
              total: 1500,
              itemCount: 2,
              items: [
                { name: 'Brake Pads', quantity: 2, price: 300 },
                { name: 'Oil Filter', quantity: 1, price: 900 },
              ],
            },
          },
        ],
      },
    ];

    render(<JourneyTimeline groups={groups} />);

    expect(screen.getByText('₹1,500')).toBeInTheDocument();
    expect(screen.getByText('2× Brake Pads, 1× Oil Filter')).toBeInTheDocument();
  });

  it('omits cycle headers for a single-cycle lead and shows the empty state', () => {
    const empty: JourneyGroup[] = [{ cycleNo: 1, outcome: 'open', events: [] }];
    render(<JourneyTimeline groups={empty} />);
    expect(screen.queryByText('Cycle #1')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing has happened/)).toBeInTheDocument();
  });

  it('caps a long cycle and offers a show-more toggle', () => {
    const events = Array.from({ length: 15 }, (_, i) => ({
      kind: 'activity' as const, at: Date.parse('2026-01-01') + i * 1000, activityType: 'note', notes: `n${i}`,
    }));
    render(<JourneyTimeline groups={[{ cycleNo: 1, outcome: 'open', events }]} />);
    expect(screen.getByText('Show 3 more')).toBeInTheDocument();
  });
});
