import type { Metadata } from 'next'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { VehicleSelectorSection } from '@/app/HomeClientSection'
import NotFoundTracker from '@/components/notFound/NotFoundTracker'
import { getServerApiBase } from '@/lib/server-api'

/**
 * The site-wide "page not found" page (HTTP 404).
 *
 * Old WooCommerce links still bring real people here, so instead of a dead end
 * it offers the three ways back into the shop: search, the main categories and
 * the vehicle picker. It also reports the hit to GA4 (`page_not_found`, with the
 * referrer) so Marketing can see which old links still get clicked.
 *
 * Metadata: a 404 has no URL of its own to describe, so it is NOT wired to a
 * PageSeo row (an admin override, or a canonical, would be meaningless here).
 * Next already adds `noindex` to every 404; it is set explicitly too, so a
 * future refactor cannot quietly drop it. The root layout appends the site name,
 * and its canonical is cleared here.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This page has moved or no longer exists. Search the shop, pick a category or choose your vehicle.',
  robots: { index: false, follow: true },
  // The root layout's canonical (the home page) must not leak onto a 404: a
  // missing page claiming to be the home page reads as a soft 404.
  alternates: null,
}

type Category = { _id?: string; name?: string; slug?: string; parent?: unknown; order?: number }

const FALLBACK_LIMIT = 8

/** Top-level categories, in admin order. Never throws: a 404 page must render. */
async function topCategories(): Promise<Category[]> {
  try {
    const res = await fetch(`${getServerApiBase()}/categories`, { next: { revalidate: 3600 } })
    if (!res.ok) return []
    const body = await res.json()
    const list: Category[] = Array.isArray(body?.categories) ? body.categories : []
    return list.filter((c) => c?.slug && c?.name && !c.parent).slice(0, FALLBACK_LIMIT)
  } catch {
    return []
  }
}

export default async function NotFound() {
  const categories = await topCategories()

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
      <NotFoundTracker />

      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Error 404</p>
        <h1 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">We couldn&apos;t find that page</h1>
        <p className="mx-auto mt-3 max-w-xl text-ink-muted">
          It may have moved or no longer exists. Search for what you need, or start from a category or your vehicle.
        </p>
      </div>

      <form action="/products/search" method="get" role="search" className="mx-auto mt-8 flex max-w-xl gap-2">
        <label htmlFor="nf-search" className="sr-only">Search products</label>
        <input
          id="nf-search"
          name="q"
          type="search"
          required
          maxLength={100}
          placeholder="Search for winches, floor mats, dash cams…"
          className="min-w-0 flex-1 rounded-md border border-hairline bg-obsidian-raised px-4 py-3 text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-md bg-obsidian-deep px-5 py-3 font-medium text-ink hover:bg-obsidian-raised"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span>Search</span>
        </button>
      </form>

      {categories.length > 0 && (
        <section aria-labelledby="nf-categories" className="mt-12">
          <h2 id="nf-categories" className="text-lg font-semibold text-ink">Popular categories</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/categories/${c.slug}`}
                  className="block rounded-md border border-hairline px-4 py-3 text-sm font-medium text-ink hover:border-gold"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link href="/categories" className="text-link hover:underline">See all categories</Link>
          </p>
        </section>
      )}

      <section aria-labelledby="nf-vehicle" className="mt-12">
        <h2 id="nf-vehicle" className="mb-4 text-center text-lg font-semibold text-ink">Shop by vehicle</h2>
        <VehicleSelectorSection />
      </section>

      <p className="mt-12 text-center text-sm">
        <Link href="/" className="text-link hover:underline">Go to the home page</Link>
        <span className="mx-2 text-ink-muted" aria-hidden="true">·</span>
        <Link href="/contact" className="text-link hover:underline">Contact us</Link>
      </p>
    </div>
  )
}
