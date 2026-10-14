/**
 * Roavion design tokens — the SAME values as the website's store.css, so the app
 * and the site are visibly one brand. Only the layout is rebuilt for phones.
 *
 * Keep this file the single source of colour, spacing and type. A screen that
 * hard-codes a hex is a screen that drifts the next time the brand is touched.
 */

export const colors = {
  /** Brand green — primary actions, prices, active states. */
  green: '#0a5c33',
  greenDark: '#084a29',
  greenMid: '#0b6b3c',
  greenSoft: '#e7f3ec',
  greenFaint: '#f2f8f4',

  /** Near-black used for headings and the dark header bar. */
  ink: '#0f1111',
  ink2: '#333838',
  muted: '#5f6363',
  grey: '#707070',

  /** Page background and surfaces. */
  bg: '#eef1f0',
  card: '#ffffff',
  line: '#dfe3e2',

  /** Dark chrome (header / hero overlays). */
  header: '#121414',
  header2: '#1d2121',

  /** Status. */
  red: '#cc0c39',
  star: '#f2a516',
  success: '#0b6b3c',

  white: '#ffffff',
  black: '#000000',
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * TWO faces, exactly as the website ships them: DM Sans for body and UI text,
 * Montserrat for headings only.
 *
 * The app used to set Montserrat on everything "as on the website", which was
 * simply wrong — the site's `body` computes to DM Sans and only `h1`-`h3` to
 * Montserrat. It is the single biggest reason the app did not read like the
 * site: Montserrat is a display face, and at the 13-15px of a product card it
 * sits heavier and more cramped than the DM Sans beside it on the web.
 *
 * Weight is chosen by FONT FAMILY, not fontWeight: on Android fontWeight is
 * ignored for custom fonts, so a "bold" heading would silently render regular.
 */
export const font = {
  /** Body / UI — DM Sans. */
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  /** Headings — Montserrat. `semibold` stays Montserrat for section titles. */
  semibold: 'Montserrat_600SemiBold',
  heading: 'Montserrat_700Bold',
  extrabold: 'Montserrat_800ExtraBold',
} as const;

/**
 * Sizes measured off the LIVE website at 390dp, not estimated.
 *
 * What the site actually renders on a phone:
 *   section heading  17-18 Montserrat 700 / 25.5-27
 *   page title       22    700 / 27.5
 *   body             14    400 / 21
 *   secondary        13    400 / 19.5
 *   meta             12    400 / 14.4
 *   smallest label   11    400 / 14.3
 *
 * The app had been running one to two points above this at almost every level,
 * which is what made it feel chunkier than the web view beside it. Everything
 * here now matches a measured value.
 *
 * 11px is the floor. Anything already at or below 11.5 was left alone — below
 * that, text stops being small and starts being unreadable, which is a worse
 * problem than looking slightly large.
 */
export const type = {
  h1: { fontFamily: font.heading, fontSize: 22, lineHeight: 28, letterSpacing: -0.22, color: colors.ink },
  h2: { fontFamily: font.heading, fontSize: 18, lineHeight: 25, letterSpacing: -0.18, color: colors.ink },
  h3: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: colors.ink2 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  tiny: { fontFamily: font.medium, fontSize: 11, lineHeight: 15, color: colors.muted },
  price: { fontFamily: font.bold, fontSize: 17, color: colors.ink },
} as const;

/**
 * Elevation matching the website's card shadow
 * (`0 1px 3px rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1)`) — much tighter
 * than the soft 10px blur the app used, which read as a floating panel rather
 * than a card sitting on the page. The site pairs it with a 1px #dfe3e2
 * border; `cardBorder` below is that border, so the two always travel together.
 */
export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0f1111',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

/** The website's card: 12px radius, hairline border, the shadow above. */
export const cardSurface = {
  backgroundColor: colors.card,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.line,
} as const;

/** Indian rupee formatting, matching the website (₹1,68,550 — no decimals). */
export function inr(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
