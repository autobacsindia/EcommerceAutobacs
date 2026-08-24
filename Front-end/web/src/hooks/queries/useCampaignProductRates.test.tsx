/**
 * useCampaignProductRates — batched, identity-free lookup of what each product
 * earns under the running campaign.
 *
 * Regression coverage for the id cap: a `showAll=true` product grid can hand this
 * hook hundreds of ids. Sent uncapped, that overflows the backend's `ids` query-param
 * validator (`isLength({ max: 2000 })`) and 400s — which would blank out every badge
 * on the page, not just the ones past the server's own MAX_RATE_LOOKUP=60. The hook
 * must cap client-side so the request it actually sends always succeeds.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCampaignProductRates, lineSavings } from './useCampaignProductRates';

const getMock = jest.fn();
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => getMock(...a) },
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({ success: true, campaign: { slug: 'festive-2026', endsAt: null, rates: {} } });
});

describe('useCampaignProductRates', () => {
  it('dedupes repeated ids before building the request', async () => {
    const { result } = renderHook(() => useCampaignProductRates(['a', 'b', 'a']), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = getMock.mock.calls[0];
    expect(url).toContain('ids=a%2Cb');
    expect(url).not.toContain('a%2Cb%2Ca');
  });

  it('caps the ids sent to the server cap (60), never sending an oversized query string', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `p${i}`);
    const { result } = renderHook(() => useCampaignProductRates(ids), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = getMock.mock.calls[0] as [string];
    const sentIds = decodeURIComponent(url.split('ids=')[1]).split(',');
    expect(sentIds).toHaveLength(60);
    expect(sentIds).toEqual(ids.slice(0, 60));
    // The validator on Back-end/server/validators/campaign.validator.js rejects past 2000.
    expect(url.length).toBeLessThan(2000);
  });

  it('does not fetch when given no ids', () => {
    const { result } = renderHook(() => useCampaignProductRates([]), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('lineSavings', () => {
  it('splits catalog vs campaign savings and floors campaign paise like the server', () => {
    const { catalog, campaign, total } = lineSavings({ price: 999, originalPrice: 1299, quantity: 2, percent: 8 });
    expect(catalog).toBeCloseTo(600); // (1299-999)*2
    expect(campaign).toBeCloseTo(159.84); // floor(999*100*2 * 8/100)/100
    expect(total).toBeCloseTo(catalog + campaign);
  });

  it('is zero when the shopper cannot claim the campaign', () => {
    const { campaign } = lineSavings({ price: 999, quantity: 1, percent: undefined });
    expect(campaign).toBe(0);
  });
});
