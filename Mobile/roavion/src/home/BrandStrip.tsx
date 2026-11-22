/**
 * Brands we carry — a slow marquee of brand logos (live /products/brands).
 * Tapping one opens that brand's products. With reduced motion it is a plain
 * swipeable row.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { fetchBrands, type Brand } from '../api/catalogue';
import { colors, elevation, font, radius, spacing } from '../theme';
import { PressScale, SectionHeader, Shimmer, useReduceMotion } from '../ui';

const ITEM_W = 116;
const GAP = spacing.md;
const MAX = 14;
/** dp per second — calm, readable. */
const SPEED = 28;

const BrandTile = memo(function BrandTile({ brand, onOpen }: { brand: Brand; onOpen: (name: string) => void }) {
  return (
    <PressScale onPress={() => onOpen(brand.name)} haptic="selection" style={s.tile} accessibilityLabel={`${brand.name} products`}>
      {brand.logo ? (
        <Image source={{ uri: brand.logo }} style={s.logo} contentFit="contain" cachePolicy="memory-disk" />
      ) : (
        <Text style={s.name} numberOfLines={2}>{brand.name}</Text>
      )}
    </PressScale>
  );
});

export default function BrandStrip() {
  const router = useRouter();
  const reduce = useReduceMotion();
  const brands = useQuery({ queryKey: ['brands'], queryFn: ({ signal }) => fetchBrands(signal), staleTime: 10 * 60_000 });
  const list = (brands.data ?? []).slice(0, MAX);
  const open = useCallback((name: string) => router.push({ pathname: '/search', params: { brand: name } }), [router]);

  const span = list.length * (ITEM_W + GAP);
  const x = useSharedValue(0);
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Marquee only while visible; stops on blur so it costs nothing off-screen.
  const marquee = !reduce && list.length >= 4;
  useEffect(() => {
    if (!marquee || !focused || span <= 0) return undefined;
    x.value = 0;
    x.value = withRepeat(withTiming(-span, { duration: (span / SPEED) * 1000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(x);
  }, [marquee, focused, span, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (brands.isError || (!brands.isPending && !list.length)) return null;

  return (
    <View style={s.section}>
      <SectionHeader overline="Trusted names" title="Brands we carry" />
      {brands.isPending ? (
        <View style={s.row}>
          {[0, 1, 2, 3].map((i) => (
            <Shimmer key={i} width={ITEM_W} height={64} radius={radius.md} />
          ))}
        </View>
      ) : marquee ? (
        <View style={s.clip}>
          <Animated.View style={[s.track, slide]}>
            {[...list, ...list].map((b, i) => (
              <BrandTile key={`${b.slug}-${i}`} brand={b} onOpen={open} />
            ))}
          </Animated.View>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
          {list.map((b) => (
            <BrandTile key={b.slug} brand={b} onOpen={open} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg },
  clip: { overflow: 'hidden', paddingVertical: spacing.xs },
  track: { flexDirection: 'row', gap: GAP, paddingLeft: spacing.lg },
  tile: {
    width: ITEM_W,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    ...elevation.e1,
  },
  logo: { width: '100%', height: 46 },
  name: { fontFamily: font.heading, fontSize: 12.5, color: colors.ink2, textAlign: 'center' },
});
