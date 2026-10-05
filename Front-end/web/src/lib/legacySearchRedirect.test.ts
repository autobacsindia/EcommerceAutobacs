import { slugToSearchWords, legacySearchPath } from './legacySearchRedirect';

describe('legacySearchRedirect', () => {
  it('turns a slug into search words', () => {
    expect(slugToSearchWords('hilux-remote-reservoir-suspension')).toBe('hilux remote reservoir suspension');
  });

  it('drops the WordPress de-duplication suffix', () => {
    expect(slugToSearchWords('spoiler-3')).toBe('spoiler');
    expect(slugToSearchWords('suspension-2')).toBe('suspension');
  });

  it('keeps numbers that are part of the product', () => {
    expect(slugToSearchWords('12v-synthetic-rope-winch')).toBe('12v synthetic rope winch');
    expect(slugToSearchWords('2020-thar-overhead-cargo-net')).toBe('2020 thar overhead cargo net');
    expect(slugToSearchWords('7-inch')).toBe('7 inch');
  });

  it('builds an encoded product-search path', () => {
    expect(legacySearchPath('car-luggage-rack')).toBe('/products/search?q=car%20luggage%20rack');
  });

  it('never produces an open redirect or an empty search', () => {
    expect(legacySearchPath('---')).toBe('/products');
    expect(legacySearchPath('%2F%2Fevil.com')).toBe('/products/search?q=%2F%2Fevil.com');
    expect(legacySearchPath('%E0%A4%A')).toBe('/products/search?q=%25e0%25a4%25a');
  });
});
