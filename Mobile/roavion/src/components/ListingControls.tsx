/**
 * Sort and filter controls for any product listing.
 *
 * ── Facet-driven, not invented ──────────────────────────────────────────────
 * An earlier version offered four hard-coded price bands ("Under ₹5,000", …)
 * and nothing else, because I believed the API could not say which brands a
 * department held. It can: `/products/facets` takes the same parameters as
 * `/products` and returns the brands, vehicle makes, ratings, stock and real
 * price span OF THAT RESULT SET, each with a count.
 *
 * That difference matters to the customer, not just to the code. Every option
 * shown here exists in what they are looking at, carries its true count, and
 * disappears when it would return nothing — so no filter can lead to an empty
 * grid, and "Bushranger 14" means fourteen.
 *
 * ── Why everything is multi-select except price ─────────────────────────────
 * Brands and ratings are unions: a customer comparing Ironman and Bushranger
 * wants both, and single-select would make them look twice. Price is a single
 * range because two disjoint price windows is not a thing anyone shops for.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing } from '../theme';

export const SORTS = [
  { key: '', label: 'Relevance' },
  { key: 'price', label: 'Price: low to high' },
  { key: '-price', label: 'Price: high to low' },
  { key: '-createdAt', label: 'Newest' },
  { key: '-averageRating', label: 'Top rated' },
] as const;

export interface Filters {
  sort: string;
  brands: string[];
  ratings: number[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  /** Restrict to parts that fit the car saved in the garage. */
  fitsMyCar: boolean;
  /** Browse another vehicle without changing the saved garage. */
  vehicleMake?: string;
  vehicleModel?: string;
}

export const EMPTY_FILTERS: Filters = { sort: '', brands: [], ratings: [], inStock: false, fitsMyCar: false };

/** How many filters are on — drives the badge, so the customer can tell. */
export function activeFilterCount(f: Filters): number {
  return (
    f.brands.length +
    f.ratings.length +
    (f.minPrice != null || f.maxPrice != null ? 1 : 0) +
    (f.inStock ? 1 : 0) +
    (f.fitsMyCar ? 1 : 0) +
    (f.vehicleMake ? 1 : 0) +
    (f.vehicleModel ? 1 : 0)
  );
}

export function ListingToolbar({
  total,
  filters,
  onToggleSort,
  onToggleFilter,
}: {
  total: number;
  filters: Filters;
  onToggleSort: () => void;
  onToggleFilter: () => void;
}) {
  const count = activeFilterCount(filters);
  return (
    <View style={s.toolbar}>
      <Text style={s.count}>{total} {total === 1 ? 'product' : 'products'}</Text>
      <View style={s.toolbarBtns}>
        <Pressable onPress={onToggleFilter} style={[s.pill, count > 0 && s.pillOn]} accessibilityRole="button" accessibilityLabel="Filter">
          <Ionicons name="options-outline" size={15} color={count > 0 ? colors.green : colors.ink2} />
          <Text style={[s.pillText, count > 0 && s.pillTextOn]}>Filter</Text>
          {count > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{count}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={onToggleSort} style={s.pill} accessibilityRole="button" accessibilityLabel="Sort">
          <Ionicons name="swap-vertical" size={15} color={colors.ink2} />
          <Text style={s.pillText}>{SORTS.find((x) => x.key === filters.sort)?.label ?? 'Sort'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function SortSheet({ sort, onPick }: { sort: string; onPick: (key: string) => void }) {
  return (
    <View style={s.sheet}>
      {SORTS.map((o) => (
        <Pressable
          key={o.key || 'relevance'}
          onPress={() => onPick(o.key)}
          style={s.option}
          accessibilityRole="button"
          accessibilityState={{ selected: sort === o.key }}
        >
          <Text style={[s.optionText, sort === o.key && s.optionOn]}>{o.label}</Text>
          {sort === o.key && <Ionicons name="checkmark" size={16} color={colors.green} />}
        </Pressable>
      ))}
    </View>
  );
}

/** One tappable option with its count, used for brands and ratings alike. */
const s = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  count: { fontFamily: font.medium, fontSize: 12.5, color: colors.muted },
  toolbarBtns: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pillOn: { borderColor: colors.green, backgroundColor: colors.greenFaint },
  pillText: { fontFamily: font.medium, fontSize: 12, color: colors.ink2 },
  pillTextOn: { fontFamily: font.semibold, color: colors.green },
  badge: {
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.bold, fontSize: 10, color: colors.white },

  sheet: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // Capped so a department with twenty brands cannot push the grid off screen.
  sheetScroll: { maxHeight: 360 },
  group: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionText: { flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.ink2 },
  optionOn: { fontFamily: font.semibold, color: colors.green },

  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  choiceOn: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  choiceText: { flexShrink: 1, fontFamily: font.medium, fontSize: 12.5, color: colors.ink2 },
  choiceTextOn: { fontFamily: font.semibold, color: colors.green },
  choiceCount: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },

  range: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  input: {
    flex: 1,
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.ink,
  },
  dash: { fontFamily: font.regular, fontSize: 13, color: colors.muted },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  clear: { paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  clearText: { fontFamily: font.medium, fontSize: 13, color: colors.muted },
  apply: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: { fontFamily: font.semibold, fontSize: 14, color: colors.white },
});
