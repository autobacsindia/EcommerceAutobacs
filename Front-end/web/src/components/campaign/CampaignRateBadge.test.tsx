import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CampaignRateBadge from './CampaignRateBadge';

// The badge must format money the same way the rest of the page does; the real provider
// is not the thing under test here.
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n.toLocaleString('en-IN')}` }),
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

  it('shows the rate and what it is worth on this item', async () => {
    mockApi({ percent: 8 });
    renderBadge();
    expect(await screen.findByText(/save 8% more/i)).toBeInTheDocument();
    expect(screen.getByText('₹800')).toBeInTheDocument();
  });

  it('shows to a signed-out visitor, with the reason to sign in', async () => {
    // The offer is public and the card is printed — a rate on the page is the thing
    // that makes signing in worth doing.
    mockApi({ eligible: false, reasonCode: 'login', percent: 8 });
    renderBadge();
    expect(await screen.findByText(/save 8% more/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in to claim it/i)).toBeInTheDocument();
  });

  it('points an unverified shopper at the one thing that unblocks them', async () => {
    mockApi({ eligible: false, reasonCode: 'unverified', percent: 8 });
    renderBadge();
    expect(await screen.findByText(/confirm your email/i)).toBeInTheDocument();
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
    expect(screen.getByText(/save 2% more/i)).toBeInTheDocument();
  });

  it('renders nothing when no campaign is running', async () => {
    mockApi({ percent: null });
    const { container } = renderBadge();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
