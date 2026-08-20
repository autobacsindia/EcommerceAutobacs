import React from 'react';
import { render, screen } from '@testing-library/react';
import OfferStrip from './OfferStrip';

jest.mock('lucide-react', () => ({
  Gift: () => <span data-testid="gift-icon">gift</span>,
}));

describe('OfferStrip', () => {
  it('shows the offer copy for a known offer key', () => {
    render(<OfferStrip offer="onam" />);
    expect(screen.getByTestId('offer-strip')).toBeInTheDocument();
    expect(screen.getByText(/Onam Special/i)).toBeInTheDocument();
  });

  // The parameter comes off a URL anyone can type. An unknown value must leave the
  // sign-in screen exactly as it was rather than render an empty decorated box.
  it.each([
    ['an unknown offer', 'diwali-2099'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('renders nothing for %s', (_label, value) => {
    const { container } = render(<OfferStrip offer={value as string | null | undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Guards against a future offer key being interpolated into the lookup: a value that
  // resolves on Object.prototype must not be treated as a configured offer.
  it('does not resolve inherited object properties as offers', () => {
    const { container } = render(<OfferStrip offer="constructor" />);
    expect(container).toBeEmptyDOMElement();
  });
});
