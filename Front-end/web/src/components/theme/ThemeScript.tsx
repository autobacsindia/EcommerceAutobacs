/**
 * Applies the saved theme before the first paint.
 *
 * This has to be a blocking inline script in <head>. React cannot do it: by the
 * time a component runs, the browser has already painted, and on a dark-theme
 * visitor that means a white flash on every single navigation. There is no
 * CSS-only way to read localStorage.
 *
 * It sets `data-theme` on <html>, which is what the token overrides in
 * globals.css key off. `colorScheme` is set alongside so the browser renders
 * scrollbars, form controls and the address bar to match — those are chrome we
 * do not style, and a light scrollbar on a dark page is the giveaway that a
 * theme was bolted on.
 *
 * Default is light: that is the premium look the brand already has, and a
 * first-time visitor should see what the business designed. The staff panel
 * has its own choice (light / dark / match the computer) — the rule and the
 * script itself live in themeChoice.ts, because lib/csp.ts hashes the same
 * string to allow it on the strict-CSP routes (/team, /admin, /cart…).
 */
import { THEME_SCRIPT } from './themeChoice';

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
