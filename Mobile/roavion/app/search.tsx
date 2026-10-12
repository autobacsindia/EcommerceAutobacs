/**
 * Search and filtered listings — one screen for "find me something".
 *
 * It doubles as the results page for a brand, a vehicle or a saved garage,
 * because they are all the same question with a different filter, and the API
 * answers them all through /products.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchProducts, fetchSuggestions } from '../src/api/catalogue';
import ProductCard from '../src/components/ProductCard';
import { Screenful, T } from '../src/components/ui';
import { colors, font, radius, spacing } from '../src/theme';

const SORTS = [
  { key: '', label: 'Relevance' },
  { key: 'price', label: 'Price: low to high' },
  { key: '-price', label: 'Price: high to low' },
  { key: '-createdAt', label: 'Newest' },
  { key: '-averageRating', label: 'Top rated' },
] as const;

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string; brand?: string; vehicleMake?: string; vehicleModel?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [sort, setSort] = useState<string>('');
  const [showSort, setShowSort] = useState(false);
  const input = useRef<TextInput>(null);

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

  const results = useQuery({
    queryKey: ['search', query, params.brand, params.vehicleMake, params.vehicleModel, sort],
    queryFn: () =>
      fetchProducts({
        search: query.trim() || undefined,
        brand: params.brand,
        vehicleMake: params.vehicleMake,
        vehicleModel: params.vehicleModel,
        sort: sort || undefined,
        limit: 40,
      }),
    enabled: filtered || query.trim().length >= 2,
  });

  const title = useMemo(() => {
    if (params.brand) return params.brand;
    if (params.vehicleMake) return `${params.vehicleMake}${params.vehicleModel ? ` ${params.vehicleModel}` : ''}`;
    return 'Search';
  }, [params.brand, params.vehicleMake, params.vehicleModel]);

  const showSuggestions = !filtered && !!suggestions.data?.length && text.trim().length >= 2;
  const products = results.data?.products ?? [];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.screen}>
        <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={s.searchRow}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="arrow-back" size={22} color={colors.white} />
            </Pressable>
            {filtered ? (
              <View style={s.filterTitle}>
                <Text style={s.filterTitleText} numberOfLines={1}>{title}</Text>
              </View>
            ) : (
              <View style={s.inputWrap}>
                <Ionicons name="search" size={18} color={colors.muted} />
                <TextInput
                  ref={input}
                  value={text}
                  onChangeText={setText}
                  placeholder="Search parts, brands or your car"
                  placeholderTextColor={colors.muted}
                  style={s.input}
                  returnKeyType="search"
                  onSubmitEditing={() => { setQuery(text); Keyboard.dismiss(); }}
                  accessibilityLabel="Search products"
                />
                {!!text && (
                  <Pressable onPress={() => setText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={18} color={colors.muted} />
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Result count + sort */}
        {(filtered || query.trim().length >= 2) && !results.isLoading && (
          <View style={s.toolbar}>
            <T kind="small">{results.data?.total ?? products.length} results</T>
            <Pressable onPress={() => setShowSort((v) => !v)} style={s.sortBtn} accessibilityRole="button">
              <Ionicons name="swap-vertical" size={15} color={colors.ink2} />
              <Text style={s.sortText}>{SORTS.find((x) => x.key === sort)?.label ?? 'Sort'}</Text>
            </Pressable>
          </View>
        )}
        {showSort && (
          <View style={s.sortSheet}>
            {SORTS.map((o) => (
              <Pressable
                key={o.key || 'relevance'}
                onPress={() => { setSort(o.key); setShowSort(false); }}
                style={s.sortOption}
                accessibilityRole="button"
              >
                <Text style={[s.sortOptionText, sort === o.key && s.sortOptionOn]}>{o.label}</Text>
                {sort === o.key && <Ionicons name="checkmark" size={16} color={colors.green} />}
              </Pressable>
            ))}
          </View>
        )}

        {showSuggestions ? (
          <FlatList
            data={suggestions.data ?? []}
            keyExtractor={(x) => x.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  if (item.type === 'product' && item.slug) router.push(`/product/${item.slug}`);
                  else { setText(item.text); setQuery(item.text); }
                }}
                style={s.suggestion}
                accessibilityRole="button"
              >
                <Ionicons name={item.type === 'product' ? 'cube-outline' : 'search'} size={16} color={colors.muted} />
                <Text style={s.suggestionText} numberOfLines={1}>{item.text}</Text>
              </Pressable>
            )}
          />
        ) : results.isLoading || results.error ? (
          <Screenful
            loading={results.isLoading}
            error={results.error ? (results.error as Error).message : null}
            onRetry={() => results.refetch()}
          />
        ) : !filtered && query.trim().length < 2 ? (
          <Screenful
            emptyIcon="search-outline"
            emptyTitle="What are you looking for?"
            emptyBody="Try a part name, a brand, or your car model."
          />
        ) : products.length === 0 ? (
          <Screenful
            emptyIcon="cube-outline"
            emptyTitle="Nothing matched"
            emptyBody="Try a different spelling, or browse by department."
            action={{ label: 'Browse departments', onPress: () => router.push('/(tabs)/shop') }}
          />
        ) : (
          <FlatList
            data={products}
            keyExtractor={(p) => p.id}
            numColumns={2}
            columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
            contentContainerStyle={{ paddingVertical: spacing.lg, gap: spacing.md }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <View style={{ flex: 1 }}>
                <ProductCard product={item} />
              </View>
            )}
          />
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.header, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 44,
  },
  input: { flex: 1, fontFamily: font.regular, fontSize: 14.5, color: colors.ink, padding: 0 },
  filterTitle: { flex: 1 },
  filterTitleText: { fontFamily: font.bold, fontSize: 19, color: colors.white },

  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.card,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.line,
  },
  sortText: { fontFamily: font.medium, fontSize: 12.5, color: colors.ink2 },
  sortSheet: { backgroundColor: colors.card, marginHorizontal: spacing.lg, marginTop: spacing.sm, borderRadius: radius.lg, overflow: 'hidden' },
  sortOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  sortOptionText: { fontFamily: font.regular, fontSize: 14, color: colors.ink2 },
  sortOptionOn: { fontFamily: font.semibold, color: colors.green },

  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  suggestionText: { flex: 1, fontFamily: font.regular, fontSize: 14.5, color: colors.ink },
});
