import { render, screen, waitFor } from '@testing-library/react';
import OffersPage from './page';
import apiClient from '@/lib/api';

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
jest.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: jest.fn(() => ({
    formatPrice: (price: number) => `AED ${price}`,
    currency: { code: 'AED', symbol: 'AED', rate: 1 }
  })),
  CurrencyProvider: ({ children }: { children: React.ReactNode }) => children
}));

describe('OffersPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders offers page correctly with products', async () => {
    // Mock successful response
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      success: true,
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
          price: 200, // No original price, maybe isOfferFeatured=true
          images: [{ url: '/test2.jpg', alt: 'test2' }],
          category: { name: 'Test Cat', slug: 'test-cat' }
        }
      ],
      count: 2
    });

    render(<OffersPage />);

    // Check header
    expect(screen.getByText('Offers')).toBeInTheDocument();

    // Wait for products to load
    await waitFor(() => {
      expect(screen.getByText('Offer Product 1')).toBeInTheDocument();
      expect(screen.getByText('Offer Product 2')).toBeInTheDocument();
    });

    // Check discount badge for product 1
    // (originalPrice - price) / originalPrice * 100 = (150 - 100) / 150 * 100 = 33%
    expect(screen.getByText('33% OFF')).toBeInTheDocument();
  });

  it('renders empty state when no offers found', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      success: true,
      products: [],
      count: 0
    });

    render(<OffersPage />);

    await waitFor(() => {
      expect(screen.getByText('No offers available right now. Please check back later.')).toBeInTheDocument();
    });
  });

  it('handles error state', async () => {
    (apiClient.get as jest.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));

    render(<OffersPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load offers')).toBeInTheDocument();
    });
  });
});
