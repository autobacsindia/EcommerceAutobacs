/**
 * Shop — departments, then the whole catalogue, filterable.
 *
 * Heritage Noir (2026-11-22): carbon page, square search bar.
 *
 * Premium look (2026-11-22): a pinned search bar (with the cart) that stays
 * while the page scrolls, a photo grid of every top-level department (each
 * opens its own page), then the full catalogue grid with the department chips,
 * sort and filter sheets.
 *
 * Brands keep their own route (Home's brand strip → /search?brand=…).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { fetchCategories } from '../../src/api/catalogue';
import { SearchField } from '../../src/components/AppHeader';
import ProductListing from '../../src/components/ProductListing';
import { DepartmentGrid } from '../../src/home/Collections';
import { noir, spacing } from '../../src/theme';
import { IconButton } from '../../src/ui';
import { useApp } from '../../src/store';

/** The pinned bar: search field + cart. */
function StickySearch() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart } = useApp();
  return (
    <View style={[s.bar, { paddingTop: insets.top + spacing.sm }]}>
      <SearchField style={s.search} />
      <IconButton
        icon="bag-handle-outline"
        label={`Cart, ${cart.totalItems} items`}
        onPress={() => router.push('/(tabs)/cart')}
        badge={cart.totalItems}
        tone="plain"
        color={noir.text}
        size={46}
        style={s.cart}
      />
    </View>
  );
}

export default function ShopScreen() {
  const [slug, setSlug] = useState<string | null>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  // Top-level departments only: every sub-category would make a wall, not a grid.
  const parents = (categories.data ?? []).filter((c) => !c.parentId);
  const current = parents.find((c) => c.slug === slug);

  return (
    <View style={s.screen}>
      <ProductListing
        stickyTop={<StickySearch />}
        topSlot={<DepartmentGrid categories={parents} loading={categories.isLoading} />}
        overline={current ? 'Department' : 'Everything'}
        title={current?.name ?? 'Shop all'}
        blurb={current?.description || undefined}
        categorySlug={slug ?? undefined}
        chips={parents}
        onPickChip={setSlug}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: noir.page,
    borderBottomWidth: 1,
    borderBottomColor: noir.hairline,
    zIndex: 2,
  },
  search: { flex: 1 },
  cart: { borderWidth: 1, borderColor: noir.hairlineStrong, backgroundColor: noir.surface },
});
