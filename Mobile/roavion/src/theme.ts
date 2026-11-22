/**
 * Autobacs design tokens — design "Premium launch" (owner approved 2026-11-22).
 *
 * THE RULE: every colour comes from the Autobacs logo or the website's
 * store.css. No other hue may appear in the app. Translucent versions of these
 * colours (scrims, glass, soft fills) are made with `alpha()` below, so they
 * stay the same hue. A screen that hard-codes a hex is a screen that drifts the
 * next time the brand is touched — import from here instead.
 *
 * The cheat-sheet for screen authors lives in the session notes
 * (`mobile-premium-foundation.md`); this file is the source of truth.
 */

// ── palette ──────────────────────────────────────────────────────────────────

/** The raw brand palette. Prefer the semantic names in `colors` in screens. */
export const palette = {
  // Autobacs green (logo "B", primary actions)
  green: '#0a5c33',
  greenDeep: '#084a29',
  greenMid: '#0b6b3c',
  /** Green that still reads on carbon / black backgrounds. */
  greenOnDark: '#228a57',
  greenSoft: '#e7f3ec',
  greenFaint: '#f2f8f4',
  /** Website hero "mint" slide (store.css `.sh-slide-mint`). */
  greenMint: '#d9efe2',

  // Ink & carbon (wordmark, header, launch)
  ink: '#0f1111',
  carbon: '#121414',
  carbon2: '#1d2121',
  void: '#080808',

  // Neutrals
  white: '#ffffff',
  page: '#f6f7f6',
  line: '#dfe3e2',
  steel: '#707070',
  muted: '#5f6363',
  ink2: '#333838',
  chrome: '#c4c4c4',

  // Accents (used sparingly)
  gold: '#f2a516',
  red: '#cc0c39',

  black: '#000000',
} as const;

/**
 * A brand colour at some opacity — the ONLY sanctioned way to get a scrim,
 * glass fill or soft tint. `alpha(palette.ink, 0.5)` → `rgba(15,17,17,0.5)`.
 */
export function alpha(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  const a = Math.max(0, Math.min(1, opacity));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Semantic colours. The older names (`bg`, `card`, `header`, `greenDark`…) are
 * kept so every existing screen still compiles and simply picks up the new
 * values.
 */
export const colors = {
  /** Brand green — key actions, prices in context, active states. */
  green: palette.green,
  greenDark: palette.greenDeep,
  greenDeep: palette.greenDeep,
  greenMid: palette.greenMid,
  greenOnDark: palette.greenOnDark,
  greenSoft: palette.greenSoft,
  greenFaint: palette.greenFaint,

  /** Text. */
  ink: palette.ink,
  ink2: palette.ink2,
  muted: palette.muted,
  grey: palette.steel,
  steel: palette.steel,
  chrome: palette.chrome,

  /** Surfaces. */
  bg: palette.page,
  page: palette.page,
  card: palette.white,
  /** Inset fills: search fields, image wells. */
  subtle: palette.page,
  /** Hairline for cards and dividers (draw at StyleSheet.hairlineWidth or 1). */
  line: palette.line,
  /** Border for inputs / outline controls that must read as tappable. */
  lineStrong: palette.chrome,

  /** Dark chrome: header, tab bar, reels UI, launch. */
  header: palette.carbon,
  header2: palette.carbon2,
  carbon: palette.carbon,
  carbon2: palette.carbon2,
  void: palette.void,

  /** Status / accents. */
  red: palette.red,
  redSoft: alpha(palette.red, 0.08),
  star: palette.gold,
  gold: palette.gold,
  goldSoft: alpha(palette.gold, 0.14),
  success: palette.greenMid,

  white: palette.white,
  black: palette.black,

  /** Overlays — always derived from ink/white, never a new hue. */
  scrim: alpha(palette.ink, 0.45),
  scrimStrong: alpha(palette.ink, 0.72),
  glassLight: alpha(palette.white, 0.72),
  glassDark: alpha(palette.carbon, 0.62),
  onDarkMuted: alpha(palette.white, 0.72),
  onDarkFaint: alpha(palette.white, 0.18),
  pressedOnDark: alpha(palette.white, 0.22),
  pressedOnLight: alpha(palette.green, 0.12),
  skeleton: palette.line,
  skeletonSheen: alpha(palette.white, 0.65),

  /**
   * Website store header (store.css `.sh-top` / `.sh-vehicle-btn` / `.sh-go`):
   * carbon bar, white wordmark, a dashed green "Parts for <car>" pill, a white
   * search pill with a green Go, and the cart. Added 2026-11-22 (light-home).
   */
  headerText: palette.white,
  headerMuted: alpha(palette.white, 0.72),
  headerHairline: alpha(palette.white, 0.14),
  vehicleFill: alpha(palette.green, 0.32),
  vehicleBorder: alpha(palette.greenOnDark, 0.75),
  /** Product photo well — the website's `.st-tile-media` grey. */
  well: palette.page,
  /** Instagram-style story ring around reel avatars. */
  storyRing: palette.green,
} as const;

/**
 * Website hero slide tones (store.css `.sh-slide-green` / `-mint`); the third
 * website tone (sand) is off-palette, so the app uses a white/page wash.
 */
export const slideTones = {
  green: { from: palette.green, to: palette.greenDeep, ink: palette.white, muted: alpha(palette.white, 0.8) },
  mint: { from: palette.greenMint, to: palette.greenFaint, ink: palette.ink, muted: palette.muted },
  light: { from: palette.white, to: palette.page, ink: palette.ink, muted: palette.muted },
} as const;
export type SlideTone = keyof typeof slideTones;

/** The logo's three slanted stripes, in order. */
export const stripes = [palette.green, palette.white, palette.steel] as const;

// ── shape & spacing ─────────────────────────────────────────────────────────

export const radius = {
  /** Badges, small tags. */
  sm: 8,
  /** Inputs, small cards, tiles. */
  md: 12,
  /** Cards, sheets' inner panels. */
  lg: 16,
  /** Hero cards, bottom sheets. */
  xl: 22,
  pill: 999,
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Minimum touch target (Apple HIG 44, Material 48 — we use 44 + hitSlop). */
export const touch = { min: 44 } as const;

// ── type ─────────────────────────────────────────────────────────────────────

/**
 * Two faces, exactly as the website: Montserrat for display/headings, DM Sans
 * for body and UI. Weight is chosen by FAMILY, not fontWeight: Android ignores
 * fontWeight on custom fonts.
 */
export const font = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  semibold: 'Montserrat_600SemiBold',
  heading: 'Montserrat_700Bold',
  extrabold: 'Montserrat_800ExtraBold',
} as const;

/**
 * Type scale. New: `display`, `caption`, `overline`. Kept for existing screens:
 * `h3`, `small`, `tiny`, `price`.
 */
export const type = {
  /** Hero titles, launch, big empty-state titles. Montserrat 800 28/34. */
  display: { fontFamily: font.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, color: colors.ink },
  h1: { fontFamily: font.heading, fontSize: 22, lineHeight: 28, letterSpacing: -0.22, color: colors.ink },
  h2: { fontFamily: font.heading, fontSize: 18, lineHeight: 24, letterSpacing: -0.15, color: colors.ink },
  h3: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.ink2 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: colors.muted },
  tiny: { fontFamily: font.medium, fontSize: 11, lineHeight: 15, color: colors.muted },
  /** Letter-spaced caps above a title ("NEW ARRIVALS"). Pass UPPERCASE text or use <Overline>. */
  overline: {
    fontFamily: font.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    color: colors.green,
  },
  price: { fontFamily: font.bold, fontSize: 18, color: colors.ink },
} as const;

// ── elevation ───────────────────────────────────────────────────────────────

/**
 * Paired iOS shadow + Android elevation, so a card lifts the same amount on
 * both. Spread into a style: `{ ...elevation.e1 }`.
 */
export const elevation = {
  e0: { shadowColor: palette.ink, shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  /** Resting card. */
  e1: { shadowColor: palette.ink, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  /** Floating chip, sticky bar. */
  e2: { shadowColor: palette.ink, shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  /** Tab bar, sheet, toast. */
  e3: { shadowColor: palette.ink, shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  /** Green glow under the Reels button. */
  glow: { shadowColor: palette.green, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const;

/** Older names — same values as e1 / e2. */
export const shadow = { card: elevation.e1, raised: elevation.e2 } as const;

/** Standard white card: radius lg, hairline border. Pair with elevation.e1. */
export const cardSurface = {
  backgroundColor: colors.card,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.line,
} as const;

// ── motion ───────────────────────────────────────────────────────────────────

export const motion = {
  duration: { fast: 150, base: 250, slow: 400 },
  /** Reanimated `withSpring` config for presses and sheets. */
  spring: { damping: 18, stiffness: 240, mass: 1 },
  /** Softer spring for sheets/toasts entering. */
  springGentle: { damping: 22, stiffness: 180, mass: 1 },
  /** Scale a tappable shrinks to while pressed. */
  pressScale: 0.97,
  /** Launch intro hard cap (ms). */
  introMax: 1600,
} as const;

// ── formatting ───────────────────────────────────────────────────────────────

/** Indian rupee formatting, matching the website (₹1,68,550 — no decimals). */
export function inr(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
