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
 * Montserrat, as on the website. Weight is chosen by FONT FAMILY, not
 * fontWeight: on Android fontWeight is ignored for custom fonts, so a "bold"
 * heading would silently render regular.
 */
export const font = {
  regular: 'Montserrat_400Regular',
  medium: 'Montserrat_500Medium',
  semibold: 'Montserrat_600SemiBold',
  bold: 'Montserrat_700Bold',
  extrabold: 'Montserrat_800ExtraBold',
} as const;

export const type = {
  h1: { fontFamily: font.bold, fontSize: 26, lineHeight: 32, color: colors.ink },
  h2: { fontFamily: font.bold, fontSize: 20, lineHeight: 26, color: colors.ink },
  h3: { fontFamily: font.semibold, fontSize: 17, lineHeight: 23, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.ink2 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  tiny: { fontFamily: font.medium, fontSize: 11, lineHeight: 15, color: colors.muted },
  price: { fontFamily: font.bold, fontSize: 18, color: colors.ink },
} as const;

/** Soft elevation that reads the same on both platforms. */
export const shadow = {
  card: {
    shadowColor: '#0f1111',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
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

/** Indian rupee formatting, matching the website (₹1,68,550 — no decimals). */
export function inr(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
