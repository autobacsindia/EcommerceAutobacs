/**
 * The one breadcrumb trail for a product page. The visible breadcrumb and the
 * BreadcrumbList JSON-LD both render from here, so what shoppers see and what
 * Google reads cannot disagree.
 *
 *   Home > Categories > <primary category> > Product
 *   Home > Products > Product                 (no usable category)
 *
 * This describes the hierarchy only. URLs stay flat (/products/<slug>,
 * /categories/<slug>) on purpose.
 */

interface CategoryLike {
  name?: string | null;
  slug?: string | null;
}

interface ProductLike {
  name: string;
  slug?: string | null;
  categories?: ReadonlyArray<CategoryLike | string | null> | null;
}

export interface ProductCrumb {
  label: string;
  /** Site-relative link. Absent on the current page (the last crumb). */
  href?: string;
}

/** First category with both a name and a slug: it is the only one we can link. */
export function primaryCategory(product: ProductLike): { name: string; slug: string } | null {
  for (const category of product.categories ?? []) {
    if (category && typeof category === 'object' && category.name?.trim() && category.slug?.trim()) {
      return { name: category.name.trim(), slug: category.slug.trim() };
    }
  }
  return null;
}

export function productBreadcrumbs(product: ProductLike): ProductCrumb[] {
  const category = primaryCategory(product);
  return [
    { label: 'Home', href: '/' },
    ...(category
      ? [
          { label: 'Categories', href: '/categories' },
          { label: category.name, href: `/categories/${category.slug}` },
        ]
      : [{ label: 'Products', href: '/products' }]),
    { label: product.name },
  ];
}

export function productBreadcrumbJsonLd(product: ProductLike, siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${siteUrl}/products/${product.slug}#breadcrumb`,
    itemListElement: productBreadcrumbs(product).map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      ...(crumb.href ? { item: crumb.href === '/' ? siteUrl : `${siteUrl}${crumb.href}` } : {}),
    })),
  };
}
