/**
 * Every cacheable route states whether Cloudflare may hold it — and why.
 *
 * Before this classification existed, every profile carried `s-maxage` and
 * nothing purged the edge, so staleness was uniform, invisible and unintended.
 * The fix is not "cache less"; it is that the decision must be MADE, per route,
 * and survive review. These tests are what stop it decaying back to a default.
 */

import { readFileSync } from 'fs';
import path from 'path';
import {
  CACHE_PROFILES,
  EDGE_MODES,
  isStorableCacheControl,
  resolveCacheControl,
  toPrivateHeader,
} from '../../../config/cacheProfiles.js';
import { CLOSED_URL_PATHS } from '../../../config/cdnPurgeUrls.js';

const cacheable = Object.entries(CACHE_PROFILES).filter(([, p]) => p.http);

describe('classification is mandatory', () => {
  it('has profiles to check (guards the guard)', () => {
    expect(cacheable.length).toBeGreaterThan(15);
  });

  it.each(cacheable)('%s declares a valid edge mode', (_name, profile) => {
    expect(EDGE_MODES).toContain(profile.edge);
  });

  it('rejects a profile with no classification at import time', () => {
    // The real enforcement is a throw in cacheProfiles.js at module load. Pin
    // the message, because a silent default is exactly the failure mode.
    const source = readFileSync(
      path.join(process.cwd(), 'config', 'cacheProfiles.js'),
      'utf8',
    );
    expect(source).toMatch(/EDGE_MODES\.includes\(profile\.edge\)/);
    expect(source).toMatch(/edge === 'ttl' && !profile\.edgeReason/);
  });
});

describe("edge: 'ttl' must justify itself", () => {
  const ttl = cacheable.filter(([, p]) => p.edge === 'ttl');

  it('is actually used — otherwise these assertions are vacuous', () => {
    expect(ttl.length).toBeGreaterThan(0);
  });

  it.each(ttl)('%s explains why unpurgeable staleness is acceptable', (_name, profile) => {
    expect(typeof profile.edgeReason).toBe('string');
    // A one-word reason is not a reason.
    expect(profile.edgeReason.length).toBeGreaterThan(40);
  });
});

describe("edge: 'purgeable' must really be purgeable", () => {
  const purgeable = cacheable.filter(([, p]) => p.edge === 'purgeable');
  const closedTags = new Set(Object.keys(CLOSED_URL_PATHS));

  it('is actually used', () => {
    expect(purgeable.length).toBeGreaterThan(0);
  });

  it.each(purgeable)('%s has every tag present in the closed-URL map', (_name, profile) => {
    // Claiming 'purgeable' without a matching entry in cdnPurgeUrls.js means the
    // write path purges nothing while the long s-maxage keeps serving the old
    // answer — strictly worse than declaring 'ttl'.
    const tags = Array.isArray(profile.tags) ? profile.tags : [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(closedTags).toContain(tag);
  });
});

describe("edge: 'none' keeps prices out of shared caches", () => {
  const money = cacheable.filter(([, p]) => p.edge === 'none');

  it('covers the product, category and brand surfaces', () => {
    const names = money.map(([n]) => n);
    // Named explicitly: these are the ones that render a price, a discount or an
    // availability claim, and none of them has a closed URL set to purge.
    for (const required of [
      'PRODUCT_LIST',
      'PRODUCT_DETAIL',
      'PRODUCT_FACETS',
      'CATEGORY_LIST',
      'CATEGORY_ITEM',
      'BRAND_LIST',
    ]) {
      expect(names).toContain(required);
    }
  });

  it.each(money)('%s never reaches a shared cache', (_name, profile) => {
    const shipped = resolveCacheControl(profile);
    expect(shipped).toMatch(/^private, max-age=\d+$/);
  });
});

describe('toPrivateHeader', () => {
  it('keeps the browser TTL and drops every shared-cache directive', () => {
    expect(
      toPrivateHeader('public, max-age=60, s-maxage=300, stale-while-revalidate=3600'),
    ).toBe('private, max-age=60');
  });

  it('falls back to max-age=0 when the source header declares none', () => {
    // Safer than carrying an unbounded browser cache forward.
    expect(toPrivateHeader('public, s-maxage=600')).toBe('private, max-age=0');
  });

  it('is not fooled by the max-age inside stale-while-revalidate', () => {
    expect(toPrivateHeader('public, s-maxage=600, max-age=120')).toBe('private, max-age=120');
  });
});

describe('isStorableCacheControl — the CSRF interop predicate', () => {
  /**
   * REGRESSION. Introducing `private, max-age=N` for money-path profiles broke
   * this predicate's older form (`/^public/`), which read those responses as
   * non-cacheable. csrfMiddleware then minted the XSRF-TOKEN cookie on them,
   * httpCache refused to store any response carrying Set-Cookie, and the Redis
   * layer went inert on /products, /categories, /brands — while every header
   * still looked deliberate. Same shape as the 2026-08-03 site-wide outage.
   *
   * The predicate must answer "will a cache WE control store this", which
   * includes Redis, not "may a SHARED cache store this".
   */
  it('treats a money-path private header as storable — Redis still holds it', () => {
    expect(isStorableCacheControl('private, max-age=300')).toBe(true);
  });

  it('treats a public edge header as storable', () => {
    expect(isStorableCacheControl('public, max-age=60, s-maxage=300')).toBe(true);
  });

  it('treats no-store as not storable, however it is spelled', () => {
    expect(isStorableCacheControl('private, no-store, no-cache, must-revalidate')).toBe(false);
    expect(isStorableCacheControl('no-store, no-cache, must-revalidate')).toBe(false);
  });

  it('treats max-age=0 as not storable', () => {
    expect(isStorableCacheControl('private, max-age=0')).toBe(false);
  });

  it('treats a missing header as not storable, so the cookie is still minted', () => {
    // Routes with no cache profile must keep getting a CSRF token.
    expect(isStorableCacheControl('')).toBe(false);
    expect(isStorableCacheControl(undefined)).toBe(false);
    expect(isStorableCacheControl(null)).toBe(false);
  });

  it('agrees with what every cacheable profile actually ships', () => {
    // The end-to-end invariant: if httpCache will store it, CSRF must suppress.
    for (const [name, profile] of Object.entries(CACHE_PROFILES)) {
      if (!profile.http) continue;
      expect(`${name}:${isStorableCacheControl(resolveCacheControl(profile))}`).toBe(`${name}:true`);
    }
  });
});
