/**
 * Festival themes the storefront knows how to draw.
 *
 * The backend only stores WHICH theme is switched on and WHEN; the colours, icons
 * and copy live in the frontend's single theme config (src/lib/festival/themes.ts).
 * This allowlist keeps the two in step: a key the storefront has no artwork for
 * is rejected at save time instead of silently rendering nothing.
 *
 * Adding Christmas/Onam/Holi = add the key here AND its entry in themes.ts.
 */
export const FESTIVAL_THEME_KEYS = Object.freeze(['diwali']);

export const DEFAULT_FESTIVAL_THEME_KEY = 'diwali';
