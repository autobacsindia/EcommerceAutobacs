import { render, screen } from '@testing-library/react';
import CampaignBanner from './CampaignBanner';
import type { CampaignStatus } from '@/hooks/queries/useCampaign';

const mockPathname = jest.fn<string, []>();
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

const mockClaimsSlot = jest.fn<boolean, []>();
jest.mock('@/hooks/useRewardRibbon', () => ({
  useRewardRibbonClaimsSlot: () => mockClaimsSlot(),
}));

const mockCampaign = jest.fn<{ data: CampaignStatus | undefined }, []>();
jest.mock('@/hooks/queries/useCampaign', () => ({
  useCampaign: () => mockCampaign(),
}));

const CAMPAIGN = {
  slug: 'festive-2026', name: 'Festive', endsAt: null, couponCode: 'FESTIVE2026',
  eligible: true, reason: null, reasonCode: null,
  tier: null, tiers: [],
  productLadder: { maxPercent: 8, defaultPercent: 4, onSaleMaxPercent: 2 },
} as unknown as CampaignStatus;

function renderBanner(path: string, props: { inHomeSlot?: boolean; className?: string } = {}) {
  mockPathname.mockReturnValue(path);
  mockClaimsSlot.mockReturnValue(true);
  mockCampaign.mockReturnValue({ data: CAMPAIGN });
  return render(<CampaignBanner {...props} />);
}

/** The ribbon's own element — the one carrying its look. */
const ribbon = () => screen.getByText(/Your festive reward is active/i).closest('div')!.parentElement!;

describe('CampaignBanner placement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stands down on / when mounted by the root layout', () => {
    // The home nav is `position: fixed` and lives inside HomeRedesign, so a ribbon
    // rendered from the layout sits underneath it — invisible, still taking space.
    const { container } = renderBanner('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders on / when the home page places it into its own slot', () => {
    renderBanner('/', { inHomeSlot: true, className: 'hr-promo-slot hr-unscoped' });
    expect(screen.getByText(/Your festive reward is active/i)).toBeInTheDocument();
  });

  it('keeps the slot class OFF the ribbon element, on a wrapper around it', () => {
    /*
      The regression this pins: the slot class was applied to the ribbon's own element,
      so the slot's placement rules (overlay positioning, mobile nav clearance, opaque
      ground) landed on the same box that carries the ribbon's look — and the home
      ribbon rendered visibly different from the one on every other page.
    */
    const { container } = renderBanner('/', { inHomeSlot: true, className: 'hr-promo-slot' });
    const wrapper = container.firstElementChild!;
    expect(wrapper).toHaveClass('hr-promo-slot');
    expect(ribbon()).not.toHaveClass('hr-promo-slot');
    expect(ribbon().className).toBe(
      'relative bg-gradient-to-r from-gold/20 via-gold/10 to-transparent border-b border-gold/25',
    );
  });

  it('renders the identical ribbon element off the home page', () => {
    // Same component, same classes — the two placements must not diverge in look.
    renderBanner('/products');
    expect(ribbon().className).toBe(
      'relative bg-gradient-to-r from-gold/20 via-gold/10 to-transparent border-b border-gold/25',
    );
  });

  it('leaves no empty slot behind when it does not render', () => {
    // The wrapper is inside this component on purpose: on mobile the slot is in flow,
    // so an empty div would show as an unexplained gap under the nav.
    mockPathname.mockReturnValue('/');
    mockClaimsSlot.mockReturnValue(false);
    mockCampaign.mockReturnValue({ data: CAMPAIGN });
    const { container } = render(<CampaignBanner inHomeSlot className="hr-promo-slot" />);
    expect(container).toBeEmptyDOMElement();
  });
});
