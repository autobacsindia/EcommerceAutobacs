/**
 * A titled horizontal rail of product cards, with its own skeleton.
 * Hidden entirely when it has nothing to show — no empty rows on Home.
 */
import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import type { Product } from '../api/catalogue';
import ProductCard from '../components/ProductCard';
import { spacing } from '../theme';
import { ProductCardSkeleton, SectionHeader } from '../ui';

export const RAIL_CARD_W = 164;
const GAP = spacing.md;

function ProductRail({
  overline,
  title,
  subtitle,
  products,
  loading,
  onSeeAll,
  ranked,
}: {
  overline?: string;
  title: string;
  subtitle?: string;
  products: Product[];
  loading: boolean;
  onSeeAll?: () => void;
  ranked?: boolean;
}) {
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Product>) => (
      <ProductCard product={item} width={RAIL_CARD_W} rank={ranked ? index + 1 : undefined} />
    ),
    [ranked],
  );

  if (!loading && !products.length) return null;

  return (
    <View style={s.section}>
      <SectionHeader overline={overline} title={title} subtitle={subtitle} actionLabel={onSeeAll ? 'See all' : undefined} onAction={onSeeAll} />
      {loading ? (
        <View style={s.row}>
          {[0, 1, 2].map((i) => (
            <ProductCardSkeleton key={i} width={RAIL_CARD_W} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={products}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={Gap}
          initialNumToRender={3}
          windowSize={3}
          decelerationRate="fast"
          snapToInterval={RAIL_CARD_W + GAP}
          getItemLayout={(_, i) => ({ length: RAIL_CARD_W + GAP, offset: (RAIL_CARD_W + GAP) * i, index: i })}
        />
      )}
    </View>
  );
}

function Gap() {
  return <View style={{ width: GAP }} />;
}

export default memo(ProductRail);

const s = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg, overflow: 'hidden' },
  // Vertical padding so the card shadow is not clipped by the list.
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
});
