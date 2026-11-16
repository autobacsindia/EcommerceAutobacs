/**
 * Festival themes the storefront knows how to draw.
 *
 * The backend only stores WHICH theme is switched on and WHEN; the colours, icons
 * and copy live in the frontend's single theme config (src/lib/festival/themes.ts).
 * This allowlist keeps the two in step: a key the storefront has no artwork for
 * is rejected at save time instead of silently rendering nothing.
 *
 * Adding Christmas/Onam/Holi = add the key here AND its entry in themes.ts.
 * Only one theme is on at a time (the admin picks which).
 */
export const FESTIVAL_THEME_KEYS = Object.freeze(['diwali', 'blackfriday']);

/**
 * The Black Friday event. It is the festival theme switched to this key — there
 * is no second switch — so "Black Friday is on" can never disagree with what the
 * storefront is showing. Read it through festivalThemeService.isBlackFridayActive()
 * (server) or `events.blackFriday` on GET /festival-theme/active (storefront).
 */
export const BLACK_FRIDAY_THEME_KEY = 'blackfriday';

export const DEFAULT_FESTIVAL_THEME_KEY = 'diwali';
