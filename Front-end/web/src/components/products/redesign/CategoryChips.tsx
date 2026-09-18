'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCategories, parentIdOf } from '@/hooks/queries/useCategories';
import { cn } from '@/lib/utils';
import './redesign.css';

/**
 * Params that only the global listing honours — the category page's product query
 * ignores them, so forwarding them there makes the page disagree with itself.
 */
const LISTING_ONLY = ['isFeatured', 'isFastMoving', 'productType', 'vehicle'];

/**
 * Sticky horizontal category chip row (MLC reference), obsidian + gold.
 *
 * These are NAVIGATION, not a filter control. Each hub links to its canonical
 * `/categories/<slug>` page; "All categories" returns to `/products`.
 *
 * They used to be `<button>`s that rewrote `?category=<ObjectId>` in place, which
 * meant the storefront's most prominent taxonomy control was the ONE category
 * surface that produced a URL Google cannot index, that no anchor semantics
 * applied to (no middle-click, no open-in-new-tab, invisible to crawlers), and
 * that leaked a Mongo id into a public address. Every other category link in the
 * app — nav, home, breadcrumbs, PDP, car explorer, sitemap — already pointed at
 * `/categories/<slug>`; this row was the outlier.
 *
 * The HIGHLIGHT still has two sources, deliberately. On a category page the
 * pathname decides. On `/products` the sidebar can still multi-select categories
 * into `?category=`, so the strip keeps reflecting that — losing it would revert
 * the fix behind "highlights EVERY chip in a multi-select, not none of them".
 */
export default function CategoryChips() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Shared query, not a local fetch: this strip now renders on BOTH /products and
  // every category page, so a per-mount fetch re-requested the taxonomy on each
  // hop between them.
  const { data: categories } = useCategories();

  // Source 1: standing on /categories/<slug>.
  const activeSlug = useMemo(() => {
    const m = /^\/categories\/([^/?#]+)/.exec(pathname ?? '');
    return m ? decodeURIComponent(m[1]) : '';
  }, [pathname]);

  /*
    A category page can be level 2 (`/categories/tail-light`), where the slug
    matches no hub in the strip. Resolving it to its PARENT means the strip still
    shows where you are; without this, that page lit no chip at all — and because
    `activeSlug` is set, it also suppressed "All categories", so nothing was
    current and `aria-current` was never emitted for assistive tech.
  */
  const activeHubId = useMemo(() => {
    if (!activeSlug) return '';
    const match = (categories ?? []).find((c) => c.slug === activeSlug);
    if (!match) return '';
    return parentIdOf(match) || String(match._id);
  }, [categories, activeSlug]);

  // Source 2: the sidebar's selection on /products, which is a comma-separated
  // list of ids — hence a Set rather than a single value.
  const activeIds = useMemo(
    () => new Set((searchParams.get('category') ?? '').split(',').filter(Boolean)),
    [searchParams]
  );

  // Hubs only — children belong to the sidebar. A hub with no slug has no page to
  // link to, so it is dropped rather than rendered as a chip pointing at
  // /categories/undefined.
  const cats = useMemo(
    () => (categories ?? []).filter((c) => !c.parent && c.slug),
    [categories]
  );

  /*
    Filters in the query string survive the jump: the category page reads the
    same `brand` / price / `inStock` / `sort` params this page does, so carrying
    them keeps a narrowed listing narrowed. `category` is dropped because the
    destination IS the category, and `page` because the result set changes.

    `isFeatured` / `isFastMoving` / `productType` / `vehicle` are carried to
    /products, which honours them, and NOT to a category page, which does not.
    Forwarding them there produced a page that disagreed with itself: the grid
    ignored `isFeatured` and showed everything, while the filter sidebar passed it
    straight to /products/facets and counted only featured products.
  */
  const carried = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete('category');
    p.delete('page');
    return p;
  }, [searchParams]);

  const href = (path: string, honoursListingMode: boolean) => {
    const p = new URLSearchParams(carried);
    if (!honoursListingMode) LISTING_ONLY.forEach((k) => p.delete(k));
    const qs = p.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const chip = (label: string, to: string, on: boolean) => (
    <Link
      key={to}
      href={to}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'whitespace-nowrap px-5 py-2.5 font-display text-[11px] uppercase tracking-[0.16em] transition-colors',
        on
          ? 'bg-gold text-obsidian'
          : 'border border-hairline text-ink-muted hover:border-gold/50 hover:text-ink'
      )}
    >
      {label}
    </Link>
  );

  /*
    Rendered before the fetch resolves, not after.

    Returning `null` while `cats` was empty collapsed this row to nothing, so the
    sticky bar wrapping it painted at ~33px and then jumped to ~74px when
    `/categories` came back — pushing the entire product grid down the page. That
    was the whole of the measured CLS on `/products` (0.027, attributed to the
    grid row below); nothing about the cards contributed to it.

    "All categories" needs no data — it is a static link to /products — so
    rendering it immediately reserves the row's final height AND gives the shopper
    a working control during the fetch. Extra chips only extend the row
    horizontally (`overflow-x-auto`, `whitespace-nowrap`), so its height is
    settled from the first paint. A failed `/categories` call now degrades to a
    single working chip rather than an empty bar.
  */
  return (
    <nav aria-label="Categories" className="sf-noscroll flex gap-2.5 overflow-x-auto">
      {chip('All categories', href('/products', true), !activeSlug && activeIds.size === 0)}
      {cats.map((c) =>
        chip(
          c.name,
          href(`/categories/${c.slug}`, false),
          activeSlug ? c._id === activeHubId : activeIds.has(c._id)
        )
      )}
    </nav>
  );
}
