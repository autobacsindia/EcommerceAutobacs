'use client';

export default function Loading() {
  return (
    <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold mx-auto"></div>
        <p className="mt-4 text-ink-muted">Loading...</p>
      </div>
    </div>
  );
}
