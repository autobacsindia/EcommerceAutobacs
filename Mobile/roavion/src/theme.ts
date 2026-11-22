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

  /**
   * Page background and surfaces — design "Premium showroom" (2026-11-18, on
   * top of "A clean light"): soft off-white page, white cards with hairline
   * borders, green only on key actions and active states.
   */
  bg: '#f7f8f7',
  card: '#ffffff',
  /** Hairline border for cards and dividers. */
  line: '#eef0ef',
  /** Stronger border for inputs and outline controls that must read as tappable. */
  lineStrong: '#dfe3e2',
  /** Light grey fill: search fields, inset panels, image wells. */
  subtle: '#f4f6f5',

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

/**
 * Soft tints for category tiles and chips — each tile gets a different one,
 * cycling in this order.
 */
export const tints = ['#e7f3ec', '#fdf1dc', '#e6eefb', '#fbe9ee'] as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
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
 * Sizes measured off the website at 375dp: its page h1 is Montserrat 700 at
 * 23/27.6 with -0.23px tracking, body 16, a product title 14/19.25 at weight
 * 500. Matching those is what makes a screenshot of the two sit side by side.
 */
export const type = {
  h1: { fontFamily: font.heading, fontSize: 23, lineHeight: 28, letterSpacing: -0.23, color: colors.ink },
  h2: { fontFamily: font.heading, fontSize: 20, lineHeight: 25, letterSpacing: -0.2, color: colors.ink },
  h3: { fontFamily: font.semibold, fontSize: 17, lineHeight: 23, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.ink2 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  tiny: { fontFamily: font.medium, fontSize: 11, lineHeight: 15, color: colors.muted },
  price: { fontFamily: font.bold, fontSize: 18, color: colors.ink },
} as const;

/**
 * Elevation. Design "A clean light": on a white page a card is defined by its
 * hairline border, so the shadow is only a soft lift, never a dark edge. The site pairs it with a 1px #dfe3e2
 * border; `cardBorder` below is that border, so the two always travel together.
 */
export const shadow = {
  card: {
    shadowColor: '#0f1111',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
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
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.line,
} as const;

/** Indian rupee formatting, matching the website (₹1,68,550 — no decimals). */
export function inr(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
