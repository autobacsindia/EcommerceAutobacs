import { primaryCategory, productBreadcrumbs, productBreadcrumbJsonLd } from './productBreadcrumbs';

const SITE = 'https://www.example.com';
const bodyKits = { name: 'Body Kits', slug: 'body-kits' };
const exterior = { name: 'Exterior', slug: 'exterior' };
const product = { name: 'A Class Kit', slug: 'a-class-kit', categories: [bodyKits, exterior] };

describe('primaryCategory', () => {
  it('takes the first category, every time', () => {
    expect(primaryCategory(product)).toEqual(bodyKits);
    expect(primaryCategory(product)).toEqual(bodyKits);
  });

  it('skips entries it cannot link to', () => {
    const categories = ['69aec43b981d9f26abdfa859', null, { name: 'No slug' }, { name: ' ', slug: 'blank' }, exterior];
    expect(primaryCategory({ ...product, categories })).toEqual(exterior);
  });

  it.each([[undefined], [null], [[]], [['69aec43b981d9f26abdfa859']]])('returns null for %j', (categories) => {
    expect(primaryCategory({ ...product, categories })).toBeNull();
  });
});

describe('productBreadcrumbs', () => {
  it('runs Home > Categories > Category > Product', () => {
    expect(productBreadcrumbs(product)).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Categories', href: '/categories' },
      { label: 'Body Kits', href: '/categories/body-kits' },
      { label: 'A Class Kit' },
    ]);
  });

  it('falls back to Home > Products > Product with no category', () => {
    expect(productBreadcrumbs({ ...product, categories: [] })).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Products', href: '/products' },
      { label: 'A Class Kit' },
    ]);
  });
});

describe('productBreadcrumbJsonLd', () => {
  it('matches the visible trail, with sequential positions and no link on the last item', () => {
    const { itemListElement } = productBreadcrumbJsonLd(product, SITE);
    expect(itemListElement.map((i) => i.name)).toEqual(productBreadcrumbs(product).map((c) => c.label));
    expect(itemListElement.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(itemListElement.map((i) => i.item)).toEqual([
      SITE,
      `${SITE}/categories`,
      `${SITE}/categories/body-kits`,
      undefined,
    ]);
  });

  it('keeps the existing entity id', () => {
    expect(productBreadcrumbJsonLd(product, SITE)['@id']).toBe(`${SITE}/products/a-class-kit#breadcrumb`);
  });
});
