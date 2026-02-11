
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CheckoutPage from './page';
import apiClient from '@/lib/api';

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
  success: jest.fn(),
  error: jest.fn(),
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

jest.mock('@/hooks/useRazorpay', () => ({
  useRazorpay: () => ({
    processPayment: jest.fn(),
    isProcessing: false,
  }),
}));

// Mock child components that might be complex
jest.mock('@/components/checkout/PaymentMethodSelector', () => {
  return function MockPaymentMethodSelector({ selectedMethod, onSelect }: any) {
    return (
      <div data-testid="payment-method-selector">
        <button onClick={() => onSelect('razorpay')}>Select Razorpay</button>
        <button onClick={() => onSelect('cod')}>Select COD</button>
        <span>Current: {selectedMethod}</span>
      </div>
    );
  };
});

describe('CheckoutPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    // Check for Order Summary
    await waitFor(() => {
      expect(screen.getByText('Review Your Cart')).toBeInTheDocument();
      expect(screen.getByText('Test Item')).toBeInTheDocument();
      // Price appears in item list and subtotal, so we expect at least one
      expect(screen.getAllByText('₹100.00').length).toBeGreaterThan(0); 
    });
  });

  it('shows address form when no saved addresses exist', async () => {
    render(<CheckoutPage />);

    // Click "Continue to Shipping" to go to address step
    const proceedBtn = screen.getByText(/continue to shipping/i);
    fireEvent.click(proceedBtn);

    // Should show address form
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/street address/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/city/i)).toBeInTheDocument();
    });
  });

  it('renders payment method selector', async () => {
    render(<CheckoutPage />);

    // Proceed to payment step usually requires filling address
    // But we can check if the component renders or if we can get to it.
    // The CheckoutPage might have steps.
    // Let's check if we can find the "Continue to Shipping" button.
    
    const proceedBtn = screen.getByText(/continue to shipping/i);
    expect(proceedBtn).toBeInTheDocument();
    
    fireEvent.click(proceedBtn);

    // Now we are in address step
    await waitFor(() => {
        expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
    });

    // Fill address form
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText(/street address/i), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByPlaceholderText(/city/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/state/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/postal code/i), { target: { value: '400001' } });
    fireEvent.change(screen.getByPlaceholderText(/phone/i), { target: { value: '9999999999' } });

    // Find "Continue to Payment" button
    const toPaymentBtn = screen.getByText(/continue to payment/i);
    fireEvent.click(toPaymentBtn);
    
    // Now should be in payment step
    await waitFor(() => {
      expect(screen.getByTestId('payment-method-selector')).toBeInTheDocument();
    });
  });
});
