/**
 * Home hero — the cinematic carousel at the top of the app.
 *
 * Slides come from live data only: a brand slide (always first, so the hero is
 * never empty), the promo banner admins switched on, and the top deals that
 * have a photo. Each slide: dark scrim, overline, Montserrat display title,
 * white pill button, animated dots. The photo drifts slower than the swipe
 * (parallax) and the carousel auto-advances every few seconds while Home is on
 * screen — both off when the phone asks for reduced motion.
 *
 * Display only: a deal's "% off" is the number the server sent.
 */
import { memo, useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type FlatList, type ListRenderItemInfo } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  runOnUI,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { alpha, colors, elevation, radius, spacing, stripes, type } from '../theme';
import { GlassChip, Overline, PremiumButton, Shimmer, useReduceMotion } from '../ui';
import { useApp } from '../store';

export interface HeroSlide {
  key: string;
  overline: string;
  title: string;
  subtitle?: string;
  /** Full-bleed photo (promo banner). */
  cover?: string;
  /** Product shot shown on a white plate over the dark backdrop (a deal). */
  product?: string;
  cta: string;
  route: string;
}

const AUTO_ADVANCE_MS = 5500;
const GUTTER = spacing.lg;

/** Hero size from the window: near-square, capped so small phones still see the next section. */
export function useHeroSize() {
  const { width, height } = useWindowDimensions();
  const w = width - GUTTER * 2;
  const h = Math.round(Math.min(w * 1.02, height * 0.52, 440));
  return { w, h };
}

/** The car pill on the hero: "Creta · Change" or "Add your car". */
function CarChip() {
  const router = useRouter();
  const { garage } = useApp();
  const car = garage ? [garage.make, garage.model].filter(Boolean).join(' ') : null;
  return (
    <GlassChip
      icon="car-sport-outline"
      label={car ?? 'Add your car'}
      action={car ? 'Change' : undefined}
      onPress={() => router.push('/garage')}
      style={s.chip}
    />
  );
}

const Slide = memo(function Slide({
  slide,
  index,
  w,
  h,
  scrollX,
  parallax,
}: {
  slide: HeroSlide;
  index: number;
  w: number;
  h: number;
  scrollX: SharedValue<number>;
  parallax: boolean;
}) {
  // The photo moves at ~70% of the swipe, so it seems to sit behind the card.
  const drift = useAnimatedStyle(() => {
    if (!parallax) return {};
    const x = interpolate(scrollX.value, [(index - 1) * w, index * w, (index + 1) * w], [-w * 0.3, 0, w * 0.3], Extrapolation.CLAMP);
    return { transform: [{ translateX: x }] };
  });
  return (
    <View style={{ width: w, height: h, overflow: 'hidden' }}>
      <Animated.View style={[s.backdrop, { width: w * 1.6, left: -w * 0.3 }, drift]}>
        {slide.cover ? (
          <Image source={{ uri: slide.cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={250} />
        ) : (
          <LinearGradient
            colors={[colors.void, colors.carbon2, colors.greenDeep]}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        {!slide.cover && !slide.product && <BrandStripes h={h} />}
      </Animated.View>
      {slide.product && (
        <View style={[s.plate, { width: w * 0.4, height: w * 0.4, top: h * 0.1 }]}>
          <Image source={{ uri: slide.product }} style={s.plateImg} contentFit="contain" cachePolicy="memory-disk" transition={250} />
        </View>
      )}
    </View>
  );
});

/** The logo's three slanted stripes, large and faint, behind the brand slide. */
function BrandStripes({ h }: { h: number }) {
  return (
    <View style={[s.bigStripes, { height: h * 1.3, top: -h * 0.15 }]} pointerEvents="none">
      {stripes.map((c, i) => (
        <View key={i} style={[s.bigStripe, { backgroundColor: c, opacity: i === 0 ? 0.55 : 0.08 }]} />
      ))}
    </View>
  );
}

function Dot({ i, w, scrollX }: { i: number; w: number; scrollX: SharedValue<number> }) {
  const st = useAnimatedStyle(() => {
    const t = interpolate(scrollX.value, [(i - 1) * w, i * w, (i + 1) * w], [0, 1, 0], Extrapolation.CLAMP);
    return { width: 6 + 14 * t, opacity: 0.45 + 0.55 * t };
  });
  return <Animated.View style={[s.dot, st]} />;
}

export function HeroSkeleton() {
  const { w, h } = useHeroSize();
  return <Shimmer width={w} height={h} radius={radius.xl} style={{ marginHorizontal: GUTTER }} />;
}

export default function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const router = useRouter();
  const reduce = useReduceMotion();
  const { w, h } = useHeroSize();
  const list = useAnimatedRef<FlatList<HeroSlide>>();
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const touching = useRef(false);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  // The words follow the slide actually on screen — swipe, timer or anything else.
  useAnimatedReaction(
    () => Math.round(scrollX.value / w),
    (i, prev) => {
      if (i !== prev) runOnJS(setIndex)(i);
    },
    [w],
  );

  // Auto-advance while Home is focused and the customer isn't touching it.
  useFocusEffect(
    useCallback(() => {
      if (reduce || slides.length < 2) return undefined;
      const id = setInterval(() => {
        if (touching.current) return;
        // Read the live offset rather than state, so the timer never fights a swipe.
        const next = (Math.round(scrollX.value / w) + 1) % slides.length;
        runOnUI((x: number) => {
          'worklet';
          scrollTo(list, x, 0, true);
        })(next * w);
      }, AUTO_ADVANCE_MS);
      return () => clearInterval(id);
    }, [reduce, slides.length, w, scrollX, list]),
  );

  const current = slides[Math.max(0, Math.min(index, slides.length - 1))];

  const renderItem = useCallback(
    ({ item, index: i }: ListRenderItemInfo<HeroSlide>) => (
      <Slide slide={item} index={i} w={w} h={h} scrollX={scrollX} parallax={!reduce} />
    ),
    [w, h, scrollX, reduce],
  );

  if (!current) return null;

  return (
    <View style={[s.hero, { width: w, height: h }]}>
      <Animated.FlatList
        ref={list}
        horizontal
        pagingEnabled
        data={slides}
        keyExtractor={(sl) => sl.key}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: w, offset: w * i, index: i })}
        onScrollBeginDrag={() => {
          touching.current = true;
        }}
        onScrollEndDrag={() => {
          touching.current = false;
        }}
        onMomentumScrollEnd={() => {
          touching.current = false;
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={`Featured, ${index + 1} of ${slides.length}`}
      />

      {/* Scrim: clear at the top, deep at the bottom where the words sit. */}
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(colors.void, 0.35), alpha(colors.void, 0), alpha(colors.void, 0.35), alpha(colors.void, 0.88)]}
        locations={[0, 0.25, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={s.body} pointerEvents="box-none">
        <CarChip />
        <View style={{ flex: 1 }} pointerEvents="none" />
        <View pointerEvents="none">
          <Overline onDark>{current.overline}</Overline>
          <Text style={s.title} numberOfLines={2}>{current.title}</Text>
          {!!current.subtitle && <Text style={s.sub} numberOfLines={2}>{current.subtitle}</Text>}
        </View>
        <View style={s.foot} pointerEvents="box-none">
          <PremiumButton
            label={current.cta}
            variant="light"
            iconRight="arrow-forward"
            onPress={() => router.push(current.route as never)}
          />
          {slides.length > 1 && (
            <View style={s.dots} pointerEvents="none">
              {slides.map((sl, i) => (
                <Dot key={sl.key} i={i} w={w} scrollX={scrollX} />
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  hero: {
    marginHorizontal: GUTTER,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.void,
    ...elevation.e2,
  },
  backdrop: { position: 'absolute', top: 0, bottom: 0 },
  plate: {
    position: 'absolute',
    right: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    padding: spacing.md,
    transform: [{ rotate: '-4deg' }],
    ...elevation.e3,
  },
  plateImg: { width: '100%', height: '100%' },
  bigStripes: { position: 'absolute', right: '8%', flexDirection: 'row', gap: 14, transform: [{ skewX: '-25deg' }] },
  bigStripe: { width: 34, height: '100%' },

  body: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: spacing.lg + 2 },
  chip: { alignSelf: 'flex-start', maxWidth: '86%' },
  title: { ...type.display, color: colors.white, marginTop: spacing.xs },
  sub: { ...type.small, color: colors.onDarkMuted, marginTop: spacing.xs, maxWidth: '92%' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { height: 6, borderRadius: 3, backgroundColor: colors.white },
});
