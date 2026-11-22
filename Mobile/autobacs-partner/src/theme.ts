/**
 * Autobacs Partner design tokens — light, website-matched (owner rejected dark
 * designs). Same palette as the customer app (Mobile/roavion/src/theme.ts) and the
 * website's default theme; copied, not imported, because each app ships alone.
 * Screens import from here; no screen hard-codes a hex.
 */
export const palette = {
  green: '#0a5c33',
  greenDeep: '#084a29',
  greenOnDark: '#228a57',
  greenSoft: '#e7f3ec',
  greenFaint: '#f2f8f4',
  ink: '#0f1111',
  ink2: '#333838',
  muted: '#5f6363',
  steel: '#707070',
  chrome: '#c4c4c4',
  line: '#dfe3e2',
  page: '#f6f7f6',
  white: '#ffffff',
  gold: '#b7791f',
  goldSoft: '#fdf3e1',
  red: '#cc0c39',
  redSoft: '#fbe9ee',
  blue: '#1d4f91',
  blueSoft: '#e8eff8',
} as const;

export const colors = {
  ...palette,
  bg: palette.page,
  card: palette.white,
  primary: palette.green,
  onPrimary: palette.white,
  scrim: 'rgba(15,17,17,0.45)',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
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
  display: { fontFamily: font.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, color: colors.ink },
  h1: { fontFamily: font.heading, fontSize: 22, lineHeight: 28, color: colors.ink },
  h2: { fontFamily: font.heading, fontSize: 17, lineHeight: 23, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.ink2 },
  bodyBold: { fontFamily: font.bold, fontSize: 15, lineHeight: 22, color: colors.ink },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: colors.ink2 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: colors.muted },
  overline: { fontFamily: font.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.6, color: colors.green },
} as const;

export const elevation = {
  e1: { shadowColor: palette.ink, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  e2: { shadowColor: palette.ink, shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
} as const;
