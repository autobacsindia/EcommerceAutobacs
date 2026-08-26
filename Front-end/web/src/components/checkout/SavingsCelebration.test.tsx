import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SavingsCelebration from './SavingsCelebration';
import type { CheckoutQuote } from '@/hooks/useCheckoutQuote';

/**
 * A celebration modal is one bad trigger away from being the reason someone abandons a
 * cart, so most of what is pinned here is when it must STAY SHUT — and that every figure
 * it shows came from the server rather than being added up in the browser.
 */
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n.toLocaleString('en-IN')}` }),
}));

const quote = (over: Partial<CheckoutQuote> = {}): CheckoutQuote => ({
  subtotal: 20000, couponDiscount: 1000, freeShippingApplied: false, karmaDiscount: 0,
  discount: 1000, shippingCost: 0, tax: 0, totalAmount: 19000,
  appliedCoupon: { code: 'FESTIVE', type: 'percentage', value: 0 },
  appliedCampaign: null, discountLines: null,
  savings: { catalog: 2000, coupon: 1000, karma: 0, total: 3000 },
  couponError: null, couponErrorCode: null, karmaPointsUsed: 0, karmaPointValue: 1, maxRedeemablePoints: 0,
  ...over,
});

const line = (over = {}) => ({
  product: 'p1', variantId: null, name: 'Profender Storm Kit', quantity: 1,
  linePaise: 1000000, tierCode: 'thanos', tierLabel: 'Thanos', percent: 2,
  alreadyOnSale: true, onSaleCapped: true, discountPaise: 20000, ...over,
});

const renderIt = (q: CheckoutQuote | null) =>
  render(<SavingsCelebration quote={q} reducedMotionOverride />);

describe('SavingsCelebration', () => {
  it('shows the server’s totals, itemised, when a coupon lands', async () => {
    renderIt(quote());

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/saving ₹3,000/)).toBeInTheDocument();
    // The catalogue saving is named separately so the coupon is never credited with a
    // discount the catalogue was already giving.
    expect(screen.getByText('Already off list price')).toBeInTheDocument();
    expect(screen.getByText('₹2,000')).toBeInTheDocument();
    expect(screen.getByText('Coupon FESTIVE')).toBeInTheDocument();
  });

  it('stays shut when no coupon is applied', () => {
    renderIt(quote({ appliedCoupon: null }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays shut when there is nothing to celebrate', () => {
    // Congratulating someone on ₹0 is worse than saying nothing.
    renderIt(quote({ savings: { catalog: 0, coupon: 0, karma: 0, total: 0 } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays shut while the quote is still loading', () => {
    renderIt(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does NOT re-fire when the cart is edited under the same coupon', async () => {
    // useCheckoutQuote re-runs on every quantity change; each response carries the same
    // applied code. Re-opening on each would make the cart unusable.
    const { rerender } = renderIt(quote());
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(<SavingsCelebration quote={quote({ subtotal: 30000, savings: { catalog: 2000, coupon: 1500, karma: 0, total: 3500 } })} reducedMotionOverride />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('celebrates again after the coupon is removed and re-applied', async () => {
    const { rerender } = renderIt(quote());
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(<SavingsCelebration quote={quote({ appliedCoupon: null })} reducedMotionOverride />);
    rerender(<SavingsCelebration quote={quote()} reducedMotionOverride />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('celebrates a DIFFERENT coupon applied afterwards', async () => {
    const { rerender } = renderIt(quote());
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(<SavingsCelebration
      quote={quote({ appliedCoupon: { code: 'OTHER', type: 'percentage', value: 5 } })}
      reducedMotionOverride
    />);
    expect(await screen.findByText('Coupon OTHER')).toBeInTheDocument();
  });

  it('freezes its figures against a re-quote landing underneath', async () => {
    const { rerender } = renderIt(quote());
    expect(await screen.findByText(/saving ₹3,000/)).toBeInTheDocument();

    // Same coupon, new totals arriving while the panel is open — the numbers being read
    // must not change under the reader.
    rerender(<SavingsCelebration
      quote={quote({ savings: { catalog: 2000, coupon: 9999, karma: 0, total: 11999 } })}
      reducedMotionOverride
    />);
    expect(screen.getByText(/saving ₹3,000/)).toBeInTheDocument();
    expect(screen.queryByText(/₹11,999/)).not.toBeInTheDocument();
  });

  it('says which items were capped because they were already on offer', async () => {
    renderIt(quote({ discountLines: [line()] }));
    expect(await screen.findByText(/Profender Storm Kit is already on offer/)).toBeInTheDocument();
    expect(screen.getByText(/adds 2% on top/)).toBeInTheDocument();
  });

  it('pluralises the already-on-offer note', async () => {
    renderIt(quote({ discountLines: [line(), line({ product: 'p2', name: 'Another Kit' })] }));
    expect(await screen.findByText(/2 items in your cart are already on offer/)).toBeInTheDocument();
  });

  it('says nothing about capping when no line was capped', async () => {
    // A 2% tier on a discounted product loses nothing, so `onSaleCapped` is false and
    // claiming otherwise would be a lie.
    renderIt(quote({ discountLines: [line({ onSaleCapped: false })] }));
    await screen.findByRole('dialog');
    expect(screen.queryByText(/already on offer/)).not.toBeInTheDocument();
  });

  it('closes on Escape and on the backdrop, so it can never trap checkout', async () => {
    const { unmount } = renderIt(quote());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    unmount();

    renderIt(quote());
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('omits limbs that contributed nothing', async () => {
    renderIt(quote({ savings: { catalog: 0, coupon: 1000, karma: 0, total: 1000 } }));
    await screen.findByRole('dialog');
    expect(screen.queryByText('Already off list price')).not.toBeInTheDocument();
    expect(screen.queryByText('Karma points')).not.toBeInTheDocument();
  });
});
