/**
 * Route-level skeleton for /products.
 *
 * ⚠ THIS FILE MUST STAY INSIDE THE `(list)` ROUTE GROUP. A `loading.tsx` at
 * `products/` would be an ANCESTOR of `products/[slug]`, and a Suspense
 * boundary above that route makes Next flush the shell — committing HTTP 200 —
 * before the page can throw notFound(). That is the site-wide soft-404 bug of
 * 2026-08-20 (see src/app/soft404.test.ts, which fails if this file moves up).
 * A route group is a SIBLING of `[slug]`, so the boundary covers the listing
 * only and `/products/<junk>` keeps answering 404.
 *
 * Shape mirrors the shell in ProductsClient.tsx (header → sticky chips →
 * sidebar + 3-up grid) and reuses its exact card skeleton, so the handoff from
 * this boundary to the client grid's own `loading` state causes no layout
 * shift.
 */
export default function ProductsLoading() {
  return (
    <div className="min-h-screen bg-obsidian font-display text-ink">
      {/* Header */}
      <header className="border-b border-hairline bg-obsidian-deep px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-[1400px] space-y-4">
          <div className="h-3 w-28 animate-pulse bg-obsidian-raised" />
          <div className="h-[clamp(38px,6vw,72px)] w-2/3 animate-pulse bg-obsidian-raised" />
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        {/* Sticky category chips */}
        <div className="sticky top-16 z-30 -mx-5 border-b border-hairline bg-obsidian/90 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8 md:top-[76px]">
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 w-24 shrink-0 animate-pulse bg-obsidian-raised" />
            ))}
          </div>
        </div>

        <div className="flex gap-10 py-8">
          {/* Sidebar */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-[150px] space-y-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="h-3 w-24 animate-pulse bg-obsidian-raised" />
                  {Array.from({ length: 4 }).map((__, j) => (
                    <div key={j} className="h-4 w-full animate-pulse bg-obsidian-raised" />
                  ))}
                </div>
              ))}
            </div>
          </aside>

          {/* Main */}
          <div className="min-w-0 flex-1">
            {/* Toolbar */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="h-4 w-24 animate-pulse bg-obsidian-raised" />
              <div className="h-10 w-44 animate-pulse bg-obsidian-raised" />
            </div>

            {/* Grid — identical to the client grid's own loading state */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="border border-hairline bg-obsidian">
                  <div className="aspect-[4/5] animate-pulse bg-obsidian-raised" />
                  <div className="space-y-3 p-5">
                    <div className="h-3 w-1/3 animate-pulse bg-obsidian-raised" />
                    <div className="h-4 w-3/4 animate-pulse bg-obsidian-raised" />
                    <div className="h-5 w-1/2 animate-pulse bg-obsidian-raised" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
