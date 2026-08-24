/**
 * useAddedToCartToast — the single add-to-cart confirmation.
 *
 * The invariant worth guarding is the eligibility gate: the campaign BADGE is shown to
 * signed-out/unverified shoppers on purpose (a reason to sign in), so every call site
 * hands this hook a real `campaignPercent` even when the shopper cannot claim it. If
 * the gate here regressed, those shoppers would be told they banked rupees the cart
 * then refuses to give them.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useAddedToCartToast } from './useAddedToCartToast';

const successMock = jest.fn();
jest.mock('react-hot-toast', () => ({
  toast: { success: (...a: unknown[]) => successMock(...a) },
}));

const useCampaignMock = jest.fn();
jest.mock('@/hooks/queries/useCampaign', () => ({
  useCampaign: () => useCampaignMock(),
}));

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n.toLocaleString('en-IN')}` }),
}));

/** Renders the hook with a given eligibility answer and returns the fire function. */
function fireWith(eligible: boolean | undefined) {
  useCampaignMock.mockReturnValue({ data: eligible === undefined ? undefined : { eligible } });
  const { result } = renderHook(() => useAddedToCartToast());
  return result;
}

beforeEach(() => {
  successMock.mockReset();
  useCampaignMock.mockReset();
});

describe('useAddedToCartToast', () => {
  it('reports campaign savings when the shopper is eligible', () => {
    const result = fireWith(true);
    act(() => result.current({ price: 1000, quantity: 1, campaignPercent: 8 }));
    expect(successMock).toHaveBeenCalledWith('Added to cart — you saved ₹80 🎉');
  });

  it('never quotes a rupee figure for a campaign the shopper cannot claim', () => {
    const result = fireWith(false);
    act(() => result.current({ price: 1000, quantity: 1, campaignPercent: 8 }));
    expect(successMock).toHaveBeenCalledWith('Added to cart');
  });

  it('treats an unresolved eligibility answer as not eligible', () => {
    const result = fireWith(undefined);
    act(() => result.current({ price: 1000, quantity: 1, campaignPercent: 8 }));
    expect(successMock).toHaveBeenCalledWith('Added to cart');
  });

  it('still reports catalogue savings to an ineligible shopper — a markdown is true for anyone', () => {
    const result = fireWith(false);
    act(() => result.current({ price: 800, originalPrice: 1000, quantity: 1, campaignPercent: 8 }));
    expect(successMock).toHaveBeenCalledWith('Added to cart — you saved ₹200 🎉');
  });

  it('combines catalogue and campaign savings across the whole line', () => {
    const result = fireWith(true);
    act(() => result.current({ price: 800, originalPrice: 1000, quantity: 2, campaignPercent: 10 }));
    // catalogue (1000-800)*2 = 400, campaign floor(800*100*2 * 10/100)/100 = 160
    expect(successMock).toHaveBeenCalledWith('Added to cart — you saved ₹560 🎉');
  });

  it('falls back to a quantity-aware message when there is nothing to save', () => {
    const result = fireWith(true);
    act(() => result.current({ price: 1000, quantity: 3 }));
    expect(successMock).toHaveBeenCalledWith('Added 3 to cart');
  });

  it('omits the quantity for a single-item quick-add', () => {
    const result = fireWith(true);
    act(() => result.current({ price: 1000 }));
    expect(successMock).toHaveBeenCalledWith('Added to cart');
  });
});
