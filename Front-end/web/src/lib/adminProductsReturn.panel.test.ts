import { productEditHref, productsListPath, safeProductsReturn } from './adminProductsReturn';

describe('product list return paths per panel', () => {
  it('admin defaults are unchanged', () => {
    expect(productsListPath()).toBe('/admin/products');
    expect(safeProductsReturn('/admin/products?page=3')).toBe('/admin/products?page=3');
    expect(productEditHref('p1', '/admin/products')).toBe('/admin/products/edit/p1?returnTo=%2Fadmin%2Fproducts');
  });

  it('the marketing panel stays inside the marketing panel', () => {
    const base = '/team/marketing';
    expect(productEditHref('p1', '/team/marketing/products?page=2', base))
      .toBe('/team/marketing/products/edit/p1?returnTo=%2Fteam%2Fmarketing%2Fproducts%3Fpage%3D2');
    expect(safeProductsReturn('/team/marketing/products?page=2', base)).toBe('/team/marketing/products?page=2');
  });

  it('a return address for ANOTHER panel or site falls back to this panel\'s list', () => {
    const base = '/team/marketing';
    expect(safeProductsReturn('/admin/products', base)).toBe('/team/marketing/products');
    expect(safeProductsReturn('//evil.example/x', base)).toBe('/team/marketing/products');
    expect(safeProductsReturn('/team/marketing/orders', base)).toBe('/team/marketing/products');
  });
});
