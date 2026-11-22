/**
 * @jest-environment node
 */
import { needsLegacyMap, resolveLegacyRoute } from './legacyRoutes';
import { isGonePath } from './legacyPaths';
import type { SlugRedirectMap } from './slugRedirects';

const MAP: SlugRedirectMap = {
  products: { 'revo-winch-12000lb-synthetic': 'revo-12000-lb-synthetic-rope-winch' },
  categories: { 'tail-light': 'tail-lamp' },
  brands: { lightforcew: 'lightforce' },
  articles: {},
  paths: {
    '/products/70mai-a400-dash-cam': '/categories/dash-cams',
    '/products/thor-2-speakers': '/products/thor-3-speakers',
    '/model/floor-mat': '/categories/floor-mats',
    '/model/old-junk-tag': null,
  },
  live: {
    categories: new Set(['dash-cams', 'floor-mats', 'accessories', 'tail-lamp']),
    brands: new Set(['70mai', 'lightforce', 'ironman-4x4']),
  },
  loaded: true,
};

const NOT_LOADED: SlugRedirectMap = {
  ...MAP, products: {}, categories: {}, brands: {}, paths: {},
  live: { categories: new Set(), brands: new Set() }, loaded: false,
};

const to = (path: string, map = MAP) => {
  const d = resolveLegacyRoute(path, map);
  return d?.kind === 'redirect' ? d.to : d?.kind ?? null;
};

describe('resolveLegacyRoute', () => {
  describe('rule 1: /product/<slug>', () => {
    it.each([
      // Renamed: straight to the current slug, not via /products/<old>.
      ['/product/revo-winch-12000lb-synthetic/', '/products/revo-12000-lb-synthetic-rope-winch'],
      ['/product/REVO-WINCH-12000LB-SYNTHETIC', '/products/revo-12000-lb-synthetic-rope-winch'],
      // Removed product with a stored target.
      ['/product/70mai-a400-dash-cam', '/categories/dash-cams'],
      // Unknown here: falls through to app/product/[slug] (live lookup).
      ['/product/some-live-product', null],
      ['/product/a/b', null],
    ])('%s → %s', (path, expected) => expect(to(path)).toBe(expected));
  });

  describe('rule 2: deleted /products/<slug> (redirect table)', () => {
    it.each([
      ['/products/70mai-a400-dash-cam', '/categories/dash-cams'],
      ['/products/70mai-a400-dash-cam/', '/categories/dash-cams'],
      ['/products/thor-2-speakers', '/products/thor-3-speakers'],
      ['/products/a-live-product', null],
    ])('%s → %s', (path, expected) => expect(to(path)).toBe(expected));
  });

  describe('rule 3: /collections and /product-category', () => {
    it.each([
      ['/collections/accessories/floor-mats', '/categories/floor-mats'],
      ['/collections/accessories/floor-mats/page/3/', '/categories/floor-mats'],
      ['/collections/accessories/nonexistent', '/categories/accessories'],
      ['/collections/accessories', '/categories/accessories'],
      ['/collections/floor-mat', '/categories/floor-mats'], // singular → plural
      ['/collections/nothing/at-all', '/categories'],
      ['/product-category/lights/tail-light/', '/categories/tail-lamp'], // renamed category
      ['/product-category/dash-cams/page/2', '/categories/dash-cams'],
    ])('%s → %s', (path, expected) => expect(to(path)).toBe(expected));

    it('does not guess before the map has loaded', () => {
      expect(to('/collections/nothing', NOT_LOADED)).toBeNull();
      expect(to('/product-brand/nothing', NOT_LOADED)).toBeNull();
    });
  });

  describe('rule 4: /product-brand', () => {
    it.each([
      ['/product-brand/70mai/page/2/', '/brands/70mai'],
      ['/product-brand/70mai-brand', '/brands/70mai'],
      ['/product-brand/lightforcew', '/brands/lightforce'],
      ['/product-brand/unknown-maker', '/brands'],
    ])('%s → %s', (path, expected) => expect(to(path)).toBe(expected));
  });

  describe('rule 5: WordPress leftovers', () => {
    it.each([
      ['/tag/winch/', '/blog'],
      ['/tag/winch/page/2', '/blog'],
      ['/tag', '/blog'],
      ['/clients/', '/about-us'],
      ['/lets-keep-in-touch/', '/contact'],
    ])('%s → %s', (path, expected) => {
      expect(to(path, NOT_LOADED)).toBe(expected); // no map needed
      expect(needsLegacyMap(path)).toBe(true);
    });

    it.each(['/2024/', '/2024', '/2023/05/', '/2023/05/17/page/2', '/feed/', '/blog/feed/',
      '/comments/feed', '/some-post/feed/atom/'])('%s → 410', (path) => expect(isGonePath(path)).toBe(true));

    it.each(['/products/feed', '/categories/feed', '/model/feed', '/blog', '/products/2024-calendar',
      '/model/2024', '/feedback', '/blog/feeding-guide'])('%s is not gone', (path) => expect(isGonePath(path)).toBe(false));
  });

  describe('redirect table on /model/<slug>', () => {
    it('maps or 410s a listed WordPress tag page; leaves everything else alone', () => {
      expect(to('/model/floor-mat/')).toBe('/categories/floor-mats');
      expect(to('/model/old-junk-tag')).toBe('gone');
      expect(to('/model/toyota-hilux')).toBeNull(); // real vehicle page keeps serving
    });
  });

  describe('no chains', () => {
    const SITEMAP_LIKE = ['/', '/products', '/categories', '/brands', '/blog', '/about-us', '/contact',
      '/products/a-live-product', '/categories/dash-cams', '/brands/70mai', '/model/toyota-hilux'];

    it('every target is itself left alone (one hop)', () => {
      const sources = ['/product/revo-winch-12000lb-synthetic', '/product/70mai-a400-dash-cam',
        '/products/70mai-a400-dash-cam', '/collections/accessories/floor-mats/page/3',
        '/product-category/lights/tail-light', '/product-brand/70mai-brand/page/2', '/tag/x',
        '/clients', '/lets-keep-in-touch', '/model/floor-mat'];
      for (const src of sources) {
        const target = to(src);
        expect(typeof target).toBe('string');
        expect(resolveLegacyRoute(target as string, MAP)).toBeNull();
        expect(isGonePath(target as string)).toBe(false);
      }
    });

    it('sitemap-style URLs are never redirected or gone', () => {
      for (const path of SITEMAP_LIKE) {
        expect(resolveLegacyRoute(path, MAP)).toBeNull();
        expect(isGonePath(path)).toBe(false);
      }
    });
  });
});
