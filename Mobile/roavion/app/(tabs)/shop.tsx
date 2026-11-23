/**
 * Shop — departments, then the whole catalogue, filterable.
 *
 * WhatsApp-style (owner, 2026-11-22): the pinned white app bar, then a large
 * bold "Shop" title and grey search pill (like WhatsApp's "Chats"), a photo
 * grid of every top-level department (each opens its own page), then the full
 * catalogue grid with tinted department chips, sort and filter sheets.
 *
 * Brands keep their own route (Home's brand strip → /search?brand=…).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchCategories } from '../../src/api/catalogue';
import AppHeader, { ScreenTitle, SearchField } from '../../src/components/AppHeader';
import ProductListing from '../../src/components/ProductListing';
import { DepartmentGrid } from '../../src/home/Collections';
import { colors, spacing } from '../../src/theme';

export default function ShopScreen() {
  const [slug, setSlug] = useState<string | null>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  // Top-level departments only: every sub-category would make a wall, not a grid.
  const parents = (categories.data ?? []).filter((c) => !c.parentId);
  const current = parents.find((c) => c.slug === slug);

  return (
    <View style={s.screen}>
      <ProductListing
        stickyTop={<AppHeader />}
        topSlot={
          <>
            <ScreenTitle title="Shop" />
            <SearchField style={{ marginHorizontal: spacing.lg, marginBottom: spacing.sm }} />
            <DepartmentGrid categories={parents} loading={categories.isLoading} />
          </>
        }
        overline={current ? 'Department' : undefined}
        title={current?.name ?? 'All products'}
        blurb={current?.description || undefined}
        categorySlug={slug ?? undefined}
        chips={parents}
        onPickChip={setSlug}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screen },
});
