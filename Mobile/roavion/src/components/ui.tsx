/**
 * The small set of building blocks every screen uses. Keeping them here is what
 * stops the app drifting into ten slightly different buttons.
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageStyle } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, shadow, spacing, type } from '../theme';

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
  const off = disabled || loading;
  const palette = {
    primary: { bg: colors.green, fg: colors.white, border: colors.green },
    dark: { bg: colors.header, fg: colors.white, border: colors.header },
    outline: { bg: 'transparent', fg: colors.green, border: colors.green },
    ghost: { bg: 'transparent', fg: colors.ink2, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      // Android users expect a ripple from the touch point; iOS expects a dim.
      android_ripple={off ? undefined : { color: 'rgba(255,255,255,0.22)', borderless: false }}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: palette.bg, borderColor: palette.border },
        full && { alignSelf: 'stretch' },
        pressed && !off && { opacity: 0.85 },
        off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={palette.fg} />}
          <Text style={[s.btnLabel, { color: palette.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ── surfaces ─────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Divider() {
  return <View style={s.divider} />;
}

/** Section heading with an optional "See all" on the right. */
export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={s.sectionHead}>
      <T kind="h2">{title}</T>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={s.seeAll}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

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
      android_ripple={{ color: 'rgba(10,92,51,0.12)' }}
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
}: {
  label: string;
  image?: string;
  onPress: () => void;
  width: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.75 }]}
    >
      <Photo uri={image} style={{ width, height: width, borderRadius: radius.sm, backgroundColor: '#f6f7f7' }} />
      <Text style={s.miniLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

// ── small bits ───────────────────────────────────────────────────────────────

export function Stars({ rating, reviews }: { rating: number; reviews?: number }) {
  if (!rating) return null;
  return (
    <View style={s.row}>
      <Ionicons name="star" size={12} color={colors.star} />
      <Text style={s.starText}>{rating.toFixed(1)}</Text>
      {reviews ? <Text style={s.reviewText}>({reviews})</Text> : null}
    </View>
  );
}

export function Badge({ text, tone = 'green' }: { text: string; tone?: 'green' | 'red' | 'grey' }) {
  const palette = {
    green: { bg: colors.greenSoft, fg: colors.green },
    red: { bg: '#fdeaee', fg: colors.red },
    grey: { bg: '#eceeed', fg: colors.muted },
  }[tone];
  return (
    <View style={[s.badge, { backgroundColor: palette.bg }]}>
      <Text style={[s.badgeText, { color: palette.fg }]}>{text}</Text>
    </View>
  );
}

/** Product photo with a quiet placeholder while it loads or when missing. */
export function Photo({ uri, style, contentFit = 'contain' }: { uri?: string; style?: StyleProp<ImageStyle>; contentFit?: 'cover' | 'contain' }) {
  if (!uri) {
    return (
      <View style={[s.photoEmpty, style as StyleProp<ViewStyle>]}>
        <Ionicons name="image-outline" size={22} color={colors.line} />
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

/** Full-screen state for loading, an error, or nothing to show. */
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
  if (loading) {
    return (
      <View style={s.full}>
        <ActivityIndicator color={colors.green} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={s.full}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
        <T kind="h3" style={{ marginTop: spacing.md, textAlign: 'center' }}>Something went wrong</T>
        <T kind="small" style={{ marginTop: 4, textAlign: 'center' }}>{error}</T>
        {onRetry && <Button label="Try again" onPress={onRetry} variant="outline" style={{ marginTop: spacing.lg }} />}
      </View>
    );
  }
  return (
    <View style={s.full}>
      <Ionicons name={emptyIcon} size={40} color={colors.line} />
      {emptyTitle && <T kind="h3" style={{ marginTop: spacing.md, textAlign: 'center' }}>{emptyTitle}</T>}
      {emptyBody && <T kind="small" style={{ marginTop: 4, textAlign: 'center' }}>{emptyBody}</T>}
      {action && <Button label={action.label} onPress={action.onPress} style={{ marginTop: spacing.lg }} />}
    </View>
  );
}

/**
 * Grey blocks in the shape of the content that is coming.
 *
 * A spinner says "wait"; a skeleton says "this is what is arriving", which is
 * what stops a slow connection feeling broken. Animated so it never looks frozen.
 */
export function Skeleton({ width, height, radius: r = radius.sm, style }: { width?: number | string; height: number; radius?: number; style?: ViewStyle }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[{ width: width as number, height, borderRadius: r, backgroundColor: '#e3e7e6', opacity: pulse }, style]}
    />
  );
}

/** The shape of one product card, shown while the real ones load. */
export function ProductCardSkeleton() {
  return (
    <View style={{ width: 172, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow.card }}>
      <Skeleton width={172} height={148} radius={0} />
      <View style={{ padding: spacing.md, gap: 6 }}>
        <Skeleton width={60} height={9} />
        <Skeleton width={140} height={12} />
        <Skeleton width={90} height={14} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 50,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  btnLabel: { fontFamily: font.semibold, fontSize: 15 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.lg },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  seeAll: { fontFamily: font.semibold, fontSize: 13, color: colors.green },

  panel: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    overflow: 'hidden',
    ...shadow.card,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  panelTitle: { fontFamily: font.bold, fontSize: 19, lineHeight: 25, color: colors.ink },
  panelSub: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: colors.muted, marginTop: 2 },
  textLink: { fontFamily: font.semibold, fontSize: 13.5, color: colors.green },

  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  chipText: { fontFamily: font.medium, fontSize: 12.5, color: colors.ink2 },
  chipTextOn: { fontFamily: font.semibold, color: colors.green },

  miniLabel: { fontFamily: font.medium, fontSize: 11.5, lineHeight: 15, color: colors.ink2, marginTop: 6 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  starText: { fontFamily: font.semibold, fontSize: 12, color: colors.ink2 },
  reviewText: { fontFamily: font.regular, fontSize: 11, color: colors.muted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, alignSelf: 'flex-start' },
  badgeText: { fontFamily: font.bold, fontSize: 11 },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f7f7' },
  full: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: 2 },
});
