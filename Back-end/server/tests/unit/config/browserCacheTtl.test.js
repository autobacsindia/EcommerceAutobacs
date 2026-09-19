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

const { HTTP_CACHE_HEADERS, CACHE_PROFILES, resolveCacheControl } =
  await import('../../../config/cacheProfiles.js');

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

    // The edge IS purgeable now (services/cdnPurgeService.js) — but only for
    // URLs with a closed set, and `vehicle-data` is worn by VEHICLE_LIST, whose
    // /vehicles is also fetched as ?limit=1000. That open set is un-purgeable,
    // so for THIS profile s-maxage remains "how long a deleted vehicle keeps
    // being served", not "worst case before a purge". Deletion is permanent, so
    // a stale edge copy links the storefront to a hard 404.
    expect(directive(header, 's-maxage')).toBeLessThanOrEqual(300);

    // stale-while-revalidate stacks ON TOP of s-maxage. On data with no purge
    // path that is pure added staleness, so this profile must not carry one.
    expect(directive(header, 'stale-while-revalidate')).toBeNull();
  });

  it('purgeable-static may outlive the others, because a write can reach it', () => {
    // The inverse of the rule above, and the reason the purge work was done: a
    // closed URL set IS purged on write, so a long s-maxage is a real worst case
    // rather than a staleness window. If this ever drops back to ~300 someone
    // has "tidied" away the benefit.
    const header = HTTP_CACHE_HEADERS['purgeable-static'];
    expect(directive(header, 's-maxage')).toBeGreaterThan(300);

    // The browser floor still applies — nothing can purge a disk cache.
    expect(directive(header, 'max-age')).toBeLessThanOrEqual(60);
  });

  it('no un-purgeable profile SHIPS a long s-maxage', () => {
    // Asserted on the RESOLVED header, not the template: an edge:'none' profile
    // is downgraded to `private` by resolveCacheControl, so the s-maxage sitting
    // in its shared header template is dead and irrelevant. What matters is the
    // string that actually reaches Cloudflare.
    //
    // Pointing an un-purgeable profile at a long-lived header is the exact
    // mistake this classification exists to prevent, and it would look entirely
    // reasonable in review.
    for (const [name, profile] of Object.entries(CACHE_PROFILES)) {
      if (!profile.http) continue;
      const shipped = resolveCacheControl(profile);
      const sMaxAge = directive(shipped, 's-maxage') ?? 0;
      if (sMaxAge > 300) {
        expect(`${name}:${profile.edge}`).toBe(`${name}:purgeable`);
      }
    }
  });

  it('every money-path profile ships `private`, so no shared cache can hold a price', () => {
    for (const [name, profile] of Object.entries(CACHE_PROFILES)) {
      if (profile.edge !== 'none') continue;
      const shipped = resolveCacheControl(profile);
      expect(`${name}: ${shipped}`).toMatch(/: private,/);
      expect(shipped).not.toMatch(/s-maxage/);
    }
  });
});
