/**
 * One department's products.
 *
 * The grid, its filters and its paging live in ProductListing, shared with the
 * Shop tab — the two show the same thing and must not drift. This screen only
 * resolves the slug to a department and hands over its name and blurb.
 *
 * "offers" is the one special case: Today's Deals is a curated list from
 * /products/offers rather than a category, so it keeps its own simple grid
 * (same cards, skeletons while loading). Heritage Noir: carbon page, serif
 * titles, dark empty/error states.
 */
import { useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchCategories, fetchOffers } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import ProductListing, { GridSkeleton, useGridColumn } from '../../src/components/ProductListing';
import { noir, spacing, type } from '../../src/theme';
import { EmptyState, ErrorState, Overline, SerifTitle } from '../../src/ui';

/** Heading for the deals page, in the same shape as a department's. */
function DealsHead({ count }: { count?: number }) {
  return (
    <View style={s.head}>
      <Overline tone="gold">Limited time</Overline>
      <SerifTitle size="title" italicLast>Today&apos;s deals</SerifTitle>
      {count != null && <Text style={s.count}>{count} offers</Text>}
    </View>
  );
}

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const deals = slug === 'offers';
  const col = useGridColumn();

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => fetchCategories(),
    enabled: !deals,
  });
  const category = useMemo(
    () => (categories.data ?? []).find((c) => c.slug === slug),
    [categories.data, slug],
  );

  const offers = useQuery({
    queryKey: ['offers', 40],
    queryFn: () => fetchOffers(40),
    enabled: deals,
  });

  if (deals) {
    const products = offers.data ?? [];
    return (
      <>
        {/* The page shows its own large title; the bar keeps only the back button. */}
        <Stack.Screen options={{ title: '' }} />
        {offers.isPending ? (
          <ScrollView style={s.screen} scrollEnabled={false}>
            <DealsHead />
            <GridSkeleton />
          </ScrollView>
        ) : offers.error ? (
          <ErrorState error={offers.error} onRetry={() => offers.refetch()} style={s.screen} onDark />
        ) : products.length === 0 ? (
          <EmptyState
            onDark
            icon="pricetag-outline"
            title="No deals right now"
            body="Check back soon — offers change often."
            action={{ label: 'Browse the shop', onPress: () => router.push('/(tabs)/shop') }}
            style={s.screen}
          />
        ) : (
          <FlatList
            style={s.screen}
            data={products}
            keyExtractor={(p) => p.id}
            numColumns={2}
            ListHeaderComponent={<DealsHead count={products.length} />}
            columnWrapperStyle={s.column}
            contentContainerStyle={s.content}
            showsVerticalScrollIndicator={false}
            initialNumToRender={6}
            windowSize={7}
            removeClippedSubviews
            renderItem={({ item }) => <ProductCard product={item} width={col} />}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ProductListing
        overline="Department"
        title={category?.name ?? 'Shop'}
        blurb={category?.description || undefined}
        categorySlug={String(slug)}
      />
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  head: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: 4 },
  count: { ...type.smallNoir },
  column: { gap: spacing.md, paddingHorizontal: spacing.lg },
  content: { paddingBottom: spacing.xxl, gap: spacing.md },
});
