/**
 * Autobacs design tokens — look "Heritage Noir" (owner picked 2026-11-22) on top
 * of the "Premium launch" token set.
 *
 * Heritage Noir = dark carbon pages, racing-green fade under photos, Playfair
 * Display serif titles, fine gold accents, square white CTAs. Its tokens are
 * ADDITIVE (`noir`, `scrims`, `font.serif*`, `type.serif*`, `radius.square`):
 * the light names in `colors` (`bg`, `card`, `ink`, `white`…) keep their old
 * meaning, because screens use `colors.ink` both as text AND as a fill —
 * flipping them in place would leave ink-on-carbon text in every screen that
 * has not been restyled yet. Screens move to `noir.*` as they are restyled.
 * Shape IS shared: `radius.sm/md/lg/xl` are now square (2) everywhere.
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

  // Ink & carbon (wordmark, header, launch)
  ink: '#0f1111',
  carbon: '#121414',
  carbon2: '#1d2121',
  void: '#080808',
  /** Hairline on carbon (Heritage Noir). */
  carbonLine: '#2c3333',

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
} as const;

/**
 * Heritage Noir semantic colours — the dark look. Use these in restyled
 * screens instead of the light `colors.bg / card / ink` names.
 */
export const noir = {
  /** Page background. */
  page: palette.carbon,
  /** Raised surface: cards, search bar, sheets, rows. */
  surface: palette.carbon2,
  /** Deepest black: reels, launch. */
  void: palette.void,
  /** Hairline between rows / around cards. */
  hairline: palette.carbonLine,
  /** Stronger hairline: tab bar, inputs. */
  hairlineStrong: palette.ink2,

  /** Text on carbon. */
  text: palette.white,
  textMuted: palette.chrome,
  textFaint: palette.steel,
  /** Caption copy under photos (white 88%). */
  textSoft: alpha(palette.white, 0.88),

  /** Racing green — the fade colour under photos, fills, Reels disc. */
  green: palette.green,
  greenDeep: palette.greenDeep,
  /** Green that reads as TEXT on carbon (overlines, ticks, "% off"). */
  greenText: palette.greenOnDark,
  /** "Fits your car" box fill. */
  greenWash: alpha(palette.green, 0.35),

  /** Fine accent only: hairlines, crest ring, active tab, SEE ALL, liked heart. */
  gold: palette.gold,
  /** Gold hairline on glass (reel product card, sticky bar). */
  goldLine: alpha(palette.gold, 0.4),
  goldFaint: alpha(palette.gold, 0.14),

  sale: palette.red,

  /** Primary CTA: white fill, ink label. */
  cta: palette.white,
  ctaText: palette.ink,

  /** Frosted carbon (tab bar, product card, sticky bar) — Android/web fallback fill. */
  glass: alpha(palette.carbon2, 0.86),
  glassStrong: alpha(palette.carbon, 0.92),
  /** Glass circle over a photo (back / share / heart). */
  glassIcon: alpha(palette.carbon, 0.6),
  /** Light glass chip on a photo ("Add your car"). */
  glassChip: alpha(palette.white, 0.14),
  glassChipBorder: alpha(palette.white, 0.3),

  pressed: alpha(palette.white, 0.12),
  skeleton: palette.carbon2,
  skeletonSheen: alpha(palette.white, 0.08),
  /** Sheet / modal backdrop. */
  backdrop: alpha(palette.void, 0.7),
} as const;

/**
 * Gradient stops for `<HeroScrim>` (expo-linear-gradient `colors` + `locations`).
 * hero: black top (header legible) → clear → racing green → carbon page.
 */
export const scrims = {
  hero: {
    colors: [alpha(palette.void, 0.75), alpha(palette.void, 0), alpha(palette.void, 0), alpha(palette.greenDeep, 0.88), palette.carbon],
    locations: [0, 0.26, 0.45, 0.82, 1],
  },
  /** Full-screen reel: dark top, clear middle, green floor. */
  reel: {
    colors: [alpha(palette.void, 0.7), 'transparent', 'transparent', alpha(palette.void, 0.55), alpha(palette.greenDeep, 0.92)],
    locations: [0, 0.22, 0.42, 0.62, 1],
  },
  /** Product gallery: light top, straight into carbon (no green). */
  gallery: {
    colors: [alpha(palette.void, 0.55), 'transparent', 'transparent', palette.carbon],
    locations: [0, 0.25, 0.7, 1],
  },
  /** Reel tile / card poster: legible creator on top, price at the bottom. */
  tile: {
    colors: [alpha(palette.black, 0.35), 'transparent', 'transparent', alpha(palette.black, 0.8)],
    locations: [0, 0.35, 0.55, 1],
  },
} as const;

export type ScrimName = keyof typeof scrims;

/** The logo's three slanted stripes, in order. */
export const stripes = [palette.green, palette.white, palette.steel] as const;

// ── shape & spacing ─────────────────────────────────────────────────────────

/**
 * Heritage Noir is square: CTAs, search, cards, tiles, sheets all use 0–2.
 * The old names (sm/md/lg/xl) now resolve to `square` so every existing
 * screen squares up without an edit. Round stays ONLY for avatars, the crest,
 * icon buttons and the floating tab bar — use `pill` (or size / 2) for those.
 */
export const radius = {
  /** Sharp edge (full-bleed photos, reel tiles). */
  none: 0,
  /** The Heritage Noir corner: CTAs, search, cards, sheets. */
  square: 2,
  sm: 2,
  md: 2,
  lg: 2,
  xl: 2,
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
  /** Heritage Noir display serif — screen titles, hero, section + product titles. */
  serif: 'PlayfairDisplay_600SemiBold',
  serifItalic: 'PlayfairDisplay_600SemiBold_Italic',
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

  // ── Heritage Noir (dark) ──
  /** Hero headline over a photo. Playfair 600 32/34. */
  serifHero: { fontFamily: font.serif, fontSize: 32, lineHeight: 36, color: noir.text },
  /** Screen title ("Reels", "Your cart"). */
  serifTitle: { fontFamily: font.serif, fontSize: 24, lineHeight: 30, color: noir.text },
  /** Section title ("Shop the reel"). */
  serifSection: { fontFamily: font.serif, fontSize: 20, lineHeight: 26, color: noir.text },
  /** Product title (PDP 21, cards use serifSmall). */
  serifProduct: { fontFamily: font.serif, fontSize: 21, lineHeight: 26, color: noir.text },
  serifSmall: { fontFamily: font.serif, fontSize: 14, lineHeight: 18, color: noir.text },
  /** Letter-spaced Montserrat caps — gold or green on dark. */
  capsNoir: {
    fontFamily: font.semibold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 2.2,
    textTransform: 'uppercase' as const,
    color: noir.gold,
  },
  /** Square CTA label: Montserrat 700 caps, letter-spaced. */
  ctaLabel: { fontFamily: font.heading, fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase' as const },
  bodyNoir: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: noir.textSoft },
  smallNoir: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: noir.textMuted },
  priceNoir: { fontFamily: font.heading, fontSize: 18, color: noir.text },
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

/** Heritage Noir card: carbon-2, square, hairline. No shadow (dark-on-dark). */
export const noirSurface = {
  backgroundColor: noir.surface,
  borderRadius: radius.square,
  borderWidth: 1,
  borderColor: noir.hairline,
} as const;

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
