import { render, screen } from '@testing-library/react';
import DeliveryEstimate from './DeliveryEstimate';

const GENERAL = { minDays: 7, maxDays: 10, heavy: false };
const HEAVY = { minDays: 10, maxDays: 15, heavy: true };

describe('DeliveryEstimate', () => {
  it('card: day range on one fixed-height line', () => {
    render(<DeliveryEstimate window={GENERAL} />);
    const el = screen.getByTestId('delivery-estimate');
    expect(el).toHaveTextContent('7–10 days delivery');
    expect(el.className).toContain('h-4');
  });

  it('reserves the same space while loading / for a sold-out item (no layout shift)', () => {
    render(<DeliveryEstimate window={null} />);
    const el = screen.getByTestId('delivery-estimate');
    expect(el).toBeEmptyDOMElement();
    expect(el.className).toContain('h-4');
  });

  it('page: real dates after mount, and heavy goods say so', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T04:30:00Z'));
    try {
      render(<DeliveryEstimate window={HEAVY} variant="page" />);
      const el = screen.getByTestId('delivery-estimate');
      expect(el).toHaveTextContent('Delivered by Sat 5 Dec – Thu 10 Dec');
      expect(el).toHaveTextContent('Heavy item · 10–15 days');
      expect(el.className).toContain('h-10');
    } finally {
      jest.useRealTimers();
    }
  });

  it('page: reserved space when there is no estimate', () => {
    render(<DeliveryEstimate window={undefined} variant="page" />);
    expect(screen.getByTestId('delivery-estimate')).toBeEmptyDOMElement();
  });
});
