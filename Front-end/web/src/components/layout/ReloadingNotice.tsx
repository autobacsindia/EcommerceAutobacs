/** Shown by a route's error.tsx for the moment between a chunk-error auto-reload and the fresh page. */
export default function ReloadingNotice() {
  return (
    <div role="status" className="min-h-screen flex items-center justify-center bg-obsidian-deep px-4">
      <p className="text-ink/70 font-display">Reloading…</p>
    </div>
  );
}
