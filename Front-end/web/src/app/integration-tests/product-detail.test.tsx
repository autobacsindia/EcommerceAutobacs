
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProductDetailPageClient } from '../products/[slug]/ClientPage'; // Adjust path
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useRouter, useSearchParams } from 'next/navigation';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
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

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  ShoppingCart: () => <div data-testid="icon-cart" />,
  Heart: () => <div data-testid="icon-heart" />,
  Star: () => <div data-testid="icon-star" />,
  GitCompare: () => <div data-testid="icon-compare" />,
}));

// Mock child components
jest.mock('@/components/products/ImageGallery', () => {
  return function MockImageGallery() {
    return <div data-testid="image-gallery">Image Gallery</div>;
  };
});

jest.mock('@/components/products/QuestionForm', () => {
  return function MockQuestionForm() {
    return <div data-testid="question-form">Question Form</div>;
  };
});

jest.mock('@/components/products/QuestionList', () => {
  return function MockQuestionList() {
    return <div data-testid="question-list">Question List</div>;
  };
});

jest.mock('@/components/products/TrustBadges', () => {
  return function MockTrustBadges() {
    return <div data-testid="trust-badges">Trust Badges</div>;
  };
});

jest.mock('@/components/products/RecentlyViewed', () => {
  return function MockRecentlyViewed() {
    return <div data-testid="recently-viewed">Recently Viewed</div>;
  };
});

jest.mock('@/components/reviews', () => ({
  Reviews: function MockReviews() {
    return <div data-testid="reviews">Reviews</div>;
  },
}));

describe('Product Detail Page Integration', () => {
  const mockPush = jest.fn();
  const mockReplace = jest.fn();
  const mockAddToWishlist = jest.fn();
  const mockRemoveFromWishlist = jest.fn();
  const mockIsInWishlist = jest.fn();
  const mockAddToCart = jest.fn();
  const mockFormatPrice = jest.fn((price) => `₹${price}`);

  const mockProduct = {
    _id: '123',
    name: 'Test Product',
    description: 'Test Description',
    price: 1000,
    originalPrice: 1200,
    images: [{ url: 'test.jpg', alt: 'Test Image' }],
    averageRating: 4.5,
    totalReviews: 10,
    stock: 5,
    isActive: true,
    isFeatured: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush, replace: mockReplace });
    (useSearchParams as jest.Mock).mockReturnValue({ get: jest.fn() });
    
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, user: { _id: 'user1', name: 'User' } });
    (useWishlist as jest.Mock).mockReturnValue({
      addToWishlist: mockAddToWishlist,
      removeFromWishlist: mockRemoveFromWishlist,
      isInWishlist: mockIsInWishlist,
    });
    (useCart as jest.Mock).mockReturnValue({ addToCart: mockAddToCart });
    (useCurrency as jest.Mock).mockReturnValue({ formatPrice: mockFormatPrice });
    
    // Default to not in wishlist
    mockIsInWishlist.mockReturnValue(false);
  });

  it('renders product details correctly', () => {
    render(<ProductDetailPageClient product={mockProduct} />);
    
    expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    expect(screen.getByText('₹1,000')).toBeInTheDocument();
    expect(screen.getByText('₹1,200')).toBeInTheDocument(); // Original price
    expect(screen.getByText(/17% OFF/)).toBeInTheDocument(); // Discount calculation
    
    expect(screen.getByTestId('image-gallery')).toBeInTheDocument();
    expect(screen.getByTestId('reviews')).toBeInTheDocument();
  });

  it('handles add to cart', async () => {
    render(<ProductDetailPageClient product={mockProduct} />);
    
    // Look for Add to Cart button - text might vary based on stock
    // Assuming "Add to Cart" text is present
    // Need to find the button. In ClientPage.tsx code isn't fully visible but usually it's "Add to Cart"
    // I'll assume there is a button with text /add to cart/i
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);
    
    // addToCart might be async or not, check usage in component
    // Assuming it calls addToCart from context
    expect(mockAddToCart).toHaveBeenCalled();
  });

  it('handles wishlist toggle', async () => {
    render(<ProductDetailPageClient product={mockProduct} />);
    
    // Find button containing heart icon
    const wishlistIcon = screen.getByTestId('icon-heart');
    const wishlistButton = wishlistIcon.closest('button');
    
    expect(wishlistButton).toBeInTheDocument();
    
    if (wishlistButton) {
        fireEvent.click(wishlistButton);
        expect(mockAddToWishlist).toHaveBeenCalledWith(mockProduct._id);
    }
  });
});
