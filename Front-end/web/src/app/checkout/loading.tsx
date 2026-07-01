export default function CheckoutLoading() {
  return (
    <div className="min-h-screen bg-obsidian-deep">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Step indicator skeleton */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-obsidian-raised animate-pulse" />
              {step < 4 && <div className="h-1 w-12 bg-obsidian-raised animate-pulse" />}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form skeleton */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-obsidian rounded-lg p-6 shadow-sm space-y-4">
              <div className="h-6 w-40 bg-obsidian-raised animate-pulse rounded" />
              <div className="grid grid-cols-2 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className={`space-y-1 ${i === 3 || i === 6 ? 'col-span-2' : ''}`}>
                    <div className="h-4 w-24 bg-obsidian-raised animate-pulse rounded" />
                    <div className="h-10 bg-obsidian-raised animate-pulse rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Order summary skeleton */}
          <div className="bg-obsidian rounded-lg p-6 shadow-sm space-y-4 h-fit">
            <div className="h-6 w-32 bg-obsidian-raised animate-pulse rounded" />
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="h-16 w-16 bg-obsidian-raised animate-pulse rounded flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-obsidian-raised animate-pulse rounded w-3/4" />
                  <div className="h-4 bg-obsidian-raised animate-pulse rounded w-1/3" />
                </div>
              </div>
            ))}
            <div className="border-t pt-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between">
                  <div className="h-4 w-20 bg-obsidian-raised animate-pulse rounded" />
                  <div className="h-4 w-16 bg-obsidian-raised animate-pulse rounded" />
                </div>
              ))}
            </div>
            <div className="h-12 bg-obsidian-raised animate-pulse rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
