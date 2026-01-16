import { render, screen, waitFor } from '@testing-library/react';
import SearchPage from './page';
import { useSearchParams, useRouter } from 'next/navigation';
import apiClient from '@/lib/api';

// Mock apiClient
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
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

// Mock WishlistContext
jest.mock('@/context/WishlistContext', () => ({
  useWishlist: jest.fn(() => ({
    isInWishlist: jest.fn(() => false),
    addToWishlist: jest.fn(),
    removeFromWishlist: jest.fn(),
  })),
}));

// Mock fetch
// global.fetch = jest.fn();

describe('SearchPage', () => {
  const mockPush = jest.fn();
  const mockSearchParams = new URLSearchParams();
  
  beforeEach(() => {
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
    
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
    
    (apiClient.get as jest.Mock).mockClear();
    mockPush.mockClear();
  });

  it('renders search results page correctly', async () => {
    mockSearchParams.set('search', 'test');
    
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('/products/suggestions')) {
        return Promise.resolve({ success: true, corrections: [] });
      }
      return Promise.resolve({
        products: [],
        pagination: { total: 0 }
      });
    });
    
    render(<SearchPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Search Results')).toBeInTheDocument();
      expect(screen.getByText('Found 0 results for "test"')).toBeInTheDocument();
    });
  });

  it('displays "Did you mean?" suggestions when there are no results', async () => {
    mockSearchParams.set('search', 'tesst');
    
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('/products/suggestions')) {
        return Promise.resolve({
          success: true,
          corrections: [
            { original: 'tesst', suggested: 'test', confidence: 0.8 }
          ]
        });
      }
      return Promise.resolve({
        products: [],
        pagination: { total: 0 }
      });
    });
    
    render(<SearchPage />);
    
    await waitFor(() => {
      expect(screen.getByText(/Did you mean:/)).toBeInTheDocument();
      expect(screen.getByText('test')).toBeInTheDocument();
    });
  });

  it('does not display "Did you mean?" when there are results', async () => {
    mockSearchParams.set('search', 'test');
    
    // Mock apiClient.get implementation to handle multiple calls
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('/products/suggestions')) {
        return Promise.resolve({ success: true, corrections: [] });
      }
      return Promise.resolve({
        products: [{ _id: '1', name: 'Test Product', price: 100, originalPrice: 100, images: [] }],
        pagination: { total: 1 }
      });
    });
    
    render(<SearchPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Showing 1 product of 1')).toBeInTheDocument();
    });
    
    // "Did you mean?" should not be present
    expect(screen.queryByText('Did you mean:')).not.toBeInTheDocument();
  });
});