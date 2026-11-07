import { serverFetch } from '@/lib/server-api';
import {
  FESTIVAL_OFFER_FAILURE_BACKOFF_MS,
  getFestivalOffer,
  resetFestivalOfferBackoff,
} from './festivalOffer';

jest.mock('@/lib/server-api', () => ({ serverFetch: jest.fn() }));

const mockFetch = serverFetch as jest.MockedFunction<typeof serverFetch>;
const NOW = Date.parse('2026-11-07T12:00:00Z');
const OFFER = { code: 'diwali', startsAt: null, endsAt: null, live: true, tiers: [{ minPaise: 0, percent: 10 }] };

/*
  The root layout calls getFestivalOffer() for every page, and Next's data cache keeps
  only successful responses. Without a back-off, a failing endpoint is hit once per
  prerendered page — that is what failed the Vercel build with 429s on PR #449.
*/
describe('getFestivalOffer — failure back-off', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetFestivalOfferBackoff();
  });

  it('returns the offer when the backend answers', async () => {
    mockFetch.mockResolvedValue({ success: true, offer: OFFER });
    await expect(getFestivalOffer(NOW)).resolves.toEqual(OFFER);
    await expect(getFestivalOffer(NOW + 1)).resolves.toEqual(OFFER);
    expect(mockFetch).toHaveBeenCalledTimes(2); // success path is left to Next's data cache
  });

  it('after one failure, skips the backend for the back-off window (one request, not one per page)', async () => {
    mockFetch.mockRejectedValue(new Error('404 Not Found'));
    await expect(getFestivalOffer(NOW)).resolves.toBeNull();
    for (let page = 1; page <= 50; page++) {
      await expect(getFestivalOffer(NOW + page * 100)).resolves.toBeNull();
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('tries the backend again once the window has passed', async () => {
    mockFetch.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    await getFestivalOffer(NOW);
    mockFetch.mockResolvedValue({ success: true, offer: OFFER });
    await expect(getFestivalOffer(NOW + FESTIVAL_OFFER_FAILURE_BACKOFF_MS - 1)).resolves.toBeNull();
    await expect(getFestivalOffer(NOW + FESTIVAL_OFFER_FAILURE_BACKOFF_MS)).resolves.toEqual(OFFER);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('"offer: null" (switched off) is a normal answer, not a failure', async () => {
    mockFetch.mockResolvedValue({ success: true, offer: null });
    await expect(getFestivalOffer(NOW)).resolves.toBeNull();
    await expect(getFestivalOffer(NOW + 1)).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
