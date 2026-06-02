export default function OrdersLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6 space-y-2">
          <div className="h-8 w-40 bg-gray-200 animate-pulse rounded" />
          <div className="h-4 w-56 bg-gray-200 animate-pulse rounded" />
        </div>

        {/* Filter tabs skeleton */}
        <div className="flex gap-2 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-24 bg-gray-200 animate-pulse rounded-full" />
          ))}
        </div>

        {/* Order cards skeleton */}
        <div className="space-y-4">
          {[1, 2, 3].map((order) => (
            <div key={order} className="bg-white rounded-lg shadow-sm overflow-hidden">
              {/* Order header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="h-4 w-32 bg-gray-200 animate-pulse rounded" />
                  <div className="h-3 w-24 bg-gray-200 animate-pulse rounded" />
                </div>
                <div className="h-6 w-20 bg-gray-200 animate-pulse rounded-full" />
              </div>

              {/* Order items */}
              <div className="px-5 py-4 space-y-3">
                {[1, 2].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="h-14 w-14 bg-gray-200 animate-pulse rounded flex-shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 bg-gray-200 animate-pulse rounded w-2/3" />
                      <div className="h-3 bg-gray-200 animate-pulse rounded w-1/4" />
                    </div>
                    <div className="h-4 w-16 bg-gray-200 animate-pulse rounded" />
                  </div>
                ))}
              </div>

              {/* Order footer */}
              <div className="px-5 py-3 bg-gray-50 flex items-center justify-between">
                <div className="h-4 w-28 bg-gray-200 animate-pulse rounded" />
                <div className="h-8 w-24 bg-gray-200 animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
