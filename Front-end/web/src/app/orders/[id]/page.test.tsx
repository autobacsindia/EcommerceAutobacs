import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrderDetailPage from './page';
import { useAuth } from '@/context/AuthContext';
import orderService from '@/lib/services/orderService';
import { useRazorpay } from '@/hooks/useRazorpay';
import { useCart } from '@/context/CartContext';
import { useRouter, useParams } from 'next/navigation';

// Mock dependencies
jest.mock('@/context/AuthContext');
jest.mock('@/context/CartContext');
jest.mock('@/lib/services/orderService');
jest.mock('@/hooks/useRazorpay');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(),
}));
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});
jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock child components
jest.mock('@/components/orders/CancelOrderModal', () => () => <div data-testid="cancel-modal" />);
jest.mock('@/components/orders/ReturnRequestModal', () => () => <div data-testid="return-modal" />);
jest.mock('@/components/reviews/WriteReviewModal', () => () => <div data-testid="review-modal" />);
jest.mock('@/components/tracking/TimelineProgress', () => ({ TimelineProgress: () => <div data-testid="timeline" /> }));
jest.mock('@/components/skeletons/OrderDetailSkeleton', () => () => <div data-testid="skeleton" />);

// Mock icons
jest.mock('lucide-react', () => {
  const IconMock = () => <span />;
  return {
    ArrowLeft: IconMock,
    MapPin: IconMock,
    CreditCard: IconMock,
    Package: IconMock,
    Truck: IconMock,
    CheckCircle: IconMock,
    XCircle: IconMock,
    Clock: IconMock,
    AlertCircle: IconMock,
    Download: IconMock,
    RotateCcw: IconMock,
    X: IconMock,
    Trash2: IconMock,
    RefreshCcw: IconMock,
    ShoppingCart: IconMock,
    Star: IconMock,
    HelpCircle: IconMock,
    ChevronDown: IconMock,
    Search: IconMock,
    Filter: IconMock,
    Eye: IconMock,
    AlertTriangle: IconMock,
    MessageSquare: IconMock,
  };
});

describe('OrderDetailPage', () => {
  const mockUser = {
    _id: 'u1',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'user',
  };

  const mockOrder = {
    _id: '12345678',
    orderNumber: 'ORD-001',
    status: 'delivered',
    totalAmount: 150,
    subtotal: 140,
    shippingCost: 10,
    tax: 0,
    discount: 0,
    createdAt: '2023-01-01T00:00:00Z',
    shippingAddress: {
      fullName: 'John Doe',
      phone: '1234567890',
      addressLine1: '123 Main St',
      city: 'City',
      state: 'State',
      postalCode: '12345',
      country: 'Country',
    },
    items: [
      {
        _id: 'item1',
        product: { _id: 'p1', name: 'Product 1', price: 150, images: [{ url: 'img.jpg' }] },
        quantity: 1,
        price: 150,
        name: 'Product 1',
        image: 'img.jpg',
      },
    ],
    payment: {
        paymentMethod: 'razorpay',
        status: 'completed'
    }
  };

  const mockProcessPayment = jest.fn();
  const mockAddToCart = jest.fn();
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: mockUser,
    });
    (useCart as jest.Mock).mockReturnValue({
      addToCart: mockAddToCart,
    });
    (useRazorpay as jest.Mock).mockReturnValue({
      processPayment: mockProcessPayment,
      isProcessing: false,
    });
    (orderService.getOrderById as jest.Mock).mockResolvedValue(mockOrder);
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
    (useParams as jest.Mock).mockReturnValue({ id: '12345678' });
    // Mock window.confirm
    window.confirm = jest.fn().mockReturnValue(true);
  });

  it('renders order details', async () => {
    render(<OrderDetailPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Order #12345678')).toBeInTheDocument();
      // Use text match for status since it might be capitalized or in a badge
      expect(screen.getByText((content) => content.toLowerCase().includes('delivered'))).toBeInTheDocument();
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });
  });

  it('handles buy again', async () => {
    render(<OrderDetailPage />);
    
    await waitFor(() => screen.getByText('Order #12345678'));
    
    const buyAgainButton = screen.getByText('Buy Again');
    fireEvent.click(buyAgainButton);
    
    await waitFor(() => {
      expect(mockAddToCart).toHaveBeenCalledWith('p1', 1);
    });
  });

  it('handles delete order', async () => {
    (orderService.getOrderById as jest.Mock).mockResolvedValue({
      ...mockOrder,
      status: 'cancelled',
    });
    (orderService.deleteOrder as jest.Mock).mockResolvedValue({ success: true });
    
    render(<OrderDetailPage />);
    
    await waitFor(() => screen.getByText('Order #12345678'));
    
    const deleteButton = screen.getByText('Delete Order');
    fireEvent.click(deleteButton);
    
    expect(window.confirm).toHaveBeenCalled();
    
    await waitFor(() => {
      expect(orderService.deleteOrder).toHaveBeenCalledWith('12345678');
      expect(mockPush).toHaveBeenCalledWith('/orders');
    });
  });
});
