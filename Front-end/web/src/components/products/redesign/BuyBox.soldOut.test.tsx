import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import BuyBox, { type BuyBoxProduct } from './BuyBox';
import { FestivalOfferProvider } from '@/components/festival/FestivalOfferContext';

jest.mock('@/hooks/queries/useDeliveryEstimates', () => ({
  useDeliveryEstimates: () => ({ estimates: { p1: { minDays: 7, maxDays: 10, heavy: false } }, pending: false }),
}));
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
// The Black Friday ₹0-delivery offer is live.
jest.mock('@/hooks/queries/useDeliveryFeesPublic', () => ({
  useDeliveryFeesPublic: () => ({ chargeAtCheckout: true, offerLive: true, isLoading: false }),
}));
jest.mock('@/hooks/useAddedToCartToast', () => ({ useAddedToCartToast: () => jest.fn() }));
jest.mock('@/hooks/queries/useCampaignProductRates', () => ({ useCampaignProductRates: () => ({ data: undefined }) }));
jest.mock('@/components/campaign/CampaignRateBadge', () => () => null);
jest.mock('@/components/products/redesign/EmiOptions', () => () => null);
jest.mock('@/components/products/redesign/NotifyMeButton', () => () => <button type="button">Notify me</button>);
jest.mock('@/components/products/redesign/JoinWaitlistButton', () => () => null);

const product = (stock: 'in' | 'out') => ({
  _id: 'p1', name: 'Thar Roxx Wheel Spacer', slug: 'thar-roxx-wheel-spacer', price: 18880, stock,
  averageRating: 0, totalReviews: 0, productType: 'simple',
}) as unknown as BuyBoxProduct;

const renderBox = (stock: 'in' | 'out') => render(
  <FestivalOfferProvider offer={null} initialLive={false}>
    <BuyBox product={product(stock)} selectedVariantId={null} onSelectVariant={jest.fn()} />
  </FestivalOfferProvider>,
);

describe('BuyBox — sold-out product', () => {
  it('in stock: shows the delivery line and the live delivery offer', () => {
    renderBox('in');
    expect(screen.getByTestId('delivery-estimate')).toBeInTheDocument();
    expect(screen.getByText(/Black Friday: apply the offer at checkout/)).toBeInTheDocument();
  });

  it('sold out: no blank delivery line and no offer the shopper cannot use', () => {
    renderBox('out');
    expect(screen.queryByTestId('delivery-estimate')).not.toBeInTheDocument();
    expect(screen.queryByText(/Black Friday: apply the offer at checkout/)).not.toBeInTheDocument();
    // Price and the tax note are still there.
    expect(screen.getByText(/Inclusive of all taxes/)).toBeInTheDocument();
  });
});
