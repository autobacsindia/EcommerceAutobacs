/**
 * Autobacs Team design tokens — light, website-matched (the owner rejected dark
 * mobile designs). Matches the approved mockup (hr-mockups.html, 2026-11-22) and
 * the other Autobacs apps. Screens import from here; no screen hard-codes a hex.
 */
export const palette = {
  green: '#0a5c33',
  greenDeep: '#084a29',
  greenOnDark: '#3fbf7f',
  greenSoft: '#e7f3ec',
  ink: '#0f1111',
  ink2: '#333838',
  muted: '#5a6360',
  line: '#e3e7e5',
  page: '#f3f5f4',
  white: '#ffffff',
  warn: '#9a5b00',
  warnSoft: '#fff4e0',
  bad: '#b42318',
  badSoft: '#fdecea',
  info: '#1f4f99',
  infoSoft: '#e8effb',
  /** Face-check camera screen only (the camera preview needs a dark surround). */
  cam: '#1b2220',
  camText: '#c9d2ce',
} as const;

export const colors = {
  ...palette,
  bg: palette.page,
  card: palette.white,
  primary: palette.green,
  onPrimary: palette.white,
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 18, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Weight by FAMILY — Android ignores fontWeight on custom fonts. */
export const font = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  heading: 'Montserrat_700Bold',
  extrabold: 'Montserrat_800ExtraBold',
} as const;

export const type = {
  clock: { fontFamily: font.extrabold, fontSize: 40, lineHeight: 44, letterSpacing: -0.8, color: colors.ink },
  h1: { fontFamily: font.heading, fontSize: 20, lineHeight: 26, color: colors.ink },
  h2: { fontFamily: font.heading, fontSize: 16, lineHeight: 22, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: colors.ink2 },
  bodyBold: { fontFamily: font.bold, fontSize: 15, lineHeight: 21, color: colors.ink },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontFamily: font.bold, fontSize: 13, lineHeight: 18, color: colors.ink },
  caption: { fontFamily: font.medium, fontSize: 11.5, lineHeight: 15, color: colors.muted },
} as const;
