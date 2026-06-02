export default function CategoryLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Category header skeleton */}
        <div className="mb-8 space-y-3">
          <div className="h-4 w-40 bg-gray-200 animate-pulse rounded" />
          <div className="h-9 w-56 bg-gray-200 animate-pulse rounded" />
          <div className="h-4 w-80 bg-gray-200 animate-pulse rounded" />
        </div>

        <div className="flex gap-8">
          {/* Filters skeleton */}
          <div className="hidden lg:block w-60 flex-shrink-0 space-y-4">
            {[1, 2, 3].map((section) => (
              <div key={section} className="bg-white rounded-lg p-4 shadow-sm space-y-3">
                <div className="h-5 w-20 bg-gray-200 animate-pulse rounded" />
                {[1, 2, 3].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <div className="h-4 w-4 bg-gray-200 animate-pulse rounded" />
                    <div className="h-4 bg-gray-200 animate-pulse rounded w-3/4" />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Product grid skeleton */}
          <div className="flex-1">
            <div className="flex justify-between items-center mb-4">
              <div className="h-4 w-32 bg-gray-200 animate-pulse rounded" />
              <div className="h-8 w-36 bg-gray-200 animate-pulse rounded" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden">
                  <div className="aspect-square bg-gray-200 animate-pulse" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-gray-200 animate-pulse rounded w-3/4" />
                    <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
                    <div className="h-5 bg-gray-200 animate-pulse rounded w-1/3" />
                    <div className="h-8 bg-gray-200 animate-pulse rounded mt-1" />
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
