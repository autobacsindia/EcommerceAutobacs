import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { WishlistProvider, useWishlist } from './WishlistContext';
import apiClient from '@/lib/api';
import { useAuth } from './AuthContext';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));

jest.mock('./AuthContext', () => ({
  useAuth: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;

const TestComponent = () => {
  const { wishlistItems, wishlistCount, addToWishlist, removeFromWishlist, isInWishlist } = useWishlist();
  
  return (
    <div>
      <div data-testid="wishlist-count">{wishlistCount}</div>
      <div data-testid="in-wishlist">{isInWishlist('507f1f77bcf86cd799439011') ? 'Yes' : 'No'}</div>
      <button onClick={() => addToWishlist('507f1f77bcf86cd799439012')}>Add</button>
      <button onClick={() => removeFromWishlist('507f1f77bcf86cd799439011')}>Remove</button>
    </div>
  );
};

describe('WishlistContext', () => {
  const mockWishlist = {
    _id: 'wl123',
    items: [
      { product: '507f1f77bcf86cd799439011', addedAt: '2023-01-01' }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true
    });
    
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      wishlists: [mockWishlist]
    });
  });

  it('should fetch wishlist on mount', async () => {
    render(
      <WishlistProvider>
        <TestComponent />
      </WishlistProvider>
    );

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(API_ENDPOINTS.WISHLIST);
    });

    expect(screen.getByTestId('wishlist-count')).toHaveTextContent('1');
    expect(screen.getByTestId('in-wishlist')).toHaveTextContent('Yes');
  });

  it('should add item to wishlist', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true,
      wishlist: {
        ...mockWishlist,
        items: [...mockWishlist.items, { product: '507f1f77bcf86cd799439012', addedAt: '2023-01-02' }]
      }
    });

    render(
      <WishlistProvider>
        <TestComponent />
      </WishlistProvider>
    );

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    const addButton = screen.getByText('Add');
    await act(async () => {
      // Use valid ObjectId
      addButton.click();
    });

    expect(apiClient.post).toHaveBeenCalled();
  });

  it('should handle unauthenticated state', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false
    });

    render(
      <WishlistProvider>
        <TestComponent />
      </WishlistProvider>
    );

    await waitFor(() => {
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    expect(screen.getByTestId('wishlist-count')).toHaveTextContent('0');
  });
});
