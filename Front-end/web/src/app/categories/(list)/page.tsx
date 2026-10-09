import type { Metadata } from 'next';
import Link from 'next/link';
import OrganizedCategoryGrid from '@/components/categories/OrganizedCategoryGrid';
import { Category } from '@/lib/types';
import StorePageHeader from '@/components/store/StorePageHeader';
import { getServerApiBase, shouldFailBuildOnFetchError } from '@/lib/server-api';
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

// Tagged 'category:list' — an allowlisted prefix the backend revalidator can
// actually emit. The bare 'categories' used before matched no allowed prefix, so
// this page served up to 600s stale after a category edit.
async function getCategories(): Promise<Category[]> {
  const res = await fetch(`${getServerApiBase()}/categories`, {
    next: { revalidate: 600, tags: ['category:list'] },
  });
  if (!res.ok) throw new Error(`categories fetch failed: ${res.status}`);
  const data = (await res.json()) as { data?: Category[]; categories?: Category[] };
  return data.data || data.categories || [];
}

export default async function CategoriesPage() {
  // Intentionally NOT wrapped in try/catch. On a fetch failure we WANT the error
  // to propagate: during an ISR background revalidation Next keeps serving the
  // last successfully generated page (stale-while-error) instead of caching a
  // failure, and a cold request surfaces error.tsx (with a working reset()).
  // Swallowing the error here would let ISR cache an error page for `revalidate`
  // seconds and hand every visitor a dead "retry" link.
  let categories: Category[];
  try {
    categories = await getCategories();
  } catch (error) {
    // The throw is still the RIGHT behaviour at request time and during ISR
    // revalidation — Next then keeps serving the last good page instead of
    // caching a failure, which is why getCategories() has no try/catch.
    //
    // It is wrong in exactly one place: the initial `next build` in CI, which
    // points NEXT_PUBLIC_API_URL at an unreachable localhost on purpose. Before
    // ISR nothing prerendered, so a build never fetched anything; now it does,
    // and rethrowing would fail every CI run. On Vercel this still throws and
    // stops the deploy.
    if (shouldFailBuildOnFetchError()) throw error;
    console.warn('[categories] build-time fetch failed; prerendering empty shell', error);
    categories = [];
  }

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: 'Categories' }]}
        title="Shop by category"
        subtitle="Every department we carry — pick one to see its products."
      />
      <div className="sp-wrap">
        {categories.length === 0 ? (
          <div className="sp-section sp-card sp-empty">
            <p className="sp-empty-title">No categories found</p>
            <p>There are no categories to show right now.</p>
            <Link href="/products" className="sh-btn sh-btn-primary">Browse all products</Link>
          </div>
        ) : (
          <OrganizedCategoryGrid categories={categories} />
        )}
      </div>
    </div>
  );
}
