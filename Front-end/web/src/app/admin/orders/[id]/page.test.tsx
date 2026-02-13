import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminOrderDetailPage from './page';
import apiClient from '@/lib/api';
import { useRouter, useParams } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  MapPin: () => <span data-testid="icon-map-pin">MapPin</span>,
  CreditCard: () => <span data-testid="icon-credit-card">CreditCard</span>,
  Truck: () => <span data-testid="icon-truck">Truck</span>,
}));

describe('AdminOrderDetailPage', () => {
  const mockRouter = {
    back: jest.fn(),
    push: jest.fn(),
  };

  const mockOrder = {
    _id: 'order123',
    orderNumber: 'ORD-001',
    createdAt: '2023-01-01T12:00:00Z',
    status: 'pending',
    items: [
      {
        product: {
          _id: 'p1',
          name: 'Test Product',
          images: [{ url: 'http://img.com/p1.jpg' }],
        },
        quantity: 2,
        price: 100,
      }
    ],
    shippingAddress: {
      fullName: 'John Doe',
      phone: '1234567890',
      addressLine1: '123 Main St',
      city: 'City',
      state: 'State',
      postalCode: '12345',
      country: 'Country',
    },
    subtotal: 200,
    shippingCost: 50,
    tax: 20,
    discount: 0,
    totalAmount: 270,
    user: {
      _id: 'u1',
      name: 'User Name',
      email: 'user@example.com',
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useParams as jest.Mock).mockReturnValue({ id: 'order123' });
    (apiClient.get as jest.Mock).mockResolvedValue({ order: mockOrder });
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    render(<AdminOrderDetailPage />);
    expect(apiClient.get).toHaveBeenCalledWith('/orders/order123');
    // Assuming loading skeleton has no text but we can wait for data to appear
    await waitFor(() => {
        expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });
  });

  it('renders order details correctly', async () => {
    render(<AdminOrderDetailPage />);
    
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Test Product')).toBeInTheDocument();
      expect(screen.getByText('User Name')).toBeInTheDocument();
      expect(screen.getByText('₹270.00')).toBeInTheDocument();
    });
  });

  it('handles status update', async () => {
    render(<AdminOrderDetailPage />);
    
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'shipped' } });

    expect(window.confirm).toHaveBeenCalled();
    
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith('/orders/order123/status', {
        status: 'shipped',
        reason: 'admin_update'
      });
    });
    
    expect(window.alert).toHaveBeenCalledWith('Order status updated successfully');
  });

  it('handles status update cancellation', async () => {
    window.confirm = jest.fn().mockReturnValue(false);
    render(<AdminOrderDetailPage />);
    
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'shipped' } });

    expect(window.confirm).toHaveBeenCalled();
    expect(apiClient.put).not.toHaveBeenCalled();
  });
  
  it('handles fetch error', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('Fetch failed'));
    render(<AdminOrderDetailPage />);
    
    await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith('Failed to load order details');
        expect(mockRouter.push).toHaveBeenCalledWith('/admin/orders');
    });
  });
});
