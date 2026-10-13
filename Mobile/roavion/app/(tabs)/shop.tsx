/**
 * Shop — the whole catalogue, filterable, with the departments as chips.
 *
 * ── What this screen was ────────────────────────────────────────────────────
 * A chooser: two tabs, Departments and Brands, each a list of links. Tapping
 * "Shop" in the tab bar therefore showed a customer no products at all — they
 * had to pick a department first and wait for a second screen. Nobody opens a
 * shopping app to read a table of contents.
 *
 * It is now the catalogue itself. The departments are still here, as the chip
 * row above the grid — the same place the website puts them — so switching
 * aisle is one tap and never leaves the products.
 *
 * Brands keep their own route (Shop → a brand opens /search?brand=…), because
 * "which brands do you carry" is a different question from "show me products",
 * and answering both on one screen is what made this a menu instead of a shop.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchCategories } from '../../src/api/catalogue';
import AppHeader from '../../src/components/AppHeader';
import ProductListing from '../../src/components/ProductListing';
import { colors } from '../../src/theme';

export default function ShopScreen() {
  const [slug, setSlug] = useState<string | null>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  // Top-level departments only: the chip row switches aisle, and every
  // sub-category would make it a wall rather than a row.
  const parents = (categories.data ?? []).filter((c) => !c.parentId);
  const current = parents.find((c) => c.slug === slug);

  return (
    <View style={s.screen}>
      <ProductListing
        // Inside the scroll view, so it leaves the screen with the content —
        // the website's behaviour, and what keeps the grid full-height.
        topSlot={<AppHeader compact />}
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
  screen: { flex: 1, backgroundColor: colors.bg },
});
