import React from 'react';
import { render, screen } from '@testing-library/react';
import OfferStrip from './OfferStrip';

jest.mock('lucide-react', () => ({
  Gift: () => <span data-testid="gift-icon">gift</span>,
}));

describe('OfferStrip', () => {
  // Onam 2026 has ended. Customers still holding the printed counter card land on
  // /login?offer=onam; they must get the plain sign-in screen, not a dead promotion.
  it('renders nothing for the retired onam offer', () => {
    render(<OfferStrip offer="onam" />);
    expect(screen.queryByTestId('offer-strip')).not.toBeInTheDocument();
    expect(screen.queryByText(/Onam/i)).not.toBeInTheDocument();
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
