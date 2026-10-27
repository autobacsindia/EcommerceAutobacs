/**
 * @jest-environment node
 */

/**
 * Crawler rules wired into the middleware: the WooCommerce-parameter 301 and the
 * noindex header on internal search. The pure rules are in lib/legacyQuery.test.ts;
 * this pins the wiring — status, ordering against the referral capture, and that
 * the header lands on search results and nowhere else.
 *
 * `jose` is stubbed for the same reason as middleware.referral.test.ts: it is
 * ESM-only, and every path under test returns before any JWT work.
 */
jest.mock('jose', () => ({ jwtVerify: jest.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const run = (url: string) => middleware(new NextRequest(new Request(url)));

describe('legacy WooCommerce parameters', () => {
  it('301s an old add-to-cart URL to the clean paginated page', async () => {
    const res = await run('https://shop.test/model/toyota-hilux/page/9?per_page=12&add-to-cart=11519');

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://shop.test/model/toyota-hilux/page/9');
    // A redirect sets no cookie, so the edge may cache it.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('keeps ?ref for the next hop instead of capturing it on this one', async () => {
    const res = await run('https://shop.test/products/x?ref=RAHUL10&layout=grid');

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://shop.test/products/x?ref=RAHUL10');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('does not touch the API proxy', async () => {
    const res = await run('https://shop.test/api/v1/products?per_page=12');
    expect(res.status).not.toBe(301);
  });

  it('lets a clean URL through', async () => {
    const res = await run('https://shop.test/model/toyota-hilux?sort=date');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('internal search results', () => {
  it.each([
    'https://shop.test/products/search?q=led',
    'https://shop.test/blog?search=lift',
    'https://shop.test/?s=hilux',
  ])('%s is served noindex, follow', async (u) => {
    const res = await run(u);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
  });

  it.each([
    'https://shop.test/blog',
    'https://shop.test/model/toyota-hilux',
    'https://shop.test/consultation?item=bull-bar',
  ])('%s carries no robots header (indexable)', async (u) => {
    const res = await run(u);
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });
});
