import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CartPage from './page';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from 'react-hot-toast';

// Mock mocks
jest.mock('@/context/CartContext');
jest.mock('@/contexts/CurrencyContext');
jest.mock('react-hot-toast');
jest.mock('next/link', () => {
  return ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  );
});
jest.mock('@/components/layout/EnhancedImage', () => {
  return ({ alt, className }: { alt: string; className?: string }) => (
    <img alt={alt} className={className} data-testid="enhanced-image" />
  );
});
jest.mock('@/components/layout/SkeletonLoader', () => {
  return ({ type }: { type: string }) => <div data-testid={`skeleton-${type}`}>Loading...</div>;
});

// Mock icons
jest.mock('lucide-react', () => ({
  Trash2: () => <span data-testid="trash-icon">Trash</span>,
  Plus: () => <span data-testid="plus-icon">+</span>,
  Minus: () => <span data-testid="minus-icon">-</span>,
  ShoppingBag: () => <span data-testid="bag-icon">Bag</span>,
  ArrowRight: () => <span data-testid="arrow-icon">Arrow</span>,
}));

describe('CartPage', () => {
  const mockRemoveFromCart = jest.fn();
  const mockUpdateQuantity = jest.fn();
  const mockClearCart = jest.fn();
  const mockFormatPrice = jest.fn((price) => `$${price}`);

  const mockCartItem = {
    product: {
      _id: 'p1',
      name: 'Test Product',
      price: 100,
      stock: 10,
      images: [{ url: 'test-image.jpg' }],
    },
    quantity: 2,
  };

  const mockCart = {
    items: [mockCartItem],
    total: 200,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useCart as jest.Mock).mockReturnValue({
      cart: mockCart,
      isLoading: false,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
      clearCart: mockClearCart,
    });
    (useCurrency as jest.Mock).mockReturnValue({
      formatPrice: mockFormatPrice,
    });
    // Mock window.confirm
    window.confirm = jest.fn(() => true);
  });

  it('renders loading state correctly', () => {
    (useCart as jest.Mock).mockReturnValue({
      cart: null,
      isLoading: true,
    });

    render(<CartPage />);
    expect(screen.getByTestId('skeleton-cart-page')).toBeInTheDocument();
  });

  it('renders empty cart state correctly', () => {
    (useCart as jest.Mock).mockReturnValue({
      cart: { items: [] },
      isLoading: false,
    });

    render(<CartPage />);
    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByText('Browse Products')).toBeInTheDocument();
  });

  it('renders cart items correctly', () => {
    render(<CartPage />);
    expect(screen.getByText('Shopping Cart')).toBeInTheDocument();
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('$100 each')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Quantity
    const prices = screen.getAllByText('$200'); // Item total and subtotal
    expect(prices.length).toBeGreaterThan(0);
    expect(prices[0]).toBeInTheDocument();
  });

  it('handles quantity increase', async () => {
    render(<CartPage />);
    const plusButton = screen.getByTestId('plus-icon').closest('button');
    fireEvent.click(plusButton!);

    await waitFor(() => {
      expect(mockUpdateQuantity).toHaveBeenCalledWith('p1', 3);
    });
  });

  it('handles quantity decrease', async () => {
    render(<CartPage />);
    const minusButton = screen.getByTestId('minus-icon').closest('button');
    fireEvent.click(minusButton!);

    await waitFor(() => {
      expect(mockUpdateQuantity).toHaveBeenCalledWith('p1', 1);
    });
  });

  it('handles item removal', async () => {
    render(<CartPage />);
    const removeButton = screen.getByTestId('trash-icon').closest('button');
    fireEvent.click(removeButton!);

    expect(window.confirm).toHaveBeenCalledWith('Remove this item from cart?');
    await waitFor(() => {
      expect(mockRemoveFromCart).toHaveBeenCalledWith('p1');
      expect(toast.success).toHaveBeenCalledWith('Item removed from cart');
    });
  });

  it('handles clear cart', async () => {
    render(<CartPage />);
    const clearButton = screen.getByText('Clear Cart');
    fireEvent.click(clearButton);

    expect(window.confirm).toHaveBeenCalledWith('Clear all items from cart?');
    await waitFor(() => {
      expect(mockClearCart).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Cart cleared');
    });
  });

  it('calculates order summary correctly', () => {
    render(<CartPage />);
    expect(screen.getByText('Order Summary')).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    
    const prices = screen.getAllByText('$200'); // Item total and Subtotal
    expect(prices.length).toBeGreaterThanOrEqual(2);
    
    expect(screen.getByText('FREE')).toBeInTheDocument(); // Shipping
    expect(screen.getByText('$36')).toBeInTheDocument(); // Tax (200 * 0.18)
    expect(screen.getByText('$236')).toBeInTheDocument(); // Total (200 * 1.18)
  });

  it('displays stock warning when max quantity reached', () => {
    const fullStockItem = { ...mockCartItem, quantity: 10 };
    (useCart as jest.Mock).mockReturnValue({
      cart: { items: [fullStockItem], total: 1000 },
      isLoading: false,
      removeFromCart: mockRemoveFromCart,
      updateQuantity: mockUpdateQuantity,
      clearCart: mockClearCart,
    });

    render(<CartPage />);
    expect(screen.getByText('Maximum available: 10')).toBeInTheDocument();
    const plusButton = screen.getByTestId('plus-icon').closest('button');
    expect(plusButton).toBeDisabled();
  });
});
