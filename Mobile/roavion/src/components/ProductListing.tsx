/**
 * The product grid, with its filters, paging and header. One implementation,
 * used by the Shop tab and by every department page.
 *
 * ── Why it is shared ────────────────────────────────────────────────────────
 * Shop and a department show the same thing — a filtered grid of products —
 * and the only differences are which category is pinned and whether the
 * department chips are offered. Keeping two copies is how the sort menu ends
 * up in one place and not the other, which is exactly what happened before:
 * search had sort, the department page had nothing, and the two drifted for
 * weeks without anyone noticing.
 *
 * ── The header ──────────────────────────────────────────────────────────────
 * It mirrors the website's listing page at 375dp: the department name as a
 * Montserrat h1, one line of description, the department chips, then the
 * controls. The app used to open straight onto a toolbar on grey, which told
 * the customer nothing about where they had landed.
 *
 * Everything shown is a value the server sent. This component never computes a
 * price, a discount or a count of its own.
 */
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchFacets,
  fetchProducts,
  type Category,
  type Product,
} from '../api/catalogue';
import ProductCard from './ProductCard';
import ScrollTopButton from './ScrollTopButton';
import {
  EMPTY_FILTERS,
  FilterSheet,
  ListingToolbar,
  SortSheet,
  activeFilterCount,
  type Filters,
} from './ListingControls';
import { Screenful } from './ui';
import { useHeaderScroll, useScrollToTop } from './useHeaderScroll';
import { useApp } from '../store';
import { colors, font, spacing, type } from '../theme';

const PAGE_SIZE = 20;

export default function ProductListing({
  topSlot,
  title,
  blurb,
  categorySlug,
  chips,
  onPickChip,
}: {
  /**
   * Rendered above the page title, INSIDE the scroll view — so a screen can
   * put the app header here and have it scroll away with the content, exactly
   * as the website's does, instead of pinning it over the grid.
   */
  topSlot?: React.ReactNode;
  title: string;
  blurb?: string;
  /** Pins the listing to one department. Undefined means the whole catalogue. */
  categorySlug?: string;
  /** Department chips, when the screen offers switching. */
  chips?: Category[];
  onPickChip?: (slug: string | null) => void;
}) {
  const router = useRouter();
  const { garage } = useApp();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sheet, setSheet] = useState<'none' | 'sort' | 'filter'>('none');

  const grid = useRef<Animated.FlatList<Product>>(null);
  const { onScroll, showTop } = useHeaderScroll(0);
  const scrollToTop = useScrollToTop(grid);

  const carLabel = garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : null;

  /*
    ONE query object for both requests. /products/facets takes the same
    parameters as /products, so building it once is what guarantees the counts
    in the filter describe the grid behind it rather than some other result set.
  */
  const query = useMemo(
    () => ({
      category: categorySlug,
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
    [categorySlug, filters, garage],
  );

  // Only fetched while the sheet is open: it is a second request per filter
  // change, and nobody needs counts they cannot see.
  const facets = useQuery({
    queryKey: ['facets', query],
    queryFn: () => fetchFacets(query),
    enabled: sheet === 'filter',
    staleTime: 60_000,
  });

  const listing = useInfiniteQuery({
    // The filters are part of the key: changing one starts a new list rather
    // than appending filtered pages onto unfiltered ones.
    queryKey: ['listing', query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchProducts({ ...query, page: pageParam, limit: PAGE_SIZE }),
    // `pages` is authoritative. Stopping on a short page would end the list
    // early whenever a filter happens to return a partial final page.
    getNextPageParam: (last, all) => (all.length < (last.pages ?? 1) ? all.length + 1 : undefined),
  });

  const products = useMemo(
    () => (listing.data?.pages ?? []).flatMap((p) => p.products),
    [listing.data],
  );
  const total = listing.data?.pages?.[0]?.total ?? products.length;
  const filtered = activeFilterCount(filters) > 0 || !!filters.sort;

  // The whole header scrolls with the grid, so the products get the screen.
  const header = (
    <View>
      {topSlot}
      <View style={s.pageHead}>
        <Text style={s.pageTitle}>{title}</Text>
        {!!blurb && <Text style={s.pageBlurb} numberOfLines={2}>{blurb}</Text>}
      </View>

      {!!chips?.length && (
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipRow}
        >
          <Pressable
            onPress={() => onPickChip?.(null)}
            style={[s.chip, !categorySlug && s.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: !categorySlug }}
          >
            <Text style={[s.chipText, !categorySlug && s.chipTextOn]}>All categories</Text>
          </Pressable>
          {chips.map((c) => {
            const on = c.slug === categorySlug;
            return (
              <Pressable
                key={c.id}
                onPress={() => onPickChip?.(c.slug)}
                style={[s.chip, on && s.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </Animated.ScrollView>
      )}

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
    </View>
  );

  // Only the FIRST load is a full-screen spinner. A filter change keeps the
  // grid on screen and swaps it when the new page lands, so the screen never
  // flashes empty under the customer's thumb.
  if (listing.isPending || listing.error) {
    return (
      <View style={s.screen}>
        {topSlot}
        <View style={s.pageHead}>
          <Text style={s.pageTitle}>{title}</Text>
        </View>
        <Screenful
          loading={listing.isPending}
          error={listing.error ? (listing.error as Error).message : null}
          onRetry={() => listing.refetch()}
        />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <Animated.FlatList
        ref={grid}
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={products}
        keyExtractor={(p: Product) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ paddingBottom: spacing.xl, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Screenful
            emptyIcon="cube-outline"
            emptyTitle={filtered ? 'Nothing matches those filters' : 'Nothing here yet'}
            emptyBody={
              filtered
                ? 'Try a wider price range, or clear the filters.'
                : 'There are no products here at the moment.'
            }
            action={
              filtered
                ? { label: 'Clear filters', onPress: () => setFilters(EMPTY_FILTERS) }
                : { label: 'Browse departments', onPress: () => router.push('/(tabs)/shop') }
            }
          />
        }
        // Half a screen early, so the next page is usually already there.
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (listing.hasNextPage && !listing.isFetchingNextPage) listing.fetchNextPage();
        }}
        ListFooterComponent={
          listing.isFetchingNextPage ? (
            <View style={s.footer}><ActivityIndicator color={colors.green} /></View>
          ) : products.length >= total && total > PAGE_SIZE ? (
            <Text style={s.end}>That&apos;s all {total} products</Text>
          ) : null
        }
        renderItem={({ item }: { item: Product }) => (
          <View style={{ flex: 1 }}>
            <ProductCard product={item} />
          </View>
        )}
      />

      <ScrollTopButton visible={showTop} onPress={scrollToTop} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  pageHead: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: 6 },
  // Montserrat 700 at 23/28 with -0.23 tracking — the site's own page h1.
  pageTitle: { ...type.h1 },
  pageBlurb: { ...type.body, fontSize: 14, lineHeight: 20 },

  chipRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { fontFamily: font.medium, fontSize: 13.5, color: colors.ink2 },
  chipTextOn: { fontFamily: font.bold, color: colors.white },

  footer: { paddingVertical: spacing.xl },
  end: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.muted,
  },
});
