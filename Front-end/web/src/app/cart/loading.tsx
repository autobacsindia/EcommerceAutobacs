export default function CartLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="h-8 w-32 bg-gray-200 animate-pulse rounded mb-8" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Cart items skeleton */}
          <div className="lg:col-span-2 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg p-4 shadow-sm flex gap-4 items-center">
                <div className="h-24 w-24 bg-gray-200 animate-pulse rounded flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-gray-200 animate-pulse rounded w-3/4" />
                  <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
                  <div className="flex items-center gap-4 mt-3">
                    <div className="h-8 w-24 bg-gray-200 animate-pulse rounded" />
                    <div className="h-5 w-16 bg-gray-200 animate-pulse rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Summary skeleton */}
          <div className="bg-white rounded-lg p-6 shadow-sm h-fit space-y-4">
            <div className="h-6 w-40 bg-gray-200 animate-pulse rounded" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-24 bg-gray-200 animate-pulse rounded" />
                <div className="h-4 w-16 bg-gray-200 animate-pulse rounded" />
              </div>
            ))}
            <div className="border-t pt-4">
              <div className="flex justify-between mb-4">
                <div className="h-5 w-16 bg-gray-200 animate-pulse rounded" />
                <div className="h-5 w-20 bg-gray-200 animate-pulse rounded" />
              </div>
              <div className="h-12 bg-gray-200 animate-pulse rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
