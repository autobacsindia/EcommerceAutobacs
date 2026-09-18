/**
 * The BROWSER copy of a cached response is the one nothing can purge.
 *
 * Redis entries are dropped by invalidatePublicCache on write, and an edge copy
 * can be purged at the CDN. A copy already sitting in someone's browser cache
 * cannot be reached by either — so `max-age` is a hard floor on how long a
 * stale answer can outlive a write, and it belongs short on every profile.
 *
 * Concrete failure this pins: `vehicle-data` shipped `max-age=1800`. Browsers
 * key their HTTP cache on the URL, NOT on cookies, so an admin's authenticated
 * fetch of /vehicles was served the public storefront's copy straight from disk.
 * A vehicle added seconds earlier was missing from the product fitment picker
 * for half an hour, and httpCache's "authenticated requests bypass the cache"
 * guard never ran because no request reached the server.
 *
 * Long TTLs go on `s-maxage`, at the edge, where a purge can reach them.
 */

const { HTTP_CACHE_HEADERS } = await import('../../../config/cacheProfiles.js');

const directive = (header, name) => {
  const match = new RegExp(`(?:^|[,\\s])${name}=(\\d+)`).exec(header);
  return match ? Number(match[1]) : null;
};

const MAX_BROWSER_TTL_SECONDS = 300;

describe('HTTP_CACHE_HEADERS browser TTLs', () => {
  it.each(Object.entries(HTTP_CACHE_HEADERS))(
    "'%s' keeps max-age short enough that a stale write self-heals",
    (_name, header) => {
      const maxAge = directive(header, 'max-age');
      expect(maxAge).not.toBeNull();
      expect(maxAge).toBeLessThanOrEqual(MAX_BROWSER_TTL_SECONDS);
    },
  );

  it('vehicle-data no longer pins a vehicle list in the browser for 30 minutes', () => {
    const header = HTTP_CACHE_HEADERS['vehicle-data'];
    expect(directive(header, 'max-age')).toBeLessThanOrEqual(60);
  });

  it('vehicle-data does not let the edge outlive the origin cache', () => {
    const header = HTTP_CACHE_HEADERS['vehicle-data'];

    // NOTHING in this codebase purges Cloudflare — invalidatePublicCache clears
    // Redis only — so s-maxage is not "worst case before a purge", it is simply
    // how long a deleted vehicle keeps being served. Vehicle deletion is
    // permanent now, so a stale edge copy links the storefront to a hard 404.
    expect(directive(header, 's-maxage')).toBeLessThanOrEqual(300);

    // stale-while-revalidate stacks ON TOP of s-maxage. On data with no purge
    // path that is pure added staleness, so this profile must not carry one.
    expect(directive(header, 'stale-while-revalidate')).toBeNull();
  });
});
