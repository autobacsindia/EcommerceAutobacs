/**
 * Route-level skeleton for /brands.
 *
 * ⚠ MUST STAY INSIDE THE `(list)` ROUTE GROUP — a `loading.tsx` at `brands/`
 * would sit above `brands/[slug]`, whose page.tsx exists specifically so a
 * missing brand can throw notFound(). A Suspense boundary above it commits
 * HTTP 200 first and re-creates the 2026-08-20 soft-404. See
 * src/app/soft404.test.ts.
 *
 * Mirrors page.tsx: centred hero, then the 4-up brand card grid.
 */
export default function BrandsLoading() {
  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Hero */}
      <div className="border-b border-hairline bg-obsidian px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-[1400px] space-y-6 text-center">
          <div className="mx-auto h-3 w-24 animate-pulse bg-obsidian-raised" />
          <div className="mx-auto h-[clamp(40px,6.5vw,84px)] w-full max-w-4xl animate-pulse bg-obsidian-raised" />
          <div className="mx-auto h-4 w-full max-w-2xl animate-pulse bg-obsidian-raised" />
        </div>
      </div>

      {/* Brand grid */}
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border border-hairline bg-obsidian p-6">
              <div className="mx-auto h-24 w-full animate-pulse bg-obsidian-raised" />
              <div className="mx-auto mt-5 h-4 w-1/2 animate-pulse bg-obsidian-raised" />
              <div className="mx-auto mt-2 h-3 w-1/3 animate-pulse bg-obsidian-raised" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
