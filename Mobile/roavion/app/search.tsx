/**
 * Search and filtered listings — one screen for "find me something".
 *
 * It doubles as the results page for a brand, a vehicle or a saved garage,
 * because they are all the same question with a different filter, and the API
 * answers them all through /products.
 *
 * Heritage Noir (2026-11-22): carbon page, square search bar with a gold
 * caret, serif titles, dark suggestions and quick picks.
 *
 * Premium look (2026-11-22): search field, product thumbnails in the
 * suggestions, departments as quick picks before typing, skeleton grid while
 * loading, sort/filter as bottom sheets, cards sized to the column.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, ScrollView, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { fetchCategories, fetchFacets, fetchProducts, fetchSuggestions } from '../src/api/catalogue';
import {
  EMPTY_FILTERS,
  FilterSheet,
  ListingToolbar,
  SortSheet,
  type Filters,
} from '../src/components/ListingControls';
import ProductCard from '../src/components/ProductCard';
import { GridSkeleton, useGridColumn } from '../src/components/ProductListing';
import { useApp } from '../src/store';
import { colors, font, noir, radius, spacing, type } from '../src/theme';
import { EmptyState, ErrorState, IconButton, Overline, PressScale, SearchBar, SerifTitle } from '../src/ui';

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string; brand?: string; vehicleMake?: string; vehicleModel?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { garage } = useApp();

  const [text, setText] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  // Suggestions are for while typing; pressing Search (or picking a term) shows the grid.
  const [typing, setTyping] = useState(!params.q);
  // The same controls the category screen uses: arriving here from the garage
  // or from a department must not present two different filter menus.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sheet, setSheet] = useState<'none' | 'sort' | 'filter'>('none');
  const input = useRef<TextInputInstance>(null);

  // A filtered listing (brand/vehicle) opens straight to results; a bare search
  // opens with the keyboard up, because that is what the person came to do.
  const filtered = !!(params.brand || params.vehicleMake);
  useEffect(() => {
    if (!filtered && !params.q) setTimeout(() => input.current?.focus(), 350);
  }, [filtered, params.q]);

  // Debounce so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 300);
    return () => clearTimeout(t);
  }, [text]);

  const suggestions = useQuery({
    queryKey: ['suggest', query],
    queryFn: () => fetchSuggestions(query),
    enabled: !filtered && query.trim().length >= 2,
  });

  /*
    One query object feeding both the grid and the facet counts, so the numbers
    in the filter always describe the results behind it. The route's own
    brand/vehicle params are the floor: a filter can narrow within them, never
    escape them — arriving from "all BMW parts" must keep showing BMW parts.
  */
  const query_ = useMemo(
    () => ({
      search: query.trim() || undefined,
      brand: filters.brands.length ? filters.brands : params.brand,
      vehicleMake: filters.fitsMyCar && garage ? garage.make : params.vehicleMake,
      vehicleModel: filters.fitsMyCar && garage ? garage.model || undefined : params.vehicleModel,
      sort: filters.sort || undefined,
      rating: filters.ratings.length ? filters.ratings : undefined,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      inStock: filters.inStock || undefined,
    }),
    [query, filters, params.brand, params.vehicleMake, params.vehicleModel, garage],
  );

  const results = useQuery({
    queryKey: ['search', query_],
    queryFn: () => fetchProducts({ ...query_, limit: 40 }),
    enabled: filtered || query.trim().length >= 2,
  });

  // Only while the sheet is open — it is a second request per filter change.
  const facets = useQuery({
    queryKey: ['searchFacets', query_],
    queryFn: () => fetchFacets(query_),
    enabled: sheet === 'filter' && (filtered || query.trim().length >= 2),
    staleTime: 60_000,
  });

  // Quick picks before the customer types — real departments, cached from Home/Shop.
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories(), enabled: !filtered });
  const departments = (categories.data ?? []).filter((c) => !c.parentId).slice(0, 12);
  const col = useGridColumn();

  const title = useMemo(() => {
    if (params.brand) return params.brand;
    if (params.vehicleMake) return `${params.vehicleMake}${params.vehicleModel ? ` ${params.vehicleModel}` : ''}`;
    return 'Search';
  }, [params.brand, params.vehicleMake, params.vehicleModel]);

  const showSuggestions = typing && !filtered && !!suggestions.data?.length && text.trim().length >= 2;
  const products = results.data?.products ?? [];
  const searching = filtered || query.trim().length >= 2;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.screen}>
        <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={s.searchRow}>
            <IconButton icon="arrow-back" label="Go back" onPress={() => router.back()} tone="plain" color={noir.text} size={40} iconSize={22} />
            {filtered ? (
              <View style={s.filterTitle}>
                <Overline tone="gold">{params.brand ? 'Brand' : 'Parts that fit'}</Overline>
                <SerifTitle size="section" numberOfLines={1}>{title}</SerifTitle>
              </View>
            ) : (
              <SearchBar
                ref={input}
                value={text}
                onChangeText={(t) => { setText(t); setTyping(true); }}
                returnKeyType="search"
                onSubmitEditing={() => { setQuery(text); setTyping(false); Keyboard.dismiss(); }}
                accessibilityLabel="Search products"
                style={s.inputWrap}
                right={
                  text ? (
                    <PressScale onPress={() => setText('')} haptic="selection" hitSlop={8} accessibilityLabel="Clear search">
                      <Ionicons name="close-circle" size={18} color={noir.textFaint} />
                    </PressScale>
                  ) : undefined
                }
              />
            )}
          </View>
        </View>

        {searching && !results.isLoading && !results.error && !showSuggestions && (
          <ListingToolbar
            total={results.data?.total ?? products.length}
            filters={filters}
            onToggleSort={() => setSheet((v) => (v === 'sort' ? 'none' : 'sort'))}
            onToggleFilter={() => setSheet((v) => (v === 'filter' ? 'none' : 'filter'))}
          />
        )}

        {showSuggestions ? (
          <FlatList
            data={suggestions.data ?? []}
            keyExtractor={(x) => x.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.suggestList}
            renderItem={({ item }) => (
              <PressScale
                onPress={() => {
                  Keyboard.dismiss();
                  if (item.type === 'product' && item.slug) router.push(`/product/${item.slug}`);
                  else { setText(item.text); setQuery(item.text); setTyping(false); }
                }}
                haptic="selection"
                scaleTo={0.99}
                style={s.suggestion}
              >
                <View style={s.suggestThumb}>
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" />
                  ) : (
                    <Ionicons name={item.type === 'product' ? 'cube-outline' : 'search'} size={16} color={noir.greenText} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.suggestionText} numberOfLines={1}>{item.text}</Text>
                  {!!item.category && <Text style={s.suggestionSub} numberOfLines={1}>{item.category}</Text>}
                </View>
                <Ionicons name="arrow-forward" size={16} color={noir.textFaint} />
              </PressScale>
            )}
          />
        ) : results.isLoading ? (
          <ScrollView scrollEnabled={false} contentContainerStyle={{ paddingTop: spacing.lg }}>
            <GridSkeleton />
          </ScrollView>
        ) : results.error ? (
          <ErrorState error={results.error} onRetry={() => results.refetch()} onDark />
        ) : !searching ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.idle}>
            <Overline noir>Start here</Overline>
            <SerifTitle size="title" italicLast style={s.idleTitle}>What are you looking for?</SerifTitle>
            <Text style={s.idleBody}>Try a part name, a brand, or your car model.</Text>
            {departments.length > 0 && (
              <>
                <Text style={s.group}>Popular departments</Text>
                <View style={s.quick}>
                  {departments.map((c) => (
                    <PressScale key={c.id} onPress={() => router.push(`/category/${c.slug}`)} haptic="selection" style={s.quickChip}>
                      <Text style={s.quickText} numberOfLines={1}>{c.name}</Text>
                    </PressScale>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        ) : products.length === 0 ? (
          <EmptyState
            onDark
            icon="cube-outline"
            title="Nothing matched"
            body="Try a different spelling, or browse by department."
            action={{ label: 'Browse departments', onPress: () => router.push('/(tabs)/shop') }}
          />
        ) : (
          <FlatList
            data={products}
            keyExtractor={(p) => p.id}
            numColumns={2}
            columnWrapperStyle={s.column}
            contentContainerStyle={s.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={6}
            windowSize={7}
            removeClippedSubviews
            renderItem={({ item }) => <ProductCard product={item} width={col} />}
          />
        )}

        <SortSheet
          visible={sheet === 'sort'}
          sort={filters.sort}
          onPick={(key) => { setFilters((f) => ({ ...f, sort: key })); setSheet('none'); }}
          onClose={() => setSheet('none')}
        />
        <FilterSheet
          visible={sheet === 'filter'}
          filters={filters}
          facets={facets.data ?? null}
          carLabel={garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : null}
          onChange={setFilters}
          onClear={() => setFilters(EMPTY_FILTERS)}
          onClose={() => setSheet('none')}
        />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  header: {
    backgroundColor: noir.page,
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: noir.hairline,
    zIndex: 2,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inputWrap: { flex: 1 },
  filterTitle: { flex: 1, paddingLeft: spacing.xs, gap: 2 },

  column: { gap: spacing.md, paddingHorizontal: spacing.lg },
  content: { paddingBottom: spacing.xxl, gap: spacing.md },

  suggestList: { paddingVertical: spacing.sm },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: noir.hairline,
  },
  // Suggestion photos are shot on white, so they keep a white square.
  suggestThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.square,
    overflow: 'hidden',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionText: { fontFamily: font.medium, fontSize: 14.5, color: noir.text },
  suggestionSub: { ...type.caption, color: noir.textFaint, marginTop: 1 },

  idle: { padding: spacing.lg, paddingTop: spacing.xl },
  idleTitle: { marginTop: spacing.xs },
  idleBody: { ...type.bodyNoir, color: noir.textMuted, marginTop: spacing.xs },
  group: {
    ...type.capsNoir,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickChip: {
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.square,
    backgroundColor: noir.surface,
    borderWidth: 1,
    borderColor: noir.hairlineStrong,
  },
  quickText: { fontFamily: font.medium, fontSize: 13.5, color: noir.textSoft },
});
