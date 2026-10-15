import { PRODUCTS_LIST_PATH, productEditHref, safeProductsReturn } from './adminProductsReturn';

describe('product editor return address', () => {
  it('returns to the exact list view it came from', () => {
    expect(safeProductsReturn('/admin/products?page=4&q=hilux&status=active')).toBe('/admin/products?page=4&q=hilux&status=active');
  });

  it('round-trips through the edit link', () => {
    const href = productEditHref('p1', '/admin/products?page=3&type=variable');
    const returnTo = new URL(href, 'http://x').searchParams.get('returnTo');
    expect(safeProductsReturn(returnTo)).toBe('/admin/products?page=3&type=variable');
  });

  it.each([
    [null], [''], ['https://evil.example/admin/products'], ['//evil.example/admin/products'],
    ['/admin/orders'], ['/admin/products/../users'], ['javascript:alert(1)'], ['/\\evil.example'],
  ])('never becomes an open redirect: %p', (raw) => {
    expect(safeProductsReturn(raw as string | null)).toBe(PRODUCTS_LIST_PATH);
  });
});
