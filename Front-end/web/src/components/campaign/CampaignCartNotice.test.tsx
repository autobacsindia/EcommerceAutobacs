import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CampaignCartNotice from './CampaignCartNotice';
import type { CampaignStatus } from '@/hooks/queries/useCampaign';

jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `₹${n.toLocaleString('en-IN')}` }),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
import apiClient from '@/lib/api';

const BASE: CampaignStatus = {
  slug: 'festive-2026', name: 'Festive', endsAt: null, couponCode: 'FESTIVE2026',
  eligible: true, reason: null, reasonCode: null,
  tier: null, tiers: [], maxDiscountPerOrder: 50000,
  productLadder: { maxPercent: 8, defaultPercent: 4, onSaleMaxPercent: 2 },
};

function renderNotice(
  props: { applied: boolean; discount: number },
  campaign: CampaignStatus | null = BASE,
) {
  (apiClient.get as jest.Mock).mockResolvedValue({ success: true, campaign });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampaignCartNotice {...props} />
    </QueryClientProvider>,
  );
}

describe('CampaignCartNotice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('confirms the offer when the SERVER actually priced it', async () => {
    renderNotice({ applied: true, discount: 10263 });
    expect(await screen.findByText(/festive offer applied/i)).toBeInTheDocument();
    expect(screen.getByText('₹10,263')).toBeInTheDocument();
  });

  it('tells a signed-out shopper what signing in is worth', async () => {
    // The gap that started this: a guest saw no discount and no reason for its absence.
    renderNotice({ applied: false, discount: 0 }, { ...BASE, eligible: false, reasonCode: 'login' });
    expect(await screen.findByText(/up to 8% off/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in to apply it/i })).toBeInTheDocument();
  });

  it('points an unverified shopper at the one thing that unblocks them', async () => {
    renderNotice({ applied: false, discount: 0 }, { ...BASE, eligible: false, reasonCode: 'unverified' });
    expect(await screen.findByRole('link', { name: /confirm your email/i })).toBeInTheDocument();
  });

  it('names the fallback code when eligible but nothing applied', async () => {
    /* Eligible and yet unpriced means the auto-apply did not land. Silence here is
       exactly how a working campaign came to look broken. */
    renderNotice({ applied: false, discount: 0 });
    expect(await screen.findByText(/your festive offer is active/i)).toBeInTheDocument();
    expect(screen.getByText('FESTIVE2026')).toBeInTheDocument();
  });

  it('says nothing to someone who has already redeemed', async () => {
    const { container } = renderNotice(
      { applied: false, discount: 0 },
      { ...BASE, eligible: false, reasonCode: 'already_used' },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing once the offer is fully claimed', async () => {
    const { container } = renderNotice(
      { applied: false, discount: 0 },
      { ...BASE, eligible: false, reasonCode: 'exhausted' },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing when no campaign is running', async () => {
    const { container } = renderNotice({ applied: false, discount: 0 }, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('never claims an applied offer worth nothing', async () => {
    // `applied` true with a zero discount would print "you are saving ₹0".
    renderNotice({ applied: true, discount: 0 });
    expect(await screen.findByText(/your festive offer is active/i)).toBeInTheDocument();
    expect(screen.queryByText(/festive offer applied/i)).not.toBeInTheDocument();
  });
});
