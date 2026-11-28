import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StickyCartBar from './StickyCartBar';
import { FestivalOfferProvider } from '@/components/festival/FestivalOfferContext';
import { resetFloatingClearance, setBuyButtonsInView } from '@/lib/floatingClearance';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/context/CartContext', () => ({ useCart: () => ({ addToCart: jest.fn() }) }));
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (n: number, o?: { exact?: boolean }) => require('@/test-utils/formatPriceMock').formatPriceMock(n, o),
  }),
}));
jest.mock('react-hot-toast', () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));
jest.mock('@/hooks/useAddedToCartToast', () => ({ useAddedToCartToast: () => jest.fn() }));
jest.mock('@/hooks/queries/useCampaignProductRates', () => ({ useCampaignProductRates: () => ({ data: undefined }) }));

const simple = { _id: 'p1', name: 'Fortuner Headlights', price: 52500, stock: 'in' as const };
const winch = { _id: 'p2', name: 'WARN VR EVO winch', price: 92000, stock: 'in' as const };

const renderBar = (ui: React.ReactElement) =>
  render(<FestivalOfferProvider offer={null} initialLive={false}>{ui}</FestivalOfferProvider>);

const scrollPast = () => act(() => {
  Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
  window.dispatchEvent(new Event('scroll'));
});

beforeEach(() => {
  resetFloatingClearance();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

describe('StickyCartBar', () => {
  it('shows after scrolling past the buy box', () => {
    renderBar(<StickyCartBar product={simple} />);
    expect(screen.queryByTestId('sticky-price')).not.toBeInTheDocument();
    scrollPast();
    expect(screen.getByTestId('sticky-price')).toHaveTextContent('₹52,500');
  });

  it('steps aside while the page\'s own Add to cart / Buy now buttons are on screen', () => {
    renderBar(<StickyCartBar product={simple} />);
    scrollPast();
    const token = {};
    act(() => setBuyButtonsInView(token, true));
    expect(screen.queryByTestId('sticky-price')).not.toBeInTheDocument();
    act(() => setBuyButtonsInView(token, false));
    expect(screen.getByTestId('sticky-price')).toBeInTheDocument();
  });

  it('a product with models shows "From" the lowest price, not a range that wraps', () => {
    renderBar(<StickyCartBar product={winch} isVariable priceMin={92000} priceMax={117500} />);
    scrollPast();
    const price = screen.getByTestId('sticky-price');
    expect(price).toHaveTextContent('From₹92,000');
    expect(price).not.toHaveTextContent('1,17,500');
  });

  it('a model is picked: shows that model\'s exact price', () => {
    renderBar(
      <StickyCartBar
        product={winch}
        isVariable
        priceMin={92000}
        priceMax={117500}
        variant={{ _id: 'v2', label: 'VR EVO 12-S', price: 117500, stock: 'in' }}
      />,
    );
    scrollPast();
    expect(screen.getByTestId('sticky-price')).toHaveTextContent('₹1,17,500');
    expect(screen.getByTestId('sticky-price')).not.toHaveTextContent('From');
  });

  it('stays hidden for a sold-out product', () => {
    renderBar(<StickyCartBar product={{ ...simple, stock: 'out' }} />);
    scrollPast();
    expect(screen.queryByTestId('sticky-price')).not.toBeInTheDocument();
  });
});
