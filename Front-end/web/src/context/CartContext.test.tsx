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

// Ad-platform trackers. add_to_cart is reported from this context (once, for
// every add path in the app), so this is where that contract is pinned down.
const mockMetaAddToCart = jest.fn();
const mockGoogleAddToCart = jest.fn();
jest.mock('@/lib/metaPixel', () => ({
  trackAddToCart: (...args: unknown[]) => mockMetaAddToCart(...args),
}));
jest.mock('@/lib/googleAdsEvents', () => ({
  trackGoogleAddToCart: (...args: unknown[]) => mockGoogleAddToCart(...args),
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
      {/* checkout's begin_checkout reads these ids straight off the cart */}
      <div data-testid="content-ids">
        {(cart?.items ?? []).map((i) => i.metaContentId ?? 'none').join(',')}
      </div>
      <button onClick={() => addToCart('prod1', 1).catch(() => {})}>Add Item</button>
      <button onClick={() => addToCart('prod1', 2).catch(() => {})}>Add Two</button>
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
          stock: 'in'
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
      expect(apiClient.get).toHaveBeenCalledWith(
        API_ENDPOINTS.CART,
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    expect(screen.getByTestId('item-count')).toHaveTextContent('1');
  });

  it('should fetch cart even when not authenticated (guest cart support)', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    // Backend returns no cart for unauthenticated guest — frontend stays empty
    (apiClient.get as jest.Mock).mockResolvedValue({ success: false });

    render(
      <CartProvider>
        <TestComponent />
      </CartProvider>
    );

    // Cart is always fetched — backend resolves auth vs guest via cookie/x-session-id
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        API_ENDPOINTS.CART,
        expect.objectContaining({ signal: expect.anything() })
      );
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

  /**
   * These cover the failure that made Google Ads and Meta report almost no
   * add_to_cart despite a working cart: the id they need is computed by the
   * backend per cart line, and the client used to drop it on the floor while
   * mapping the response — so every downstream event had nothing to match
   * against a catalogue offer.
   */
  describe('ad-platform add_to_cart', () => {
    /** Server cart shaped like cartSerializer's output (catalogue id per line). */
    const cartWithContentId = (metaContentId: string | null, quantity = 1, price = 100) => ({
      _id: 'cart123',
      items: [
        {
          product: { _id: 'prod1', name: 'Test Product', price, images: ['img.jpg'], stock: 'in' },
          quantity,
          price,
          metaContentId,
        },
      ],
      totalPrice: price * quantity,
    });

    const addItem = async (label: 'Add Item' | 'Add Two' = 'Add Item') => {
      render(
        <CartProvider>
          <TestComponent />
        </CartProvider>
      );
      await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
      await act(async () => {
        screen.getByText(label).click();
      });
    };

    it('reports the SERVER catalogue id, not our internal product id', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        cart: cartWithContentId('11466'),
      });

      await addItem();

      expect(mockGoogleAddToCart).toHaveBeenCalledWith('11466', 100, 1);
      expect(mockMetaAddToCart).toHaveBeenCalledWith('11466', 100, 1);
      // 'prod1' is the Mongo _id — it matches no catalogue offer anywhere.
      expect(mockGoogleAddToCart).not.toHaveBeenCalledWith('prod1', expect.anything(), expect.anything());
    });

    it('values a multi-quantity add at unit price × quantity ADDED, not the line total', async () => {
      // The shopper adds 2; the line now holds 5 because 3 were already there.
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        cart: cartWithContentId('11466', 5, 100),
      });

      await addItem('Add Two');

      // 2 × ₹100 — reporting the ₹500 line total would inflate every repeat add.
      expect(mockGoogleAddToCart).toHaveBeenCalledWith('11466', 200, 2);
      expect(mockMetaAddToCart).toHaveBeenCalledWith('11466', 200, 2);
    });

    it('skips tracking when the line has no catalogue id', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        cart: cartWithContentId(null),
      });

      await addItem();

      expect(mockGoogleAddToCart).not.toHaveBeenCalled();
      expect(mockMetaAddToCart).not.toHaveBeenCalled();
    });

    it('does not fire when the add fails — no phantom signal', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (apiClient.post as jest.Mock).mockRejectedValue(new Error('out of stock'));

      await addItem();

      expect(mockGoogleAddToCart).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('keeps metaContentId on cart lines so begin_checkout can report products', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        success: true,
        cart: cartWithContentId('11466'),
      });

      render(
        <CartProvider>
          <TestComponent />
        </CartProvider>
      );

      await waitFor(() => expect(screen.getByTestId('content-ids')).toHaveTextContent('11466'));
    });
  });
});
