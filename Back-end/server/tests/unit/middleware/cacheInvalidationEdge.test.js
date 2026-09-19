/**
 * The write path reaches the EDGE, not just Redis.
 *
 * Redis invalidation has been correct for a long time; the edge was the half
 * nobody purged, which is why config/cacheProfiles.js cut TTLs to compensate.
 * This asserts the wiring itself — that invalidateCache hands the right paths
 * to the CDN service — because a broken hook here is invisible: Redis still
 * clears, the admin still sees success, and only the storefront stays stale.
 */

import { jest } from '@jest/globals';

const purgeEdgePaths = jest.fn();

jest.unstable_mockModule('../../../services/cdnPurgeService.js', () => ({
  purgeEdgePaths,
  purgeEverything: jest.fn(),
  isConfigured: () => true,
  default: { purgeEdgePaths },
}));

const { invalidateCache } = await import('../../../middleware/cacheMiddleware.js');
const { invalidatePublicCache } = await import('../../../middleware/publicCacheMiddleware.js');

const settle = () => new Promise((r) => setTimeout(r, 20));

// jest.config.js sets resetMocks:true, which strips the implementation before
// every test — so the resolved value has to be (re)installed here, not at
// creation, or the hook under test receives undefined and `.catch` throws.
beforeEach(() => {
  purgeEdgePaths.mockReset();
  purgeEdgePaths.mockResolvedValue(1);
});

describe('invalidateCache → edge purge', () => {
  it('purges the closed-set URLs for a vehicle write', async () => {
    invalidateCache('vehicles');
    await settle();
    expect(purgeEdgePaths).toHaveBeenCalledWith(['/vehicles/makes']);
  });

  it('does not call the CDN at all for open-variant tags', async () => {
    // /products, /categories and /brands are requested with varying query
    // strings, so there is no exact URL set to purge. Calling with [] would be
    // a wasted API request against a rate-limited quota.
    invalidateCache('products', 'categories', 'brands');
    await settle();
    expect(purgeEdgePaths).not.toHaveBeenCalled();
  });

  it('merges paths across patterns in one call', async () => {
    invalidateCache('vehicles', 'reviews');
    await settle();
    expect(purgeEdgePaths).toHaveBeenCalledTimes(1);
    expect(purgeEdgePaths.mock.calls[0][0].sort()).toEqual(
      ['/reviews/testimonials', '/vehicles/makes'].sort(),
    );
  });

  it('routes through the same chokepoint via the invalidatePublicCache alias', async () => {
    // The two helpers were byte-identical copies; the alias is what stops the
    // edge purge from being wired into one and not the other.
    invalidatePublicCache('vehicles');
    await settle();
    expect(purgeEdgePaths).toHaveBeenCalledWith(['/vehicles/makes']);
  });

  it('survives a rejecting CDN purge without an unhandled rejection', async () => {
    const onUnhandled = jest.fn();
    process.once('unhandledRejection', onUnhandled);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    purgeEdgePaths.mockRejectedValueOnce(new Error('cdn down'));

    expect(() => invalidateCache('vehicles')).not.toThrow();
    await settle();
    expect(onUnhandled).not.toHaveBeenCalled();
    process.removeListener('unhandledRejection', onUnhandled);
  });
});
