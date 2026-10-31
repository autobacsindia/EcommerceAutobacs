/**
 * Which theme a page shows — the one place the rule is written.
 *
 *   storefront  `roavion-theme`: light | dark, the moon button. Light unless
 *               chosen: the brand is designed and photographed on white, so a
 *               dark laptop does not flip the shop (see ThemeToggle).
 *   staff panel `roavion-panel-theme`: light | dark | system, the switch in
 *               the panel's top bar. A separate choice, so a staff member who
 *               wants a dark panel for long shifts does not darken the shop,
 *               and the reverse. Not chosen yet → whatever the shop uses on
 *               this browser, which is what the panel showed before it had a
 *               switch of its own.
 *
 * THEME_SCRIPT is the same rule as a string, run before first paint (ThemeScript).
 * It is allowed by its SHA-256 hash on the strict-CSP routes — which include
 * /team and /admin — so it must be exported as ONE string that both the
 * renderer and lib/csp.ts use; a copy that differs by a space is silently
 * refused by the browser.
 */
export const THEME_KEY = 'roavion-theme';
export const PANEL_THEME_KEY = 'roavion-panel-theme';

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

export const isPanelPath = (pathname: string): boolean => /^\/(team|admin)(\/|$)/.test(pathname);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** What the person picked for this kind of page (never 'system' on the storefront). */
export function savedChoice(pathname: string): ThemeChoice {
  if (isPanelPath(pathname)) {
    const panel = read(PANEL_THEME_KEY);
    if (panel === 'light' || panel === 'dark' || panel === 'system') return panel;
  }
  return read(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

export const resolveTheme = (choice: ThemeChoice): Theme => (choice === 'system' ? systemTheme() : choice);

export function savePanelChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(PANEL_THEME_KEY, choice);
  } catch {
    // Blocked storage: the theme still applies for this visit.
  }
}

export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{
var s=null;
if(/^\\/(team|admin)(\\/|$)/.test(location.pathname)){s=localStorage.getItem('${PANEL_THEME_KEY}');}
if(s!=='light'&&s!=='dark'&&s!=='system'){s=localStorage.getItem('${THEME_KEY}')==='dark'?'dark':'light';}
var t=s==='system'?(window.matchMedia&&matchMedia('${DARK_QUERY}').matches?'dark':'light'):s;
d.setAttribute('data-theme',t);
d.style.colorScheme=t;
}catch(e){
d.setAttribute('data-theme','light');
}})();`;
