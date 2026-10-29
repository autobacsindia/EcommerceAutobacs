import {
  buildCategoryProductsQuery,
  isDefaultListingView,
  normalizeProductsResponse,
  toCardProduct,
} from './categoryProducts';

describe('isDefaultListingView', () => {
  it('is the default view with no params, or only tracking params', () => {
    expect(isDefaultListingView(new URLSearchParams())).toBe(true);
    expect(isDefaultListingView(new URLSearchParams('utm_source=x&gclid=y&fbclid=z'))).toBe(true);
  });

  it.each(['sort=price_asc', 'page=2', 'brand=bmc', 'showAll=true', 'category=child', 'minPrice=100'])(
    'is not the default view with %s',
    (q) => expect(isDefaultListingView(new URLSearchParams(q))).toBe(false),
  );
});

describe('buildCategoryProductsQuery', () => {
  it('asks for the scope only on the default view — what the server pre-renders', () => {
    expect(buildCategoryProductsQuery({}, 'hub')).toBe('category=hub');
  });

  it('maps sorts and filters exactly as the page always has', () => {
    expect(buildCategoryProductsQuery({ sort: 'price_desc', page: '2', brand: 'bmc' }, 'hub'))
      .toBe('category=hub&page=2&brand=bmc&sortBy=price&order=desc');
    expect(buildCategoryProductsQuery({ sort: 'createdAt_desc' }, 'hub')).toBe('category=hub&sortBy=createdAt&order=desc');
    expect(buildCategoryProductsQuery({ showAll: 'true' }, 'hub')).toBe('category=hub&limit=500');
  });
});

describe('normalizeProductsResponse', () => {
  it('lifts the top-level pagination fields', () => {
    expect(normalizeProductsResponse({ products: [{ _id: 'a' }], total: 7, pages: 1, currentPage: 1, hasNext: false }))
      .toEqual({ products: [{ _id: 'a' }], pagination: { total: 7, pages: 1, currentPage: 1, hasNext: false, hasPrev: undefined, count: undefined } });
  });

  it('treats an unexpected body as empty', () => {
    expect(normalizeProductsResponse(null)).toEqual({ products: [], pagination: {} });
  });
});

describe('toCardProduct', () => {
  it('keeps what a card renders and drops the heavy copy', () => {
    const card = toCardProduct({
      _id: 'a', name: 'Kit', slug: 'kit', price: 100, images: [{ url: 'x' }], stock: 'in',
      description: 'long…', specifications: [], seo: {}, features: ['…'],
    });
    expect(card).toEqual({ _id: 'a', name: 'Kit', slug: 'kit', price: 100, images: [{ url: 'x' }], stock: 'in' });
  });
});
