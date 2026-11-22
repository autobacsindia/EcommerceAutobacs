/**
 * The original building blocks every screen uses — now thin adapters over the
 * premium foundation in `src/ui` (design "Premium launch", 2026-11-22), so
 * existing screens pick up the new look without code changes. New code should
 * import from `src/ui` directly (PremiumButton, Price, Rating, Shimmer…).
 */
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageStyle } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing, type } from '../theme';
import {
  Badge as PBadge,
  Card as PCard,
  EmptyState,
  ErrorState,
  LoadingState,
  PremiumButton,
  Rating,
  SectionHeader as PSectionHeader,
  Shimmer,
  type BadgeTone,
} from '../ui';

export { ProductCardSkeleton } from '../ui';

// ── text ─────────────────────────────────────────────────────────────────────

type TextKind = keyof typeof type;

export function T({
  kind = 'body',
  style,
  children,
  numberOfLines,
}: {
  kind?: TextKind;
  style?: object;
  children: React.ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text style={[type[kind], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// ── button ───────────────────────────────────────────────────────────────────

/**
 * @deprecated use `PremiumButton` from src/ui. Old variants map to:
 * primary → green, dark → ink-black, outline → ink outline, ghost → ghost.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  full,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'dark' | 'ghost';
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  full?: boolean;
}) {
  const v = ({ primary: 'green', dark: 'primary', outline: 'outline', ghost: 'ghost' } as const)[variant];
  return <PremiumButton label={label} onPress={onPress} variant={v} icon={icon} loading={loading} disabled={disabled} style={style} full={full} />;
}

// ── surfaces ─────────────────────────────────────────────────────────────────

/** White card with padding (see `Card` in src/ui for tappable / carbon / green tones). */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <PCard style={style}>{children}</PCard>;
}

export function Divider() {
  return <View style={s.divider} />;
}

/** Section heading with an optional "See all" — see `SectionHeader` in src/ui for overline/stripes. */
export const SectionHeader = PSectionHeader;

/**
 * The white block a section lives in — the website's defining mobile shape.
 *
 * On the site every row of the home page sits in one of these on the grey
 * page, which is what gives it its ordered, catalogue-like feel. Sections that
 * float directly on the background (what this app did before) read as a list of
 * loose widgets instead of a shop.
 *
 * `flush` keeps the horizontal padding off so a card rail can bleed to the edge
 * while the heading above it stays inset.
 */
export function Panel({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
  flush,
  style,
}: {
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
  flush?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[s.panel, style]}>
      {!!title && (
        <View style={[s.panelHead, flush && { paddingHorizontal: spacing.lg }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.panelTitle}>{title}</Text>
            {!!subtitle && <Text style={s.panelSub}>{subtitle}</Text>}
          </View>
          {actionLabel && onAction && (
            <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
              <Text style={s.seeAll}>{actionLabel}</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={flush ? undefined : { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>{children}</View>
      {flush && <View style={{ height: spacing.lg }} />}
    </View>
  );
}

/** The quiet green text link the website ends a panel with ("See all deals"). */
export function TextLink({ label, onPress, style }: { label: string; onPress: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={style}>
      <Text style={s.textLink}>{label}</Text>
    </Pressable>
  );
}

/** A tappable pill — used for vehicle makes and quick filters. */
export function Chip({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: colors.pressedOnLight }}
      style={({ pressed }) => [s.chip, active && s.chipOn, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.chipText, active && s.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/**
 * The small square-image tile the website packs four to a row (categories,
 * "Upgrade your ride", "Top deals for you"). Dense on purpose: it shows twelve
 * ways in, in the height one hero would take.
 */
export function MiniTile({
  label,
  image,
  onPress,
  width,
  tint,
}: {
  label: string;
  image?: string;
  onPress: () => void;
  width: number;
  /** Soft tile colour (showroom tiles): the photo sits inset on it. */
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.75 }]}
    >
      {tint ? (
        <View style={{ width, height: width, borderRadius: radius.md, backgroundColor: tint, padding: 10 }}>
          <Photo uri={image} style={{ flex: 1, backgroundColor: 'transparent' }} contentFit="contain" />
        </View>
      ) : (
        <Photo uri={image} style={{ width, height: width, borderRadius: radius.md, backgroundColor: colors.subtle }} />
      )}
      <Text style={s.miniLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

// ── small bits ───────────────────────────────────────────────────────────────

/** @deprecated use `Rating` from src/ui. Compact star + number + count. */
export function Stars({ rating, reviews }: { rating: number; reviews?: number }) {
  return <Rating rating={rating} count={reviews} compact />;
}

/** Status tag — see `Badge` in src/ui for more tones. */
export function Badge({ text, tone = 'green' }: { text: string; tone?: BadgeTone }) {
  return <PBadge text={text} tone={tone} />;
}

/** Product photo with a quiet placeholder while it loads or when missing. */
export function Photo({ uri, style, contentFit = 'contain' }: { uri?: string; style?: StyleProp<ImageStyle>; contentFit?: 'cover' | 'contain' }) {
  if (!uri) {
    return (
      <View style={[s.photoEmpty, style as StyleProp<ViewStyle>]}>
        <Ionicons name="image-outline" size={22} color={colors.chrome} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[{ backgroundColor: colors.white }, style]}
      contentFit={contentFit}
      transition={180}
      cachePolicy="memory-disk"
    />
  );
}

/**
 * Full-screen state for loading, an error, or nothing to show — now the
 * branded states from src/ui (network failures show the offline layout when
 * the screen passes the raw error text; prefer `ErrorState error={err}`).
 */
export function Screenful({
  loading,
  error,
  onRetry,
  emptyIcon = 'cube-outline',
  emptyTitle,
  emptyBody,
  action,
}: {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitle?: string;
  emptyBody?: string;
  action?: { label: string; onPress: () => void };
}) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={new Error(error)} message={error} onRetry={onRetry} />;
  return <EmptyState icon={emptyIcon} title={emptyTitle ?? 'Nothing here yet'} body={emptyBody} action={action} />;
}

/** @deprecated use `Shimmer` from src/ui. */
export function Skeleton({ width, height, radius: r = radius.sm, style }: { width?: number | string; height: number; radius?: number; style?: ViewStyle }) {
  return <Shimmer width={width as number} height={height} radius={r} style={style} />;
}

const s = StyleSheet.create({
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.lg },
  seeAll: { fontFamily: font.semibold, fontSize: 13, color: colors.green },

  // On the white page a section is defined by whitespace, not a box.
  panel: {
    // Open section on the page colour (showroom): no white band.
    marginTop: spacing.lg,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  panelTitle: { fontFamily: font.heading, fontSize: 18, lineHeight: 24, letterSpacing: -0.2, color: colors.ink },
  panelSub: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: colors.muted, marginTop: 2 },
  textLink: { fontFamily: font.semibold, fontSize: 13.5, color: colors.green },

  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  chipText: { fontFamily: font.medium, fontSize: 12.5, color: colors.ink2 },
  chipTextOn: { fontFamily: font.semibold, color: colors.green },

  miniLabel: { fontFamily: font.medium, fontSize: 11.5, lineHeight: 15, color: colors.ink2, marginTop: 6 },

  photoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.page },
});
