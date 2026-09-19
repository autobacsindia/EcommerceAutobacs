/**
 * The closed-URL contract.
 *
 * Cloudflare Free purges by EXACT URL only, and keys its cache on the full URL
 * including the query string. So an endpoint is only safely purgeable if every
 * caller requests it with no query string — otherwise the purge succeeds,
 * reports success, and leaves the variants it did not know about stale.
 *
 * These tests pin that contract so a well-meaning "just add /categories to the
 * list" cannot quietly re-open it.
 */

import { jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { CLOSED_URL_PATHS, pathsForPatterns } from '../../../config/cdnPurgeUrls.js';

describe('closed URL map', () => {
  it('lists only bare paths — a query string means the set is not closed', () => {
    for (const [tag, paths] of Object.entries(CLOSED_URL_PATHS)) {
      for (const p of paths) {
        expect(p.startsWith('/')).toBe(true);
        // `?` here would mean we are purging ONE variant of a family and
        // pretending the family is covered.
        expect(p).not.toMatch(/[?#]/);
      }
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(tag).toBeTruthy();
    }
  });

  it('excludes the endpoints whose callers vary the query string', () => {
    // Each of these is requested with ?limit=, ?page= or a per-entity segment
    // somewhere in Front-end/web/src. They must be handled by dropping
    // s-maxage, never by a partial URL list here.
    const OPEN_VARIANT_PATHS = [
      '/products',
      '/products/featured',
      '/products/offers',
      '/products/facets',
      '/categories',
      '/brands',
      '/vehicles',
    ];
    const listed = Object.values(CLOSED_URL_PATHS).flat();
    for (const open of OPEN_VARIANT_PATHS) {
      expect(listed).not.toContain(open);
    }
  });
});

describe('pathsForPatterns', () => {
  it('maps a known invalidation tag to its edge URLs', () => {
    expect(pathsForPatterns(['vehicles'])).toEqual(['/vehicles/makes']);
    expect(pathsForPatterns(['reviews'])).toEqual(['/reviews/testimonials']);
  });

  it('returns nothing for open-variant tags like products', () => {
    // Not an oversight — see the OPEN_VARIANT_PATHS rationale above.
    expect(pathsForPatterns(['products'])).toEqual([]);
    expect(pathsForPatterns(['categories'])).toEqual([]);
    expect(pathsForPatterns(['brands'])).toEqual([]);
  });

  it('returns nothing for per-entity tags, without throwing', () => {
    expect(pathsForPatterns(['product:some-slug', 'reviews:product:abc'])).toEqual([]);
  });

  it('de-duplicates across patterns', () => {
    expect(pathsForPatterns(['vehicles', 'vehicles'])).toEqual(['/vehicles/makes']);
  });

  it('handles an empty or absent pattern list', () => {
    expect(pathsForPatterns([])).toEqual([]);
    expect(pathsForPatterns()).toEqual([]);
  });
});

describe('every listed path is actually served by a route', () => {
  // Guards the other direction: a typo'd path purges nothing, forever, silently.
  const ROUTES_DIR = path.join(process.cwd(), 'routes');
  const routeSource = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(path.join(ROUTES_DIR, f), 'utf8'))
    .join('\n');

  it.each(Object.values(CLOSED_URL_PATHS).flat())('%s has a matching router.get', (p) => {
    // Paths are mounted (e.g. '/vehicles/makes' = vehicles router + '/makes'),
    // so match on the final segment, which is what the route file declares.
    const lastSegment = p.split('/').filter(Boolean).pop();
    expect(routeSource).toMatch(new RegExp(`router\\.get\\(\\s*["'\`]/${lastSegment}["'\`]`));
  });
});
