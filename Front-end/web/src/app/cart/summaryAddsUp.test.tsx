/**
 * The cart's Order Summary must add up: Subtotal + GST = Total.
 *
 * Prices include GST. The summary printed the GST-INCLUSIVE subtotal and then the
 * GST inside it on the next row, so a shopper read
 *
 *   Subtotal ₹1,57,300   Tax (18% GST) ₹23,995   Total ₹1,57,300
 *
 * — two rows that visibly do not sum to the third. The Subtotal row now prints the
 * server's `subtotalBeforeTax`; the browser never derives it.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CartPage from './page';
import { useCart } from '@/context/CartContext';
import { useCheckoutQuote } from '@/hooks/useCheckoutQuote';

jest.mock('@/context/CartContext', () => ({ useCart: jest.fn() }));
jest.mock('@/hooks/useCheckoutQuote', () => ({ useCheckoutQuote: jest.fn() }));
jest.mock('@/hooks/queries/useCampaign', () => ({ useCampaign: () => ({ data: undefined }) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({}), post: jest.fn() } }));

// Mirrors the real formatter's contract: whole rupees by default, paise only when
// `exact` is asked for AND the figure has them.
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      o?.exact && Math.round(n * 100) % 100 !== 0 ? `₹${n.toFixed(2)}` : `₹${Math.round(n)}`,
  }),
}));

jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
jest.mock('@/components/layout/EnhancedImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

// The case from the bug report.
const QUOTE = {
  subtotal: 157300,
  subtotalBeforeTax: 133305.08,
  couponDiscount: 0,
  freeShippingApplied: false,
  karmaDiscount: 0,
  discount: 0,
  shippingCost: 0,
  tax: 23994.92,
  totalAmount: 157300,
  appliedCoupon: null,
  appliedCampaign: null,
  discountLines: null,
  savings: { catalog: 0, coupon: 0, karma: 0, total: 0 },
  couponError: null,
  karmaPointsUsed: 0,
  karmaPointValue: 1,
  maxRedeemablePoints: 0,
};

const rowValue = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe('cart Order Summary', () => {
  beforeEach(() => {
    (useCart as jest.Mock).mockReturnValue({
      cart: {
        items: [{
          product: { _id: 'p1', name: 'Coilover kit', price: 157300, images: [], slug: 'kit', stock: 'in' },
          quantity: 1,
        }],
        total: 157300,
      },
      isLoading: false,
      removeFromCart: jest.fn(),
      updateQuantity: jest.fn(),
      clearCart: jest.fn(),
      applyCoupon: jest.fn(),
      removeCoupon: jest.fn(),
    });
  });

  it('shows the subtotal BEFORE GST, so Subtotal + GST = Total', () => {
    (useCheckoutQuote as jest.Mock).mockReturnValue({ quote: QUOTE, quotedCouponCode: null, loading: false, error: null });
    render(<CartPage />);

    expect(rowValue('Subtotal (before GST)')).toBe('₹133305.08');
    expect(rowValue('Tax (18% GST)')).toBe('₹23994.92');
    expect(rowValue('Total')).toBe('₹157300');
    // The inclusive figure must not be presented as the subtotal any more.
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
  });

  it('prints "—" rather than a wrong subtotal if the server did not send one', () => {
    const { subtotalBeforeTax: _omit, ...older } = QUOTE;
    (useCheckoutQuote as jest.Mock).mockReturnValue({ quote: older, quotedCouponCode: null, loading: false, error: null });
    render(<CartPage />);

    expect(rowValue('Subtotal (before GST)')).toBe('—');
  });

  /*
    Shipping is never in the website total: the customer pays the courier on
    delivery, by cash or GPay / UPI. The cart says so, and promises nothing free.
  */
  it('shows shipping as extra, paid on delivery', () => {
    (useCheckoutQuote as jest.Mock).mockReturnValue({ quote: QUOTE, quotedCouponCode: null, loading: false, error: null });
    render(<CartPage />);

    expect(rowValue('Shipping')).toBe('Extra — paid on delivery');
    expect(rowValue('Total')).toBe('₹157300');   // shipping is not added to it
  });

  it('a referral coupon that saves nothing is offered without promising free shipping', () => {
    (useCheckoutQuote as jest.Mock).mockReturnValue({
      quote: { ...QUOTE, suggestedCoupon: { code: 'ASHA10', estimatedDiscount: 0, freeShipping: true } },
      quotedCouponCode: null, loading: false, error: null,
    });
    render(<CartPage />);

    const offer = screen.getByText('ASHA10').closest('button')!;
    expect(offer).toHaveTextContent('You were referred — apply ASHA10');
    expect(offer).not.toHaveTextContent(/free/i);
  });
});
