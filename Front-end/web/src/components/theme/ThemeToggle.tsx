'use client';

/**
 * Light/dark switch.
 *
 * The theme itself is applied by ThemeScript before first paint; this only
 * changes it afterwards. The two must agree on the storage key and the
 * attribute, so both are stated here and there and nowhere else.
 *
 * Deliberately NOT following `prefers-color-scheme` on a first visit. The light
 * theme is the one the business designed and the one every photograph was shot
 * against; a visitor whose laptop is in dark mode should still see the brand as
 * intended until they choose otherwise.
 */
import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export const THEME_KEY = 'roavion-theme';
export type Theme = 'light' | 'dark';

function current(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  // Keeps scrollbars, form controls and the mobile address bar in step.
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit.
  }
}

export default function ThemeToggle({ className = '' }: { className?: string }) {
  // `mounted` avoids a hydration mismatch: the server cannot know the theme,
  // so the icon is rendered only once the client has read the real attribute.
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(current());
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }, []);

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      // The pressed state is the honest one for a two-state switch, and lets a
      // screen reader announce the change rather than just the new label.
      aria-pressed={dark}
      title={dark ? 'Light theme' : 'Dark theme'}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${className}`}
    >
      {/* Before mount, render the moon with no transition so the button has a
          stable size and nothing jumps when the real value arrives. */}
      {mounted && dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
