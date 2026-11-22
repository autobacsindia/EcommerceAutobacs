/**
 * Premium primitives — the building blocks every restyled screen uses.
 * All colours come from `theme.ts`; nothing here computes money (Price only
 * formats the numbers the server gave it).
 */
import { type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, font, inr, noir, radius, spacing, type } from '../theme';
import { PressScale, type HapticKind } from './motion';
import { StripeLoader, Stripes } from './loaders';
import { SerifTitle } from './noir';

type IconName = keyof typeof Ionicons.glyphMap;

// ── Overline ────────────────────────────────────────────────────────────────

export type OverlineTone = 'green' | 'gold';

/**
 * Letter-spaced caps above a title.
 *   <Overline>New arrivals</Overline>                 // green, on light
 *   <Overline onDark>Shop the reel</Overline>          // on-dark green
 *   <Overline tone="gold">Profender</Overline>         // Heritage Noir: brand / hero overline
 *   <Overline tone="green" noir>Watch & shop</Overline> // Heritage Noir: section overline
 *
 * `tone` switches to the Heritage Noir caps (Montserrat 600, 10pt, spacing 2.2).
 */
export function Overline({
  children,
  onDark,
  tone,
  noir: isNoir,
  style,
}: {
  children: ReactNode;
  onDark?: boolean;
  /** Heritage Noir caps in gold or on-dark green. */
  tone?: OverlineTone;
  /** Heritage Noir caps (green unless `tone`). */
  noir?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  if (tone || isNoir) {
    return (
      <Text style={[type.capsNoir, { color: tone === 'gold' ? noir.gold : noir.greenText }, style]} numberOfLines={1}>
        {children}
      </Text>
    );
  }
  return (
    <Text style={[type.overline, onDark && { color: colors.greenOnDark }, style]} numberOfLines={1}>
      {children}
    </Text>
  );
}

// ── PremiumButton ───────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'green' | 'outline' | 'ghost' | 'light' | 'outlineLight' | 'noir' | 'noirOutline';

const BTN: Record<ButtonVariant, { bg: string; fg: string; border: string; onDarkLoader: boolean }> = {
  /** Heritage Noir primary — white fill, ink label ("BUY NOW", "SHOP NOW"). Use on carbon / photos. */
  noir: { bg: noir.cta, fg: noir.ctaText, border: noir.cta, onDarkLoader: false },
  /** Heritage Noir secondary — 1px white outline ("ADD TO CART", "FOLLOW"). */
  noirOutline: { bg: 'transparent', fg: noir.text, border: noir.text, onDarkLoader: true },
  /** Ink-black — the call to action on a LIGHT (not yet restyled) screen. */
  primary: { bg: colors.ink, fg: colors.white, border: colors.ink, onDarkLoader: true },
  /** Brand green — use for the one green action on a screen ("Add to cart", "Pay"). */
  green: { bg: colors.green, fg: colors.white, border: colors.green, onDarkLoader: true },
  /** Hairline ink outline — secondary action. */
  outline: { bg: 'transparent', fg: colors.ink, border: colors.ink, onDarkLoader: false },
  /** Text-only. */
  ghost: { bg: 'transparent', fg: colors.ink2, border: 'transparent', onDarkLoader: false },
  /** White pill on dark/photo backgrounds (hero CTA). */
  light: { bg: colors.white, fg: colors.ink, border: colors.white, onDarkLoader: false },
  /** White outline on dark/video (Reels "Add to cart"). */
  outlineLight: { bg: 'transparent', fg: colors.white, border: colors.white, onDarkLoader: true },
};

const BTN_SIZE = {
  sm: { h: 36, px: spacing.lg, fs: 10.5, icon: 15 },
  md: { h: 48, px: spacing.xl, fs: 12, icon: 17 },
  lg: { h: 54, px: spacing.xl, fs: 13, icon: 18 },
} as const;

/**
 * The square Heritage Noir button: uppercase Montserrat 700, letter-spaced,
 * corner radius 2, 1px border. Every variant shares the shape; pick the
 * colour by the background it sits on.
 *
 *   <PremiumButton label="Buy now" variant="noir" onPress={buy} />          // white on carbon (Heritage Noir primary)
 *   <PremiumButton label="Add to cart" variant="noirOutline" onPress={add} />
 *   <PremiumButton label="Buy now" onPress={buy} />                 // ink-black (light screens)
 *   <PremiumButton label="Add to cart" variant="green" icon="cart-outline" full />
 *   <PremiumButton label="See details" variant="outline" size="sm" />
 *   <PremiumButton label="Shop now" variant="light" />              // on a hero photo
 *   <PremiumButton label="Paying…" loading />                       // StripeLoader inside, disabled
 *
 * Press: springs to 97% + light haptic on primary/green (override with `haptic`).
 */
export function PremiumButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading,
  disabled,
  full,
  haptic: hapticKind,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width. */
  full?: boolean;
  haptic?: HapticKind | false;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const off = !!disabled || !!loading;
  const p = BTN[variant];
  const z = BTN_SIZE[size];
  const h =
    hapticKind === false ? undefined : hapticKind ?? (variant === 'primary' || variant === 'green' || variant === 'noir' ? 'light' : undefined);
  return (
    <PressScale
      onPress={onPress}
      disabled={off}
      haptic={h}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!loading }}
      style={[
        s.btn,
        { height: z.h, paddingHorizontal: z.px, backgroundColor: p.bg, borderColor: p.border },
        full && { alignSelf: 'stretch' },
        off && !loading && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <StripeLoader size="sm" onDark={p.onDarkLoader} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={z.icon} color={p.fg} />}
          <Text style={[type.ctaLabel, { color: p.fg, fontSize: z.fs }]} numberOfLines={1}>
            {label}
          </Text>
          {iconRight && <Ionicons name={iconRight} size={z.icon} color={p.fg} />}
        </>
      )}
    </PressScale>
  );
}

// ── IconButton ──────────────────────────────────────────────────────────────

/**
 * Round icon-only button (44pt target).
 *
 *   <IconButton icon="heart-outline" label="Save" onPress={save} />
 *   <IconButton icon="close" label="Close" tone="glass" />          // over a photo
 *   <IconButton icon="share-outline" label="Share" tone="dark" size={36} />
 */
export function IconButton({
  icon,
  label,
  onPress,
  tone = 'light',
  size = 40,
  iconSize,
  color,
  haptic: hapticKind = 'selection',
  style,
  badge,
}: {
  icon: IconName;
  /** Screen-reader label — required. */
  label: string;
  onPress: () => void;
  tone?: 'light' | 'dark' | 'glass' | 'plain';
  size?: number;
  iconSize?: number;
  color?: string;
  haptic?: HapticKind;
  style?: StyleProp<ViewStyle>;
  /** Small count bubble (e.g. cart). */
  badge?: number;
}) {
  const bg = { light: colors.white, dark: colors.carbon, glass: colors.glassDark, plain: 'transparent' }[tone];
  const fg = color ?? (tone === 'light' || tone === 'plain' ? colors.ink : colors.white);
  const pad = Math.max(0, (44 - size) / 2);
  return (
    <PressScale
      onPress={onPress}
      haptic={hapticKind}
      accessibilityLabel={label}
      hitSlop={pad}
      scaleTo={0.92}
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
        tone === 'light' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, ...elevation.e1 },
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.5)} color={fg} />
      {!!badge && badge > 0 && <CountBubble count={badge} style={{ position: 'absolute', top: -2, right: -2 }} />}
    </PressScale>
  );
}

/** Green count bubble (cart badge). Display only. */
export function CountBubble({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.bubble, style]} accessibilityLabel={`${count} items`}>
      <Text style={s.bubbleText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

// ── GlassChip ───────────────────────────────────────────────────────────────

/**
 * Frosted pill for content over photos/video ("Creta 2022 · Change",
 * reel product pin). iOS uses a real blur; Android/web a translucent fill.
 *
 *   <GlassChip icon="car-sport-outline" label="Creta 2022" action="Change" onPress={pickCar} />
 *   <GlassChip label="₹1,299" tone="light" />
 */
export function GlassChip({
  label,
  icon,
  action,
  onPress,
  tone = 'dark',
  style,
}: {
  label: string;
  icon?: IconName;
  /** Trailing green/white call-out after a dot ("Change"). */
  action?: string;
  onPress?: () => void;
  /** dark/light: round frosted pill. gold: square carbon glass with a gold hairline ("Watch in reels · 3"). */
  tone?: 'dark' | 'light' | 'gold';
  style?: StyleProp<ViewStyle>;
}) {
  const dark = tone !== 'light';
  const fg = dark ? colors.white : colors.ink;
  const inner = (
    <>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={40} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? colors.glassDark : colors.glassLight }]} />
      )}
      {icon && <Ionicons name={icon} size={15} color={tone === 'gold' ? noir.gold : fg} />}
      <Text style={[s.chipText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      {!!action && (
        <Text style={[s.chipAction, { color: tone === 'gold' ? noir.gold : dark ? colors.greenOnDark : colors.green }]} numberOfLines={1}>
          · {action}
        </Text>
      )}
    </>
  );
  const box = [
    s.glass,
    { borderColor: tone === 'gold' ? noir.goldLine : dark ? colors.onDarkFaint : colors.line },
    tone === 'gold' && { borderRadius: radius.square, borderWidth: 1 },
    style,
  ];
  if (!onPress) return <View style={box}>{inner}</View>;
  return (
    <PressScale onPress={onPress} haptic="selection" accessibilityLabel={action ? `${label}, ${action}` : label} style={box}>
      {inner}
    </PressScale>
  );
}

// ── Price ───────────────────────────────────────────────────────────────────

/**
 * Price line: price, struck MRP, "% off", optional festival price.
 * DISPLAY ONLY — pass the server's numbers; it never decides a charge.
 *
 *   <Price price={1299} mrp={1799} />                         // ₹1,299  ₹1,799  28% off
 *   <Price price={1299} mrp={1799} offPercent={28} size="lg" />
 *   <Price price={1299} festivalPrice={1169} />               // ₹1,169  ₹1,299  "Festival price"
 *   <Price price={1299} onDark />                             // reels
 *
 * `offPercent` from the server wins; otherwise it's derived from mrp/shown.
 */
export function Price({
  price,
  mrp,
  offPercent,
  festivalPrice,
  size = 'md',
  onDark,
  hideOff,
  style,
}: {
  price: number;
  mrp?: number | null;
  offPercent?: number | null;
  festivalPrice?: number | null;
  size?: 'sm' | 'md' | 'lg';
  onDark?: boolean;
  hideOff?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const festive = festivalPrice != null && festivalPrice > 0 && festivalPrice < price;
  const shown = festive ? festivalPrice! : price;
  const was = mrp != null && mrp > shown ? mrp : festive ? price : null;
  const off = offPercent != null && offPercent > 0 && !festive ? offPercent : was ? Math.round(((was - shown) / was) * 100) : 0;
  const fs = { sm: 14, md: 17, lg: 24 }[size];
  const main = onDark ? colors.white : colors.ink;
  const sub = onDark ? colors.onDarkMuted : colors.steel;
  return (
    <View style={style}>
      {festive && (
        <Text style={[s.festive, { color: onDark ? colors.gold : colors.ink2 }]}>
          <Text style={{ color: colors.gold }}>★ </Text>Festival price
        </Text>
      )}
      <View style={s.priceRow} accessibilityLabel={`Price ${inr(shown)}${was ? `, was ${inr(was)}` : ''}${off > 0 ? `, ${off}% off` : ''}`}>
        <Text style={[s.price, { fontSize: fs, color: main }, size === 'lg' && { fontFamily: font.heading }]}>{inr(shown)}</Text>
        {was != null && <Text style={[s.mrp, { color: sub, fontSize: Math.max(11, fs - 4) }]}>{inr(was)}</Text>}
        {!hideOff && off > 0 && <Text style={[s.off, { fontSize: Math.max(11, fs - 4) }, onDark && { color: noir.greenText }]}>{off}% off</Text>}
      </View>
    </View>
  );
}

// ── Rating ──────────────────────────────────────────────────────────────────

/**
 * Stars + count. Renders nothing when rating is 0/absent.
 *   <Rating rating={4.5} count={780} />            // ★★★★½ 4.5 · 780 ratings
 *   <Rating rating={4.5} count={780} compact />    // ★ 4.5 · 780
 *   <Rating rating={4.2} onDark compact />
 */
export function Rating({
  rating,
  count,
  compact,
  onDark,
  style,
}: {
  rating: number | null | undefined;
  count?: number | null;
  compact?: boolean;
  onDark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!rating) return null;
  const r = Math.max(0, Math.min(5, rating));
  const txt = onDark ? colors.white : colors.ink2;
  const sub = onDark ? colors.onDarkMuted : colors.muted;
  const stars = compact
    ? [<Ionicons key={0} name="star" size={12} color={colors.star} />]
    : [0, 1, 2, 3, 4].map((i) => (
        <Ionicons key={i} name={r >= i + 0.75 ? 'star' : r >= i + 0.25 ? 'star-half' : 'star-outline'} size={12} color={colors.star} />
      ));
  const label = `${r.toFixed(1)} out of 5${count ? `, ${count} ratings` : ''}`;
  return (
    <View style={[s.ratingRow, style]} accessible accessibilityLabel={label}>
      {stars}
      <Text style={[s.ratingNum, { color: txt }]}>{r.toFixed(1)}</Text>
      {!!count && (
        <Text style={[s.ratingCount, { color: sub }]}>
          · {count.toLocaleString('en-IN')}
          {compact ? '' : count === 1 ? ' rating' : ' ratings'}
        </Text>
      )}
    </View>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────

export type BadgeTone = 'green' | 'red' | 'grey' | 'ink' | 'gold' | 'solidGreen' | 'solidRed';

const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  green: { bg: colors.greenSoft, fg: colors.green },
  red: { bg: colors.redSoft, fg: colors.red },
  grey: { bg: colors.page, fg: colors.muted },
  ink: { bg: colors.ink, fg: colors.white },
  gold: { bg: colors.goldSoft, fg: colors.ink2 },
  solidGreen: { bg: colors.green, fg: colors.white },
  solidRed: { bg: colors.red, fg: colors.white },
};

/**
 * Small status tag.
 *   <Badge text="In stock" />                  // green soft
 *   <Badge text="-28%" tone="solidRed" />      // sale
 *   <Badge text="Pending" tone="gold" />
 *   <Badge text="New" tone="ink" icon="sparkles" />
 */
export function Badge({ text, tone = 'green', icon, style }: { text: string; tone?: BadgeTone; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const p = BADGE[tone];
  return (
    <View style={[s.badge, { backgroundColor: p.bg }, style]}>
      {icon && <Ionicons name={icon} size={11} color={p.fg} />}
      <Text style={[s.badgeText, { color: p.fg }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// ── SectionHeader ───────────────────────────────────────────────────────────

/**
 * Section heading: optional stripes + overline, title, optional "See all".
 *
 *   <SectionHeader title="Fits your car" />
 *   <SectionHeader overline="Curated" title="Detailing essentials" actionLabel="See all" onAction={go} />
 *   <SectionHeader title="Shop the reel" onDark stripes />
 *   <SectionHeader noir overline="Watch & shop" title="Shop the reel" italicLast actionLabel="See all" onAction={go} />
 *     → Heritage Noir: green caps overline, Playfair title ("Shop the *reel*"), gold SEE ALL.
 *
 * Old call sites (`title`, `actionLabel`, `onAction`) keep working.
 */
export function SectionHeader({
  title,
  overline,
  subtitle,
  actionLabel,
  onAction,
  onDark,
  stripes,
  inset = true,
  noir: isNoir,
  italicLast,
  style,
}: {
  title: string;
  /** Heritage Noir: serif title, letter-spaced overline, gold SEE ALL. */
  noir?: boolean;
  /** Heritage Noir: set the title's last word in italic. */
  italicLast?: boolean;
  overline?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDark?: boolean;
  /** Show the three-stripe accent before the overline. */
  stripes?: boolean;
  /** Horizontal page padding (default true). */
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (isNoir) {
    return (
      <View style={[s.section, inset && { paddingHorizontal: spacing.lg }, style]}>
        <View style={{ flex: 1 }}>
          {!!overline && (
            <Overline noir style={{ marginBottom: 3 }}>
              {overline}
            </Overline>
          )}
          <SerifTitle size="section" italicLast={italicLast} accessibilityRole="header" numberOfLines={2}>
            {title}
          </SerifTitle>
          {!!subtitle && <Text style={[type.smallNoir, { marginTop: 2 }]}>{subtitle}</Text>}
        </View>
        {!!actionLabel && !!onAction && (
          <PressScale onPress={onAction} hitSlop={12} haptic="selection" accessibilityLabel={`${actionLabel}: ${title}`} style={s.seeAll}>
            <Text style={type.capsNoir}>{actionLabel}</Text>
          </PressScale>
        )}
      </View>
    );
  }
  return (
    <View style={[s.section, inset && { paddingHorizontal: spacing.lg }, style]}>
      <View style={{ flex: 1 }}>
        {(stripes || overline) && (
          <View style={s.overRow}>
            {stripes && <Stripes width={10} height={3} gap={2} onDark={onDark} />}
            {!!overline && <Overline onDark={onDark}>{overline}</Overline>}
          </View>
        )}
        <Text style={[type.h2, onDark && { color: colors.white }]} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        {!!subtitle && <Text style={[type.small, { marginTop: 2 }, onDark && { color: colors.onDarkMuted }]}>{subtitle}</Text>}
      </View>
      {!!actionLabel && !!onAction && (
        <PressScale onPress={onAction} hitSlop={10} haptic="selection" accessibilityLabel={`${actionLabel}: ${title}`} style={s.seeAll}>
          <Text style={[s.seeAllText, onDark && { color: colors.white }]}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={onDark ? colors.white : colors.green} />
        </PressScale>
      )}
    </View>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

/**
 * White surface: radius lg, hairline border, e1 lift.
 *   <Card>…</Card>
 *   <Card onPress={open} padded={false}>…</Card>      // tappable, press-scale
 *   <Card tone="carbon">…</Card>                       // dark card
 *   <Card tone="green">…</Card>                        // green-faint panel
 */
export function Card({
  children,
  onPress,
  tone = 'white',
  padded = true,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  /** noir = Heritage Noir surface (carbon-2, hairline, no shadow). */
  tone?: 'white' | 'carbon' | 'green' | 'noir';
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const box: StyleProp<ViewStyle> = [
    s.card,
    tone === 'carbon' && { backgroundColor: colors.carbon, borderColor: colors.carbon2 },
    tone === 'green' && { backgroundColor: colors.greenFaint, borderColor: colors.greenSoft, ...elevation.e0 },
    tone === 'noir' && { backgroundColor: noir.surface, borderColor: noir.hairline, borderWidth: 1, ...elevation.e0 },
    padded && { padding: spacing.lg },
    style,
  ];
  if (!onPress) return <View style={box}>{children}</View>;
  return (
    <PressScale onPress={onPress} scaleTo={0.98} accessibilityLabel={accessibilityLabel} style={box}>
      {children}
    </PressScale>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.square,
    borderWidth: 1,
  },

  bubble: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  bubbleText: { fontFamily: font.bold, fontSize: 10, color: colors.white, lineHeight: 13 },

  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontFamily: font.medium, fontSize: 13 },
  chipAction: { fontFamily: font.bold, fontSize: 13 },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 },
  price: { fontFamily: font.heading, fontVariant: ['tabular-nums'] },
  mrp: { fontFamily: font.regular, textDecorationLine: 'line-through' },
  off: { fontFamily: font.heading, color: colors.red },
  festive: { fontFamily: font.bold, fontSize: 11, letterSpacing: 0.3, marginBottom: 2 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingNum: { fontFamily: font.bold, fontSize: 12, marginLeft: 4 },
  ratingCount: { fontFamily: font.regular, fontSize: 12, marginLeft: 2 },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeText: { fontFamily: font.bold, fontSize: 11, letterSpacing: 0.2 },

  section: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.md },
  overRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  seeAllText: { fontFamily: font.semibold, fontSize: 13, color: colors.green },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...elevation.e1,
  },
});
