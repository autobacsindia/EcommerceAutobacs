import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CampaignMeter from './CampaignMeter';
import { nextTier, type CampaignStatus } from '@/hooks/queries/useCampaign';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
import apiClient from '@/lib/api';

const STATUS: CampaignStatus = {
  slug: 'festive-2026',
  name: 'Festive 2026',
  endsAt: null,
  couponCode: 'FESTIVE2026',
  eligible: true,
  reason: null,
  reasonCode: null,
  tier: { tierId: 'festive20', label: 'Festive 20', percent: 20, discountPaise: 1000000 },
  tiers: [
    { id: 'festive20', label: 'Festive 20', minCartValue: 0, percent: 20, maxDiscount: 20000 },
    { id: 'grand10', label: 'Grand 10', minCartValue: 100000, percent: 10, maxDiscount: null },
  ],
  maxDiscountPerOrder: 50000,
  // This campaign is priced by the CART-VALUE ladder above, so it carries no
  // per-product ladder — the two are mutually exclusive by configuration.
  productLadder: null,
};

function renderMeter(props: { cartValue: number; appliedDiscount?: number }, status = STATUS) {
  (apiClient.get as jest.Mock).mockResolvedValue({ success: true, campaign: status });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampaignMeter {...props} />
    </QueryClientProvider>,
  );
}

describe('CampaignMeter', () => {
  beforeEach(() => jest.clearAllMocks());

  // ₹30,000 is chosen so the three figures are all distinct — saving ₹6,000, ₹70,000
  // more to reach the next rung, ₹14,000 extra there — and an assertion cannot pass by
  // matching the wrong number.
  it('shows the saving the server actually granted, not its own maths', async () => {
    // The server's quote is authoritative; the meter must mirror it rather than
    // recompute, or the cart could advertise a discount the checkout will not honour.
    renderMeter({ cartValue: 30000, appliedDiscount: 6000 });
    expect(await screen.findByText('₹6,000')).toBeInTheDocument();
  });

  it('nudges toward the next tier only when it genuinely pays more', async () => {
    renderMeter({ cartValue: 30000, appliedDiscount: 6000 });
    expect(await screen.findByText(/Add/)).toBeInTheDocument();
    expect(screen.getByText('₹70,000')).toBeInTheDocument();   // amount to add
    expect(screen.getByText(/₹14,000/)).toBeInTheDocument();   // extra saving unlocked
  });

  it('renders nothing for an empty cart', () => {
    const { container } = renderMeter({ cartValue: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the visitor is not eligible', async () => {
    const { container } = renderMeter(
      { cartValue: 50000 },
      { ...STATUS, eligible: false, tier: null, couponCode: null },
    );
    // Nothing to assert asynchronously — an ineligible visitor must never see the offer.
    expect(container).toBeEmptyDOMElement();
  });

  it('says the top tier is reached instead of promising more', async () => {
    renderMeter({ cartValue: 600000, appliedDiscount: 50000 });
    expect(await screen.findByText(/unlocked the best tier/i)).toBeInTheDocument();
  });

  // The mocked status carries a fixed tier of ₹10,000 (discountPaise 1000000), so these
  // assert the component falls back to the TIER figure rather than the passed-in value.
  it('ignores a zero appliedDiscount and falls back to the tier', async () => {
    // A real 0 was previously treated as authoritative, rendering "Festive 20 — ₹0"
    // while the tier said the customer had earned something.
    renderMeter({ cartValue: 30000, appliedDiscount: 0 });
    expect(await screen.findByText('₹10,000')).toBeInTheDocument();
  });

  it('ignores a null appliedDiscount (an unrelated coupon is applied)', async () => {
    // The cart passes null when the quote's coupon is NOT this campaign's, so another
    // coupon's discount can never be displayed under the festive label.
    renderMeter({ cartValue: 30000, appliedDiscount: null });
    expect(await screen.findByText('₹10,000')).toBeInTheDocument();
  });

  it('renders nothing when eligible but no tier is earned yet', async () => {
    // Eligibility no longer depends on cart value, so an eligible customer with a
    // trivial cart reaches here with tier null — there is nothing to celebrate.
    const { container } = renderMeter(
      { cartValue: 100 },
      { ...STATUS, tier: null },
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('nextTier', () => {
  it('never promises a next tier that pays less', () => {
    // The whole point of best-for-customer resolution: at ₹1,50,000 the 10% tier is
    // worth ₹15,000 while the capped 20% tier already gives ₹20,000, so suggesting
    // "spend more to reach 10%" would be a lie.
    expect(nextTier(STATUS, 150000)).toBeNull();
  });

  it('reports the gap and the extra saving at the ₹1 lakh rung', () => {
    const n = nextTier(STATUS, 50000);
    expect(n).toEqual(expect.objectContaining({ addRupees: 50000, extraRupees: 10000 }));
  });

  it('returns null with no tiers', () => {
    expect(nextTier({ ...STATUS, tiers: [] }, 50000)).toBeNull();
    expect(nextTier(undefined, 50000)).toBeNull();
  });

  it('respects the absolute per-order ceiling', () => {
    // Ceiling ₹50,000 is already reached at ₹5,00,000, so nothing further is promised.
    expect(nextTier(STATUS, 500000)).toBeNull();
  });
});

describe('CampaignMeter — per-product campaign', () => {
  beforeEach(() => jest.clearAllMocks());

  /*
    `tiers` is empty — the two ladders are mutually exclusive — so every cart-value
    affordance in this component has to stand down, or the meter starts making promises
    the pricing engine will not keep.
  */
  const PRODUCT_STATUS: CampaignStatus = {
    ...STATUS,
    tier: null,
    tiers: [],
    productLadder: { maxPercent: 8, defaultPercent: 4, onSaleMaxPercent: 2 },
  };

  it('still shows the saving the server granted', async () => {
    renderMeter({ cartValue: 30000, appliedDiscount: 1200 }, PRODUCT_STATUS);
    expect(await screen.findByText('₹1,200')).toBeInTheDocument();
  });

  it('publishes the three rates so a small saving reads as the rule, not a short-change', async () => {
    renderMeter({ cartValue: 30000, appliedDiscount: 1200 }, PRODUCT_STATUS);
    expect(await screen.findByText('8%')).toBeInTheDocument();
    expect(screen.getByText('4%')).toBeInTheDocument();
    expect(screen.getByText('2%')).toBeInTheDocument();
  });

  it('never claims a bigger cart earns more, because it does not', async () => {
    /* The rate follows the product here. "Add ₹X more to save ₹Y extra" would be an
       untrue promise, and "you've unlocked the best tier available" names a ladder
       that does not exist. Both belong to the cart-value shape only. */
    renderMeter({ cartValue: 30000, appliedDiscount: 1200 }, PRODUCT_STATUS);
    await screen.findByText('₹1,200');
    expect(screen.queryByText(/more to save/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unlocked the best tier/i)).not.toBeInTheDocument();
  });
});
