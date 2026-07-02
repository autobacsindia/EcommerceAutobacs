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

// Mock CurrencyContext
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: jest.fn(() => ({
    formatPrice: (price: number) => `₹${price.toLocaleString()}`,
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
      expect(screen.getByText(/Results for/i)).toBeInTheDocument();
      expect(screen.getByText(/Found 0 results/i)).toBeInTheDocument();
    });
  });

  it('displays "Did you mean?" suggestions when there are no results', async () => {
    mockSearchParams.set('search', 'tesst');
    
    // Mock for suggestions endpoint (server component call)
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
    
    // Wait for text to appear (adjust expectation based on actual UI)
    await waitFor(() => {
      // Look for the container or the specific text node
      const didYouMean = screen.getByText(/Did you mean:/i);
      expect(didYouMean).toBeInTheDocument();
      
      const suggestedTerm = screen.getByText('test', { selector: 'button' });
      expect(suggestedTerm).toBeInTheDocument();
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
        total: 1,
        hasNext: false
      });
    });

    render(<SearchPage />);

    await waitFor(() => {
      expect(screen.getByText(/Showing 1 result/)).toBeInTheDocument();
    });
    
    // "Did you mean?" should not be present
    expect(screen.queryByText('Did you mean:')).not.toBeInTheDocument();
  });
});