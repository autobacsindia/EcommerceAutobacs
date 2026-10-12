/**
 * One department's products.
 *
 * ── What this screen was ────────────────────────────────────────────────────
 * Sixty-four lines that fetched `limit: 40` once and rendered a grid. No sort,
 * no filters, and no paging — so a department holding 200 products showed 40
 * and simply stopped, with nothing on screen to say the rest existed. That is
 * the single worst place in the app to hide stock: the customer has already
 * told us what they are shopping for.
 *
 * ── What it is now ──────────────────────────────────────────────────────────
 * The same grid, plus:
 *   - sort and price filters, from the shared ListingControls so that arriving
 *     here and arriving through search give identical controls;
 *   - "only parts that fit my car", when a car is saved — the app's whole
 *     premise, and until now unreachable from a department;
 *   - endless paging, a page at a time as the customer reaches the bottom;
 *   - back to top, because a long grid is otherwise a long swipe.
 *
 * ── Paging ──────────────────────────────────────────────────────────────────
 * `useInfiniteQuery` keyed on the filters, so changing a filter starts a fresh
 * list rather than appending to the old one. The API reports `pages`, so the
 * next page is requested only while one exists — the alternative, stopping on
 * a short page, misreads a filter that happens to return exactly one page.
 */
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchCategories, fetchFacets, fetchOffers, fetchProducts, type Product } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import ScrollTopButton from '../../src/components/ScrollTopButton';
import {
  EMPTY_FILTERS,
  FilterSheet,
  ListingToolbar,
  SortSheet,
  activeFilterCount,
  type Filters,
} from '../../src/components/ListingControls';
import { Screenful } from '../../src/components/ui';
import { useHeaderScroll, useScrollToTop } from '../../src/components/useHeaderScroll';
import { useApp } from '../../src/store';
import { colors, font, spacing } from '../../src/theme';

const PAGE_SIZE = 20;

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { garage } = useApp();
  const deals = slug === 'offers';

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sheet, setSheet] = useState<'none' | 'sort' | 'filter'>('none');

  const grid = useRef<Animated.FlatList<Product>>(null);
  const { onScroll, showTop } = useHeaderScroll(0);
  const scrollToTop = useScrollToTop(grid);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories(), enabled: !deals });
  const category = (categories.data ?? []).find((c) => c.slug === slug);

  const carLabel = garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : null;

  /*
    ONE query object for both requests. /products/facets takes the same
    parameters as /products, so building it once is what guarantees the counts
    in the filter describe the grid behind it rather than some other result set.
  */
  const query = useMemo(
    () => ({
      category: String(slug),
      sort: filters.sort || undefined,
      brand: filters.brands.length ? filters.brands : undefined,
      rating: filters.ratings.length ? filters.ratings : undefined,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      inStock: filters.inStock || undefined,
      ...(filters.fitsMyCar && garage
        ? { vehicleMake: garage.make, vehicleModel: garage.model || undefined }
        : {}),
    }),
    [slug, filters, garage],
  );

  // Only fetched while the sheet is open: it is a second request per filter
  // change, and nobody needs counts they cannot see.
  const facets = useQuery({
    queryKey: ['facets', query],
    queryFn: () => fetchFacets(query),
    enabled: !deals && sheet === 'filter',
    staleTime: 60_000,
  });

  const listing = useInfiniteQuery({
    // The filters are part of the key: changing one starts a new list rather
    // than appending filtered pages onto unfiltered ones.
    queryKey: ['category', query, deals],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      deals
        ? fetchOffers(PAGE_SIZE).then((products) => ({ products, total: products.length, pages: 1 }))
        : fetchProducts({ ...query, page: pageParam, limit: PAGE_SIZE }),
    // `pages` is authoritative. Stopping on a short page would end the list
    // early whenever a filter happens to return a partial final page.
    getNextPageParam: (last, all) => (all.length < (last.pages ?? 1) ? all.length + 1 : undefined),
    enabled: !!slug,
  });

  const products = useMemo(
    () => (listing.data?.pages ?? []).flatMap((p) => p.products),
    [listing.data],
  );
  const total = listing.data?.pages?.[0]?.total ?? products.length;
  const title = deals ? "Today's deals" : category?.name ?? 'Shop';
  const filtered = activeFilterCount(filters) > 0 || !!filters.sort;

  // Only the FIRST load is a full-screen spinner. A filter change keeps the
  // grid on screen and swaps it when the new page lands, so the screen never
  // flashes empty under the customer's thumb.
  if (listing.isPending || listing.error) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <Screenful
          loading={listing.isPending}
          error={listing.error ? (listing.error as Error).message : null}
          onRetry={() => listing.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <View style={s.screen}>
        <ListingToolbar
          total={total}
          filters={filters}
          onToggleSort={() => setSheet((v) => (v === 'sort' ? 'none' : 'sort'))}
          onToggleFilter={() => setSheet((v) => (v === 'filter' ? 'none' : 'filter'))}
        />

        {sheet === 'sort' && (
          <SortSheet
            sort={filters.sort}
            onPick={(key) => { setFilters((f) => ({ ...f, sort: key })); setSheet('none'); }}
          />
        )}
        {sheet === 'filter' && (
          <FilterSheet
            filters={filters}
            facets={facets.data ?? null}
            carLabel={carLabel}
            onChange={setFilters}
            onClear={() => setFilters(EMPTY_FILTERS)}
            onClose={() => setSheet('none')}
          />
        )}

        {products.length === 0 ? (
          <Screenful
            emptyIcon="cube-outline"
            emptyTitle={filtered ? 'Nothing matches those filters' : 'Nothing here yet'}
            emptyBody={
              filtered
                ? 'Try a wider price range, or clear the filters.'
                : 'This department has no products at the moment.'
            }
            action={
              filtered
                ? { label: 'Clear filters', onPress: () => setFilters(EMPTY_FILTERS) }
                : { label: 'Browse all departments', onPress: () => router.push('/(tabs)/shop') }
            }
          />
        ) : (
          <Animated.FlatList
            ref={grid}
            onScroll={onScroll}
            scrollEventThrottle={16}
            data={products}
            keyExtractor={(p: Product) => p.id}
            numColumns={2}
            columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
            contentContainerStyle={{ paddingVertical: spacing.lg, gap: spacing.md }}
            showsVerticalScrollIndicator={false}
            // Half a screen early, so the next page is usually already there.
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (listing.hasNextPage && !listing.isFetchingNextPage) listing.fetchNextPage();
            }}
            ListFooterComponent={
              listing.isFetchingNextPage ? (
                <View style={s.footer}><ActivityIndicator color={colors.green} /></View>
              ) : products.length >= total && total > PAGE_SIZE ? (
                <Text style={s.end}>That's all {total} products</Text>
              ) : null
            }
            renderItem={({ item }: { item: Product }) => (
              <View style={{ flex: 1 }}>
                <ProductCard product={item} />
              </View>
            )}
          />
        )}

        <ScrollTopButton visible={showTop} onPress={scrollToTop} />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  footer: { paddingVertical: spacing.xl },
  end: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.muted,
  },
});
