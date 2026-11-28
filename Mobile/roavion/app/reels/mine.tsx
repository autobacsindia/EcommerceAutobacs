/**
 * Account → My reels: everything this customer has posted, as a two-column
 * poster grid with a review-status pill on each, and the team's reason when a
 * reel was not approved.
 */
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Reel, ReelStatus } from '../../src/api/reels';
import { ApiError } from '../../src/api/client';
import { useMyReels } from '../../src/reels/useReels';
import { useApp } from '../../src/store';
import { alpha, colors, elevation, font, palette, radius, spacing, type } from '../../src/theme';
import { EmptyState, ErrorState, Overline, PremiumButton, Shimmer, StripeLoader } from '../../src/ui';

const STATUS: Record<ReelStatus, { label: string; bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  processing: { label: 'Preparing video', bg: colors.gold, fg: colors.ink, icon: 'sync' },
  pending: { label: 'Under review', bg: colors.gold, fg: colors.ink, icon: 'time' },
  approved: { label: 'Live', bg: colors.green, fg: colors.white, icon: 'checkmark-circle' },
  rejected: { label: 'Not approved', bg: colors.red, fg: colors.white, icon: 'close-circle' },
  removed: { label: 'Removed', bg: colors.carbon2, fg: colors.white, icon: 'remove-circle' },
};

const GAP = spacing.md;

function StatusPill({ status }: { status: ReelStatus }) {
  const st = STATUS[status] ?? STATUS.pending;
  return (
    <View style={[s.pill, { backgroundColor: st.bg }]} accessibilityLabel={`Status: ${st.label}`}>
      <Ionicons name={st.icon} size={12} color={st.fg} />
      <Text style={[s.pillText, { color: st.fg }]}>{st.label}</Text>
    </View>
  );
}

function Tile({ reel, width }: { reel: Reel; width: number }) {
  const poster = reel.posterUrl || reel.product?.image || null;
  const date = new Date(reel.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <View style={{ width }}>
      <View style={[s.thumb, { height: Math.round(width * (16 / 9)) }]}>
        {poster ? (
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={reel.id} />
        ) : null}
        <LinearGradient colors={[alpha(palette.black, 0.35), alpha(palette.black, 0), alpha(palette.black, 0.6)]} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
        <View style={s.thumbTop}>
          <StatusPill status={reel.status} />
        </View>
        <View style={s.thumbBottom}>
          <Ionicons name={reel.status === 'approved' ? 'heart' : 'play'} size={13} color={colors.white} />
          <Text style={s.thumbStat}>{reel.status === 'approved' ? reel.likeCount.toLocaleString('en-IN') : date}</Text>
        </View>
      </View>
      {!!reel.product && <Text style={s.product} numberOfLines={1}>{reel.product.title}</Text>}
      {!!reel.caption && <Text style={s.caption} numberOfLines={2}>{reel.caption}</Text>}
      {reel.status === 'rejected' && !!reel.rejectReason && (
        <View style={s.reason}>
          <Ionicons name="information-circle" size={14} color={colors.red} />
          <Text style={s.reasonText}>{reel.rejectReason}</Text>
        </View>
      )}
    </View>
  );
}

function GridSkeleton({ tileWidth }: { tileWidth: number }) {
  return (
    <View style={s.grid}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: tileWidth, gap: spacing.sm }}>
          <Shimmer width={tileWidth} height={Math.round(tileWidth * (16 / 9))} radius={radius.lg} />
          <Shimmer width="80%" height={12} />
        </View>
      ))}
    </View>
  );
}

export default function MyReelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { customer } = useApp();
  const q = useMyReels(!!customer);
  const reels = (q.data?.pages ?? []).flatMap((p) => p.reels);
  const tileWidth = Math.floor((width - spacing.lg * 2 - GAP) / 2);

  if (!customer) {
    return (
      <EmptyState
        icon="person-circle-outline"
        title="Sign in to see your reels"
        body="Your posted reels and their review status live here."
        action={{ label: 'Sign in', onPress: () => router.push('/login?next=/reels/mine') }}
        style={s.screen}
      />
    );
  }
  if (q.isPending) {
    return (
      <View style={[s.screen, { padding: spacing.lg }]}>
        <Shimmer width="100%" height={50} radius={radius.pill} style={{ marginBottom: spacing.xl }} />
        <GridSkeleton tileWidth={tileWidth} />
      </View>
    );
  }
  if (q.isError && !reels.length) {
    return (
      <ErrorState
        error={q.error}
        message={q.error instanceof ApiError ? q.error.message : 'Could not load your reels.'}
        onRetry={() => q.refetch()}
        style={s.screen}
      />
    );
  }

  const live = reels.filter((r) => r.status === 'approved').length;
  const review = reels.filter((r) => r.status === 'pending' || r.status === 'processing').length;

  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, flexGrow: 1 }}
      data={reels}
      keyExtractor={(r) => r.id}
      numColumns={2}
      columnWrapperStyle={{ gap: GAP }}
      ItemSeparatorComponent={() => <View style={{ height: spacing.xl }} />}
      renderItem={({ item }) => <Tile reel={item} width={tileWidth} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.green} colors={[colors.green]} />}
      ListHeaderComponent={
        <View style={s.head}>
          {/* Counts only once every page is loaded, so they are never short. */}
          {reels.length > 0 && !q.hasNextPage && (
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.statNum}>{reels.length}</Text>
                <Overline style={s.statLabel}>Posted</Overline>
              </View>
              <View style={s.statDivider} />
              <View style={s.stat}>
                <Text style={s.statNum}>{live}</Text>
                <Overline style={s.statLabel}>Live</Overline>
              </View>
              <View style={s.statDivider} />
              <View style={s.stat}>
                <Text style={s.statNum}>{review}</Text>
                <Overline style={s.statLabel}>In review</Overline>
              </View>
            </View>
          )}
          <PremiumButton label="Post a new reel" icon="add" onPress={() => router.push('/reels/new')} full />
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="film-outline"
          title="No reels yet"
          body="Film the gear on your car and tag the product. Approved reels appear in the Reels tab."
          style={{ flex: 0, paddingTop: spacing.xxxl }}
        />
      }
      ListFooterComponent={
        q.isFetchingNextPage ? (
          <StripeLoader style={{ marginTop: spacing.xl }} label="Loading more" />
        ) : q.isFetchNextPageError ? (
          <Pressable onPress={() => q.fetchNextPage()} style={{ padding: spacing.lg }} accessibilityRole="button">
            <Text style={[type.small, { textAlign: 'center', color: colors.green }]}>Couldn&apos;t load more. Tap to retry.</Text>
          </Pressable>
        ) : undefined
      }
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: { gap: spacing.lg, marginBottom: spacing.xl },
  stats: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.line, paddingVertical: spacing.lg, ...elevation.e1,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontFamily: font.extrabold, fontSize: 22, color: colors.ink },
  statLabel: { color: colors.muted },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.line },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, rowGap: spacing.xl },
  thumb: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.carbon, ...elevation.e1 },
  thumbTop: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm },
  thumbBottom: { position: 'absolute', left: spacing.sm, bottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 4 },
  thumbStat: { fontFamily: font.bold, fontSize: 12, color: colors.white },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  pillText: { fontFamily: font.bold, fontSize: 11 },
  product: { fontFamily: font.semibold, fontSize: 13, color: colors.ink, marginTop: spacing.sm },
  caption: { fontFamily: font.regular, fontSize: 12.5, color: colors.muted, lineHeight: 17, marginTop: 2 },
  reason: { flexDirection: 'row', gap: 4, backgroundColor: colors.redSoft, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm },
  reasonText: { flex: 1, fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: colors.ink2 },
});
