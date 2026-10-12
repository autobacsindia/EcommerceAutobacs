/**
 * Shop — browse the whole catalogue by department or brand.
 *
 * Departments come from the live category tree, so a category added in admin
 * appears here without an app update.
 */
import { useRef, useState } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchBrands, fetchCategories, type Brand, type Category } from '../../src/api/catalogue';
import AppHeader from '../../src/components/AppHeader';
import ScrollTopButton from '../../src/components/ScrollTopButton';
import { useHeaderScroll, useScrollToTop } from '../../src/components/useHeaderScroll';
import { Photo, Screenful, T } from '../../src/components/ui';
import { colors, font, radius, shadow, spacing } from '../../src/theme';

type Tab = 'departments' | 'brands';

export default function ShopScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('departments');
  const list = useRef<FlatList>(null);

  /*
    Compact header: the pinned bar only, so nothing collapses here (0) — but it
    still floats over the content, so the tab strip below carries its height.
  */
  const { onScroll, showTop } = useHeaderScroll(0);
  const scrollToTop = useScrollToTop(list);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => fetchBrands(), enabled: tab === 'brands' });

  const parents = (categories.data ?? []).filter((c) => !c.parentId);
  const childrenOf = (id: string) => (categories.data ?? []).filter((c) => c.parentId === id);

  const loading = tab === 'departments' ? categories.isLoading : brands.isLoading;
  const error = tab === 'departments' ? categories.error : brands.error;

  return (
    <View style={s.screen}>
      {/* The same brand chrome as Home, minus the home page's extra bars, so
          moving between the two tabs never feels like two different apps. */}
      <AppHeader compact />
      <View style={s.header}>
        <View style={s.tabs}>
          {(['departments', 'brands'] as Tab[]).map((key) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[s.tab, tab === key && s.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
            >
              <Text style={[s.tabText, tab === key && s.tabTextOn]}>{key === 'departments' ? 'Departments' : 'Brands'}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading || error ? (
        <Screenful
          loading={loading}
          error={error ? (error as Error).message : null}
          onRetry={() => (tab === 'departments' ? categories.refetch() : brands.refetch())}
        />
      ) : tab === 'departments' ? (
        <Animated.FlatList
          /*
            A distinct key per tab. Both branches render the same element type
            in the same position, so React reuses ONE list instance across the
            switch — and the brands tab sets numColumns={2} while departments
            leaves it at 1. Changing numColumns on a live list is an invariant
            violation that crashes the screen outright. The key forces a fresh
            mount instead, which is what the error itself prescribes.
          */
          key="departments"
          ref={list}
          onScroll={onScroll}
          scrollEventThrottle={16}
          data={parents}
          keyExtractor={(c: Category) => c.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const subs = childrenOf(item.id);
            return (
              <View style={s.group}>
                <Pressable
                  onPress={() => router.push(`/category/${item.slug}`)}
                  style={s.groupHead}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                >
                  <Photo uri={item.image} style={s.groupImage} contentFit="cover" />
                  <T kind="h3" style={{ flex: 1 }}>{item.name}</T>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
                {subs.length > 0 && (
                  <View style={s.chips}>
                    {subs.slice(0, 8).map((sub) => (
                      <Pressable key={sub.id} onPress={() => router.push(`/category/${sub.slug}`)} style={s.chip}>
                        <Text style={s.chipText}>{sub.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          }}
        />
      ) : (
        <Animated.FlatList
          key="brands"
          ref={list}
          onScroll={onScroll}
          scrollEventThrottle={16}
          data={brands.data ?? []}
          keyExtractor={(b: Brand) => b.slug}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/search?brand=${encodeURIComponent(item.name)}`)}
              style={s.brandCard}
              accessibilityRole="button"
              accessibilityLabel={item.name}
            >
              {item.logo ? <Photo uri={item.logo} style={s.brandLogo} /> : <Text style={s.brandName}>{item.name}</Text>}
              <Text style={s.brandCount}>{item.productCount} products</Text>
            </Pressable>
          )}
        />
      )}

      <ScrollTopButton visible={showTop} onPress={scrollToTop} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.header, paddingHorizontal: spacing.lg },
  tabs: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  tab: { paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.white },
  tabText: { fontFamily: font.medium, fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  tabTextOn: { fontFamily: font.semibold, color: colors.white },

  list: { padding: spacing.lg, gap: spacing.md },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, ...shadow.card },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  groupImage: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: { backgroundColor: colors.greenFaint, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipText: { fontFamily: font.medium, fontSize: 12, color: colors.green },

  brandCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg,
    alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 104, ...shadow.card,
  },
  brandLogo: { width: 92, height: 42 },
  brandName: { fontFamily: font.bold, fontSize: 14, color: colors.ink, textAlign: 'center' },
  brandCount: { fontFamily: font.regular, fontSize: 11, color: colors.muted },
});
