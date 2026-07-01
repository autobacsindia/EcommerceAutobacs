export default function ProductDetailLoading() {
  return (
    <div className="min-h-screen bg-obsidian-deep">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-4 w-16 bg-obsidian-raised animate-pulse rounded" />
              {i < 3 && <div className="h-4 w-2 bg-obsidian-raised animate-pulse rounded" />}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Image gallery skeleton */}
          <div className="space-y-3">
            <div className="aspect-square bg-obsidian-raised animate-pulse rounded-lg" />
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="aspect-square bg-obsidian-raised animate-pulse rounded" />
              ))}
            </div>
          </div>

          {/* Product info skeleton */}
          <div className="space-y-5">
            <div className="h-4 w-24 bg-obsidian-raised animate-pulse rounded" />
            <div className="space-y-2">
              <div className="h-8 bg-obsidian-raised animate-pulse rounded w-4/5" />
              <div className="h-8 bg-obsidian-raised animate-pulse rounded w-3/5" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-5 w-24 bg-obsidian-raised animate-pulse rounded" />
              <div className="h-4 w-20 bg-obsidian-raised animate-pulse rounded" />
            </div>
            <div className="h-8 w-32 bg-obsidian-raised animate-pulse rounded" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-obsidian-raised animate-pulse rounded" style={{ width: `${75 + i * 5}%` }} />
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <div className="h-12 flex-1 bg-obsidian-raised animate-pulse rounded" />
              <div className="h-12 w-12 bg-obsidian-raised animate-pulse rounded" />
            </div>
            <div className="border-t pt-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-5 w-5 bg-obsidian-raised animate-pulse rounded-full" />
                  <div className="h-4 w-48 bg-obsidian-raised animate-pulse rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
