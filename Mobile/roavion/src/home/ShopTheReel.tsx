/**
 * "Shop the reel" — tall 9:16 reel cards; each opens Reels at that reel.
 *
 * Data is the live reels feed (or the mock when EXPO_PUBLIC_REELS_MOCK=1).
 * The price chip shows what the server sent — never computed here.
 */
import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Reel } from '../api/reels';
import { useReelFeed } from '../reels/useReels';
import { alpha, colors, font, inr, radius, spacing } from '../theme';
import { PressScale, SectionHeader, Shimmer } from '../ui';

export const REEL_W = 138;
export const REEL_H = Math.round((REEL_W * 16) / 9);
const GAP = spacing.md;

const ReelCard = memo(function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (id: string) => void }) {
  const p = reel.product;
  const price = p ? (p.festivalPrice ?? p.price) : null;
  const poster = reel.posterUrl || p?.image || undefined;
  return (
    <PressScale
      onPress={() => onOpen(reel.id)}
      haptic="light"
      style={s.card}
      accessibilityLabel={`Reel by ${reel.creator.name}${p ? `, ${p.title}` : ''}`}
    >
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} recyclingKey={reel.id} />
      ) : null}
      <LinearGradient
        colors={[alpha(colors.void, 0.35), alpha(colors.void, 0), alpha(colors.void, 0.85)]}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={s.top}>
        <View style={s.avatar}>
          {reel.creator.avatarUrl ? (
            <Image source={{ uri: reel.creator.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Text style={s.avatarText}>{reel.creator.name.slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <Text style={s.handle} numberOfLines={1}>{reel.creator.name}</Text>
      </View>
      <View style={s.play}>
        <Ionicons name="play" size={14} color={colors.white} style={{ marginLeft: 2 }} />
      </View>
      {p && (
        <View style={s.bottom}>
          <Text style={s.title} numberOfLines={2}>{p.title}</Text>
          {price != null && (
            <View style={s.pricePill}>
              <Ionicons name="bag-handle" size={11} color={colors.ink} />
              <Text style={s.priceText}>{inr(price)}</Text>
            </View>
          )}
        </View>
      )}
    </PressScale>
  );
});

export default function ShopTheReel() {
  const router = useRouter();
  const feed = useReelFeed();
  const reels = feed.reels.slice(0, 10);

  const open = useCallback(
    (id: string) => router.push({ pathname: '/(tabs)/reels', params: { start: id } }),
    [router],
  );
  const renderItem = useCallback(({ item }: ListRenderItemInfo<Reel>) => <ReelCard reel={item} onOpen={open} />, [open]);

  // A broken or empty feed hides the row rather than showing a hole.
  if (feed.isError || (!feed.isPending && !reels.length)) return null;

  return (
    <View style={s.section}>
      <SectionHeader overline="Watch & shop" title="Shop the reel" stripes actionLabel="See all" onAction={() => router.push('/(tabs)/reels')} />
      {feed.isPending ? (
        <View style={s.row}>
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} width={REEL_W} height={REEL_H} radius={radius.lg} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={reels}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.row}
          initialNumToRender={3}
          windowSize={3}
          decelerationRate="fast"
          snapToInterval={REEL_W + GAP}
          getItemLayout={(_, i) => ({ length: REEL_W + GAP, offset: (REEL_W + GAP) * i, index: i })}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg },
  card: { width: REEL_W, height: REEL_H, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.carbon },
  top: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: colors.green,
    borderWidth: 1.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.bold, fontSize: 10, color: colors.white },
  handle: { flex: 1, fontFamily: font.medium, fontSize: 11, color: colors.white },
  play: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.glassDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.onDarkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, gap: 6 },
  title: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: colors.white },
  pricePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
  },
  priceText: { fontFamily: font.bold, fontSize: 12, color: colors.ink },
});
