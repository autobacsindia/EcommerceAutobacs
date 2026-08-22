/**
 * The review step's totals must be the SERVER's.
 *
 * They were computed in the browser — `cart.total / 1.18` for the subtotal, the
 * remainder for tax, `cart.total` for the total. Two consequences, both bad:
 *
 *   1. the step knew nothing about the coupon persisted on the cart, so a shopper who
 *      had just been shown a ₹9,312 discount reached checkout and saw the full price
 *      again; and
 *   2. the figures were invented rather than merely stale, which is the one thing money
 *      display in this codebase may never be.
 *
 * This pins that the step reads the quote, coupon and all.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CheckoutPage from './page';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { name: 'Test User', email: 'test@example.com' },
    isLoading: false,
  }),
}));

// A cart that already carries the campaign's coupon — exactly what the cart page leaves
// behind when the offer auto-applies.
jest.mock('@/context/CartContext', () => ({
  useCart: () => ({
    cart: {
      items: [
        { product: { _id: 'p1', name: 'Toyota LC300 Body Skirting Kit', price: 89850, images: [] }, quantity: 1, variantId: null },
      ],
      total: 89850,
      couponCode: 'FESTIVE2026',
    },
    clearCart: jest.fn(),
  }),
}));

jest.mock('@/hooks/useRazorpay', () => ({
  useRazorpay: () => ({ processPayment: jest.fn(), isProcessing: false }),
}));

const QUOTE = {
  subtotal: 89850,
  couponDiscount: 7188,
  freeShippingApplied: false,
  karmaDiscount: 0,
  discount: 7188,
  shippingCost: 0,
  tax: 12609.15,
  totalAmount: 82662,
  appliedCoupon: { code: 'FESTIVE2026', type: 'percentage', value: 0 },
  appliedCampaign: { id: 'c1', slug: 'festive-2026', name: 'Festive', tierId: null, tierLabel: null, percent: null },
  discountLines: null,
  savings: { catalog: 0, coupon: 7188, karma: 0, total: 7188 },
  couponError: null,
  karmaPointsUsed: 0,
  karmaPointValue: 1,
  maxRedeemablePoints: 0,
};

describe('checkout review step totals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.post as jest.Mock).mockImplementation((url: string, body: any) => {
      if (url.includes('/cart/validate-checkout')) {
        return Promise.resolve({ success: true, valid: true, errors: [] });
      }
      if (url.includes('/checkout/quote')) {
        // The whole point: the cart's coupon has to reach the server.
        expect(body.couponCode).toBe('FESTIVE2026');
        expect(body.items[0]).toHaveProperty('variantId');
        return Promise.resolve({ success: true, quote: QUOTE });
      }
      return Promise.resolve({ success: true });
    });
  });

  it('shows the server discount and total, not the cart total', async () => {
    render(<CheckoutPage />);
    await screen.findByText('Review Your Cart');

    await waitFor(() => {
      expect(screen.getByText('−₹7188.00')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('₹82662.00')).toBeInTheDocument();   // server total
    expect(screen.getByText('₹12609.15')).toBeInTheDocument();   // server tax, not total/1.18

    /*
      ₹89,850 legitimately appears twice — as the line price and as the pre-discount
      subtotal. What must NOT happen is it being the TOTAL, which is what the browser's
      own arithmetic used to print. Assert on the total row specifically.
    */
    const total = screen.getByText('Total').parentElement!;
    expect(total).toHaveTextContent('₹82662.00');
    expect(total).not.toHaveTextContent('₹89850.00');
  });

  it('never prints a confident total before the server answers', async () => {
    /* Printing cart.total while the quote was in flight is what made checkout open on
       the full price and drop a second later — read as the price changing underfoot. */
    (apiClient.post as jest.Mock).mockImplementation((url: string) =>
      url.includes('/cart/validate-checkout')
        ? Promise.resolve({ success: true, valid: true, errors: [] })
        : new Promise(() => {}),   // the quote never resolves
    );
    render(<CheckoutPage />);
    await screen.findByText('Review Your Cart');
    await waitFor(() => {
      expect(screen.getByText(/working it out/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
