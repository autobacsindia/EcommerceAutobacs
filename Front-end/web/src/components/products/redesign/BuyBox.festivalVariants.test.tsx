import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import BuyBox, { type BuyBoxProduct } from './BuyBox';
import { FestivalOfferProvider } from '@/components/festival/FestivalOfferContext';
import type { PublicFestivalOffer } from '@/lib/festival/festivalOffer';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>);
jest.mock('@/context/CartContext', () => ({ useCart: () => ({ addToCart: jest.fn() }) }));
jest.mock('@/context/WishlistContext', () => ({
  useWishlist: () => ({ isInWishlist: () => false, addToWishlist: jest.fn(), removeFromWishlist: jest.fn() }),
}));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (n: number, o?: { exact?: boolean }) => require('@/test-utils/formatPriceMock').formatPriceMock(n, o),
  }),
}));
jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/hooks/useAddedToCartToast', () => ({ useAddedToCartToast: () => jest.fn() }));
jest.mock('@/hooks/queries/useCampaignProductRates', () => ({ useCampaignProductRates: () => ({ data: undefined }) }));
jest.mock('@/components/campaign/CampaignRateBadge', () => () => null);
jest.mock('@/components/products/redesign/EmiOptions', () => () => null);
jest.mock('@/components/products/redesign/NotifyMeButton', () => () => null);
jest.mock('@/components/products/redesign/JoinWaitlistButton', () => () => null);

const OFFER: PublicFestivalOffer = {
  code: 'diwali', startsAt: null, endsAt: null, live: true,
  tiers: [
    { minPaise: 0, percent: 10 },
    { minPaise: 50_000_00, percent: 5 },
    { minPaise: 1_00_000_00 + 1, percent: 3 },
    { minPaise: 2_00_000_00 + 1, percent: 2 },
  ],
};

// Jerry Can 8L: Red ₹3,060 (No offer), Black ₹4,200 (same as product = Custom 8%), Kit ₹6,390 (Custom 15%).
const jerry = {
  _id: 'p1', name: 'Jerry Can 8L', slug: 'jerry-can-8l', price: 3060, stock: 'in',
  averageRating: 0, totalReviews: 0, productType: 'variable', priceMin: 3060, priceMax: 6390,
  festivalOfferSetting: { mode: 'custom', percent: 8 },
  festivalOfferVariantSettings: [
    { variantId: 'red', mode: 'none' },
    { variantId: 'kit', mode: 'custom', percent: 15 },
  ],
  variants: [
    { _id: 'red', label: 'Red', price: 3060, stock: 'in' },
    { _id: 'black', label: 'Black', price: 4200, stock: 'in' },
    { _id: 'kit', label: 'Kit', price: 6390, stock: 'in' },
  ],
} as unknown as BuyBoxProduct;

const renderBox = (selected: string | null, offer: PublicFestivalOffer | null = OFFER) => render(
  <FestivalOfferProvider offer={offer} initialLive={!!offer}>
    <BuyBox product={jerry} selectedVariantId={selected} onSelectVariant={jest.fn()} />
  </FestivalOfferProvider>,
);

describe('BuyBox — Diwali price per model', () => {
  it('before a model is picked: the range uses each model\'s own offer', () => {
    renderBox(null);
    // Black 8% → ₹3,864 is the cheapest; Red (no offer) ₹3,060 is cheaper still; Kit 15% → ₹5,431 is the dearest.
    expect(screen.getByText('₹3,060 – ₹5,431')).toBeInTheDocument();
    expect(screen.getByText(/pick a model to see its saving/)).toBeInTheDocument();
  });

  it.each([
    ['red', '₹3,060', null],
    ['black', '₹3,864', '−8%'],
    ['kit', '₹5,431', '−15%'],
  ])('model %s shows %s', (id, price, pct) => {
    renderBox(id);
    expect(screen.getAllByText(price)[0]).toBeInTheDocument();
    const tag = screen.queryByTestId('festival-offer-tag');
    if (pct) expect(within(tag!).getByText(new RegExp(pct))).toBeInTheDocument();
    else expect(tag).toBeNull();
  });

  it('switch off: every model at its normal price, range unchanged', () => {
    renderBox(null, null);
    expect(screen.getByText('₹3,060 – ₹6,390')).toBeInTheDocument();
    expect(screen.queryByText(/pick a model to see its saving/)).toBeNull();
  });
});
