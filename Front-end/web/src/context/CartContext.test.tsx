import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CartProvider, useCart } from './CartContext';
import apiClient from '@/lib/api';
import { useAuth } from './AuthContext';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
}));

jest.mock('./AuthContext', () => ({
  useAuth: jest.fn(),
}));

const mockUseAuth = useAuth as jest.Mock;

// Test component to consume context
const TestComponent = () => {
  const { cart, itemCount, addToCart, removeFromCart, updateQuantity, clearCart, refreshCart, error } = useCart();
  
  return (
    <div>
      <div data-testid="item-count">{itemCount}</div>
      <div data-testid="cart-total">{cart?.total || 0}</div>
      <div data-testid="error-message">{error}</div>
      <button onClick={() => addToCart('prod1', 1).catch(() => {})}>Add Item</button>
      <button onClick={() => removeFromCart('prod1')}>Remove Item</button>
      <button onClick={() => updateQuantity('prod1', 2)}>Update Quantity</button>
      <button onClick={() => clearCart()}>Clear Cart</button>
      <button onClick={() => refreshCart()}>Refresh Cart</button>
    </div>
  );
};

describe('CartContext', () => {
  const mockCartData = {
    _id: 'cart123',
    items: [
      {
        product: {
          _id: 'prod1',
          name: 'Test Product',
          price: 100,
          images: ['img.jpg'],
          stock: 10
        },
        quantity: 1
      }
    ],
    totalPrice: 100
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementation
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      cart: mockCartData
    });

    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true,
      cart: {
        ...mockCartData,
        items: [...mockCartData.items, { ...mockCartData.items[0], quantity: 1 }],
        totalPrice: 200
      }
    });
  });

  it('should fetch cart on mount if authenticated', async () => {
    render(
      <CartProvider>
        <TestComponent />
      </CartProvider>
    );

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(API_ENDPOINTS.CART);
    });

    expect(screen.getByTestId('item-count')).toHaveTextContent('1');
  });

  it('should not fetch cart if not authenticated', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(
      <CartProvider>
        <TestComponent />
      </CartProvider>
    );

    await waitFor(() => {
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    expect(screen.getByTestId('item-count')).toHaveTextContent('0');
  });

  it('should add item to cart', async () => {
    render(
      <CartProvider>
        <TestComponent />
      </CartProvider>
    );

    // Initial fetch
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    // Click add button
    const addButton = screen.getByText('Add Item');
    await act(async () => {
      addButton.click();
    });

    expect(apiClient.post).toHaveBeenCalledWith(API_ENDPOINTS.CART_ADD, {
      productId: 'prod1',
      quantity: 1
    });
  });

  it('should handle add to cart error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (apiClient.post as jest.Mock).mockRejectedValue(new Error('Failed to add'));

    render(
      <CartProvider>
        <TestComponent />
      </CartProvider>
    );

    // Initial fetch
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    const addButton = screen.getByText('Add Item');
    
    await act(async () => {
      addButton.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Failed to add');
    });

    consoleSpy.mockRestore();
  });
});
