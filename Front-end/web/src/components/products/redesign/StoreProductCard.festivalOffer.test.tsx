import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StoreProductCard from './StoreProductCard';
import { FestivalOfferProvider } from '@/components/festival/FestivalOfferContext';
import type { PublicFestivalOffer } from '@/lib/festival/festivalOffer';
import type { Product } from '@/lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('@/components/products/ProductImage', () => {
  return function MockProductImage({ alt }: { alt: string }) {
    return <img alt={alt} />;
  };
});

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({ addToCart: (...a: unknown[]) => addToCartMock(...a) }),
}));

jest.mock('@/context/WishlistContext', () => ({
  useWishlist: () => ({
    isInWishlist: () => false,
    addToWishlist: jest.fn(),
    removeFromWishlist: jest.fn(),
  }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    // The REAL formatter's behaviour, not an approximation — see formatPriceMock.
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      require('@/test-utils/formatPriceMock').formatPriceMock(n, o),
  }),
}));

jest.mock('react-hot-toast', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

// The card owns WHICH savings it reports; the shared hook owns how that becomes a
// sentence (and the eligibility gate) — covered in useAddedToCartToast.test.tsx.
const notifyAddedMock = jest.fn();
jest.mock('@/hooks/useAddedToCartToast', () => ({
  useAddedToCartToast: () => notifyAddedMock,
}));

const addToCartMock = jest.fn();

beforeEach(() => {
  notifyAddedMock.mockReset();
  addToCartMock.mockReset();
  addToCartMock.mockResolvedValue(undefined);
});

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test Product',
    price: 1000,
    images: [{ url: '/test.jpg' }],
    stock: 'in',
    averageRating: 0,
    ...overrides,
  } as Product;
}

const OFFER: PublicFestivalOffer = {
  code: 'diwali', startsAt: null, endsAt: null, live: true,
  tiers: [
    { minPaise: 0, percent: 10 },
    { minPaise: 50_000_00, percent: 5 },
    { minPaise: 1_00_000_00 + 1, percent: 3 },
    { minPaise: 2_00_000_00 + 1, percent: 2 },
  ],
};

const renderWithOffer = (ui: React.ReactElement, offer: PublicFestivalOffer | null = OFFER) =>
  render(<FestivalOfferProvider offer={offer} initialLive={!!offer}>{ui}</FestivalOfferProvider>);

describe('StoreProductCard — Diwali offer (display mirror)', () => {
  it('no MRP: shows the Diwali price, the price before Diwali, % and the saving', () => {
    renderWithOffer(<StoreProductCard product={makeProduct({ price: 40000 })} />);
    expect(screen.getByText('₹36,000')).toBeInTheDocument();
    const tag = screen.getByTestId('festival-offer-tag');
    expect(tag).toHaveTextContent('Diwali offer −10%');
    expect(tag).toHaveTextContent('Before Diwali ₹40,000');
    expect(tag).toHaveTextContent('You save ₹4,000');
  });

  it('stacks on an existing sale and keeps the M.R.P. strike-through and −20% badge (Profender)', () => {
    renderWithOffer(<StoreProductCard product={makeProduct({ price: 112500, originalPrice: 140625 })} />);
    expect(screen.getByText('₹1,09,125')).toBeInTheDocument();
    expect(screen.getByText('₹1,40,625')).toHaveClass('line-through');
    expect(screen.getByText('-20%')).toBeInTheDocument();
    const tag = screen.getByTestId('festival-offer-tag');
    expect(tag).toHaveTextContent('Diwali offer −3%');
    expect(tag).toHaveTextContent('Before Diwali ₹1,12,500');
    // The whole saving from M.R.P.: ₹1,40,625 − ₹1,09,125 (sale + Diwali), not the Diwali part alone.
    expect(tag).toHaveTextContent('You save ₹31,500');
  });

  it('offer off → exactly today\'s view: M.R.P. + current price + −20% badge, no Diwali', () => {
    renderWithOffer(<StoreProductCard product={makeProduct({ price: 112500, originalPrice: 140625 })} />, null);
    expect(screen.getByText('₹1,12,500')).toBeInTheDocument();
    expect(screen.getByText('₹1,40,625')).toHaveClass('line-through');
    expect(screen.getByText('-20%')).toBeInTheDocument();
    expect(screen.queryByTestId('festival-offer-tag')).not.toBeInTheDocument();
  });

  it('variable product: the "From" price is the cheapest model\'s Diwali price', () => {
    renderWithOffer(<StoreProductCard product={makeProduct({ productType: 'variable', price: 500, priceMin: 500, priceMax: 2000 })} />);
    expect(screen.getByText('₹450')).toBeInTheDocument();
    expect(screen.getByText('From')).toBeInTheDocument();
  });

  it('prices a campaign saving off the Diwali price the cart will charge', () => {
    renderWithOffer(
      <StoreProductCard product={makeProduct({ price: 1000 })} campaignRate={{ percent: 8, onSaleCapped: false }} />,
    );
    // 8% of ₹900 (the Diwali price), not of ₹1,000.
    expect(screen.getByText('+₹72 off')).toBeInTheDocument();
  });

  it('switches itself back to today\'s view at the end time without a reload', () => {
    jest.useFakeTimers();
    const endsAt = new Date(Date.now() + 1000).toISOString();
    renderWithOffer(<StoreProductCard product={makeProduct({ price: 40000 })} />, { ...OFFER, endsAt });
    expect(screen.getByText('₹36,000')).toBeInTheDocument();
    require('@testing-library/react').act(() => { jest.advanceTimersByTime(1100); });
    expect(screen.queryByTestId('festival-offer-tag')).not.toBeInTheDocument();
    expect(screen.getByText('₹40,000')).toBeInTheDocument();
    jest.useRealTimers();
  });
});
