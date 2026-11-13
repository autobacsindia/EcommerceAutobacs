/**
 * @jest-environment node
 */
import {
  resolveSlugRedirect,
  isSlugRedirectCandidate,
  getSlugRedirectMap,
  __resetSlugRedirectsForTest,
  REFRESH_MS,
  type SlugRedirectMap,
} from './slugRedirects';

const MAP: SlugRedirectMap = {
  products: { product: 'dr-nano-rear-balance-arms-isuzu-v-cross' },
  categories: { 'tail-light': 'tail-lamp' },
  brands: { lightforcew: 'lightforce' },
  articles: {
    '14710-2': 'thar-roxx-accessories',
    '%f0%9f%9a%97-how-to-render': 'how-to-render',
  },
};

describe('resolveSlugRedirect', () => {
  it.each([
    ['/products/product', '/products/dr-nano-rear-balance-arms-isuzu-v-cross'],
    ['/products/product/', '/products/dr-nano-rear-balance-arms-isuzu-v-cross'],
    ['/categories/tail-light', '/categories/tail-lamp'],
    ['/brands/lightforcew', '/brands/lightforce'],
    ['/14710-2', '/thar-roxx-accessories'],
    ['/PRODUCTS-X', null],
    // The emoji post: stored percent-encoded, requested either way.
    ['/%F0%9F%9A%97-how-to-render', '/how-to-render'],
    ['/%f0%9f%9a%97-how-to-render', '/how-to-render'],
  ])('%s → %s', (path, expected) => {
    expect(resolveSlugRedirect(path, MAP)).toBe(expected);
  });

  it.each([
    '/products/unknown',
    '/products',
    '/products/product/reviews', // deeper path never matches
    '/categories/tail-lamp', // the live slug is never redirected
    '/',
    '/blog/14710-2', // a blog slug only redirects at the root
  ])('%s is left alone', (path) => {
    expect(resolveSlugRedirect(path, MAP)).toBeNull();
  });

  it('does not cross sections: a product old slug at /categories is not redirected', () => {
    expect(resolveSlugRedirect('/categories/product', MAP)).toBeNull();
  });
});

describe('isSlugRedirectCandidate', () => {
  it.each(['/14710-2', '/products/x', '/categories/x/', '/brands/x'])('%s is a candidate', (p) => {
    expect(isSlugRedirectCandidate(p)).toBe(true);
  });
  it.each(['/', '/robots.txt', '/admin/products', '/model/x/page/2', '/products/x/y'])(
    '%s is not',
    (p) => expect(isSlugRedirectCandidate(p)).toBe(false),
  );
});

describe('getSlugRedirectMap', () => {
  const OLD_ENV = process.env.NEXT_PUBLIC_API_URL;
  const ok = (body: unknown) =>
    jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.test';
    __resetSlugRedirectsForTest();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = OLD_ENV;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('loads once, then serves from memory', async () => {
    const f = ok({ products: { a: 'b' } });
    expect((await getSlugRedirectMap(f)).products).toEqual({ a: 'b' });
    await getSlugRedirectMap(f);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f as jest.Mock).mock.calls[0][0]).toBe('https://api.test/api/v1/redirects/slugs');
  });

  it('drops targets that are not plain slugs (no open redirect)', async () => {
    const map = await getSlugRedirectMap(
      ok({ products: { a: 'https://evil.test', b: '//evil.test', c: '../x', d: 'fine-slug' } }),
    );
    expect(map.products).toEqual({ d: 'fine-slug' });
  });

  it('a failing backend means no redirects, never a throw', async () => {
    const f = jest.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch;
    await expect(getSlugRedirectMap(f)).resolves.toEqual({ products: {}, categories: {}, brands: {}, articles: {} });
  });

  it('keeps the last good map when a refresh fails', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    await getSlugRedirectMap(ok({ brands: { x: 'y' } }));
    jest.setSystemTime(1_000_000 + REFRESH_MS + 1);
    const failing = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    // Stale map is served at once; the refresh runs behind it.
    expect((await getSlugRedirectMap(failing)).brands).toEqual({ x: 'y' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect((await getSlugRedirectMap(failing)).brands).toEqual({ x: 'y' });
  });
});
