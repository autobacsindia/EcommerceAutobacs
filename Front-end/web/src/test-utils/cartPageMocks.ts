/**
 * Shared jest.mock factories for tests that render the cart page.
 *
 * The page now reads auth (to re-check stock for signed-in users), asks the
 * server for a price quote, polls campaign status and lists public coupons.
 * Unit tests stub those boundaries so they stay offline and deterministic.
 *
 * Usage (factories must be required lazily inside jest.mock):
 *   jest.mock('@/context/AuthContext', () => require('@/test-utils/cartPageMocks').authGuestMock);
 */
export const authGuestMock = {
  useAuth: () => ({ isAuthenticated: false, user: null, isLoading: false }),
};

/** No quote yet: the summary shows "—" placeholders, never a client-side total. */
export const checkoutQuoteIdleMock = {
  useCheckoutQuote: () => ({ quote: null, quotedCouponCode: undefined, loading: false, error: null }),
};

export const campaignNoneMock = {
  useCampaign: () => ({ data: undefined }),
};
