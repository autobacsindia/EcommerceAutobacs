/**
 * useCheckoutQuote — specifically, WHICH coupon the quote on screen describes.
 *
 * The hook deliberately keeps the previous quote while a new one is being fetched, so
 * the totals do not flicker to nothing on every keystroke in the promo box. That is good
 * for the display and a trap for anything that makes a DECISION from the coupon fields:
 * for the length of the 350 ms debounce plus the request, `couponError` and
 * `couponErrorCode` still describe the code that was applied BEFORE.
 *
 * The cart acts on exactly those fields — it silently drops a campaign coupon the
 * customer can no longer use — so it has to be able to tell which code the response
 * belongs to. `quotedCouponCode` is that answer, and this file pins it.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useCheckoutQuote } from './useCheckoutQuote';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
import apiClient from '@/lib/api';

const ITEMS = [{ product: 'p1', quantity: 1, variantId: null }];

/** A quote whose coupon was refused because it belongs to a campaign. */
const campaignRefusal = () => ({
  success: true,
  quote: {
    subtotal: 10000, couponDiscount: 0, freeShippingApplied: false, karmaDiscount: 0,
    discount: 0, shippingCost: 0, tax: 0, totalAmount: 10000,
    appliedCoupon: null, appliedCampaign: null, discountLines: null,
    savings: { catalog: 0, coupon: 0, karma: 0, total: 0 },
    couponError: 'This offer has not been activated on your account',
    couponErrorCode: 'campaign',
    karmaPointsUsed: 0, karmaPointValue: 1, maxRedeemablePoints: 0,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('reports which coupon the current quote was priced with', async () => {
  (apiClient.post as jest.Mock).mockResolvedValue(campaignRefusal());

  const { result } = renderHook(() => useCheckoutQuote(ITEMS, 'FESTIVE2026', 0));

  await act(async () => { jest.advanceTimersByTime(400); });
  await waitFor(() => expect(result.current.quote).not.toBeNull());

  expect(result.current.quotedCouponCode).toBe('FESTIVE2026');
  expect(result.current.quote?.couponErrorCode).toBe('campaign');
});

it('does NOT claim the old code once a different one is being priced', async () => {
  /*
    The regression. Before `quotedCouponCode` existed, the cart read
    `quote.couponErrorCode === 'campaign'` during this window and deleted whatever coupon
    was currently on the cart — including one the customer had just typed themselves.
  */
  (apiClient.post as jest.Mock).mockResolvedValue(campaignRefusal());

  const { result, rerender } = renderHook(
    ({ code }: { code: string }) => useCheckoutQuote(ITEMS, code, 0),
    { initialProps: { code: 'FESTIVE2026' } },
  );

  await act(async () => { jest.advanceTimersByTime(400); });
  await waitFor(() => expect(result.current.quotedCouponCode).toBe('FESTIVE2026'));

  // The customer applies their own coupon. The request for it has not landed yet.
  rerender({ code: 'MYOWNCODE' });

  // The retained quote still carries the campaign refusal — that part is by design...
  expect(result.current.quote?.couponErrorCode).toBe('campaign');
  // ...but it must no longer claim to describe the code now on the cart, which is the
  // check that stops the cart acting on it.
  expect(result.current.quotedCouponCode).not.toBe('MYOWNCODE');
});

it('catches up once the new code has actually been priced', async () => {
  (apiClient.post as jest.Mock).mockResolvedValue(campaignRefusal());

  const { result, rerender } = renderHook(
    ({ code }: { code: string }) => useCheckoutQuote(ITEMS, code, 0),
    { initialProps: { code: 'FESTIVE2026' } },
  );
  await act(async () => { jest.advanceTimersByTime(400); });
  await waitFor(() => expect(result.current.quotedCouponCode).toBe('FESTIVE2026'));

  (apiClient.post as jest.Mock).mockResolvedValue({
    ...campaignRefusal(),
    quote: { ...campaignRefusal().quote, couponError: null, couponErrorCode: null },
  });
  rerender({ code: 'MYOWNCODE' });
  await act(async () => { jest.advanceTimersByTime(400); });

  await waitFor(() => expect(result.current.quotedCouponCode).toBe('MYOWNCODE'));
  expect(result.current.quote?.couponErrorCode).toBeNull();
});
