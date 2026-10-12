/**
 * One department's products.
 *
 * The grid, its filters and its paging live in ProductListing, shared with the
 * Shop tab — the two show the same thing and must not drift. This screen only
 * resolves the slug to a department and hands over its name and blurb.
 *
 * "offers" is the one special case: Today's Deals is a curated list from
 * /products/offers rather than a category, so it keeps its own simple grid.
 */
import { useMemo } from 'react';
import { FlatList, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchCategories, fetchOffers } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import ProductListing from '../../src/components/ProductListing';
import { Screenful } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme';

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const deals = slug === 'offers';

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
        <Stack.Screen options={{ title: "Today's deals" }} />
        {offers.isPending || offers.error ? (
          <Screenful
            loading={offers.isPending}
            error={offers.error ? (offers.error as Error).message : null}
            onRetry={() => offers.refetch()}
          />
        ) : products.length === 0 ? (
          <Screenful
            emptyIcon="pricetag-outline"
            emptyTitle="No deals right now"
            emptyBody="Check back soon — offers change often."
            action={{ label: 'Browse the shop', onPress: () => router.push('/(tabs)/shop') }}
          />
        ) : (
          <FlatList
            style={{ backgroundColor: colors.bg }}
            data={products}
            keyExtractor={(p) => p.id}
            numColumns={2}
            columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
            contentContainerStyle={{ paddingVertical: spacing.lg, gap: spacing.md }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ flex: 1 }}>
                <ProductCard product={item} />
              </View>
            )}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: category?.name ?? 'Shop' }} />
      <ProductListing
        title={category?.name ?? 'Shop'}
        blurb={category?.description || undefined}
        categorySlug={String(slug)}
      />
    </>
  );
}
