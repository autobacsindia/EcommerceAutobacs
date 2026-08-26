import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CartLineDiscount from './CartLineDiscount';
import type { CheckoutQuote } from '@/hooks/useCheckoutQuote';

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    // The REAL formatter's behaviour, not an approximation — see formatPriceMock.
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      require('@/test-utils/formatPriceMock').formatPriceMock(n, o),
  }),
}));

const line = (over: Partial<NonNullable<CheckoutQuote['discountLines']>[number]> = {}) => ({
  product: 'p1',
  variantId: null,
  name: 'Profender Storm Kit',
  quantity: 1,
  linePaise: 2300000,
  tierCode: 'thanos',
  tierLabel: 'Thanos',
  percent: 8,
  alreadyOnSale: false,
  onSaleCapped: false,
  discountPaise: 184000,
  ...over,
});

const quote = (lines: CheckoutQuote['discountLines']): CheckoutQuote => ({
  subtotal: 23000,
  couponDiscount: 1840,
  freeShippingApplied: false,
  karmaDiscount: 0,
  discount: 1840,
  shippingCost: 0,
  tax: 0,
  totalAmount: 21160,
  appliedCoupon: { code: 'FESTIVE2026', type: 'percentage', value: 8 },
  appliedCampaign: null,
  discountLines: lines,
  savings: { catalog: 0, coupon: 1840, karma: 0, total: 1840 },
  couponError: null,
  karmaPointsUsed: 0,
  karmaPointValue: 1,
  maxRedeemablePoints: 0,
} as CheckoutQuote);

describe('CartLineDiscount', () => {
  it('states the amount the SERVER took off this line, never a rate', () => {
    /* 184000 paise = ₹1,840. The shopper reads the figure rather than working 8% of
       ₹23,000 out for themselves and then comparing their answer to the total. */
    render(<CartLineDiscount quote={quote([line()])} productId="p1" />);
    expect(screen.getByText(/₹1,840 off with FESTIVE2026/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('renders the exact paise the server resolved, not price × percent', () => {
    /* The guarantee that matters: whatever the browser prints came off discountLines.
       Here the rate says 8% of ₹23,000 (₹1,840) but the server resolved ₹900 — because
       the order ceiling bit, or the line was repriced. The server wins. */
    render(<CartLineDiscount quote={quote([line({ discountPaise: 90000 })])} productId="p1" />);
    expect(screen.getByText(/₹900 off with FESTIVE2026/)).toBeInTheDocument();
    expect(screen.queryByText(/₹1,840/)).not.toBeInTheDocument();
  });

  it('says nothing when the ceiling reduced this line to zero', () => {
    /* apportionCap can zero a line while its tier rate still reads 8%. The old
       `percent > 0` gate printed a discount beside a line discounted by nothing. */
    const { container } = render(
      <CartLineDiscount quote={quote([line({ discountPaise: 0 })])} productId="p1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('matches on the variant, so two variants of one product do not swap figures', () => {
    const lines = [
      line({ variantId: 'v1', discountPaise: 100000 }),
      line({ variantId: 'v2', discountPaise: 250000 }),
    ];
    render(<CartLineDiscount quote={quote(lines)} productId="p1" variantId="v2" />);
    expect(screen.getByText(/₹2,500 off/)).toBeInTheDocument();
    expect(screen.queryByText(/₹1,000/)).not.toBeInTheDocument();
  });

  it('still flags an already-discounted line, beside the amount', () => {
    render(
      <CartLineDiscount
        quote={quote([line({ alreadyOnSale: true, onSaleCapped: true, discountPaise: 46000 })])}
        productId="p1"
      />,
    );
    expect(screen.getByText(/₹460 off with FESTIVE2026/)).toBeInTheDocument();
    expect(screen.getByText(/already on offer, so this is the added rate/)).toBeInTheDocument();
  });

  it('keeps the paise, so the lines sum to the discount in the summary', () => {
    /* The defect this closes: the site's INR formatting rounds to whole rupees, so two
       10,050-paise lines rendered "₹101 + ₹101" against a "₹201" summary and a shopper
       adding up the bag found a rupee that was not there. These figures exist to be
       added up — they are the breakdown of the number below them. */
    const lines = [
      line({ variantId: 'v1', discountPaise: 10050 }),
      line({ variantId: 'v2', discountPaise: 10050 }),
    ];
    render(<CartLineDiscount quote={quote(lines)} productId="p1" variantId="v1" />);
    expect(screen.getByText(/₹100\.50 off/)).toBeInTheDocument();
  });

  it('prints no paise on a whole-rupee line', () => {
    // Exact formatting shows paise only where they exist; "₹1,840.00" would be noise.
    render(<CartLineDiscount quote={quote([line()])} productId="p1" />);
    expect(screen.getByText(/₹1,840 off/)).toBeInTheDocument();
  });

  it('itemises a sub-rupee line the card would not have advertised', () => {
    /* The card suppresses anything under ₹1 as not worth a badge. The cart must not:
       these figures have to account for the summary, so every paise appears. */
    render(<CartLineDiscount quote={quote([line({ discountPaise: 40 })])} productId="p1" />);
    expect(screen.getByText(/₹0\.40 off/)).toBeInTheDocument();
  });

  it('says nothing when the server sent no breakdown at all', () => {
    // Not every coupon is priced by a product ladder; discountLines is null for those.
    const { container } = render(<CartLineDiscount quote={quote(null)} productId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing while the quote is still in flight', () => {
    const { container } = render(<CartLineDiscount quote={null} productId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
