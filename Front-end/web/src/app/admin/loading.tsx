export default function AdminLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Page title skeleton */}
      <div className="space-y-2">
        <div className="h-7 w-48 bg-gray-200 animate-pulse rounded" />
        <div className="h-4 w-72 bg-gray-200 animate-pulse rounded" />
      </div>

      {/* Stats row skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-lg p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 bg-gray-200 animate-pulse rounded" />
              <div className="h-8 w-8 bg-gray-200 animate-pulse rounded-full" />
            </div>
            <div className="h-7 w-20 bg-gray-200 animate-pulse rounded" />
            <div className="h-3 w-32 bg-gray-200 animate-pulse rounded" />
          </div>
        ))}
      </div>

      {/* Content area skeleton */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="h-5 w-32 bg-gray-200 animate-pulse rounded" />
          <div className="h-8 w-24 bg-gray-200 animate-pulse rounded" />
        </div>
        <div className="divide-y divide-gray-100">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 bg-gray-200 animate-pulse rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 animate-pulse rounded w-2/5" />
                <div className="h-3 bg-gray-200 animate-pulse rounded w-3/5" />
              </div>
              <div className="h-6 w-16 bg-gray-200 animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
