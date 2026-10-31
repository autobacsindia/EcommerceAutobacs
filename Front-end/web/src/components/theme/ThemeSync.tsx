'use client';

/**
 * Re-applies the saved theme once React has hydrated, and again whenever the
 * page moves between the storefront and the staff panel.
 *
 * Why this is needed as well as ThemeScript:
 *
 * ThemeScript sets `data-theme` on <html> before first paint, which is the only
 * way to avoid a white flash. But <html> is rendered by React, and React
 * reconciles attributes it owns — naming `data-theme` in the JSX made React
 * hold "light" and reset the DOM on any client re-render (that is why /cart
 * rendered light while localStorage said dark); leaving it out made React
 * REMOVE the attribute the script had set.
 *
 * So the script owns first paint and this owns everything after it. The two
 * together are what every theme library does, for the same reason.
 *
 * The panel and the shop keep separate choices (themeChoice.ts), and a client
 * navigation ("View website" from the panel) does not re-run ThemeScript — so
 * this follows the path. When the panel is set to "match my computer" it also
 * follows the computer switching between light and dark while the page is open.
 *
 * It renders nothing.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { paintTheme } from './ThemeToggle';
import { DARK_QUERY, PANEL_THEME_KEY, THEME_KEY, resolveTheme, savedChoice } from './themeChoice';

/** Paint what this path should show, if it is not showing it already. */
export function syncTheme(pathname: string): void {
  const want = resolveTheme(savedChoice(pathname));
  if (document.documentElement.getAttribute('data-theme') !== want) paintTheme(want);
}

export default function ThemeSync() {
  const pathname = usePathname() || '/';

  useEffect(() => {
    syncTheme(pathname);
    const media = window.matchMedia?.(DARK_QUERY);
    const onSystem = () => { if (savedChoice(pathname) === 'system') syncTheme(pathname); };
    // Another tab changed a choice: follow it here too.
    const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY || e.key === PANEL_THEME_KEY) syncTheme(pathname); };
    media?.addEventListener?.('change', onSystem);
    window.addEventListener('storage', onStorage);
    return () => {
      media?.removeEventListener?.('change', onSystem);
      window.removeEventListener('storage', onStorage);
    };
  }, [pathname]);

  return null;
}
