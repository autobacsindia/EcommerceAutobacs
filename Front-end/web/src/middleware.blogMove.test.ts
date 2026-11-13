/**
 * @jest-environment node
 */

/**
 * Blog posts moved from the site root (/<slug>) to /blog/<slug> (2026-11).
 *
 * Pins, at the middleware (the real HTTP answer, before any page renders):
 *   - every one of the 64 posts that was ever at the root → ONE 301 → /blog/<slug>,
 *     in the plain, trailing-slash, UPPERCASE and query-string forms;
 *   - the WordPress emoji slug in every spelling a client can send;
 *   - a post renamed after the move skips its old /blog URL (still one hop);
 *   - the 20 static root pages, an unknown root slug, /blog, /blog/gallery,
 *     /blog/videos and the new /blog/<slug> URLs are NOT redirected;
 *   - no legacy slug collides with a real top-level route (it would hijack it).
 *
 * `jose` is stubbed as in the other middleware tests: ESM-only, never reached here.
 */
jest.mock('jose', () => ({ jwtVerify: jest.fn() }));

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { __resetSlugRedirectsForTest } from '@/lib/slugRedirects';
import { LEGACY_ROOT_BLOG_SLUGS } from '@/lib/legacyBlogSlugs';
import { RESERVED_BLOG_SLUGS } from '@/lib/articleRoutes';

const ORIGIN = 'https://www.autobacsindia.com';
const run = (p: string, method = 'GET') => middleware(new NextRequest(new Request(`${ORIGIN}${p}`, { method })));

const SLUGS = [...LEGACY_ROOT_BLOG_SLUGS];
const EMOJI = '%f0%9f%9a%97-how-to-create-a-virtual-wide-body-kit-render-using-chatgpt';

// The 20 static pages the live sitemap listed at the root on 2026-11-11.
const STATIC_ROOT_PAGES = [
  'about-us', 'affiliates', 'blog', 'brands', 'careers', 'categories', 'consultation', 'contact',
  'faq', 'help', 'media', 'offers', 'privacy', 'products', 'returns', 'shipping', 'super-cars',
  'terms', 'track', 'warranty',
];

const OLD_ENV = process.env.NEXT_PUBLIC_API_URL;
const realFetch = global.fetch;

function withRenameMap(articles: Record<string, string>) {
  process.env.NEXT_PUBLIC_API_URL = 'https://api.test';
  __resetSlugRedirectsForTest();
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ products: {}, categories: {}, brands: {}, articles }),
  })) as unknown as typeof fetch;
}

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = OLD_ENV;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('the legacy list', () => {
  it('holds exactly the 64 posts that were at the root, stored lowercase', () => {
    expect(SLUGS).toHaveLength(64);
    for (const s of SLUGS) expect(s).toBe(s.toLowerCase());
    expect(LEGACY_ROOT_BLOG_SLUGS.has(EMOJI)).toBe(true);
  });

  it('never names a real top-level route or a reserved /blog page', () => {
    const appDir = path.join(process.cwd(), 'src', 'app');
    const routes = fs
      .readdirSync(appDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('['))
      .map((d) => d.name.replace(/^\((.*)\)$/, '$1'));
    const clashes = SLUGS.filter((s) => routes.includes(s) || RESERVED_BLOG_SLUGS.has(s) || STATIC_ROOT_PAGES.includes(s));
    expect(clashes).toEqual([]);
  });
});

describe('old root URL → one 301 → /blog/<slug> (no rename map loaded)', () => {
  // The backend is unreachable: the fixed list alone must still redirect.
  beforeEach(() => {
    __resetSlugRedirectsForTest();
    delete process.env.NEXT_PUBLIC_API_URL;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it.each(SLUGS)('/%s', async (slug) => {
    for (const form of [`/${slug}`, `/${slug}/`, `/${slug.toUpperCase()}`]) {
      const res = await run(form);
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/blog/${slug}`);
    }
  });

  it('keeps the query string (an affiliate ?ref is captured on the next hop)', async () => {
    const res = await run('/14710-2?ref=RAHUL10&utm_source=x');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/blog/14710-2?ref=RAHUL10&utm_source=x`);
  });

  it.each([
    ['browser form (uppercase escapes)', `/${EMOJI.toUpperCase()}`],
    ['stored form (lowercase escapes)', `/${EMOJI}`],
    ['the literal emoji (a client encodes it)', `/${encodeURI('🚗')}-how-to-create-a-virtual-wide-body-kit-render-using-chatgpt`],
    ['double-encoded (a link holding the text "%f0")', `/${encodeURIComponent(EMOJI)}`],
    ['trailing slash', `/${EMOJI}/`],
  ])('emoji post, %s', async (_label, p) => {
    const res = await run(p);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/blog/${EMOJI}`);
  });

  it('never redirects a POST', async () => {
    const res = await run('/14710-2', 'POST');
    expect(res.status).not.toBe(301);
  });
});

describe('a post renamed after the move', () => {
  beforeEach(() => withRenameMap({ '14710-2': 'thar-roxx-accessories' }));

  it('old root URL goes straight to the CURRENT /blog URL (one hop, not two)', async () => {
    const res = await run('/14710-2/');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/blog/thar-roxx-accessories`);
  });

  it('its old /blog URL also goes to the current one', async () => {
    const res = await run('/blog/14710-2');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/blog/thar-roxx-accessories`);
  });
});

describe('everything else is unchanged', () => {
  beforeEach(() => withRenameMap({}));

  it.each([
    ...STATIC_ROOT_PAGES.map((p) => `/${p}`),
    ...STATIC_ROOT_PAGES.map((p) => `/${p}/`),
    '/',
    '/zzz-not-a-post', // unknown root slug → passes through and 404s in app/[slug]
    '/blog',
    '/blog/gallery',
    '/blog/videos',
    '/blog/14710-2', // the new URL itself
    `/blog/${EMOJI}`,
    '/products/some-product',
  ])('%s is not redirected', async (p) => {
    const res = await run(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
