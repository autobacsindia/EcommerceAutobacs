/**
 * Review step: the saved shipping address's PIN is enough for the Black Friday waiver
 * to be asked for automatically — no tap — while the offer is live. The order is then
 * created with the flag the server's quote reported (checkout/page.tsx), so the placed
 * total matches what was shown; the server re-checks the offer at order creation.
 */
import React from 'react';
import { render } from '@testing-library/react';
import CheckoutSummary from './CheckoutSummary';
import { useCheckoutQuote } from '@/hooks/useCheckoutQuote';
import { resetDeliveryFeeOfferIntent } from '@/hooks/useDeliveryFeeOffer';

let offerLive = true;
jest.mock('@/hooks/queries/useDeliveryFeesPublic', () => ({
  useDeliveryFeesPublic: () => ({ chargeAtCheckout: true, offerLive, isLoading: false }),
}));
jest.mock('@/hooks/useCheckoutQuote', () => ({ useCheckoutQuote: jest.fn() }));
jest.mock('@/context/CartContext', () => ({ useCart: () => ({ cart: { couponCode: '' } }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({}) } }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: any) => <a href={href}>{children}</a> }));

const quoteMock = useCheckoutQuote as jest.Mock;
const items = [{ product: 'p1', quantity: 1, variantId: null }];

beforeEach(() => {
  offerLive = true;
  resetDeliveryFeeOfferIntent();
  quoteMock.mockReset();
  quoteMock.mockReturnValue({ quote: null, loading: false, error: null });
});

const lastOptions = () => quoteMock.mock.calls[quoteMock.mock.calls.length - 1][3];

it('offer live + saved address PIN → quote asks for the waiver automatically', () => {
  render(<CheckoutSummary items={items} isAuthenticated={false} deliveryPin="500001" onChange={jest.fn()} />);
  expect(lastOptions()).toEqual({ deliveryPin: '500001', applyDeliveryFeeOffer: true });
});

it('offer not live → not asked for', () => {
  offerLive = false;
  render(<CheckoutSummary items={items} isAuthenticated={false} deliveryPin="500001" onChange={jest.fn()} />);
  expect(lastOptions()).toEqual({ deliveryPin: '500001', applyDeliveryFeeOffer: false });
});

it('removed on the cart → stays removed at the review step', () => {
  window.sessionStorage.setItem('ab:deliveryFeeOffer', '0');
  resetDeliveryFeeOfferIntentKeepingStorage();
  render(<CheckoutSummary items={items} isAuthenticated={false} deliveryPin="500001" onChange={jest.fn()} />);
  expect(lastOptions()).toEqual({ deliveryPin: '500001', applyDeliveryFeeOffer: false });
});

/** Drop the in-memory copy only, so the hook re-reads sessionStorage like a new page. */
function resetDeliveryFeeOfferIntentKeepingStorage() {
  const saved = window.sessionStorage.getItem('ab:deliveryFeeOffer');
  resetDeliveryFeeOfferIntent();
  if (saved !== null) window.sessionStorage.setItem('ab:deliveryFeeOffer', saved);
}
