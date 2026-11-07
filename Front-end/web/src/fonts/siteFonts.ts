import localFont from 'next/font/local';

/**
 * Storefront + staff-panel fonts, SELF-HOSTED (no request to Google at build
 * time or at runtime).
 *
 * Why: `next/font/google` downloads these files from fonts.gstatic.com during
 * every `next build`. When that download flaked on a GitHub runner the Build
 * check went red ("An error occurred in `next/font`") — PRs #333, #381, #382 —
 * and the same flake could fail a Vercel production deploy.
 *
 * The .woff2 files in this folder are the exact files Google serves for these
 * families (fetched 2026-11-07, DM Sans v17, Montserrat v31), and the calls
 * below reproduce Google's CSS one-for-one: one @font-face set per subset,
 * with the same `unicode-range`, weights, `display: swap`, and the `latin`
 * subset declared last and preloaded (exactly what `subsets: ['latin']` did).
 * The non-latin subsets download only when a page actually uses those glyphs —
 * note `latin-ext` carries the ₹ sign, so most pages fetch it, as before.
 *
 * Only the `latin` call sets the CSS variable and builds the size-matched
 * Arial fallback (prevents layout shift while the font loads). The other calls
 * share its font-family name and just add glyph coverage; they are exported
 * so the build keeps their CSS — do not delete them as "unused".
 *
 * Licence: SIL Open Font License 1.1 — see OFL.txt in each folder.
 * To change the site font: swap the files + these calls. Pages consume only the
 * CSS variables `--font-dm-sans` and `--font-montserrat` (set on <body> in
 * app/layout.tsx), so nothing else needs touching.
 */

// ── DM Sans (body text) → --font-dm-sans ─────────────────────────────────

/** latin-ext glyphs — fetched by the browser only when the page uses them. */
export const dmSansLatinExt = localFont({
  src: [
    { path: './dm-sans/latin-ext.woff2', weight: '300', style: 'normal' },
    { path: './dm-sans/latin-ext.woff2', weight: '400', style: 'normal' },
    { path: './dm-sans/latin-ext.woff2', weight: '500', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: 'DM Sans' },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const dmSans = localFont({
  src: [
    { path: './dm-sans/latin.woff2', weight: '300', style: 'normal' },
    { path: './dm-sans/latin.woff2', weight: '400', style: 'normal' },
    { path: './dm-sans/latin.woff2', weight: '500', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: 'DM Sans' },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
  display: 'swap',
  variable: '--font-dm-sans',
  preload: true,
  adjustFontFallback: 'Arial',
});

// ── Montserrat (site display font) → --font-montserrat ─────────────────────

/** cyrillic-ext glyphs — fetched by the browser only when the page uses them. */
export const montserratCyrillicExt = localFont({
  src: [
    { path: './montserrat/cyrillic-ext.woff2', weight: '300', style: 'normal' },
    { path: './montserrat/cyrillic-ext.woff2', weight: '400', style: 'normal' },
    { path: './montserrat/cyrillic-ext.woff2', weight: '500', style: 'normal' },
    { path: './montserrat/cyrillic-ext.woff2', weight: '600', style: 'normal' },
    { path: './montserrat/cyrillic-ext.woff2', weight: '700', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: 'Montserrat' },
    { prop: 'unicode-range', value: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** cyrillic glyphs — fetched by the browser only when the page uses them. */
export const montserratCyrillic = localFont({
  src: [
    { path: './montserrat/cyrillic.woff2', weight: '300', style: 'normal' },
    { path: './montserrat/cyrillic.woff2', weight: '400', style: 'normal' },
    { path: './montserrat/cyrillic.woff2', weight: '500', style: 'normal' },
    { path: './montserrat/cyrillic.woff2', weight: '600', style: 'normal' },
    { path: './montserrat/cyrillic.woff2', weight: '700', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: 'Montserrat' },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** vietnamese glyphs — fetched by the browser only when the page uses them. */
export const montserratVietnamese = localFont({
  src: [
    { path: './montserrat/vietnamese.woff2', weight: '300', style: 'normal' },
    { path: './montserrat/vietnamese.woff2', weight: '400', style: 'normal' },
    { path: './montserrat/vietnamese.woff2', weight: '500', style: 'normal' },
    { path: './montserrat/vietnamese.woff2', weight: '600', style: 'normal' },
    { path: './montserrat/vietnamese.woff2', weight: '700', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: 'Montserrat' },
    { prop: 'unicode-range', value: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** latin-ext glyphs — fetched by the browser only when the page uses them. */
export const montserratLatinExt = localFont({
  src: [
    { path: './montserrat/latin-ext.woff2', weight: '300', style: 'normal' },
    { path: './montserrat/latin-ext.woff2', weight: '400', style: 'normal' },
    { path: './montserrat/latin-ext.woff2', weight: '500', style: 'normal' },
    { path: './montserrat/latin-ext.woff2', weight: '600', style: 'normal' },
    { path: './montserrat/latin-ext.woff2', weight: '700', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: 'Montserrat' },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const montserrat = localFont({
  src: [
    { path: './montserrat/latin.woff2', weight: '300', style: 'normal' },
    { path: './montserrat/latin.woff2', weight: '400', style: 'normal' },
    { path: './montserrat/latin.woff2', weight: '500', style: 'normal' },
    { path: './montserrat/latin.woff2', weight: '600', style: 'normal' },
    { path: './montserrat/latin.woff2', weight: '700', style: 'normal' },
  ],
  declarations: [
    { prop: 'font-family', value: 'Montserrat' },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
  display: 'swap',
  variable: '--font-montserrat',
  preload: true,
  adjustFontFallback: 'Arial',
});

