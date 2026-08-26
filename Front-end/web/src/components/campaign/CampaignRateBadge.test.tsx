import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CampaignRateBadge from './CampaignRateBadge';

// The badge must format money the same way the rest of the page does; the real provider
// is not the thing under test here.
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    // The REAL formatter's behaviour, not an approximation — see formatPriceMock.
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      require('@/test-utils/formatPriceMock').formatPriceMock(n, o),
  }),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
import apiClient from '@/lib/api';

const PRODUCT = '507f1f77bcf86cd799439011';

/**
 * Two independent calls back this component, and which one answers matters:
 *   /campaigns/:slug/me            → per-user eligibility (private)
 *   /campaigns/:slug/product-rates → the rate itself (shared, identity-free)
 */
function mockApi({
  eligible = true,
  reasonCode = null as string | null,
  percent = 8 as number | null,
  onSaleCapped = false,
  requiresActivation = false,
  activated = false,
}) {
  (apiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('/product-rates')) {
      return Promise.resolve({
        success: true,
        campaign: percent === null
          ? null
          : { slug: 'festive-2026', endsAt: null, rates: { [PRODUCT]: { percent, onSaleCapped } } },
      });
    }
    return Promise.resolve({
      success: true,
      campaign: {
        slug: 'festive-2026', name: 'Festive', endsAt: null,
        couponCode: eligible ? 'FESTIVE2026' : null,
        eligible, reason: null, reasonCode,
        requiresActivation, activated,
        tier: null, tiers: [], maxDiscountPerOrder: 50000,
        productLadder: { maxPercent: 8, defaultPercent: 4, onSaleMaxPercent: 2 },
      },
    });
  });
}

function renderBadge(props: Partial<React.ComponentProps<typeof CampaignRateBadge>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampaignRateBadge productId={PRODUCT} price={10000} {...props} />
    </QueryClientProvider>,
  );
}

describe('CampaignRateBadge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('says what the offer is worth on this item, and never quotes the rate', async () => {
    /* 8% of ₹10,000. The rate is the rule; the amount is the answer, and it is the only
       one of the two a shopper can weigh against the price beside it. */
    mockApi({ percent: 8 });
    renderBadge();
    expect(await screen.findByText(/save ₹800 more/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('says nothing to a signed-out visitor', async () => {
    /*
      This used to advertise the rate to anyone, on the reasoning that a visible discount
      is what makes signing in worth doing. That is true for an offer the whole site is
      meant to have, and false for one gated on activation: most people who saw the badge
      would sign in and be charged full price anyway. A promise on a product page has to
      survive to the invoice.
    */
    mockApi({ eligible: false, reasonCode: 'login', percent: 8 });
    const { container } = renderBadge();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing to an unverified shopper', async () => {
    mockApi({ eligible: false, reasonCode: 'unverified', percent: 8 });
    const { container } = renderBadge();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing to a customer who never came through the card', async () => {
    // The case the activation gate exists for: they registered through the ordinary
    // sign-up form, so the checkout will refuse this discount and the badge must not
    // promise it.
    mockApi({
      eligible: false, reasonCode: 'not_activated', percent: 8,
      requiresActivation: true, activated: false,
    });
    const { container } = renderBadge();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the saving once that customer has activated', async () => {
    mockApi({ eligible: true, percent: 8, requiresActivation: true, activated: true });
    renderBadge();
    expect(await screen.findByText(/save ₹800 more/i)).toBeInTheDocument();
  });

  it('promises nothing to someone who has already redeemed', async () => {
    /* Terminal refusal. Advertising a discount the checkout will refuse is a broken
       promise dressed as marketing. */
    mockApi({ eligible: false, reasonCode: 'already_used', percent: 8 });
    const { container } = renderBadge();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('promises nothing once the offer is fully claimed', async () => {
    mockApi({ eligible: false, reasonCode: 'exhausted', percent: 8 });
    const { container } = renderBadge();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('says an item is already on offer, rather than leaving the small number unexplained', async () => {
    mockApi({ percent: 2, onSaleCapped: true });
    renderBadge();
    expect(await screen.findByText(/already on offer/i)).toBeInTheDocument();
    expect(screen.getByText(/save ₹200 more/i)).toBeInTheDocument();
  });

  it('renders nothing when no campaign is running', async () => {
    mockApi({ percent: null });
    const { container } = renderBadge();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
