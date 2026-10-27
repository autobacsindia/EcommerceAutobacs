import React from 'react';
import { render, screen } from '@testing-library/react';
import ParcelSteps from './ParcelSteps';

describe('ParcelSteps (customer)', () => {
  it('renders nothing until there is an update', () => {
    const { container } = render(<ParcelSteps steps={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<ParcelSteps />).container).toBeEmptyDOMElement();
  });

  it('shows the updates newest first, in customer words, with the note', () => {
    render(<ParcelSteps steps={[
      { status: 'picked_up', at: '2026-10-26T05:00:00Z' },
      { status: 'delivery_failed', note: 'Customer not at home', at: '2026-10-27T05:00:00Z' },
    ]} />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/Delivery attempt missed — the courier will try again · Customer not at home/);
    expect(items[1]).toMatch(/Picked up by the courier/);
  });
});
