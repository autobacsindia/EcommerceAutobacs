/**
 * Category presentation for Home and Shop — real categories only, never
 * invented collections.
 *
 *  - `CategoryQuads` (Home): the website's Amazon-style 4-up cards
 *    (store `CategoryCards.tsx`): "Shop by category", "Upgrade your ride" and
 *    "Top deals for you", each a white card with a 2×2 grid of real photos.
 *    On a phone they sit in a swipeable row.
 *  - `DepartmentGrid` (Shop): every top-level department as a photo tile,
 *    three across, on white cards.
 */
import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Category, Product } from '../api/catalogue';
import { colors, elevation, font, radius, spacing, type } from '../theme';
import { PressScale, SectionHeader, Shimmer } from '../ui';

const GAP = spacing.md;

interface QuadTile {
  key: string;
  label: string;
  image: string;
  route: string;
  /** Product photos sit on the grey well, contained; category photos fill. */
  contain?: boolean;
}
interface Quad {
  key: string;
  title: string;
  tiles: QuadTile[];
  more: { label: string; route: string };
}

const QuadCard = memo(function QuadCard({ quad, width }: { quad: Quad; width: number }) {
  const router = useRouter();
  // -2: the card's hairline border eats into the row; without it the 2×2 wraps to 1 column.
  const tile = Math.floor((width - spacing.lg * 2 - spacing.sm - 2) / 2);
  return (
    <View style={[s.quad, { width }]}>
      <Text style={s.quadTitle} numberOfLines={1}>{quad.title}</Text>
      <View style={s.quadGrid}>
        {quad.tiles.slice(0, 4).map((t) => (
          <PressScale
            key={t.key}
            onPress={() => router.push(t.route as never)}
            haptic="selection"
            scaleTo={0.96}
            style={{ width: tile }}
            accessibilityLabel={t.label}
          >
            <View style={[s.quadMedia, { height: Math.round(tile * 0.82) }]}>
              <Image
                source={{ uri: t.image }}
                style={t.contain ? s.quadContain : StyleSheet.absoluteFill}
                contentFit={t.contain ? 'contain' : 'cover'}
                cachePolicy="memory-disk"
                transition={200}
              />
            </View>
            <Text style={s.quadLabel} numberOfLines={1}>{t.label}</Text>
          </PressScale>
        ))}
      </View>
      <PressScale onPress={() => router.push(quad.more.route as never)} haptic="selection" hitSlop={8} style={s.quadMore} accessibilityLabel={quad.more.label}>
        <Text style={s.quadMoreText}>{quad.more.label}</Text>
        <Ionicons name="chevron-forward" size={13} color={colors.green} />
      </PressScale>
    </View>
  );
});

export function CategoryQuads({ categories, deals = [], loading }: { categories: Category[]; deals?: Product[]; loading: boolean }) {
  const { width } = useWindowDimensions();
  const cardW = Math.min(Math.round(width * 0.8), 340);

  const withImg = categories.filter((c) => !!c.image);
  const cats: QuadTile[] = withImg.map((c) => ({ key: c.id, label: c.name, image: c.image, route: `/category/${c.slug}` }));
  const dealTiles: QuadTile[] = deals
    .filter((d) => !!d.image)
    .slice(0, 4)
    .map((d) => ({ key: d.id, label: d.name, image: d.image as string, route: `/product/${d.slug}`, contain: true }));

  const quads: Quad[] = [];
  if (cats.length >= 4) quads.push({ key: 'cats', title: 'Shop by category', tiles: cats.slice(0, 4), more: { label: 'See all categories', route: '/(tabs)/shop' } });
  if (cats.length >= 8) quads.push({ key: 'ride', title: 'Upgrade your ride', tiles: cats.slice(4, 8), more: { label: 'Explore more', route: '/(tabs)/shop' } });
  if (dealTiles.length >= 4) quads.push({ key: 'deals', title: 'Top deals for you', tiles: dealTiles, more: { label: 'See all deals', route: '/category/offers' } });

  const renderItem = useCallback(({ item }: ListRenderItemInfo<Quad>) => <QuadCard quad={item} width={cardW} />, [cardW]);

  if (!loading && !quads.length) return null;
  return (
    <View style={s.section}>
      {loading ? (
        <View style={s.row}>
          {[0, 1].map((i) => (
            <Shimmer key={i} width={cardW} height={cardW * 0.98} radius={radius.lg} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={quads}
          keyExtractor={(q) => q.key}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[s.row, { paddingVertical: spacing.xs }]}
          decelerationRate="fast"
          snapToInterval={cardW + GAP}
        />
      )}
    </View>
  );
}

/** Older name, kept for any caller still importing it. */
export function CuratedCollections({ categories, loading }: { categories: Category[]; loading: boolean }) {
  return <CategoryQuads categories={categories} loading={loading} />;
}

// ── Shop: department grid ───────────────────────────────────────────────────

const COLS = 3;

function DeptTile({ cat, size, onOpen }: { cat: Category; size: number; onOpen: (slug: string) => void }) {
  return (
    <PressScale onPress={() => onOpen(cat.slug)} haptic="selection" style={[s.dept, { width: size }]} accessibilityLabel={cat.name}>
      <View style={[s.deptImgWrap, { height: size }]}>
        {cat.image ? (
          <Image source={{ uri: cat.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        ) : (
          <Ionicons name="grid-outline" size={24} color={colors.green} />
        )}
      </View>
      <Text style={s.deptName} numberOfLines={2}>{cat.name}</Text>
    </PressScale>
  );
}

export function DepartmentGrid({ categories, loading }: { categories: Category[]; loading: boolean }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const size = Math.floor((width - spacing.lg * 2 - GAP * (COLS - 1)) / COLS);
  const open = useCallback((slug: string) => router.push(`/category/${slug}`), [router]);

  if (!loading && !categories.length) return null;
  return (
    <View style={s.deptSection}>
      <SectionHeader overline="Browse" title="Departments" stripes />
      <View style={s.grid}>
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
              <View key={i} style={{ width: size, gap: spacing.sm }}>
                <Shimmer width={size} height={size} radius={radius.lg} />
                <Shimmer width={size * 0.7} height={10} />
              </View>
            ))
          : categories.map((c) => <DeptTile key={c.id} cat={c} size={size} onOpen={open} />)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: spacing.xl },
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg },

  quad: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...elevation.e1,
  },
  quadTitle: { ...type.h2, marginBottom: spacing.md },
  quadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, rowGap: spacing.md },
  quadMedia: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
  quadContain: { width: '86%', height: '86%' },
  quadLabel: { fontFamily: font.medium, fontSize: 12.5, color: colors.ink2, marginTop: 6 },
  quadMore: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: spacing.md, alignSelf: 'flex-start' },
  quadMoreText: { fontFamily: font.bold, fontSize: 13, color: colors.green },

  deptSection: { marginTop: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, rowGap: spacing.lg, paddingHorizontal: spacing.lg },
  dept: { gap: spacing.sm },
  deptImgWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.e1,
  },
  deptName: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 16, color: colors.ink, textAlign: 'center' },
});
