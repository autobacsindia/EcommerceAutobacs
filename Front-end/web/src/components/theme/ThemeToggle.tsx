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

/**
 * Class that kills every transition for one frame. See applyTheme.
 *
 * The rule itself lives in globals.css, because a style element injected here
 * would arrive after first paint and miss the very switch it exists to cover.
 */
const NO_TRANSITION = 'theme-switching';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  /*
    Transitions are suppressed for the duration of the swap, and this is NOT
    cosmetic.

    A `transition` on a property whose value is `var(--token)` does not
    re-resolve when the TOKEN changes in Chromium: the element keeps painting
    the old colour until something else invalidates its style. On /about-us that
    left `text-gold` sitting at the dark green and `text-ink` at the dark ink
    after switching to light — correct again only after a reload. Every element
    with `transition-colors` was affected, which is most of the buttons and
    links on the site.

    Removing the transition for the frame in which the attribute changes makes
    the new value resolve immediately. The reflow between the two writes is what
    forces the browser to apply the class before the attribute moves; without it
    the two changes are batched into one style pass and the fix does nothing.
  */
  root.classList.add(NO_TRANSITION);
  void root.offsetHeight;

  root.setAttribute('data-theme', theme);
  // Keeps scrollbars, form controls and the mobile address bar in step.
  root.style.colorScheme = theme;

  // Next frame: the new colours are painted, so transitions can come back for
  // ordinary hover and focus work.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove(NO_TRANSITION));
  });

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
