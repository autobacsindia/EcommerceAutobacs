import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CartPage from './page';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'react-hot-toast';

// Mock Hooks
jest.mock('@/context/CartContext', () => ({
  useCart: jest.fn(),
}));

jest.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: jest.fn(),
}));

jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock('@/components/layout/SkeletonLoader', () => ({
  __esModule: true,
  default: () => <div data-testid="skeleton-loader">Loading...</div>,
}));

jest.mock('@/components/layout/EnhancedImage', () => ({
  __esModule: true,
  default: ({ src, alt }: any) => <img src={src} alt={alt} />,
}));

// Mock window.confirm
global.confirm = jest.fn();

describe('CartPage Component', () => {
  const mockUpdateQuantity = jest.fn();
  const mockRemoveFromCart = jest.fn();
  const mockClearCart = jest.fn();
  const mockFormatPrice = jest.fn((price) => `$${price}`);

  beforeEach(() => {
    jest.clearAllMocks();
    (useCurrency as jest.Mock).mockReturnValue({ formatPrice: mockFormatPrice });
  });

  it('renders loading skeleton when loading', () => {
    (useCart as jest.Mock).mockReturnValue({
      cart: null,
      isLoading: true,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
      clearCart: mockClearCart,
    });

    render(<CartPage />);
    expect(screen.getByTestId('skeleton-loader')).toBeInTheDocument();
  });

  it('renders empty cart state', () => {
    (useCart as jest.Mock).mockReturnValue({
      cart: { items: [] },
      isLoading: false,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
      clearCart: mockClearCart,
    });

    render(<CartPage />);
    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByText('Add some products to get started!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse Products/i })).toHaveAttribute('href', '/products');
  });

  it('renders cart items', () => {
    const mockCart = {
      items: [
        {
          product: {
            _id: 'p1',
            name: 'Test Product',
            price: 100,
            images: ['test.jpg'],
            slug: 'test-product',
            stock: 10
          },
          quantity: 2,
        },
      ],
      total: 200,
    };

    (useCart as jest.Mock).mockReturnValue({
      cart: mockCart,
      isLoading: false,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
      clearCart: mockClearCart,
    });

    render(<CartPage />);
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('$100 each')).toBeInTheDocument();
    
    // Check for $200 (Item total and Subtotal)
    const prices = screen.getAllByText('$200');
    expect(prices.length).toBeGreaterThanOrEqual(1);
    
    // Check quantity display
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('handles item removal', async () => {
    const mockCart = {
        items: [
          {
            product: { _id: 'p1', name: 'Test Product', price: 100, images: [] },
            quantity: 1,
          },
        ],
      };
  
      (useCart as jest.Mock).mockReturnValue({
        cart: mockCart,
        isLoading: false,
        removeFromCart: mockRemoveFromCart,
        updateQuantity: mockUpdateQuantity,
        clearCart: mockClearCart,
      });

      (global.confirm as jest.Mock).mockReturnValue(true);
  
      render(<CartPage />);
      
      const removeBtn = screen.getByRole('button', { name: /Remove item/i });
      fireEvent.click(removeBtn);

      expect(global.confirm).toHaveBeenCalledWith('Remove this item from cart?');
      await waitFor(() => {
          expect(mockRemoveFromCart).toHaveBeenCalledWith('p1');
          expect(toast.success).toHaveBeenCalledWith('Item removed from cart');
      });
  });

  it('handles quantity update (increase)', async () => {
    const mockCart = {
        items: [
          {
            product: { _id: 'p1', name: 'Test Product', price: 100, images: [], stock: 5 },
            quantity: 1,
          },
        ],
      };
  
      (useCart as jest.Mock).mockReturnValue({
        cart: mockCart,
        isLoading: false,
        removeFromCart: mockRemoveFromCart,
        updateQuantity: mockUpdateQuantity,
        clearCart: mockClearCart,
      });
  
      render(<CartPage />);
      
      const increaseBtn = screen.getByRole('button', { name: /Increase quantity/i });
      fireEvent.click(increaseBtn);

      await waitFor(() => {
          expect(mockUpdateQuantity).toHaveBeenCalledWith('p1', 2);
      });
  });

  it('handles quantity update (decrease)', async () => {
    const mockCart = {
        items: [
          {
            product: { _id: 'p1', name: 'Test Product', price: 100, images: [], stock: 5 },
            quantity: 2,
          },
        ],
      };
  
      (useCart as jest.Mock).mockReturnValue({
        cart: mockCart,
        isLoading: false,
        removeFromCart: mockRemoveFromCart,
        updateQuantity: mockUpdateQuantity,
        clearCart: mockClearCart,
      });
  
      render(<CartPage />);
      
      const decreaseBtn = screen.getByRole('button', { name: /Decrease quantity/i });
      fireEvent.click(decreaseBtn);

      await waitFor(() => {
          expect(mockUpdateQuantity).toHaveBeenCalledWith('p1', 1);
      });
  });

  it('handles clear cart', async () => {
    const mockCart = {
        items: [
          {
            product: { _id: 'p1', name: 'Test Product', price: 100, images: [] },
            quantity: 1,
          },
        ],
      };
  
      (useCart as jest.Mock).mockReturnValue({
        cart: mockCart,
        isLoading: false,
        removeFromCart: mockRemoveFromCart,
        updateQuantity: mockUpdateQuantity,
        clearCart: mockClearCart,
      });

      (global.confirm as jest.Mock).mockReturnValue(true);
  
      render(<CartPage />);
      
      const clearBtn = screen.getByRole('button', { name: /Clear Cart/i });
      fireEvent.click(clearBtn);

      expect(global.confirm).toHaveBeenCalledWith('Clear all items from cart?');
      await waitFor(() => {
          expect(mockClearCart).toHaveBeenCalled();
          expect(toast.success).toHaveBeenCalledWith('Cart cleared');
      });
  });
});
