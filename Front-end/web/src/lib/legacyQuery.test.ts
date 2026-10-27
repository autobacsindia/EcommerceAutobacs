/**
 * Crawler query-string rules (lib/legacyQuery.ts). Cases from the Search Console
 * report (Oct 2026).
 *
 * The dangerous mistake is the FALSE POSITIVE: a parameter the site really reads
 * (sort, category, page, q) stripped by a 301 throws the shopper's choice away on
 * every click, and nothing else would notice.
 */
import { isInternalSearch, LEGACY_PARAMS, stripLegacyParams } from './legacyQuery';

const strip = (u: string) => stripLegacyParams(new URL(u))?.toString() ?? null;

describe('stripLegacyParams', () => {
  it.each([
    ['https://shop.test/model/toyota-hilux/page/9?per_page=12&add-to-cart=11519', 'https://shop.test/model/toyota-hilux/page/9'],
    ['https://shop.test/model/thar-roxx-aftermarket-suspension?layout=list&add-to-cart=27714', 'https://shop.test/model/thar-roxx-aftermarket-suspension'],
    ['https://shop.test/model/ford-endeavour-mods?per_page=18&layout=grid&add-to-cart=9767', 'https://shop.test/model/ford-endeavour-mods'],
    ['https://shop.test/?remove_item=abc&_wpnonce=f00', 'https://shop.test/'],
    ['https://shop.test/categories/lights?orderby=price', 'https://shop.test/categories/lights'],
  ])('%s → %s', (from, to) => expect(strip(from)).toBe(to));

  it('drops the WordPress trailing slash in the same hop, but not the root', () => {
    expect(strip('https://shop.test/model/toyota-hilux/page/9/?per_page=12&add-to-cart=11519'))
      .toBe('https://shop.test/model/toyota-hilux/page/9');
    expect(strip('https://shop.test/?add-to-cart=1')).toBe('https://shop.test/');
  });

  it('keeps the parameters the site reads, in order', () => {
    expect(strip('https://shop.test/model/toyota-hilux?sort=price_asc&add-to-cart=1&category=lights'))
      .toBe('https://shop.test/model/toyota-hilux?sort=price_asc&category=lights');
  });

  // The referral capture runs on the next hop; dropping ?ref here would cost the
  // affiliate the sale.
  it('keeps ?ref so the affiliate is still credited after the redirect', () => {
    expect(strip('https://shop.test/products/x?ref=RAHUL10&add-to-cart=5'))
      .toBe('https://shop.test/products/x?ref=RAHUL10');
  });

  it('strips a repeated parameter completely', () => {
    expect(strip('https://shop.test/?add-to-cart=1&add-to-cart=2')).toBe('https://shop.test/');
  });

  it.each([
    'https://shop.test/model/toyota-hilux',
    'https://shop.test/model/toyota-hilux/page/2?sort=date',
    'https://shop.test/products/search?q=led',
    'https://shop.test/blog?page=2&category=guides&search=lift',
    'https://shop.test/cart?quantity=2',
  ])('leaves %s alone (null = no redirect)', (u) => expect(strip(u)).toBeNull());

  it('never lists a parameter the site reads', () => {
    for (const live of ['sort', 'category', 'page', 'q', 'search', 'ref', 'item', 'product', 'quantity']) {
      expect(LEGACY_PARAMS).not.toContain(live);
    }
  });
});

describe('isInternalSearch', () => {
  const is = (u: string) => {
    const url = new URL(u);
    return isInternalSearch(url.pathname, url.searchParams);
  };

  it.each([
    'https://shop.test/products/search?q=led',
    'https://shop.test/products/search',
    'https://shop.test/blog?search=lift+kit',
    'https://shop.test/products?search=bumper',
    'https://shop.test/?s=hilux',
  ])('%s is a search result (noindex)', (u) => expect(is(u)).toBe(true));

  it.each([
    'https://shop.test/blog',
    'https://shop.test/blog?page=2&category=guides',
    'https://shop.test/products/searchlight-led',
    'https://shop.test/model/toyota-hilux?sort=date',
    'https://shop.test/consultation?item=bull-bar',
  ])('%s is a real page (indexable)', (u) => expect(is(u)).toBe(false));
});
