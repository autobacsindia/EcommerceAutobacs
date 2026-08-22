import { renderHook } from '@testing-library/react';
import { useRewardRibbonClaimsSlot } from './useRewardRibbon';

const mockPathname = jest.fn<string, []>();
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

const mockCampaign = jest.fn<{ data: { eligible: boolean } | undefined }, []>();
jest.mock('@/hooks/queries/useCampaign', () => ({
  useCampaign: () => mockCampaign(),
}));

/**
 * The precedence rule between the two bars that want the strip under the nav.
 * Both CampaignBanner and ConditionalPromoBanner read this one function, so a
 * disagreement here would mean either two stacked bars or none at all.
 */
describe('useRewardRibbonClaimsSlot', () => {
  const at = (path: string, eligible: boolean | undefined) => {
    mockPathname.mockReturnValue(path);
    mockCampaign.mockReturnValue({ data: eligible === undefined ? undefined : { eligible } });
    return renderHook(() => useRewardRibbonClaimsSlot()).result.current;
  };

  it('claims the slot for an eligible customer on a storefront page', () => {
    expect(at('/products', true)).toBe(true);
  });

  it('releases the slot when the customer is not eligible', () => {
    expect(at('/products', false)).toBe(false);
  });

  it('releases the slot while eligibility is still loading', () => {
    // Undefined must not be treated as eligible, or the promo strip would be
    // suppressed on first paint and then pop in — a visible layout jump.
    expect(at('/products', undefined)).toBe(false);
  });

  it.each(['/cart', '/admin', '/admin/orders', '/festive'])(
    'releases the slot on %s, where the ribbon does not render',
    (path) => {
      // Otherwise the promo strip would also hide on these routes, and the space
      // would sit empty for no reason.
      expect(at(path, true)).toBe(false);
    },
  );

  it('handles a trailing slash', () => {
    // skipTrailingSlashRedirect means '/cart/' is served verbatim.
    expect(at('/cart/', true)).toBe(false);
  });
});

/**
 * The home page is the one route where the two bars are NOT sorted out between the root
 * layout and ConditionalPromoBanner: its nav is `position: fixed` and it mounts its own
 * strip inside the hero's scroll track, so the layout's ribbon rendered underneath that
 * bar — invisible, while its flow height still pushed the page down — and the promo
 * image showed alongside it because the precedence gate was never consulted.
 *
 * The rule itself must stay route-agnostic: home is a PLACEMENT problem, not an
 * eligibility one. If '/' were suppressed here the ribbon would never show there at all.
 */
describe('useRewardRibbonClaimsSlot on the home page', () => {
  const at = (path: string, eligible: boolean | undefined) => {
    mockPathname.mockReturnValue(path);
    mockCampaign.mockReturnValue({ data: eligible === undefined ? undefined : { eligible } });
    return renderHook(() => useRewardRibbonClaimsSlot()).result.current;
  };

  it('still claims the slot on / — home is where it renders, not whether', () => {
    expect(at('/', true)).toBe(true);
  });

  it('claims nothing on / for an ineligible visitor', () => {
    expect(at('/', false)).toBe(false);
  });
});
