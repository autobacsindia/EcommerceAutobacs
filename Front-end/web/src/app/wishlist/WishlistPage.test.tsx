import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WishlistPage from './page';
import '@testing-library/jest-dom';

// Mocks
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

jest.mock('lucide-react', () => ({
  ShoppingCart: () => <span data-testid="icon-cart">Cart</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Heart: () => <span data-testid="icon-heart">Heart</span>,
}));

jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/components/layout/EnhancedImage', () => () => <img data-testid="product-image" alt="Product" />);

const mockRemoveFromWishlist = jest.fn();
const mockFetchWishlist = jest.fn();
const mockAddToCart = jest.fn();

jest.mock('@/context/WishlistContext', () => ({
  useWishlist: () => ({
    wishlistItems: [
      {
        product: {
          _id: '1',
          name: 'Test Product',
          price: 100,
          images: [{ url: 'img1.jpg' }],
          averageRating: 4.5,
          stock: 'in',
        },
      },
    ],
    loading: false,
    removeFromWishlist: mockRemoveFromWishlist,
    fetchWishlist: mockFetchWishlist,
  }),
}));

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({
    addToCart: mockAddToCart,
  }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (price: number) => `₹${price}`,
  }),
}));

describe('WishlistPage Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders wishlist items correctly', () => {
    render(<WishlistPage />);
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText(/₹100/)).toBeInTheDocument();
  });

  it('handles add to cart', async () => {
    render(<WishlistPage />);
    // Assuming there is an add to cart button
    // Try to find by text first, then by icon
    const addToCartButton = screen.queryByText(/Add to Cart/i) || screen.getByTestId('icon-cart').closest('button');
    expect(addToCartButton).toBeInTheDocument();
    
    if (addToCartButton) {
        fireEvent.click(addToCartButton);
        await waitFor(() => {
            expect(mockAddToCart).toHaveBeenCalledWith('1', 1);
        });
    }
  });

  it('handles remove from wishlist', async () => {
    render(<WishlistPage />);
    const removeIcon = screen.getByTestId('icon-trash');
    const removeButton = removeIcon.closest('button');
    expect(removeButton).toBeInTheDocument();
    
    if (removeButton) {
      fireEvent.click(removeButton);
      await waitFor(() => {
        expect(mockRemoveFromWishlist).toHaveBeenCalledWith('1');
      });
    }
  });
});
