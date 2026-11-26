/**
 * Recovery from a failed script ("chunk") download — see app/global-error.tsx.
 *
 * A reload fixes a missing chunk almost every time, but reloading on EVERY error
 * would loop forever on a real bug. So we reload at most once per window per
 * tab, remembered in sessionStorage. If storage is unavailable (private mode,
 * blocked site data) we do not auto-reload at all: without a memory of the last
 * attempt we cannot prove we are not about to loop.
 */

const KEY = 'chunk-reload-at';
/** A second chunk failure within this window shows the error page instead. */
export const AUTO_RELOAD_WINDOW_MS = 60_000;

/** webpack: ChunkLoadError / "Loading chunk 123 failed"; CSS: "Loading CSS chunk"; native import(): "Failed to fetch dynamically imported module". */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  const msg = typeof message === 'string' ? message : '';
  return /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
}

/** True (and records the attempt) when this tab has not auto-reloaded recently. */
export function shouldAutoReload(now: number = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(KEY) || 0);
    if (last && now - last < AUTO_RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Full page reload — its own function so tests can observe it. */
export function reloadPage(): void {
  window.location.reload();
}
