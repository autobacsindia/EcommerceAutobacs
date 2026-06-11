import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProductCard from './ProductCard';
import '@testing-library/jest-dom';

// Setup configurable mocks
const mockAddToCart = jest.fn();
const mockIsInWishlist = jest.fn();
const mockAddToWishlist = jest.fn();
const mockRemoveFromWishlist = jest.fn();
const mockFormatPrice = jest.fn((price) => `₹${price}`);
const mockRouterPush = jest.fn();
let mockIsAuthenticated = true;

jest.mock('@/context/CartContext', () => ({
  useCart: () => ({
    addToCart: mockAddToCart,
  }),
}));

jest.mock('@/context/WishlistContext', () => ({
  useWishlist: () => ({
    isInWishlist: mockIsInWishlist,
    addToWishlist: mockAddToWishlist,
    removeFromWishlist: mockRemoveFromWishlist,
  }),
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    get isAuthenticated() { return mockIsAuthenticated; },
  }),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: mockFormatPrice,
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

// Mock Link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock toast
jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const mockProduct = {
  _id: '123',
  name: 'Test Product',
  price: 1000,
  originalPrice: 1200,
  images: [{ url: '/test-image.jpg', alt: 'Test Image' }],
  stock: 10,
  averageRating: 4.5,
  categories: [{ name: 'Test Category', _id: 'cat1', slug: 'cat-1' }],
  description: 'Test Description',
  isActive: true,
  isFeatured: false,
  totalReviews: 10,
  createdAt: '2023-01-01',
  updatedAt: '2023-01-01',
};

describe('ProductCard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsInWishlist.mockReturnValue(false);
    mockIsAuthenticated = true;
  });

  it('renders product information correctly', () => {
    render(<ProductCard product={mockProduct as any} />);
    
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('₹1000')).toBeInTheDocument();
    expect(screen.getByText('₹1200')).toBeInTheDocument(); 
    expect(screen.getByText('TEST CATEGORY')).toBeInTheDocument();
    expect(screen.getByText('(4.5)')).toBeInTheDocument();
  });

  it('handles add to cart', async () => {
    render(<ProductCard product={mockProduct as any} />);
    
    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);
    
    await waitFor(() => {
      expect(mockAddToCart).toHaveBeenCalledWith('123', 1);
    });
  });

  it('redirects to login if not authenticated when adding to cart', async () => {
    mockIsAuthenticated = false;
    render(<ProductCard product={mockProduct as any} />);
    
    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);
    
    expect(mockRouterPush).toHaveBeenCalledWith('/login');
    expect(mockAddToCart).not.toHaveBeenCalled();
  });
  
  it('displays out of stock badge when stock is 0', () => {
      const outOfStockProduct = { ...mockProduct, stock: 0 };
      render(<ProductCard product={outOfStockProduct as any} />);
      expect(screen.getByText('Out of Stock')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });
  
  it('handles comparison toggle', () => {
      const mockOnToggleCompare = jest.fn();
      render(<ProductCard product={mockProduct as any} onToggleCompare={mockOnToggleCompare} isCompared={false} />);
      
      // The compare checkbox is inside a label. We can find it by text 'Compare'
      const compareLabel = screen.getByText('Compare');
      fireEvent.click(compareLabel); // Clicking label triggers input change
      
      expect(mockOnToggleCompare).toHaveBeenCalledWith('123');
  });
});
