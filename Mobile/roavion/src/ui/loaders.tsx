/**
 * Loaders. The app never shows a system spinner:
 * - `StripeLoader` — the logo's three slanted stripes pulsing. For short,
 *   shapeless waits (button busy, paging footer, video buffering).
 * - `Shimmer` — a grey block with a moving sheen. Compose into skeletons in the
 *   shape of the content that is coming, so nothing jumps when it arrives.
 * - Ready-made skeleton layouts for common screens.
 * - `Stripes` — the static three-stripe accent (section headers, empty states).
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors, elevation, palette, radius, spacing, stripes as stripeColors } from '../theme';

// ── Stripes (static accent) ─────────────────────────────────────────────────

/**
 * The logo's three slanted stripes (green / white / steel, skewed -25°).
 *
 *   <Stripes />                         // 18×4 each, for a section header
 *   <Stripes width={28} height={6} onDark />
 *
 * `onDark`: the white stripe keeps a hairline so it never vanishes on white,
 * and drops it on dark backgrounds.
 */
export function Stripes({
  width = 16,
  height = 4,
  gap = 3,
  onDark,
  style,
}: {
  width?: number;
  height?: number;
  gap?: number;
  onDark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', gap }, style]} accessible={false}>
      {stripeColors.map((c, i) => (
        <View
          key={i}
          style={{
            width,
            height,
            backgroundColor: c,
            transform: [{ skewX: '-25deg' }],
            borderWidth: c === palette.white && !onDark ? StyleSheet.hairlineWidth : 0,
            borderColor: colors.chrome,
          }}
        />
      ))}
    </View>
  );
}

// ── StripeLoader ────────────────────────────────────────────────────────────

function Bar({ i, t, color, w, h, onDark }: { i: number; t: SharedValue<number>; color: string; w: number; h: number; onDark?: boolean }) {
  const st = useAnimatedStyle(() => {
    // Each stripe peaks a third of a cycle after the previous one.
    const p = (t.value + (2 - i) / 3) % 1;
    const wave = interpolate(p, [0, 0.35, 0.7, 1], [0.35, 1, 0.35, 0.35]);
    return { opacity: wave, transform: [{ skewX: '-25deg' }, { scaleY: 0.75 + wave * 0.25 }] };
  });
  return (
    <Animated.View
      style={[
        {
          width: w,
          height: h,
          backgroundColor: color,
          borderWidth: color === palette.white && !onDark ? StyleSheet.hairlineWidth : 0,
          borderColor: colors.chrome,
        },
        st,
      ]}
    />
  );
}

/**
 * Replaces ActivityIndicator everywhere.
 *
 *   <StripeLoader />                    // md, on light background
 *   <StripeLoader size="sm" onDark />   // inside a dark button / over video
 *   <StripeLoader size="lg" label="Loading reels" />
 *
 * Honours reduce-motion (shows the static stripes).
 */
export function StripeLoader({
  size = 'md',
  onDark,
  label = 'Loading',
  style,
}: {
  size?: 'sm' | 'md' | 'lg';
  onDark?: boolean;
  /** Screen-reader label. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  const dims = { sm: [10, 4, 2], md: [16, 6, 3], lg: [24, 8, 4] }[size];
  const [w, h, gap] = dims;
  // On dark, the third stripe uses chrome so it stays visible on carbon.
  const cols = onDark ? [palette.greenOnDark, palette.white, palette.chrome] : stripeColors;

  useEffect(() => {
    if (reduce) return;
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [reduce, t]);

  return (
    <View
      style={[{ flexDirection: 'row', gap, alignItems: 'center', justifyContent: 'center' }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      {reduce
        ? cols.map((c, i) => (
            <View key={i} style={{ width: w, height: h, backgroundColor: c, transform: [{ skewX: '-25deg' }] }} />
          ))
        : cols.map((c, i) => <Bar key={i} i={i} t={t} color={c} w={w} h={h} onDark={onDark} />)}
    </View>
  );
}

// ── Shimmer ─────────────────────────────────────────────────────────────────

/**
 * One skeleton block with a moving sheen.
 *
 *   <Shimmer width={140} height={12} />
 *   <Shimmer width="100%" height={180} radius={radius.lg} />
 *   <Shimmer height={14} dark />        // on carbon (reels)
 */
export function Shimmer({
  width = '100%',
  height,
  radius: r = radius.sm,
  dark,
  style,
}: {
  width?: DimensionValue;
  height: number;
  radius?: number;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduce || !w) return;
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(t);
  }, [reduce, w, t]);

  const sheen = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-w, w]) }],
  }));

  const base = dark ? colors.carbon2 : colors.skeleton;
  const shine = dark ? colors.onDarkFaint : colors.skeletonSheen;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: r, backgroundColor: base, overflow: 'hidden', opacity: dark ? 1 : 0.7 }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {!reduce && w > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, sheen]}>
          <LinearGradient
            colors={['transparent', shine, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}
    </View>
  );
}

// ── skeleton layouts ────────────────────────────────────────────────────────

/** One product card while loading (rail width 172 by default). */
export function ProductCardSkeleton({ width = 172 }: { width?: number }) {
  return (
    <View style={[sk.card, { width }]}>
      <Shimmer width={width} height={Math.round(width * 0.86)} radius={0} />
      <View style={{ padding: spacing.md, gap: 6 }}>
        <Shimmer width={60} height={9} />
        <Shimmer width={width - 32} height={12} />
        <Shimmer width={90} height={14} />
      </View>
    </View>
  );
}

/** Two-column product grid (Shop, category, search). */
export function ProductGridSkeleton({ count = 6, columnWidth }: { count?: number; columnWidth: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, padding: spacing.lg }}>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} width={columnWidth} />
      ))}
    </View>
  );
}

/** Horizontal rail of product cards (Home sections). */
export function RailSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg }}>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** List rows with a thumbnail (orders, cart, my reels). */
export function ListSkeleton({ rows = 4, thumb = 64 }: { rows?: number; thumb?: number }) {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[sk.row]}>
          <Shimmer width={thumb} height={thumb} radius={radius.md} />
          <View style={{ flex: 1, gap: 8 }}>
            <Shimmer width="70%" height={12} />
            <Shimmer width="45%" height={10} />
            <Shimmer width={80} height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Product detail page: gallery, title, price, button. */
export function ProductDetailSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Shimmer width="100%" height={340} radius={0} />
      <View style={{ padding: spacing.lg, gap: 10 }}>
        <Shimmer width={90} height={10} />
        <Shimmer width="85%" height={20} />
        <Shimmer width="60%" height={20} />
        <Shimmer width={120} height={12} style={{ marginTop: 4 }} />
        <Shimmer width={150} height={26} style={{ marginTop: 8 }} />
        <Shimmer width="100%" height={52} radius={radius.pill} style={{ marginTop: spacing.lg }} />
      </View>
    </View>
  );
}

/** Home: hero + section header + rail. */
export function HomeSkeleton() {
  return (
    <View style={{ gap: spacing.xl, paddingTop: spacing.lg }}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Shimmer width="100%" height={200} radius={radius.xl} />
      </View>
      <View style={{ paddingHorizontal: spacing.lg, gap: 8 }}>
        <Shimmer width={80} height={9} />
        <Shimmer width={180} height={18} />
      </View>
      <RailSkeleton />
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    ...elevation.e1,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
