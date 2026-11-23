/**
 * Home hero — a swipeable carousel of the website's own home banners.
 *
 * The website (Front-end/web `components/home/store/HeroBanners.tsx` +
 * `StoreHome.buildSlides`) composes its hero from live catalogue content:
 * Today's Deals (green), Shop by vehicle (mint), New arrivals — copy on the
 * left, real product photos on white plates. The app shows the same slides,
 * plus the promo banner admins switched on (`/promo-banners/active`) first.
 * When none of those exist the Home screen builds slides from the category
 * photos instead, so the hero is never a dark empty box.
 *
 * Slide kinds:
 *   - `banner`: the admin's artwork, full-bleed, light (no dark scrim over it).
 *   - `tone`: website slide — tinted panel, eyebrow, title, subtitle, button,
 *     up to three product photos on white plates.
 *   - `photo`: a category photo with a soft bottom fade and its name.
 *
 * Auto-advances every few seconds while Home is focused and the customer isn't
 * touching it; off for reduced motion. Display only — any "% off" is the
 * figure the server sent.
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
import { Ionicons } from '@expo/vector-icons';
import { alpha, colors, elevation, font, radius, slideTones, spacing, type, type SlideTone } from '../theme';
import { PressScale, Shimmer, useReduceMotion } from '../ui';

export interface HeroPhoto {
  uri: string;
  /** Route the photo opens (its product). */
  route: string;
  name: string;
}

export type HeroSlide =
  | { kind: 'banner'; key: string; image: string; title: string; cta: string; route: string }
  | {
      kind: 'tone';
      key: string;
      tone: SlideTone;
      eyebrow: string;
      title: string;
      subtitle?: string;
      cta: string;
      route: string;
      photos: HeroPhoto[];
    }
  | { kind: 'photo'; key: string; image: string; eyebrow: string; title: string; cta: string; route: string };

const AUTO_ADVANCE_MS = 6000;
const GUTTER = spacing.lg;

/** Hero size from the window: wide card, capped so small phones still see the next row. */
export function useHeroSize() {
  const { width, height } = useWindowDimensions();
  const w = width - GUTTER * 2;
  const h = Math.round(Math.min(w * 0.86, height * 0.42, 360));
  return { w, h };
}

function CtaPill({ label, onDark, onPress }: { label: string; onDark?: boolean; onPress: () => void }) {
  return (
    <PressScale
      onPress={onPress}
      haptic="light"
      scaleTo={0.96}
      style={[s.cta, onDark ? s.ctaOnDark : s.ctaOnLight]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[s.ctaText, { color: onDark ? colors.green : colors.white }]}>{label}</Text>
      <Ionicons name="arrow-forward" size={14} color={onDark ? colors.green : colors.white} />
    </PressScale>
  );
}

const ToneSlide = memo(function ToneSlide({ slide, w, h }: { slide: Extract<HeroSlide, { kind: 'tone' }>; w: number; h: number }) {
  const router = useRouter();
  const t = slideTones[slide.tone];
  const onDark = slide.tone === 'green';
  const photos = slide.photos.slice(0, 3);
  const plate = Math.round(Math.min(w * 0.25, h * 0.3));
  return (
    <View style={{ width: w, height: h }}>
      <LinearGradient colors={[t.from, t.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {/* The website's soft white glow, top-right. */}
      <View style={[s.glow, { backgroundColor: alpha(colors.white, onDark ? 0.08 : 0.55), width: w * 0.8, height: w * 0.8, borderRadius: w * 0.4 }]} />
      <View style={s.copy}>
        <Text style={[s.eyebrow, { color: onDark ? colors.greenSoft : colors.green }]} numberOfLines={1}>{slide.eyebrow}</Text>
        <Text style={[s.title, { color: t.ink }]} numberOfLines={2}>{slide.title}</Text>
        {!!slide.subtitle && <Text style={[s.sub, { color: t.muted }]} numberOfLines={2}>{slide.subtitle}</Text>}
        <View style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
          <CtaPill label={slide.cta} onDark={onDark} onPress={() => router.push(slide.route as never)} />
        </View>
      </View>
      {photos.length > 0 && (
        <View style={[s.plates, { height: plate + spacing.sm }]}>
          {photos.map((p, i) => (
            <PressScale
              key={`${p.route}-${i}`}
              onPress={() => router.push(p.route as never)}
              haptic="selection"
              scaleTo={0.95}
              style={[s.plate, { width: plate, height: plate, marginTop: i === 1 ? 0 : spacing.sm }]}
              accessibilityLabel={p.name}
            >
              <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" transition={200} />
            </PressScale>
          ))}
        </View>
      )}
    </View>
  );
});

const BannerSlide = memo(function BannerSlide({ slide, w, h }: { slide: Extract<HeroSlide, { kind: 'banner' }>; w: number; h: number }) {
  const router = useRouter();
  return (
    <PressScale
      onPress={() => router.push(slide.route as never)}
      haptic="light"
      scaleTo={0.99}
      style={{ width: w, height: h, backgroundColor: colors.white }}
      accessibilityRole="button"
      accessibilityLabel={`${slide.title}. ${slide.cta}`}
    >
      <Image source={{ uri: slide.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={250} />
      <View style={s.bannerCta} pointerEvents="none">
        <Text style={s.bannerCtaText}>{slide.cta}</Text>
        <Ionicons name="arrow-forward" size={13} color={colors.ink} />
      </View>
    </PressScale>
  );
});

const PhotoSlide = memo(function PhotoSlide({ slide, w, h }: { slide: Extract<HeroSlide, { kind: 'photo' }>; w: number; h: number }) {
  const router = useRouter();
  return (
    <View style={{ width: w, height: h, backgroundColor: colors.greenFaint }}>
      <Image source={{ uri: slide.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={250} />
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(colors.ink, 0), alpha(colors.ink, 0.7)]}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.photoCopy}>
        <Text style={[s.eyebrow, { color: colors.greenSoft }]}>{slide.eyebrow}</Text>
        <Text style={[s.title, { color: colors.white }]} numberOfLines={2}>{slide.title}</Text>
        <View style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
          <CtaPill label={slide.cta} onDark onPress={() => router.push(slide.route as never)} />
        </View>
      </View>
    </View>
  );
});

function Dot({ i, w, scrollX, color }: { i: number; w: number; scrollX: SharedValue<number>; color: string }) {
  const st = useAnimatedStyle(() => {
    const t = interpolate(scrollX.value, [(i - 1) * w, i * w, (i + 1) * w], [0, 1, 0], Extrapolation.CLAMP);
    return { width: 6 + 14 * t, opacity: 0.35 + 0.65 * t };
  });
  return <Animated.View style={[s.dot, { backgroundColor: color }, st]} />;
}

export function HeroSkeleton() {
  const { w, h } = useHeroSize();
  return <Shimmer width={w} height={h} radius={radius.xl} style={{ marginHorizontal: GUTTER }} />;
}

export default function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
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

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<HeroSlide>) =>
      item.kind === 'banner' ? (
        <BannerSlide slide={item} w={w} h={h} />
      ) : item.kind === 'photo' ? (
        <PhotoSlide slide={item} w={w} h={h} />
      ) : (
        <ToneSlide slide={item} w={w} h={h} />
      ),
    [w, h],
  );

  if (!slides.length) return null;
  const current = slides[Math.max(0, Math.min(index, slides.length - 1))];
  const darkDots = current?.kind === 'tone' && current.tone !== 'green';

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
        accessibilityLabel={`Offers, ${index + 1} of ${slides.length}`}
      />
      {slides.length > 1 && (
        <View style={[s.dots, darkDots ? s.dotsOnLight : s.dotsOnDark]} pointerEvents="none">
          {slides.map((sl, i) => (
            <Dot key={sl.key} i={i} w={w} scrollX={scrollX} color={darkDots ? colors.green : colors.white} />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hero: {
    marginHorizontal: GUTTER,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.card,
    ...elevation.e2,
  },
  glow: { position: 'absolute', top: '-30%', right: '-25%' },

  copy: { paddingHorizontal: spacing.lg + 2, paddingTop: spacing.lg + 2, maxWidth: '92%' },
  eyebrow: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { ...type.h1, fontFamily: font.extrabold, fontSize: 23, lineHeight: 28, marginTop: spacing.xs },
  sub: { ...type.small, marginTop: spacing.xs },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  ctaOnLight: { backgroundColor: colors.green },
  ctaOnDark: { backgroundColor: colors.white },
  ctaText: { fontFamily: font.bold, fontSize: 13.5 },

  plates: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.lg + 6,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  plate: {
    borderRadius: radius.md,
    backgroundColor: colors.white,
    overflow: 'hidden',
    ...elevation.e2,
  },

  bannerCta: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    ...elevation.e1,
  },
  bannerCtaText: { fontFamily: font.bold, fontSize: 12.5, color: colors.ink },

  photoCopy: { position: 'absolute', left: spacing.lg + 2, right: spacing.lg + 2, bottom: spacing.lg + 8 },

  dots: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  dotsOnDark: { backgroundColor: alpha(colors.ink, 0.28) },
  dotsOnLight: { backgroundColor: alpha(colors.white, 0.7) },
  dot: { height: 6, borderRadius: 3 },
});
