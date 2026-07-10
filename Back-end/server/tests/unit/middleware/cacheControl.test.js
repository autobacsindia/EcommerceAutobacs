/**
 * Cache-Control policy for taxonomy responses.
 *
 * Nothing can purge a CDN edge from a Mongo write, so `s-maxage` is a window of
 * staleness no code path can close. It was 7200 (2h): once api.<domain> sits
 * behind Cloudflare, an admin renaming a category would watch the storefront
 * ignore them for two hours. These pin the bound.
 */

import { jest } from '@jest/globals';

const { cacheMiddleware } = await import('../../../middleware/cacheControl.js');

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const run = (type) => {
  const headers = {};
  const res = { set: (k, v) => { headers[k] = v; } };
  cacheMiddleware(type)({}, res, jest.fn());
  return headers;
};

/** `s-maxage=300` → 300 */
const directive = (header, name) => {
  const match = new RegExp(`(?:^|,\\s*)${name}=(\\d+)`).exec(header);
  return match ? Number(match[1]) : null;
};

afterEach(() => { process.env.NODE_ENV = ORIGINAL_NODE_ENV; });

describe('static-data (categories / brands) in production', () => {
  beforeEach(() => { process.env.NODE_ENV = 'production'; });

  it('bounds unpurgeable edge staleness to 5 minutes', () => {
    const sMaxAge = directive(run('static-data')['Cache-Control'], 's-maxage');
    expect(sMaxAge).toBe(300);
  });

  it('keeps edge hit-rate via stale-while-revalidate rather than a long s-maxage', () => {
    const header = run('static-data')['Cache-Control'];
    expect(directive(header, 'stale-while-revalidate')).toBeGreaterThan(0);
    expect(directive(header, 'stale-if-error')).toBeGreaterThan(0);
  });

  it('never lets the browser hold taxonomy longer than the edge', () => {
    const header = run('static-data')['Cache-Control'];
    expect(directive(header, 'max-age')).toBeLessThanOrEqual(directive(header, 's-maxage'));
  });
});

describe('outside production', () => {
  it('never caches, so local admin edits always surface', () => {
    process.env.NODE_ENV = 'development';
    expect(run('static-data')['Cache-Control']).toContain('no-store');
  });
});

describe('unknown cache types', () => {
  it('fall back to no-store rather than silently caching', () => {
    process.env.NODE_ENV = 'production';
    expect(run('not-a-real-type')['Cache-Control']).toContain('no-store');
  });
});
