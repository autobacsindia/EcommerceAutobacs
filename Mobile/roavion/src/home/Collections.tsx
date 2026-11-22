/**
 * Category presentation for Home and Shop — real categories only, never
 * invented collections.
 *
 *  - `CuratedCollections` (Home): wide photo cards for the top-level
 *    departments that have a photo, dark scrim, name and "Explore".
 *  - `DepartmentGrid` (Shop): every top-level department as a photo tile,
 *    three across, on white cards (no off-brand tints).
 */
import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Category } from '../api/catalogue';
import { alpha, colors, elevation, font, radius, spacing, type } from '../theme';
import { Overline, PressScale, SectionHeader, Shimmer } from '../ui';

const COLL_W = 248;
const COLL_H = 168;
const GAP = spacing.md;

const CollectionCard = memo(function CollectionCard({ cat, onOpen }: { cat: Category; onOpen: (slug: string) => void }) {
  return (
    <PressScale onPress={() => onOpen(cat.slug)} haptic="selection" style={s.coll} accessibilityLabel={`${cat.name} collection`}>
      <Image source={{ uri: cat.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
      <LinearGradient
        colors={[alpha(colors.void, 0), alpha(colors.void, 0.88)]}
        locations={[0.2, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={s.collBody}>
        <Overline onDark>Collection</Overline>
        <Text style={s.collTitle} numberOfLines={1}>{cat.name}</Text>
        <View style={s.explore}>
          <Text style={s.exploreText}>Explore</Text>
          <Ionicons name="arrow-forward" size={12} color={colors.white} />
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
      <SectionHeader overline="Curated" title="Collections" actionLabel="All departments" onAction={() => router.push('/(tabs)/shop')} />
      {loading ? (
        <View style={s.row}>
          {[0, 1].map((i) => (
            <Shimmer key={i} width={COLL_W} height={COLL_H} radius={radius.lg} />
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
  section: { marginTop: spacing.xxl },
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: spacing.lg },
  coll: { width: COLL_W, height: COLL_H, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.carbon },
  collBody: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md },
  collTitle: { ...type.h2, color: colors.white, marginTop: 2 },
  explore: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  exploreText: { fontFamily: font.medium, fontSize: 12, color: colors.onDarkMuted },

  deptSection: { marginTop: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, rowGap: spacing.lg, paddingHorizontal: spacing.lg },
  dept: { gap: spacing.sm },
  deptImgWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.greenFaint,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.e1,
  },
  deptName: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 16, color: colors.ink, textAlign: 'center' },
});
