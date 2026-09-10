/**
 * @jest-environment node
 */

/**
 * `?ref=` capture — the entry point of the whole affiliate attribution chain.
 *
 * Untested until now, and it is the one link in that chain that runs on the EDGE, where
 * a mistake is invisible: no server log, no error, just an affiliate who never gets
 * credited and cannot tell you why.
 *
 * `node` environment, not jsdom: NextRequest needs the real Request/Response globals.
 */

/*
  `jose` ships ESM-only and jest does not transform node_modules, so importing the
  middleware pulls in a module it cannot parse. Stubbing it is honest here: the referral
  capture returns BEFORE any JWT work — that ordering is itself part of what these tests
  assert — so no behaviour under test touches the real implementation.
*/
jest.mock('jose', () => ({ jwtVerify: jest.fn() }));

import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const request = (url: string) => new NextRequest(new Request(url));

/** The Set-Cookie header, or null. */
const setCookie = (res: Response) => res.headers.get('set-cookie');

describe('?ref= capture', () => {
  it('sets the cookie and redirects to the clean URL', async () => {
    const res = await middleware(request('https://shop.test/?ref=RAHUL10'));

    // 307 preserves the method; the point is that ?ref never becomes canonical.
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://shop.test/');
    expect(setCookie(res)).toContain('ab_ref=RAHUL10');
  });

  /*
    The attributes are the security surface. HttpOnly keeps it out of reach of injected
    script; SameSite=Lax still allows the top-level navigation from an affiliate's own
    site, which is the only way this cookie is ever set.
  */
  it('sets it HttpOnly, Secure, SameSite=Lax, site-wide', async () => {
    const cookie = setCookie(await middleware(request('https://shop.test/?ref=RAHUL10')))!;

    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it('uppercases the code, so a lowercased link still credits the affiliate', async () => {
    const cookie = setCookie(await middleware(request('https://shop.test/?ref=rahul10')))!;
    expect(cookie).toContain('ab_ref=RAHUL10');
  });

  /*
    An affiliate links to a product, not the homepage. Losing their other query params
    would break the very link they published.
  */
  it('preserves every other query parameter', async () => {
    const res = await middleware(request('https://shop.test/products?ref=RAHUL10&sort=new&page=2'));

    const location = res.headers.get('location')!;
    expect(location).toContain('sort=new');
    expect(location).toContain('page=2');
    expect(location).not.toContain('ref=');
  });

  it('works on a deep path, not just the homepage', async () => {
    const res = await middleware(request('https://shop.test/products/alloy-wheel?ref=RAHUL10'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://shop.test/products/alloy-wheel');
    expect(setCookie(res)).toContain('ab_ref=RAHUL10');
  });

  /*
    Still redirect (so a junk ?ref never becomes canonical), but store nothing. A
    malformed code is not a claim, and writing it would only be read back and discarded.
  */
  it.each([
    ['too short', 'x'],
    ['starts with a separator', '-RAHUL'],
    ['has a space', 'RAHUL 10'],
    ['script-ish', '<script>'],
    ['empty', ''],
  ])('cleans the URL but stores nothing for a %s code', async (_label, code) => {
    const res = await middleware(request(`https://shop.test/?ref=${encodeURIComponent(code)}`));

    expect(res.status).toBe(307);
    expect(setCookie(res)).toBeNull();
  });

  it('does nothing at all when there is no ref', async () => {
    const res = await middleware(request('https://shop.test/products'));

    // Not a redirect — the request proceeds normally.
    expect(res.status).not.toBe(307);
    expect(setCookie(res)).toBeNull();
  });

  /*
    Last click wins. No first-touch branch: the most recent link a buyer followed is the
    promotion that actually brought them back.
  */
  it('overwrites an existing cookie rather than keeping the first', async () => {
    const req = request('https://shop.test/?ref=PRIYA10');
    req.cookies.set('ab_ref', 'RAHUL10');

    expect(setCookie(await middleware(req))).toContain('ab_ref=PRIYA10');
  });

  /*
    The API short-circuit returns before the referral check. A ?ref on an API call is
    meaningless, and redirecting one would break the request.
  */
  it('ignores ?ref on an API route', async () => {
    const res = await middleware(request('https://shop.test/api/v1/products?ref=RAHUL10'));

    expect(res.status).not.toBe(307);
    expect(setCookie(res)).toBeNull();
  });
});
