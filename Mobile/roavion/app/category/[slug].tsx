/**
 * One department's products. A thin wrapper over the same list the search
 * screen renders, so paging, sorting and card layout stay identical.
 */
import { FlatList, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchCategories, fetchOffers, fetchProducts } from '../../src/api/catalogue';
import ProductCard from '../../src/components/ProductCard';
import { Screenful } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme';

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const deals = slug === 'offers';

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories(), enabled: !deals });
  const category = (categories.data ?? []).find((c) => c.slug === slug);

  const listing = useQuery({
    queryKey: ['category', slug],
    queryFn: () => (deals ? fetchOffers(40).then((products) => ({ products })) : fetchProducts({ category: String(slug), limit: 40 })),
    enabled: !!slug,
  });

  const products = listing.data?.products ?? [];
  const title = deals ? "Today's deals" : category?.name ?? 'Shop';

  return (
    <>
      <Stack.Screen options={{ title }} />
      {listing.isLoading || listing.error ? (
        <Screenful
          loading={listing.isLoading}
          error={listing.error ? (listing.error as Error).message : null}
          onRetry={() => listing.refetch()}
        />
      ) : products.length === 0 ? (
        <Screenful
          emptyIcon="cube-outline"
          emptyTitle="Nothing here yet"
          emptyBody="This department has no products at the moment."
          action={{ label: 'Browse all departments', onPress: () => router.push('/(tabs)/shop') }}
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
