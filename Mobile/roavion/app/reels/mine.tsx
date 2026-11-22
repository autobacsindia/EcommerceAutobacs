/**
 * Account → My reels: everything this customer has posted, with its review
 * status and, if rejected, the team's reason.
 */
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Reel, ReelStatus } from '../../src/api/reels';
import { ApiError } from '../../src/api/client';
import { useMyReels } from '../../src/reels/useReels';
import { Button, Screenful } from '../../src/components/ui';
import { useApp } from '../../src/store';
import { colors, font, radius, shadow, spacing } from '../../src/theme';

const STATUS: Record<ReelStatus, { label: string; bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  pending: { label: 'Under review', bg: colors.goldSoft, fg: colors.ink2, icon: 'time-outline' },
  approved: { label: 'Live', bg: colors.greenSoft, fg: colors.green, icon: 'checkmark-circle' },
  rejected: { label: 'Not approved', bg: colors.redSoft, fg: colors.red, icon: 'close-circle' },
  removed: { label: 'Removed', bg: colors.page, fg: colors.muted, icon: 'remove-circle-outline' },
};

function Row({ reel }: { reel: Reel }) {
  const st = STATUS[reel.status] ?? STATUS.pending;
  return (
    <View style={s.card}>
      <View style={s.thumb}>
        {(reel.posterUrl || reel.product?.image) ? <Image source={{ uri: (reel.posterUrl || reel.product?.image) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <Ionicons name="play" size={18} color={colors.white} style={s.thumbIcon} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={[s.pill, { backgroundColor: st.bg }]}>
          <Ionicons name={st.icon} size={13} color={st.fg} />
          <Text style={[s.pillText, { color: st.fg }]}>{st.label}</Text>
        </View>
        {!!reel.product && <Text style={s.product} numberOfLines={1}>{reel.product.title}</Text>}
        {!!reel.caption && <Text style={s.caption} numberOfLines={2}>{reel.caption}</Text>}
        {reel.status === 'rejected' && !!reel.rejectReason && (
          <View style={s.reason}>
            <Text style={s.reasonLabel}>Why: </Text>
            <Text style={s.reasonText}>{reel.rejectReason}</Text>
          </View>
        )}
        <Text style={s.date}>
          {new Date(reel.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          {reel.status === 'approved' ? ` · ${reel.likeCount} likes` : ''}
        </Text>
      </View>
    </View>
  );
}

export default function MyReelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer } = useApp();
  const q = useMyReels(!!customer);
  const reels = (q.data?.pages ?? []).flatMap((p) => p.reels);

  if (!customer) {
    return (
      <Screenful
        emptyIcon="person-circle-outline"
        emptyTitle="Sign in to see your reels"
        action={{ label: 'Sign in', onPress: () => router.push('/login?next=/reels/mine') }}
      />
    );
  }
  if (q.isPending) return <Screenful loading />;
  if (q.isError && !reels.length) {
    return (
      <Screenful
        error={q.error instanceof ApiError ? q.error.message : 'Could not load your reels.'}
        onRetry={() => q.refetch()}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md, flexGrow: 1 }}
      data={reels}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => <Row reel={item} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.green} colors={[colors.green]} />}
      ListHeaderComponent={
        <Button label="Post a new reel" icon="add" onPress={() => router.push('/reels/new')} full style={{ marginBottom: spacing.sm }} />
      }
      ListEmptyComponent={
        <View style={s.empty}>
          <Ionicons name="film-outline" size={40} color={colors.muted} />
          <Text style={s.emptyTitle}>No reels yet</Text>
          <Text style={s.emptyBody}>Film the gear on your car and tag the product. Approved reels appear in the Reels tab.</Text>
        </View>
      }
      ListFooterComponent={
        q.isFetchNextPageError ? (
          <Pressable onPress={() => q.fetchNextPage()} style={{ padding: spacing.md }}>
            <Text style={[s.emptyBody, { color: colors.green }]}>Couldn&apos;t load more. Tap to retry.</Text>
          </Pressable>
        ) : undefined
      }
    />
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.line, ...shadow.card,
  },
  thumb: { width: 72, height: 128, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.header, alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontFamily: font.bold, fontSize: 12 },
  product: { fontFamily: font.bold, fontSize: 14, color: colors.ink },
  caption: { fontFamily: font.regular, fontSize: 13, color: colors.ink2, lineHeight: 18 },
  reason: { backgroundColor: colors.redSoft, borderRadius: radius.sm, padding: spacing.sm, flexDirection: 'row', flexWrap: 'wrap' },
  reasonLabel: { fontFamily: font.bold, fontSize: 12.5, color: colors.red },
  reasonText: { fontFamily: font.regular, fontSize: 12.5, color: colors.ink2, flexShrink: 1 },
  date: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, marginTop: 'auto' },
  empty: { alignItems: 'center', paddingTop: 60, gap: spacing.sm, paddingHorizontal: spacing.lg },
  emptyTitle: { fontFamily: font.heading, fontSize: 18, color: colors.ink },
  emptyBody: { fontFamily: font.regular, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
