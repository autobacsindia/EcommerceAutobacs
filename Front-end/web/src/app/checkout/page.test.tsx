import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import CheckoutPage from './page';
import apiClient from '@/lib/api';
import { toast } from 'react-hot-toast';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
  })),
}));

jest.mock('react-hot-toast', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock hooks
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { name: 'Test User', email: 'test@example.com' },
    isLoading: false,
  }),
}));

const mockClearCart = jest.fn();
jest.mock('@/context/CartContext', () => ({
  useCart: () => ({
    cart: {
      items: [
        {
          product: {
            _id: 'p1',
            name: 'Test Item',
            price: 100,
            images: [{ url: 'test.jpg' }],
          },
          quantity: 1,
        },
      ],
      total: 100,
    },
    clearCart: mockClearCart,
  }),
}));

// Mock useRazorpay to capture callbacks
let mockRazorpayCallbacks: any = {};
const mockProcessPayment = jest.fn();

jest.mock('@/hooks/useRazorpay', () => ({
  useRazorpay: (callbacks: any) => {
    mockRazorpayCallbacks = callbacks;
    return {
      processPayment: mockProcessPayment,
      isProcessing: false,
    };
  },
}));

// Mock child components
jest.mock('@/components/checkout/PaymentMethodSelector', () => {
  return function MockPaymentMethodSelector({ selectedMethod, onSelect }: any) {
    return (
      <div data-testid="payment-method-selector">
        <button onClick={() => onSelect('razorpay')}>Select Razorpay</button>
        <button onClick={() => onSelect('cod')}>Select COD</button>
        <span data-testid="selected-method">{selectedMethod}</span>
      </div>
    );
  };
});

describe('CheckoutPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRazorpayCallbacks = {};
    
    // Default mock for profile fetch (no saved addresses)
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      user: {
        addresses: [],
      },
    });
  });

  it('renders checkout page with cart summary', async () => {
    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByText('Review Your Cart')).toBeInTheDocument();
      expect(screen.getByText('Test Item')).toBeInTheDocument();
      expect(screen.getAllByText(/100.00/).length).toBeGreaterThan(0); 
    });
  });

  it('shows address form when no saved addresses exist', async () => {
    render(<CheckoutPage />);

    const proceedBtn = screen.getByText(/continue to shipping/i);
    fireEvent.click(proceedBtn);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
    });
  });

  it('allows selecting a saved address', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      user: {
        addresses: [
          {
            fullName: 'Saved User',
            addressLine1: 'Saved St',
            city: 'Saved City',
            state: 'Saved State',
            postalCode: '123456',
            country: 'India',
            phone: '9876543210',
            isDefault: true
          }
        ],
      },
    });

    render(<CheckoutPage />);

    // Go to shipping
    fireEvent.click(screen.getByText(/continue to shipping/i));

    await waitFor(() => {
      expect(screen.getByText('Saved User')).toBeInTheDocument();
      expect(screen.getByText('Saved St')).toBeInTheDocument();
    });

    // Click on the address to select it
    fireEvent.click(screen.getByText('Saved User'));

    // Continue to payment (Deliver to this address)
    fireEvent.click(screen.getByText(/deliver to this address/i));

    await waitFor(() => {
      expect(screen.getByTestId('payment-method-selector')).toBeInTheDocument();
    });
  });

  it('completes order with COD', async () => {
    render(<CheckoutPage />);

    // Cart -> Shipping
    fireEvent.click(screen.getByText(/continue to shipping/i));

    // Fill Address
    await waitFor(() => {
       expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText(/street address/i), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByPlaceholderText(/city/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/state/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/postal code/i), { target: { value: '400001' } });
    fireEvent.change(screen.getByPlaceholderText(/phone/i), { target: { value: '9999999999' } });

    // Shipping -> Payment
    fireEvent.click(screen.getByText(/continue to payment/i));

    await waitFor(() => {
      expect(screen.getByTestId('payment-method-selector')).toBeInTheDocument();
    });

    // Select COD
    fireEvent.click(screen.getByText('Select COD'));
    expect(screen.getByTestId('selected-method')).toHaveTextContent('cod');

    // Continue to Review
    fireEvent.click(screen.getByText(/continue to review/i));

    await waitFor(() => {
      expect(screen.getByText('Review Your Order')).toBeInTheDocument();
    });

    // Mock order creation API
    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true,
      order: {
        _id: 'order_123',
        totalAmount: 118
      }
    });

    // Place Order
    const placeOrderBtn = screen.getByText(/place order/i);
    fireEvent.click(placeOrderBtn);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/orders', expect.objectContaining({
        paymentMethod: 'cod',
        shippingAddress: expect.objectContaining({
          fullName: 'John Doe'
        })
      }));
      expect(mockClearCart).toHaveBeenCalled();
      expect(screen.getByText('Order Placed Successfully!')).toBeInTheDocument();
    });
  });

  it('completes order with Razorpay', async () => {
    render(<CheckoutPage />);

    // Cart -> Shipping
    fireEvent.click(screen.getByText(/continue to shipping/i));

    // Fill Address
    await waitFor(() => {
       expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText(/street address/i), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByPlaceholderText(/city/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/state/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/postal code/i), { target: { value: '400001' } });
    fireEvent.change(screen.getByPlaceholderText(/phone/i), { target: { value: '9999999999' } });

    // Shipping -> Payment
    fireEvent.click(screen.getByText(/continue to payment/i));

    // Select Razorpay
    fireEvent.click(screen.getByText('Select Razorpay'));

    // Continue to Review
    fireEvent.click(screen.getByText(/continue to review/i));

    await waitFor(() => {
      expect(screen.getByText('Review Your Order')).toBeInTheDocument();
    });

    // Mock order creation API
    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true,
      order: {
        _id: 'order_123',
        totalAmount: 118
      }
    });

    // Setup processPayment to trigger success callback
    mockProcessPayment.mockImplementation(async () => {
       if (mockRazorpayCallbacks.onSuccess) {
           await mockRazorpayCallbacks.onSuccess('order_123');
       }
    });

    // Place Order
    const placeOrderBtn = screen.getByText(/place order/i);
    await act(async () => {
        fireEvent.click(placeOrderBtn);
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalled();
      expect(mockProcessPayment).toHaveBeenCalled();
      expect(mockClearCart).toHaveBeenCalled();
      expect(screen.getByText('Order Placed Successfully!')).toBeInTheDocument();
    });
  });
});
