'use client';

/**
 * Error boundary for /categories. Rendered when the server component's
 * getCategories() throws (backend unreachable / non-2xx). Unlike a cached
 * in-page error state, this is NOT persisted by ISR — and `reset()` re-runs the
 * server render, so "Try again" actually refetches instead of re-serving a
 * cached failure.
 */
export default function CategoriesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-obsidian-deep py-12 flex items-center justify-center">
      <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-8 max-w-md mx-4 text-center">
        <svg className="w-14 h-14 mx-auto text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h2 className="text-xl font-display font-light text-ink tracking-[-0.01em] mb-2">Error Loading Categories</h2>
        <p className="text-ink/70 font-display mb-6">
          We couldn’t load categories right now. Please try again shortly.
        </p>
        <button
          onClick={reset}
          className="bg-gold text-obsidian font-display text-[10px] font-semibold uppercase tracking-[0.2em] px-6 py-3 transition-opacity hover:opacity-90"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
