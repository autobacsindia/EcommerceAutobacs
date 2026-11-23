/**
 * Reels tab — WhatsApp "Updates" layout (owner, 2026-11-22): a big bold title,
 * a status row of creators (green segmented rings), then a grid of reels to
 * shop, and a green "Post a reel" button floating bottom-right. Tapping any
 * circle or tile opens the full-screen viewer (`/reels/watch`), which is where
 * playback, likes and shopping happen.
 *
 * Prices on the tiles are the server's live product block from the feed —
 * formatting only, nothing is computed here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { REELS_MOCK, type Reel } from '../../src/api/reels';
import { ApiError } from '../../src/api/client';
import { useReelFeed } from '../../src/reels/useReels';
import { StatusRow, groupByCreator, type CreatorGroup } from '../../src/reels/StatusRow';
import { useApp } from '../../src/store';
import { alpha, colors, elevation, font, palette, radius, spacing, type } from '../../src/theme';
import { ErrorState, IconButton, PremiumButton, Price, PressScale, Shimmer } from '../../src/ui';

const TEAM_BADGE = require('../../assets/icon.png');
const GAP = spacing.sm + 2;

export default function ReelsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { customer } = useApp();
  const feed = useReelFeed();
  const [refreshing, setRefreshing] = useState(false);
  const { start } = useLocalSearchParams<{ start?: string }>();

  // Home and product pages link to a specific reel: hand it to the viewer.
  useEffect(() => {
    if (!start) return;
    router.setParams({ start: undefined });
    router.push({ pathname: '/reels/watch', params: { start } });
  }, [start, router]);

  const groups = useMemo(() => groupByCreator(feed.reels), [feed.reels]);
  const tileW = (width - spacing.lg * 2 - GAP) / 2;

  const watch = useCallback((reel: Reel) => router.push({ pathname: '/reels/watch', params: { start: reel.id } }), [router]);
  const openGroup = useCallback((g: CreatorGroup) => watch(g.reels[0]), [watch]);
  const onPost = useCallback(() => {
    router.push(customer ? '/reels/new' : '/login?next=/reels/new');
  }, [customer, router]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await feed.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const loading = feed.isPending;
  const empty = !loading && !feed.isError && feed.reels.length === 0;
  const myInitial = customer?.name?.trim().slice(0, 1).toUpperCase() || undefined;

  const header = (
    <View>
      <View style={[s.titleRow, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title} accessibilityRole="header">Reels</Text>
        {REELS_MOCK && (
          <View style={s.demo}>
            <Text style={s.demoText}>DEMO</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {customer && <IconButton icon="albums-outline" label="My reels" tone="plain" onPress={() => router.push('/reels/mine')} />}
      </View>

      <Text style={s.section}>Creators</Text>
      <StatusRow groups={groups} loading={loading} onOpen={openGroup} onPost={onPost} myInitial={myInitial} />
      <View style={s.divider} />

      {feed.isError && !feed.reels.length ? (
        <ErrorState
          error={feed.error}
          message={feed.error instanceof ApiError ? feed.error.message : "We couldn't load reels right now."}
          onRetry={() => feed.refetch()}
          style={{ paddingVertical: spacing.xxl }}
        />
      ) : empty ? (
        // 0 approved reels (true at launch): an invitation, never a blank page.
        <View style={s.emptyCard}>
          <View style={s.emptyBadges} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Image source={TEAM_BADGE} style={s.emptyBadge} contentFit="cover" />
            <View style={s.emptyPlus}>
              <Ionicons name="add" size={16} color={colors.white} />
            </View>
          </View>
          <Text style={s.emptyTitle}>Be the first to post a reel</Text>
          <Text style={s.emptyBody}>
            Film the gear on your car, tag the product, and help other drivers shop it. Our team checks every reel before it goes live.
          </Text>
          <PremiumButton label="Post a reel" icon="videocam-outline" variant="green" onPress={onPost} style={{ marginTop: spacing.lg, minWidth: 200 }} />
          <PremiumButton label="Browse the shop" variant="ghost" size="sm" onPress={() => router.push('/(tabs)/shop')} style={{ marginTop: spacing.xs }} />
        </View>
      ) : (
        <Text style={s.section}>Watch & shop</Text>
      )}
    </View>
  );

  const renderTile = ({ item }: { item: Reel }) => (
    <PressScale onPress={() => watch(item)} haptic="selection" scaleTo={0.97} style={[s.tile, { width: tileW }]} accessibilityLabel={`Watch reel by ${item.creator.name}${item.product ? `, ${item.product.title}` : ''}`}>
      <View style={[s.poster, { height: Math.round(tileW * 1.45) }]}>
        {(item.posterUrl || item.product?.image) ? (
          <Image source={{ uri: (item.posterUrl || item.product?.image) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={item.id} />
        ) : null}
        <LinearGradient colors={[alpha(palette.black, 0), alpha(palette.black, 0.55)]} style={s.posterScrim} pointerEvents="none" />
        <View style={s.play}>
          <Ionicons name="play" size={12} color={colors.white} />
        </View>
        <Text style={s.by} numberOfLines={1}>{item.creator.name}</Text>
      </View>
      {item.product && (
        <View style={s.tileBody}>
          <Text style={s.tileTitle} numberOfLines={1}>{item.product.title}</Text>
          <Price price={item.product.price} mrp={item.product.mrp} offPercent={item.product.discountPercent} size="sm" />
        </View>
      )}
    </PressScale>
  );

  return (
    <View style={s.screen}>
      <FlatList
        data={empty || (feed.isError && !feed.reels.length) ? [] : feed.reels}
        keyExtractor={(r) => r.id}
        renderItem={renderTile}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: GAP, paddingBottom: 96 }}
        ListHeaderComponent={header}
        ListFooterComponent={
          loading ? (
            <View style={[s.skeletonRow]}>
              <Shimmer width={tileW} height={Math.round(tileW * 1.45)} radius={radius.lg} />
              <Shimmer width={tileW} height={Math.round(tileW * 1.45)} radius={radius.lg} />
            </View>
          ) : undefined
        }
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        onEndReachedThreshold={0.6}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} colors={[colors.green]} />}
      />

      {/* WhatsApp-style FAB. */}
      <PressScale onPress={onPost} haptic="medium" scaleTo={0.92} style={s.fab} accessibilityLabel="Post a reel">
        <Ionicons name="videocam" size={24} color={colors.white} />
      </PressScale>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { fontFamily: font.extrabold, fontSize: 30, color: colors.ink, letterSpacing: -0.5 },
  demo: { backgroundColor: colors.gold, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  demoText: { fontFamily: font.bold, fontSize: 10, color: colors.ink, letterSpacing: 0.8 },
  section: { fontFamily: font.bold, fontSize: 16, color: colors.ink, paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginTop: spacing.md },

  tile: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, overflow: 'hidden' },
  poster: { backgroundColor: colors.carbon, justifyContent: 'flex-end' },
  posterScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  play: {
    position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.glassDark, alignItems: 'center', justifyContent: 'center',
  },
  by: { fontFamily: font.bold, fontSize: 12, color: colors.white, padding: spacing.sm },
  tileBody: { padding: spacing.sm + 2, gap: 2 },
  tileTitle: { fontFamily: font.medium, fontSize: 13, color: colors.ink },
  skeletonRow: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg, marginTop: GAP },

  emptyCard: {
    alignItems: 'center', marginHorizontal: spacing.lg, marginTop: spacing.xl, padding: spacing.xl,
    borderRadius: radius.lg, backgroundColor: colors.greenFaint,
  },
  emptyBadges: { flexDirection: 'row', alignItems: 'center' },
  emptyBadge: { width: 64, height: 64, borderRadius: 32, borderWidth: 2.5, borderColor: colors.green },
  emptyPlus: {
    width: 26, height: 26, borderRadius: 13, marginLeft: -16, marginTop: 40, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white,
  },
  emptyTitle: { ...type.h2, textAlign: 'center', marginTop: spacing.lg },
  emptyBody: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },

  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: radius.lg,
    backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', ...elevation.e2,
  },
});
