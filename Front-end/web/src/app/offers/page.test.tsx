import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OffersPage from './page';
import apiClient from '@/lib/api';
import { useSearchParams } from 'next/navigation';

// Mock apiClient
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
  })),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

// Mock CartContext
jest.mock('@/context/CartContext', () => ({
  useCart: jest.fn(() => ({
    addToCart: jest.fn(),
  })),
}));

// Mock AuthContext
jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    isAuthenticated: false,
  })),
}));

// Mock WishlistContext if needed (likely used by ProductCard inside ProductGrid)
jest.mock('@/context/WishlistContext', () => ({
  useWishlist: jest.fn(() => ({
    isInWishlist: jest.fn(() => false),
    addToWishlist: jest.fn(),
    removeFromWishlist: jest.fn(),
  })),
}));

// Mock CurrencyContext
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: jest.fn(() => ({
    formatPrice: (price: number) => `AED ${price}`,
    currency: { code: 'AED', symbol: 'AED', rate: 1 }
  })),
  CurrencyProvider: ({ children }: { children: React.ReactNode }) => children
}));

// ProductGrid batches a campaign-rate lookup per page via react-query; this suite
// exercises the offers fetch and its pagination, not campaign eligibility.
jest.mock('@/hooks/queries/useCampaignProductRates', () => ({
  useCampaignProductRates: jest.fn(() => ({ data: null })),
}));
jest.mock('@/hooks/queries/useCampaign', () => ({
  useCampaignBadgeVisible: jest.fn(() => true),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function offerResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    count: 2,
    total: 2,
    pages: 1,
    currentPage: 1,
    hasNext: false,
    hasPrev: false,
    products: [
      {
        _id: '1',
        name: 'Offer Product 1',
        price: 100,
        originalPrice: 150,
        images: [{ url: '/test.jpg', alt: 'test' }],
        category: { name: 'Test Cat', slug: 'test-cat' }
      },
      {
        _id: '2',
        name: 'Offer Product 2',
        price: 200,
        images: [{ url: '/test2.jpg', alt: 'test2' }],
        category: { name: 'Test Cat', slug: 'test-cat' }
      }
    ],
    ...overrides,
  };
}

describe('OffersPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  });

  it('renders offers page correctly with products', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce(offerResponse());

    renderWithClient(<OffersPage />);

    // Check header
    expect(screen.getByText('Offers')).toBeInTheDocument();

    // Wait for products to load
    await waitFor(() => {
      expect(screen.getByText('Offer Product 1')).toBeInTheDocument();
      expect(screen.getByText('Offer Product 2')).toBeInTheDocument();
    });

    // Check discount badge for product 1 (StoreProductCard renders "-33%")
    // (originalPrice - price) / originalPrice * 100 = (150 - 100) / 150 * 100 = 33%
    expect(screen.getByText('-33%')).toBeInTheDocument();

    // Fetched page 1 at the standard page size.
    expect(apiClient.get).toHaveBeenCalledWith('/products/offers?page=1&limit=24');
  });

  it('renders empty state when no offers found', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce(offerResponse({ products: [], total: 0, count: 0 }));

    renderWithClient(<OffersPage />);

    await waitFor(() => {
      expect(screen.getByText('No offers available right now. Please check back later.')).toBeInTheDocument();
    });
  });

  it('handles error state', async () => {
    (apiClient.get as jest.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));

    renderWithClient(<OffersPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load offers')).toBeInTheDocument();
    });
  });

  it('requests the page from the URL and shows pagination controls when there is more than one page', async () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('page=2'));
    (apiClient.get as jest.Mock).mockResolvedValueOnce(
      offerResponse({ total: 50, pages: 3, currentPage: 2, hasNext: true, hasPrev: true }),
    );

    renderWithClient(<OffersPage />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/products/offers?page=2&limit=24');
    });

    expect(await screen.findByText(/Page 2 of 3/)).toBeInTheDocument();
  });

  it('does not show pagination controls for a single page of results', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce(offerResponse());

    renderWithClient(<OffersPage />);

    await waitFor(() => expect(screen.getByText('Offer Product 1')).toBeInTheDocument());
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
  });
});
