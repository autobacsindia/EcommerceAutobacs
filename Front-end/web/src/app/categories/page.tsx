import type { Metadata } from 'next';
import Link from 'next/link';
import OrganizedCategoryGrid from '@/components/categories/OrganizedCategoryGrid';
import { Category } from '@/lib/types';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import { getServerApiBase } from '@/lib/server-api';
import { SITE_URL } from '@/lib/siteUrl';

// The category list has no per-request inputs, so it renders as a fully static
// page revalidated every 10 min (ISR) — the HTML is served from the edge with
// no client fetch/spinner on first paint. Matches the backend CATEGORY_LIST TTL.
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Product Categories',
  description: 'Browse our collection of automotive products, organised by category.',
  alternates: { canonical: `${SITE_URL}/categories` },
};

async function getCategories(): Promise<Category[]> {
  const res = await fetch(`${getServerApiBase()}/categories`, {
    next: { revalidate: 600, tags: ['categories'] },
  });
  if (!res.ok) throw new Error(`categories fetch failed: ${res.status}`);
  const data = (await res.json()) as { data?: Category[]; categories?: Category[] };
  return data.data || data.categories || [];
}

export default async function CategoriesPage() {
  let categories: Category[] = [];
  let failed = false;
  try {
    categories = await getCategories();
  } catch (error) {
    console.error('[categories/page] server fetch failed:', error);
    failed = true;
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="bg-obsidian border-b border-hairline px-5 py-16 sm:px-8">
        <Reveal className="mx-auto max-w-[1400px] text-center">
          <Eyebrow>Browse</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-3xl text-[clamp(38px,6vw,72px)] font-light leading-[0.95] tracking-[-0.01em] text-ink">
            Product <em className="font-light not-italic text-gold">Categories</em>
          </h1>
          <p className="mx-auto mt-5 max-w-xl font-display text-[14px] font-light leading-relaxed text-ink-muted">
            Browse our collection of automotive products, organised by category.
          </p>
        </Reveal>
      </div>

      {/* Categories Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {failed ? (
          <div className="text-center py-12">
            <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em] mb-4">
              Error Loading Categories
            </h2>
            <p className="text-ink/70 font-display mb-6">
              We couldn’t load categories right now. Please try again shortly.
            </p>
            <Link
              href="/categories"
              className="text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors"
            >
              Retry
            </Link>
          </div>
        ) : categories.length === 0 ? (
          <div className="text-center py-12">
            <h2 className="text-2xl font-display font-light text-ink tracking-[-0.01em] mb-4">No Categories Found</h2>
            <p className="text-ink/70 font-display mb-6">There are currently no categories available.</p>
            <Link href="/products" className="text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors">
              Browse All Products
            </Link>
          </div>
        ) : (
          <OrganizedCategoryGrid categories={categories} />
        )}
      </div>
    </div>
  );
}
