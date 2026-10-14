'use client';

/**
 * Re-applies the saved theme once React has hydrated.
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
 * It renders nothing.
 */
import { useEffect } from 'react';
import { THEME_KEY, applyTheme, type Theme } from './ThemeToggle';

export default function ThemeSync() {
  useEffect(() => {
    let saved: Theme = 'light';
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light') saved = stored;
    } catch {
      // Blocked storage: light is the documented default.
    }
    if (document.documentElement.getAttribute('data-theme') !== saved) {
      applyTheme(saved);
    }
  }, []);

  return null;
}
