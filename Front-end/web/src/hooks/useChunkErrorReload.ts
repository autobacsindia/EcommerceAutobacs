'use client';

import { useEffect, useState } from 'react';
import { isChunkLoadError, reloadPage, shouldAutoReload } from '@/lib/chunkErrorRecovery';

/**
 * For a route's error.tsx: when the crash is a failed script download
 * ("ChunkLoadError" — flaky phone data, a cut-off download, a tab left open
 * across a release), reload the page once. A fresh load almost always fixes it,
 * where the error screen's "Try again" (React reset) re-renders with the same
 * missing script and fails again.
 *
 * Loop guard (lib/chunkErrorRecovery): at most one auto-reload per tab per
 * minute, remembered in sessionStorage. If storage is blocked we never
 * auto-reload — without that memory we cannot prove we are not looping.
 *
 * Returns true while the reload is under way, so the page can say "Reloading…".
 */
export function useChunkErrorReload(error: unknown): boolean {
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    if (isChunkLoadError(error) && shouldAutoReload()) {
      setReloading(true);
      reloadPage();
    }
  }, [error]);
  return reloading;
}
