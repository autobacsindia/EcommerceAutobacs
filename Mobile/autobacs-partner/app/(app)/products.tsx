/**
 * My products: the supplier's own listings, newest change first, cursor-paged
 * (infinite scroll), filterable by status, with the quick In/Low/Out toggle.
 */
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, errorMessage, type Listing, type ListingStatus } from '../../src/api';
import { listingsKey } from '../../src/features/listingCache';
import { StatusChip } from '../../src/features/status';
import { StockToggle } from '../../src/features/StockToggle';
import { formatPaise } from '../../src/lib/money';
import { colors, elevation, radius, spacing } from '../../src/theme';
import { Banner, Button, Chips, EmptyState, ErrorState, Loading, Logo, T } from '../../src/ui';

type Filter = 'all' | ListingStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'submitted', label: 'Waiting' },
  { value: 'changes_requested', label: 'Needs a fix' },
  { value: 'draft', label: 'Drafts' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
];
const PAGE = 20;

export default function Products() {
  const [filter, setFilter] = useState<Filter>('all');
  const status = filter === 'all' ? undefined : filter;

  const q = useInfiniteQuery({
    queryKey: listingsKey(status),
    queryFn: ({ pageParam }) => api.listListings({ status, cursor: pageParam, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  // A refetch that failed while we already show data: keep the data, say it may be old.
  const staleError = q.isError && items.length > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={34} />
      </View>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <T kind="display" style={{ fontSize: 26 }}>
          My products
        </T>
      </View>
      <View style={{ paddingLeft: spacing.lg, paddingVertical: spacing.md }}>
        <Chips scroll options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {q.isPending ? (
        <Loading />
      ) : q.isError && !items.length ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => <Row listing={item} />}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 110, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListHeaderComponent={staleError ? <Banner tone="warn">{`Could not refresh. ${errorMessage(q.error)}`}</Banner> : undefined}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.green} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage && !q.isError) void q.fetchNextPage();
          }}
          ListFooterComponent={
            q.isFetchingNextPage ? (
              <ActivityIndicator color={colors.green} style={{ marginVertical: spacing.lg }} />
            ) : q.isFetchNextPageError ? (
              <Button label="Load more" variant="ghost" onPress={() => void q.fetchNextPage()} />
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title={filter === 'all' ? 'No products yet' : 'Nothing here'}
              body={filter === 'all' ? 'Add your first product. Procurement checks it before it goes live.' : 'No products with this status.'}
              action={filter === 'all' ? <Button label="Add a product" icon="add" onPress={() => router.push('/listing/new')} /> : undefined}
            />
          }
        />
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/listing/new')} accessibilityRole="button" accessibilityLabel="Add a product">
        <Ionicons name="add" size={22} color={colors.white} />
        <T kind="bodyBold" style={{ color: colors.white, marginLeft: 6 }}>
          Add product
        </T>
      </Pressable>
    </SafeAreaView>
  );
}

function Row({ listing }: { listing: Listing }) {
  const thumb = listing.images[0]?.url;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/listing/[id]', params: { id: listing.id } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={listing.title}
    >
      <View style={{ flexDirection: 'row' }}>
        <View style={styles.thumb}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          ) : (
            <Ionicons name="image-outline" size={24} color={colors.chrome} />
          )}
        </View>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <T kind="bodyBold" numberOfLines={2}>
            {listing.title}
          </T>
          <T kind="small" numberOfLines={1}>
            {[listing.brand, listing.fits].filter(Boolean).join(' · ') || ' '}
          </T>
          <T kind="caption" style={{ color: colors.ink2, marginTop: 4 }}>
            You get {formatPaise(listing.costPaise)} + GST
          </T>
          <View style={{ marginTop: 6 }}>
            <StatusChip status={listing.status} />
          </View>
        </View>
      </View>
      {listing.status === 'changes_requested' && listing.reviewNote ? (
        <T kind="small" style={{ color: colors.gold, marginTop: spacing.sm }} numberOfLines={2}>
          “{listing.reviewNote}”
        </T>
      ) : null}
      {listing.status !== 'rejected' ? (
        <View style={styles.stockRow}>
          <T kind="caption">Stock</T>
          <StockToggle listing={listing} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md, ...elevation.e1 },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.page, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: radius.lg,
    paddingHorizontal: 18,
    height: 52,
    ...elevation.e2,
  },
});
