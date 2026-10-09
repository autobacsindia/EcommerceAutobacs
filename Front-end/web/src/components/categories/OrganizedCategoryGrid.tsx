'use client';

import Link from 'next/link';
import { Category } from '@/lib/types';
import CategoryCard from '@/components/categories/CategoryCard';

/** Chips per department before "+N more" — some departments have 40+ sub-categories. */
const SUB_LIMIT = 12;

interface OrganizedCategoryGridProps {
  categories: Category[];
}

/**
 * Every department as a picture tile in one grid (the way the home page shows
 * them), then each department's sub-categories as quick chips — so a shopper sees
 * the whole store at a glance instead of scrolling past one tile per section.
 */
export default function OrganizedCategoryGrid({ categories }: OrganizedCategoryGridProps) {
  // Departments = live top-level categories (same source as the home page), so a
  // department added in admin shows up here without a code change. The old fixed
  // hierarchy only matched 4 of the 14 live departments.
  const parentId = (c: Category) =>
    typeof c.parent === 'string' ? c.parent : c.parent && typeof c.parent === 'object' ? c.parent._id : undefined;
  const isActive = (c: Category) => (c as { isActive?: boolean }).isActive !== false;
  const departments = categories
    .filter((c) => isActive(c) && !parentId(c))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((category) => ({
      category,
      subcategories: categories
        .filter((c) => isActive(c) && parentId(c) === category._id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));

  const withSubs = departments.filter((d) => d.subcategories.length > 0);

  return (
    <>
      <section className="sp-section" aria-labelledby="departments-title">
        <div className="sp-section-head">
          <h2 id="departments-title" className="sp-h2">All departments</h2>
          <Link href="/products" className="st-link">Shop all products ›</Link>
        </div>
        <div className="sp-tiles">
          {departments.map(({ category }) => (
            <CategoryCard key={category._id} category={category} />
          ))}
        </div>
      </section>

      {withSubs.length > 0 && (
        <section className="sp-section sp-card" aria-labelledby="subcats-title">
          <h2 id="subcats-title" className="sp-h2 mb-4">Browse by sub-category</h2>
          <div className="space-y-5">
            {withSubs.map(({ category, subcategories }) => (
              <div key={category._id}>
                <Link href={`/categories/${category.slug}`} className="text-[15px] font-bold text-ink hover:text-gold">
                  {category.name} ›
                </Link>
                <div className="mt-2 flex flex-wrap gap-2">
                  {subcategories.slice(0, SUB_LIMIT).map((sub) => (
                    <Link key={sub._id} href={`/categories/${sub.slug}`} className="sp-chip">
                      {sub.name}
                    </Link>
                  ))}
                  {subcategories.length > SUB_LIMIT && (
                    <Link href={`/categories/${category.slug}`} className="sp-chip is-on">
                      +{subcategories.length - SUB_LIMIT} more
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
