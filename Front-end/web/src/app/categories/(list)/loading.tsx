/**
 * Route-level skeleton for /categories.
 *
 * ⚠ MUST STAY INSIDE THE `(list)` ROUTE GROUP — a `loading.tsx` at
 * `categories/` would sit above `categories/[slug]` and its Suspense boundary
 * would commit HTTP 200 before that page could throw notFound(), re-creating
 * the 2026-08-20 soft-404. See src/app/soft404.test.ts.
 *
 * Mirrors page.tsx: centred hero, then the category grid.
 */
export default function CategoriesLoading() {
  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="border-b border-hairline bg-obsidian px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-[1400px] space-y-5 text-center">
          <div className="mx-auto h-3 w-20 animate-pulse bg-obsidian-raised" />
          <div className="mx-auto h-[clamp(38px,6vw,72px)] w-full max-w-3xl animate-pulse bg-obsidian-raised" />
          <div className="mx-auto h-4 w-full max-w-xl animate-pulse bg-obsidian-raised" />
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="border border-hairline bg-obsidian">
              <div className="aspect-[4/3] animate-pulse bg-obsidian-raised" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 animate-pulse bg-obsidian-raised" />
                <div className="h-3 w-1/3 animate-pulse bg-obsidian-raised" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
