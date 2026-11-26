import React from 'react';
import { render, screen } from '@testing-library/react';
import CustomerOrderProgress, { type CustomerProgress } from './CustomerOrderProgress';

const step = (key: CustomerProgress['steps'][number]['key'], at: string | null) => ({ key, at, done: at != null });

const base = (over: Partial<CustomerProgress> = {}): CustomerProgress => ({
  current: 'packed',
  onHold: false,
  steps: [
    step('placed', '2026-11-23T04:30:00Z'),
    step('preparing', '2026-11-24T06:00:00Z'),
    step('packed', null),
    step('shipped', null),
    step('delivered', null),
  ],
  parcels: { total: 0, shipped: 0, delivered: 0 },
  estimate: { kind: 'window', from: '2026-11-23T04:30:00Z', minDays: 7, maxDays: 10, heavy: false },
  ...over,
});

describe('CustomerOrderProgress (customer order page)', () => {
  it('shows every step with its date, the step being worked on, and what we are doing now', () => {
    render(<CustomerOrderProgress progress={base()} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'working', 'todo', 'todo']);
    expect(items[0]).toHaveTextContent('Placed');
    expect(items[0]).toHaveTextContent('Mon 23 Nov');
    expect(items[1]).toHaveTextContent('Tue 24 Nov');
    expect(items[2]).toHaveTextContent('In progress');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('progress-headline')).toHaveTextContent('Your item is confirmed — we’re preparing it for dispatch.');
    expect(screen.getByText(/We’ll email you at every step/)).toBeInTheDocument();
  });

  it('shows the delivery window counted from the placed date', () => {
    render(<CustomerOrderProgress progress={base()} />);
    // Placed Mon 23 Nov (IST) + 7…10 days → Mon 30 Nov – Thu 3 Dec.
    expect(screen.getByTestId('progress-estimate')).toHaveTextContent('Expected delivery: Mon 30 Nov – Thu 3 Dec');
  });

  it('a courier date wins once a parcel is on its way', () => {
    render(<CustomerOrderProgress progress={base({
      current: 'delivered',
      steps: [step('placed', '2026-11-23T04:30:00Z'), step('preparing', '2026-11-23T06:00:00Z'), step('packed', '2026-11-24T06:00:00Z'), step('shipped', '2026-11-24T08:00:00Z'), step('delivered', null)],
      parcels: { total: 1, shipped: 1, delivered: 0 },
      estimate: { kind: 'courier', day: '2026-12-04' },
    })} />);
    expect(screen.getByTestId('progress-estimate')).toHaveTextContent('Expected by Fri 4 Dec');
    expect(screen.getByTestId('progress-headline')).toHaveTextContent('On its way to you.');
  });

  it('delivered: every step done, no estimate, no "in progress"', () => {
    render(<CustomerOrderProgress progress={base({
      current: 'delivered',
      steps: (['placed', 'preparing', 'packed', 'shipped', 'delivered'] as const).map((k) => step(k, '2026-11-28T08:00:00Z')),
      parcels: { total: 1, shipped: 1, delivered: 1 },
      estimate: null,
    })} />);
    expect(screen.getAllByRole('listitem').every((li) => li.getAttribute('data-state') === 'done')).toBe(true);
    expect(screen.queryByTestId('progress-estimate')).toBeNull();
    expect(screen.queryByText('In progress')).toBeNull();
    expect(screen.getByTestId('progress-headline')).toHaveTextContent('Delivered. We hope you love it.');
  });

  it('an item on hold says so plainly, without asking the customer to call', () => {
    render(<CustomerOrderProgress progress={base({ current: 'preparing', onHold: true })} />);
    const headline = screen.getByTestId('progress-headline').textContent || '';
    expect(headline).toMatch(/our team will be in touch/);
    expect(headline).not.toMatch(/call/i);
  });

  it('part shipped: says the rest follows', () => {
    render(<CustomerOrderProgress progress={base({ current: 'delivered', parcels: { total: 2, shipped: 1, delivered: 0 } })} />);
    expect(screen.getByTestId('progress-headline')).toHaveTextContent('Part of your order is on its way; the rest follows separately.');
  });
});
