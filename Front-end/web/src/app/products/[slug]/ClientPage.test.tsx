import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClientPage from './ClientPage'; // Default export (the wrapper)
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import { useRouter, useSearchParams } from 'next/navigation';

// ── Hooks ──
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/context/WishlistContext', () => ({ useWishlist: jest.fn() }));
jest.mock('@/context/CartContext', () => ({ useCart: jest.fn() }));
jest.mock('@/context/CurrencyContext', () => ({ useCurrency: jest.fn() }));

jest.mock('react-hot-toast', () => {
  const mockToast = jest.fn() as unknown as jest.Mock & { success: jest.Mock; error: jest.Mock };
  mockToast.success = jest.fn();
  mockToast.error = jest.fn();
  return { __esModule: true, default: mockToast, toast: mockToast };
});

// ── Child components (rendered as lightweight stubs) ──
jest.mock('@/components/products/redesign/Gallery', () => ({
  __esModule: true,
  default: () => <div data-testid="gallery">Gallery</div>,
}));
jest.mock('@/components/products/QuestionForm', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/QuestionList', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/reviews', () => ({ Reviews: () => <div data-testid="reviews" /> }));
jest.mock('@/components/products/SimilarProductsSection', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/ComplementaryProductsSection', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/StickyCartBar', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/VehicleCards', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/SaleCountdown', () => ({
  __esModule: true,
  default: () => null,
  useSaleCountdown: () => ({ live: true, remaining: 0 }),
}));

describe('ClientPage', () => {
  const mockProduct = {
    _id: 'p1',
    name: 'Test Product',
    price: 1000,
    originalPrice: 1200,
    description: 'Test Description',
    shortDescription: 'Short Description',
    images: [{ url: 'test.jpg', alt: 'Test Image' }],
    stock: 'in',
    averageRating: 4.5,
    totalReviews: 10,
    sku: 'TEST-SKU',
    category: { name: 'Test Category' },
    brand: 'Test Brand',
    compatibleVehicles: [],
  };

  const mockRouter = { push: jest.fn(), replace: jest.fn() };
  const mockAddToCart = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, user: { _id: 'user1' } });
    (useCart as jest.Mock).mockReturnValue({ addToCart: mockAddToCart });
    (useWishlist as jest.Mock).mockReturnValue({
      addToWishlist: jest.fn(),
      removeFromWishlist: jest.fn(),
      isInWishlist: jest.fn().mockReturnValue(false),
    });
    (useCurrency as jest.Mock).mockReturnValue({
      formatPrice: (price: number) => `₹${price.toLocaleString()}`,
    });
    (apiClient.get as jest.Mock).mockResolvedValue({ product: mockProduct });
  });

  it('renders product details after loading', async () => {
    render(<ClientPage slug="p1" />);
    expect(screen.getByText('Loading product…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    expect(screen.getByText('₹1,000')).toBeInTheDocument();
    expect(screen.getByText('Short Description')).toBeInTheDocument();
    expect(screen.getByTestId('gallery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeInTheDocument();
  });

  it('adds to cart with the selected quantity', async () => {
    render(<ClientPage slug="p1" />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    await waitFor(() => {
      expect(mockAddToCart).toHaveBeenCalledWith('p1', 2);
    });
  });
});
