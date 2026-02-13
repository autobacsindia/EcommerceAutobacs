import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClientPage from './ClientPage'; // Default export (the wrapper)
import apiClient from '@/lib/api'; // We need to mock the API response
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';

// Mock Hooks
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/context/WishlistContext', () => ({
  useWishlist: jest.fn(),
}));

jest.mock('@/context/CartContext', () => ({
  useCart: jest.fn(),
}));

jest.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: jest.fn(),
}));

jest.mock('react-hot-toast', () => {
  const mockToast = jest.fn();
  mockToast.success = jest.fn();
  mockToast.error = jest.fn();
  return {
    __esModule: true,
    default: mockToast,
    toast: mockToast,
  };
});

// Mock Child Components to simplify testing
jest.mock('@/components/products/ImageGallery', () => ({
  __esModule: true,
  default: () => <div data-testid="image-gallery">Image Gallery</div>,
}));

jest.mock('@/components/products/QuestionForm', () => ({
  __esModule: true,
  default: () => <div data-testid="question-form">Question Form</div>,
}));

jest.mock('@/components/products/QuestionList', () => ({
  __esModule: true,
  default: () => <div data-testid="question-list">Question List</div>,
}));

jest.mock('@/components/reviews', () => ({
  Reviews: () => <div data-testid="reviews">Reviews Section</div>,
}));

// Mock TrustBadges
jest.mock('@/components/products/TrustBadges', () => ({
  __esModule: true,
  default: () => <div data-testid="trust-badges">Trust Badges</div>,
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
    stock: 10,
    averageRating: 4.5,
    totalReviews: 10,
    variableSpecs: [
      {
        key: 'Color',
        options: [
          { label: 'Red', price: 1000 },
          { label: 'Blue', price: 1100 }
        ]
      }
    ],
    sku: 'TEST-SKU',
    category: { name: 'Test Category' },
    brand: 'Test Brand',
    compatibleVehicles: []
  };

  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
  };

  const mockAddToCart = jest.fn();
  const mockAddToWishlist = jest.fn();
  const mockRemoveFromWishlist = jest.fn();
  const mockIsInWishlist = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      user: { _id: 'user1' }
    });

    (useCart as jest.Mock).mockReturnValue({
      addToCart: mockAddToCart,
    });

    (useWishlist as jest.Mock).mockReturnValue({
      addToWishlist: mockAddToWishlist,
      removeFromWishlist: mockRemoveFromWishlist,
      isInWishlist: mockIsInWishlist,
    });

    (useCurrency as jest.Mock).mockReturnValue({
      formatPrice: (price: number) => `₹${price.toLocaleString()}`,
    });

    // Mock API response for product fetch
    // getProduct expects { product: ... } structure from response?
    // Let's verify getProduct in ClientPage.tsx:
    // const response = await apiClient.get(...)
    // return response?.product || null
    (apiClient.get as jest.Mock).mockResolvedValue({
      product: mockProduct
    });
  });

  it('renders product details correctly after loading', async () => {
    render(<ClientPage id="p1" />);

    // Initial loading state
    expect(screen.getByText('Loading product...')).toBeInTheDocument();

    // Wait for product to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    expect(screen.getByText('₹1,000')).toBeInTheDocument();
    expect(screen.getByText('Short Description')).toBeInTheDocument();
    expect(screen.getByTestId('image-gallery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeInTheDocument();
  });

  it('handles variable specifications selection', async () => {
    render(<ClientPage id="p1" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    const redOption = screen.getByText('Red');
    const blueOption = screen.getByText('Blue');

    // Default selection should be Red (first option)
    await waitFor(() => {
      expect(redOption).toHaveClass('bg-blue-600 text-white');
    });
    expect(screen.getByText('₹1,000')).toBeInTheDocument();

    // Select Blue
    fireEvent.click(blueOption);
    
    // Check updated styling and price
    expect(blueOption).toHaveClass('bg-blue-600 text-white');
    expect(redOption).not.toHaveClass('bg-blue-600 text-white');
    expect(screen.getByText('₹1,100')).toBeInTheDocument();
  });

  it('handles add to cart', async () => {
    render(<ClientPage id="p1" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    const addToCartBtn = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartBtn);

    await waitFor(() => {
      expect(mockAddToCart).toHaveBeenCalledWith('p1', 1);
      expect(toast.success).toHaveBeenCalledWith('Added to cart!');
    });
  });

  it('redirects to login if guest tries to add to cart', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      user: null
    });

    render(<ClientPage id="p1" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    const addToCartBtn = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartBtn);

    expect(mockAddToCart).not.toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalledWith('/login');
  });
});
