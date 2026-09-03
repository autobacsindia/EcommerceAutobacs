import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import CheckoutPage from './page';
import apiClient from '@/lib/api';
import { toast } from 'react-hot-toast';
import { trackPurchase } from '@/lib/analytics';

// Mock dependencies
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

/**
 * Tick the Terms + Privacy checkbox on the review step.
 *
 * Order placement is gated on it (services/buyerService.js rejects an order with
 * no recorded acceptance, and the button is disabled until it is ticked), so
 * every test that reaches Place Order has to do this — which is the point: an
 * order cannot be placed without it.
 */
const acceptTerms = () => {
  fireEvent.click(screen.getByRole('checkbox', { name: /accept the Terms and Conditions/i }));
};

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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

// The PostHog funnel. Mocked so the promotional attribution riding on `purchase` can
// be asserted — that property is the only thing that separates "bought during the
// campaign" from "bought USING the campaign" once the data reaches PostHog.
jest.mock('@/lib/analytics', () => ({
  trackBeginCheckout: jest.fn(),
  trackPurchase: jest.fn(),
  trackViewCart: jest.fn(),
  trackCheckoutStep: jest.fn(),
  trackAddPaymentInfo: jest.fn(),
  trackCheckoutAbandoned: jest.fn(),
}));

/*
  The server's pricing breakdown, injected at the review step.

  CheckoutSummary owns the real quote request; here it only needs to hand the page the
  same shape the server would, so the attribution can be driven per test.
*/
let mockQuote: any = null;
jest.mock('@/components/checkout/CheckoutSummary', () => {
  const ReactMod = require('react');
  return function MockCheckoutSummary({ onChange }: any) {
    ReactMod.useEffect(() => {
      onChange({ couponCode: mockQuote?.appliedCoupon?.code, redeemKarmaPoints: 0, quote: mockQuote });
    }, [onChange]);
    return <div data-testid="checkout-summary" />;
  };
});

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

/*
  `apiClient.get` serves two different endpoints in this flow, and they are not
  interchangeable: the profile fetch fills the saved-address list, while
  /cart/validate is the server price check that `handlePlaceOrder` runs BEFORE it
  will post an order. A single blanket mock answered both with the profile payload,
  so `validation.isValid` came back undefined, the page took the "items have changed"
  branch, and the order was never placed — which is why the two order-completion
  tests below could not pass.
*/
const mockGetByEndpoint = (overrides: { validation?: any } = {}) =>
  (apiClient.get as jest.Mock).mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/cart/validate')) {
      return {
        success: true,
        isValid: true,
        // Must stay within ₹0.50 of the mocked cart total, or the page pauses on the
        // price-drift confirmation banner instead of ordering.
        subtotal: 100,
        tax: 18,
        total: 118,
        items: [{ productId: 'p1', quantity: 1, unitPrice: 100 }],
        ...overrides.validation,
      };
    }
    return { success: true, user: { addresses: [] } };
  });

describe('CheckoutPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRazorpayCallbacks = {};
    mockQuote = null;
    
    // Profile fetch (no saved addresses) + a passing server price check.
    mockGetByEndpoint();
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

    // Place Order — acceptance first, or the gate short-circuits it.
    acceptTerms();
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
      expect(screen.getByText('Order Placed!')).toBeInTheDocument();
    });

  });

  it('will not place an order until the Terms are accepted', async () => {
    // Asserted BOTH ways on purpose: the button is disabled, and the call is
    // refused even if a click gets through. The price-change "Confirm & Pay"
    // button is a second route into the same function, so a disabled-only guard
    // would leave that one open.
    render(<CheckoutPage />);
    fireEvent.click(screen.getByText(/continue to shipping/i));
    await waitFor(() => expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText(/street address/i), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByPlaceholderText(/city/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/state/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/postal code/i), { target: { value: '400001' } });
    fireEvent.change(screen.getByPlaceholderText(/phone/i), { target: { value: '9999999999' } });
    fireEvent.click(screen.getByText(/continue to payment/i));
    fireEvent.click(screen.getByText('Select COD'));
    fireEvent.click(screen.getByText(/continue to review/i));
    await waitFor(() => expect(screen.getByText('Review Your Order')).toBeInTheDocument());

    const placeOrderBtn = screen.getByText(/place order/i).closest('button')!;
    expect(placeOrderBtn).toBeDisabled();

    (apiClient.post as jest.Mock).mockClear();
    await act(async () => { fireEvent.click(placeOrderBtn); });
    expect(apiClient.post).not.toHaveBeenCalled();

    acceptTerms();
    expect(placeOrderBtn).toBeEnabled();
  });

  it('sends the buyer block and the acceptance with the order', async () => {
    // The payload contract. Note what is NOT sent: no terms version (the server
    // stamps its own) and no billing state (derived from the GSTIN) — so neither
    // can be chosen by the client.
    render(<CheckoutPage />);
    fireEvent.click(screen.getByText(/continue to shipping/i));
    await waitFor(() => expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText(/street address/i), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByPlaceholderText(/city/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/state/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/postal code/i), { target: { value: '400001' } });
    fireEvent.change(screen.getByPlaceholderText(/phone/i), { target: { value: '9999999999' } });
    fireEvent.click(screen.getByText(/continue to payment/i));
    fireEvent.click(screen.getByText('Select COD'));
    fireEvent.click(screen.getByText(/continue to review/i));
    await waitFor(() => expect(screen.getByText('Review Your Order')).toBeInTheDocument());

    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true, order: { _id: 'order_123', totalAmount: 118 },
    });

    acceptTerms();
    await act(async () => { fireEvent.click(screen.getByText(/place order/i)); });

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/orders',
      expect.objectContaining({ acceptTerms: true, buyer: { type: 'individual' } }),
    ));

    const payload = (apiClient.post as jest.Mock).mock.calls.at(-1)![1];
    expect(payload).not.toHaveProperty('termsVersion');
    expect(payload.buyer).not.toHaveProperty('gstin');
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

    // Place Order — acceptance first, or the gate short-circuits it.
    acceptTerms();
    const placeOrderBtn = screen.getByText(/place order/i);
    await act(async () => {
        fireEvent.click(placeOrderBtn);
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalled();
      expect(mockProcessPayment).toHaveBeenCalled();
      expect(mockClearCart).toHaveBeenCalled();
      // Not the inline confirmation step: the Razorpay path hands off to the dedicated
      // success page, which is what fires the Google Ads conversion.
      expect(mockPush).toHaveBeenCalledWith('/order/order_123/success');
    });
  });
});


/**
 * Promotional attribution on the `purchase` event.
 *
 * The event fires AFTER the cart is cleared and, on the Razorpay path, while the router
 * is already navigating away — so the attribution has to be captured before that, or the
 * campaign's own sales get reported as organic and the offer looks like it did nothing.
 */
describe('CheckoutPage — purchase attribution', () => {
  const reachReviewAndPay = async () => {
    render(<CheckoutPage />);
    fireEvent.click(screen.getByText(/continue to shipping/i));
    await waitFor(() => expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText(/street address/i), { target: { value: '123 Main St' } });
    fireEvent.change(screen.getByPlaceholderText(/city/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByPlaceholderText(/state/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText(/postal code/i), { target: { value: '400001' } });
    fireEvent.change(screen.getByPlaceholderText(/phone/i), { target: { value: '9999999999' } });
    fireEvent.click(screen.getByText(/continue to payment/i));
    fireEvent.click(screen.getByText('Select Razorpay'));
    fireEvent.click(screen.getByText(/continue to review/i));
    await waitFor(() => expect(screen.getByText('Review Your Order')).toBeInTheDocument());

    (apiClient.post as jest.Mock).mockResolvedValue({
      success: true,
      order: { _id: 'order_123', totalAmount: 118 },
    });
    mockProcessPayment.mockImplementation(async () => {
      if (mockRazorpayCallbacks.onSuccess) await mockRazorpayCallbacks.onSuccess('order_123');
    });
    acceptTerms();
    await act(async () => { fireEvent.click(screen.getByText(/place order/i)); });
    await waitFor(() => expect(trackPurchase).toHaveBeenCalled());
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRazorpayCallbacks = {};
    mockQuote = null;
    mockGetByEndpoint();
  });

  it('attributes the sale to the campaign the server actually applied', async () => {
    mockQuote = {
      subtotal: 100, couponDiscount: 8, karmaDiscount: 0, discount: 8,
      shippingCost: 0, tax: 0, totalAmount: 92,
      appliedCoupon: { code: 'FESTIVE2026', type: 'percentage', value: 8 },
      appliedCampaign: { id: 'c1', slug: 'festive-2026', name: 'Festive', tierId: null, tierLabel: null, percent: 8 },
    };
    await reachReviewAndPay();

    expect((trackPurchase as jest.Mock).mock.calls[0][0]).toMatchObject({
      orderId: 'order_123',
      couponCode: 'FESTIVE2026',
      campaignSlug: 'festive-2026',
      discount: 8,
    });
  });

  it('reports an organic sale as organic — no coupon, no campaign, zero discount', async () => {
    mockQuote = {
      subtotal: 100, couponDiscount: 0, karmaDiscount: 0, discount: 0,
      shippingCost: 0, tax: 0, totalAmount: 100,
      appliedCoupon: null, appliedCampaign: null,
    };
    await reachReviewAndPay();

    expect((trackPurchase as jest.Mock).mock.calls[0][0]).toMatchObject({
      couponCode: null, campaignSlug: null, discount: 0,
    });
  });

  /*
    A plain coupon is NOT a campaign. Collapsing the two would credit the festive offer
    with every sale that used any discount code at all.
  */
  it('does not credit a campaign when an ordinary coupon was used', async () => {
    mockQuote = {
      subtotal: 100, couponDiscount: 10, karmaDiscount: 0, discount: 10,
      shippingCost: 0, tax: 0, totalAmount: 90,
      appliedCoupon: { code: 'WELCOME10', type: 'percentage', value: 10 },
      appliedCampaign: null,
    };
    await reachReviewAndPay();

    const props = (trackPurchase as jest.Mock).mock.calls[0][0];
    expect(props.couponCode).toBe('WELCOME10');
    expect(props.campaignSlug).toBeNull();
  });
});
