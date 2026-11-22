/**
 * Category presentation for Home and Shop — real categories only, never
 * invented collections.
 *
 *  - `CuratedCollections` (Home): wide photo cards for the top-level
 *    departments that have a photo, dark scrim, name and "Explore".
 *  - `DepartmentGrid` (Shop): every top-level department as a photo tile,
 *    three across.
 *
 * Heritage Noir: square photo cards, tile scrim, gold caps, serif names.
 */
import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Category } from '../api/catalogue';
import { font, noir, noirSurface, radius, spacing, type } from '../theme';
import { HeroScrim, Overline, PressScale, SectionHeader, SerifTitle, Shimmer } from '../ui';

const COLL_W = 248;
const COLL_H = 168;
const GAP = spacing.md;

const CollectionCard = memo(function CollectionCard({ cat, onOpen }: { cat: Category; onOpen: (slug: string) => void }) {
  return (
    <PressScale onPress={() => onOpen(cat.slug)} haptic="selection" style={s.coll} accessibilityLabel={`${cat.name} collection`}>
      <Image source={{ uri: cat.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
      <HeroScrim variant="tile" />
      <View style={s.collBody}>
        <Overline tone="gold">Collection</Overline>
        <SerifTitle size="section" numberOfLines={1} style={s.collTitle}>{cat.name}</SerifTitle>
        <View style={s.explore}>
          <Text style={s.exploreText}>Explore</Text>
          <Ionicons name="arrow-forward" size={12} color={noir.text} />
        </View>
      </View>
    </PressScale>
  );
});

export function CuratedCollections({ categories, loading }: { categories: Category[]; loading: boolean }) {
  const router = useRouter();
  const withPhoto = categories.filter((c) => !!c.image).slice(0, 8);
  const open = useCallback((slug: string) => router.push(`/category/${slug}`), [router]);
  const renderItem = useCallback(({ item }: ListRenderItemInfo<Category>) => <CollectionCard cat={item} onOpen={open} />, [open]);

  if (!loading && !withPhoto.length) return null;
  return (
    <View style={s.section}>
      <SectionHeader noir overline="Curated" title="Shop by collection" italicLast actionLabel="All" onAction={() => router.push('/(tabs)/shop')} />
      {loading ? (
        <View style={s.row}>
          {[0, 1].map((i) => (
            <Shimmer key={i} width={COLL_W} height={COLL_H} radius={radius.square} dark />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={withPhoto}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.row}
          decelerationRate="fast"
          snapToInterval={COLL_W + GAP}
          initialNumToRender={2}
          windowSize={3}
        />
      )}
    </View>
  );
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
          <Ionicons name="grid-outline" size={24} color={noir.greenText} />
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
      <SectionHeader noir overline="Browse" title="All departments" italicLast />
      <View style={s.grid}>
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
              <View key={i} style={{ width: size, gap: spacing.sm }}>
                <Shimmer width={size} height={size} radius={radius.square} dark />
                <Shimmer width={size * 0.7} height={10} dark />
              </View>
            ))
          : categories.map((c) => <DeptTile key={c.id} cat={c} size={size} onOpen={open} />)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: spacing.xxl },
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg },
  coll: { width: COLL_W, height: COLL_H, borderRadius: radius.square, overflow: 'hidden', backgroundColor: noir.surface, borderBottomWidth: 2, borderBottomColor: noir.gold },
  collBody: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md },
  collTitle: { marginTop: 2 },
  explore: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  exploreText: { ...type.capsNoir, color: noir.text },

  deptSection: { marginTop: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, rowGap: spacing.lg, paddingHorizontal: spacing.lg },
  dept: { gap: spacing.sm },
  deptImgWrap: {
    ...noirSurface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deptName: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 16, color: noir.textSoft, textAlign: 'center' },
});
