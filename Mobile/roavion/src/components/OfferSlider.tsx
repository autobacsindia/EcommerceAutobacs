/**
 * The offers carousel at the top of Home — the first thing a customer sees.
 *
 * Every big Indian shopping app opens with one of these, and for a reason: it
 * is the only place on the home screen where a single offer gets the whole
 * width and a photograph big enough to actually read. A row of 170px cards can
 * show a discount; it cannot sell one.
 *
 * Slides are built from live offer data — the same `/products/offers` the
 * website's deals row uses — so a discount set in admin appears here with no
 * app update, and a slide can never advertise a price the server would not
 * charge.
 *
 * Behaviour: auto-advances, and stops permanently the moment a thumb lands on
 * it. A banner that keeps moving under the finger is the single most complained
 * about pattern in this component, so the yield is deliberate and one-way.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Product } from '../api/catalogue';
import { colors, font, inr, radius, shadow, spacing } from '../theme';
import { Photo, Skeleton } from './ui';

const { width: SCREEN } = Dimensions.get('window');

/** Full width minus the page gutter, so the banner lines up with every panel. */
export const SLIDE_W = SCREEN - spacing.md * 2;
const SLIDE_H = 176;
const INTERVAL = SLIDE_W + spacing.md;
const ROTATE_MS = 4000;

export default function OfferSlider({ offers, loading }: { offers: Product[]; loading: boolean }) {
  const router = useRouter();
  const list = useRef<FlatList<Product>>(null);
  const [index, setIndex] = useState(0);
  // Not state: flipping it must not re-render, and the timer reads it directly.
  const touched = useRef(false);

  const slides = offers.filter((p) => p.discountPercent > 0).slice(0, 6);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => {
      if (touched.current) return;
      setIndex((i) => {
        const next = (i + 1) % slides.length;
        list.current?.scrollToOffset({ offset: next * INTERVAL, animated: true });
        return next;
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length]);

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / INTERVAL));

  if (loading) {
    return <Skeleton width={SLIDE_W} height={SLIDE_H} radius={radius.lg} style={s.loading} />;
  }
  if (!slides.length) return null;

  return (
    <View style={s.wrap}>
      <FlatList
        ref={list}
        horizontal
        data={slides}
        keyExtractor={(p) => p.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={INTERVAL}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: spacing.md }}
        ItemSeparatorComponent={() => <View style={{ width: spacing.md }} />}
        onTouchStart={() => { touched.current = true; }}
        onMomentumScrollEnd={onSettled}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/product/${item.slug}`)}
            android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
            accessibilityRole="button"
            accessibilityLabel={`${item.discountPercent}% off ${item.name}, ${inr(item.price)}`}
            style={({ pressed }) => [s.slide, pressed && { opacity: 0.94 }]}
          >
            <LinearGradient
              colors={[colors.greenMid, colors.green, colors.greenDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View style={s.copy}>
              <View style={s.off}>
                <Text style={s.offText}>{item.discountPercent}% OFF</Text>
              </View>
              <Text style={s.name} numberOfLines={2}>{item.name}</Text>
              <View style={s.priceRow}>
                <Text style={s.price}>{inr(item.price)}</Text>
                {item.mrp ? <Text style={s.mrp}>{inr(item.mrp)}</Text> : null}
              </View>
              <View style={s.cta}>
                <Text style={s.ctaText}>Shop now</Text>
                <Ionicons name="arrow-forward" size={13} color={colors.green} />
              </View>
            </View>

            {/* A white tile, not a bleed: catalogue shots are cut-outs on a
                white background, so cropping them to fill the panel slices the
                product in half and showing them raw puts a white rectangle on
                the gradient. The tile makes the whiteness intentional. */}
            <View style={s.photoWrap}>
              <Photo uri={item.image} style={s.photo} contentFit="contain" />
            </View>
          </Pressable>
        )}
      />

      {slides.length > 1 && (
        <View style={s.dots}>
          {slides.map((sl, i) => (
            <View key={sl.id} style={[s.dot, i === index && s.dotOn]} />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  loading: { marginTop: spacing.md, marginHorizontal: spacing.md },

  slide: {
    width: SLIDE_W,
    height: SLIDE_H,
    flexDirection: 'row',
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.card,
  },

  copy: { flex: 1.25, padding: spacing.lg, justifyContent: 'center' },
  off: {
    alignSelf: 'flex-start',
    backgroundColor: colors.red,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  offText: { fontFamily: font.bold, fontSize: 11, color: colors.white, letterSpacing: 0.3 },
  name: {
    fontFamily: font.heading,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: colors.white,
    marginTop: spacing.sm,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 5 },
  price: { fontFamily: font.bold, fontSize: 17, color: colors.white },
  mrp: {
    fontFamily: font.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    textDecorationLine: 'line-through',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  ctaText: { fontFamily: font.bold, fontSize: 12.5, color: colors.green },

  photoWrap: {
    flex: 1,
    margin: spacing.md,
    marginLeft: 0,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },

  dots: { flexDirection: 'row', gap: 5, alignSelf: 'center', marginTop: spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotOn: { width: 20, backgroundColor: colors.green },
});
