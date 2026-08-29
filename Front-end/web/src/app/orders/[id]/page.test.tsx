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
  // useRequireAuth reads the pathname to build the /login?redirect= destination.
  usePathname: () => '/orders/order123',
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
jest.mock('@/components/orders/OrderParcels', () => () => <div data-testid="parcels" />);

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
      expect(screen.getByText('#12345678')).toBeInTheDocument();
      // Use text match for status since it might be capitalized or in a badge
      expect(screen.getByText((content) => content.toLowerCase().includes('delivered'))).toBeInTheDocument();
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });
  });

  it('handles buy again', async () => {
    render(<OrderDetailPage />);
    
    await waitFor(() => screen.getByText('#12345678'));
    
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
    
    await waitFor(() => screen.getByText('#12345678'));
    
    const deleteButton = screen.getByText('Delete Order');
    fireEvent.click(deleteButton);
    
    expect(window.confirm).toHaveBeenCalled();
    
    await waitFor(() => {
      expect(orderService.deleteOrder).toHaveBeenCalledWith('12345678');
      expect(mockPush).toHaveBeenCalledWith('/orders');
    });
  });

  /**
   * Split orders — per-item fulfilment, and the Review button that was gated on the
   * WRONG thing.
   *
   * A split order sits at `shipped` until its LAST parcel lands. The Review button used
   * to read `order.status`, so an item delivered two weeks ago stayed un-reviewable
   * until an unrelated box turned up. This is the same mistake the return window
   * already fixed one screen-full earlier; these cases stop it coming back.
   */
  describe('split shipments', () => {
    const splitOrder = {
      ...mockOrder,
      // Deliberately NOT 'delivered': this is the state the old gating got wrong.
      status: 'shipped',
      trackingNumber: 'AWB-PARCEL-1',
      carrier: { name: 'Bluedart', trackingUrl: 'https://track/1' },
      deliveredAt: '2023-02-01T00:00:00Z',
      items: [
        { ...mockOrder.items[0], _id: 'item1', name: 'Arrived Item',
          product: { _id: 'p1', name: 'Arrived Item', price: 100, images: [{ url: 'a.jpg' }] } },
        { ...mockOrder.items[0], _id: 'item2', name: 'Still Coming',
          product: { _id: 'p2', name: 'Still Coming', price: 50, images: [{ url: 'b.jpg' }] } },
      ],
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: new Date().toISOString(),
          lines: [{ itemId: 'item1', quantity: 1 }] },
        { _id: 's2', status: 'shipped', lines: [{ itemId: 'item2', quantity: 1 }] },
      ],
    };

    // THE REGRESSION. Before the fix this found zero Review buttons.
    it('offers Review for the item that arrived, on an order still marked shipped', async () => {
      (orderService.getOrderById as jest.Mock).mockResolvedValue(splitOrder);
      render(<OrderDetailPage />);
      await waitFor(() => screen.getByText('Arrived Item'));

      expect(screen.getAllByText('Review')).toHaveLength(1);
    });

    it('does not offer Review for the item still in transit', async () => {
      (orderService.getOrderById as jest.Mock).mockResolvedValue(splitOrder);
      render(<OrderDetailPage />);
      await waitFor(() => screen.getByText('Still Coming'));

      // One Review button total, and it is not the second row's.
      const rows = screen.getAllByText('Review');
      expect(rows).toHaveLength(1);
      expect(screen.getByText('On its way')).toBeInTheDocument();
    });

    it('states where each line has got to', async () => {
      (orderService.getOrderById as jest.Mock).mockResolvedValue(splitOrder);
      render(<OrderDetailPage />);
      await waitFor(() => screen.getByText('Arrived Item'));

      expect(screen.getByText(/^Delivered /)).toBeInTheDocument();
      expect(screen.getByText('On its way')).toBeInTheDocument();
    });

    /*
      The order-level tracking fields mirror PARCEL 1 ONLY. Showing them on a split
      order puts one AWB and one delivery date under "Tracking Information" directly
      above a Parcels panel listing two different ones.
    */
    it('suppresses the order-level tracking card once there are two parcels', async () => {
      (orderService.getOrderById as jest.Mock).mockResolvedValue(splitOrder);
      render(<OrderDetailPage />);
      await waitFor(() => screen.getByText('Arrived Item'));

      expect(screen.queryByText('Tracking Information')).not.toBeInTheDocument();
      expect(screen.queryByText('AWB-PARCEL-1')).not.toBeInTheDocument();
      expect(screen.queryByText('Track Package')).not.toBeInTheDocument();
    });

    // A single parcel has no ambiguity, so nothing about that order changes.
    it('keeps the tracking card for a single-parcel order', async () => {
      (orderService.getOrderById as jest.Mock).mockResolvedValue({
        ...splitOrder,
        shipments: [{ _id: 's1', status: 'shipped', lines: [{ itemId: 'item1', quantity: 1 }] }],
      });
      render(<OrderDetailPage />);
      await waitFor(() => screen.getByText('Arrived Item'));

      expect(screen.getByText('Tracking Information')).toBeInTheDocument();
      expect(screen.getByText('AWB-PARCEL-1')).toBeInTheDocument();
    });

    /*
      Every order placed before split shipments existed carries no parcels. They must
      render exactly as they always did: order-level tracking, and Review driven by the
      order status — with no per-item chip, which would be invented state.
    */
    it('leaves a legacy parcel-less order completely unchanged', async () => {
      (orderService.getOrderById as jest.Mock).mockResolvedValue({
        ...splitOrder,
        status: 'delivered',
        shipments: [],
      });
      render(<OrderDetailPage />);
      await waitFor(() => screen.getByText('Arrived Item'));

      expect(screen.getByText('Tracking Information')).toBeInTheDocument();
      expect(screen.getAllByText('Review')).toHaveLength(2);
      expect(screen.queryByText('On its way')).not.toBeInTheDocument();
      expect(screen.queryByText('Not shipped yet')).not.toBeInTheDocument();
    });

    // A lost parcel's units go back to the to-ship pool — the customer is waiting again.
    it('shows a line whose only parcel was lost as not shipped', async () => {
      (orderService.getOrderById as jest.Mock).mockResolvedValue({
        ...splitOrder,
        shipments: [
          { _id: 's1', status: 'delivered', deliveredAt: new Date().toISOString(),
            lines: [{ itemId: 'item1', quantity: 1 }] },
          { _id: 's2', status: 'lost', lines: [{ itemId: 'item2', quantity: 1 }] },
        ],
      });
      render(<OrderDetailPage />);
      await waitFor(() => screen.getByText('Still Coming'));

      expect(screen.getByText('Not shipped yet')).toBeInTheDocument();
      expect(screen.getAllByText('Review')).toHaveLength(1);
    });
  });
});
