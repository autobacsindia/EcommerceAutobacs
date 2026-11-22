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
 * ── Presentation (2026-11-22, Heritage Noir) ────────────────────────────────
 * Dark sheets, square controls (white when on), gold group caps and radio.
 * Sort and filter open as bottom sheets (the shared `Sheet`) instead of
 * panels pushed into the list, so the grid never jumps under the customer.
 *
 * ── Why everything is multi-select except price ─────────────────────────────
 * Brands and ratings are unions: a customer comparing Ironman and Bushranger
 * wants both, and single-select would make them look twice. Price is a single
 * range because two disjoint price windows is not a thing anyone shops for.
 */
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Facets } from '../api/catalogue';
import { font, inr, noir, radius, spacing, type } from '../theme';
import { PremiumButton, PressScale, Sheet, StripeLoader } from '../ui';

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
}

export const EMPTY_FILTERS: Filters = { sort: '', brands: [], ratings: [], inStock: false, fitsMyCar: false };

/** How many filters are on — drives the badge, so the customer can tell. */
export function activeFilterCount(f: Filters): number {
  return (
    f.brands.length +
    f.ratings.length +
    (f.minPrice != null || f.maxPrice != null ? 1 : 0) +
    (f.inStock ? 1 : 0) +
    (f.fitsMyCar ? 1 : 0)
  );
}

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

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
  const sortLabel = SORTS.find((x) => x.key === filters.sort)?.label;
  return (
    <View style={s.toolbar}>
      <Text style={s.count}>
        <Text style={s.countNum}>{total}</Text> {total === 1 ? 'product' : 'products'}
      </Text>
      <View style={s.toolbarBtns}>
        <PressScale onPress={onToggleSort} haptic="selection" style={[s.pill, !!filters.sort && s.pillOn]} accessibilityLabel={`Sort: ${sortLabel ?? 'Relevance'}`}>
          <Ionicons name="swap-vertical" size={15} color={filters.sort ? noir.ctaText : noir.text} />
          <Text style={[s.pillText, !!filters.sort && s.pillTextOn]} numberOfLines={1}>{filters.sort ? sortLabel : 'Sort'}</Text>
        </PressScale>
        <PressScale onPress={onToggleFilter} haptic="selection" style={[s.pill, count > 0 && s.pillOn]} accessibilityLabel={count ? `Filter, ${count} on` : 'Filter'}>
          <Ionicons name="options-outline" size={15} color={count > 0 ? noir.ctaText : noir.text} />
          <Text style={[s.pillText, count > 0 && s.pillTextOn]}>Filter</Text>
          {count > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{count}</Text>
            </View>
          )}
        </PressScale>
      </View>
    </View>
  );
}

export function SortSheet({
  visible,
  sort,
  onPick,
  onClose,
}: {
  visible: boolean;
  sort: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Sort by">
      {SORTS.map((o) => {
        const on = sort === o.key;
        return (
          <PressScale
            key={o.key || 'relevance'}
            onPress={() => onPick(o.key)}
            haptic="selection"
            style={[s.option, on && s.optionRowOn]}
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.optionText, on && s.optionOn]}>{o.label}</Text>
            <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
          </PressScale>
        );
      })}
    </Sheet>
  );
}

/** One tappable option with its count, used for brands and ratings alike. */
function Choice({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <PressScale
      onPress={onPress}
      haptic="selection"
      style={[s.choice, on && s.choiceOn]}
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}, ${count} products`}
    >
      {on && <Ionicons name="checkmark" size={14} color={noir.ctaText} />}
      <Text style={[s.choiceText, on && s.choiceTextOn]} numberOfLines={1}>{label}</Text>
      <Text style={[s.choiceCount, on && s.choiceCountOn]}>{count}</Text>
    </PressScale>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} haptic="selection" scaleTo={0.99} style={s.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <Text style={[s.optionText, on && s.optionOn]} numberOfLines={1}>{label}</Text>
      <View style={[s.switch, on && s.switchOn]}>
        <View style={[s.knob, on && s.knobOn]} />
      </View>
    </PressScale>
  );
}

export function FilterSheet({
  visible,
  filters,
  facets,
  carLabel,
  onChange,
  onClear,
  onClose,
}: {
  visible: boolean;
  filters: Filters;
  /** Null while the first facet request is in flight. */
  facets: Facets | null;
  carLabel?: string | null;
  onChange: (next: Filters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  /** Empty string clears the bound rather than filtering on NaN. */
  const setBound = (which: 'minPrice' | 'maxPrice', text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    onChange({ ...filters, [which]: digits ? Number(digits) : undefined });
  };

  const inStockFacet = facets?.availability.find((a) => a.value === 'in');
  const count = activeFilterCount(filters);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      footer={
        <View style={s.actions}>
          <PressScale onPress={onClear} haptic="selection" disabled={!count} style={s.clear}>
            <Text style={[s.clearText, !count && { color: noir.textFaint }]}>Clear all</Text>
          </PressScale>
          <PremiumButton
            label={facets ? `Show ${facets.total} ${facets.total === 1 ? 'result' : 'results'}` : 'Show results'}
            onPress={onClose}
            variant="noir"
            style={{ flex: 1 }}
            full
          />
        </View>
      }
    >
      {!facets && (
        <View style={s.loading}>
          <StripeLoader label="Loading filters" onDark />
        </View>
      )}

      {/* Fitment first: it is the app's whole premise, and it cuts the list hardest. */}
      {carLabel && (
        <>
          <Text style={s.group}>Fitment</Text>
          <Toggle
            label={`Only parts that fit my ${carLabel}`}
            on={filters.fitsMyCar}
            onPress={() => onChange({ ...filters, fitsMyCar: !filters.fitsMyCar })}
          />
        </>
      )}

      {!!facets?.brands.length && (
        <>
          <Text style={s.group}>Brand</Text>
          <View style={s.choices}>
            {facets.brands.slice(0, 20).map((b) => (
              <Choice
                key={b.value}
                label={b.value}
                count={b.count}
                on={filters.brands.includes(b.value)}
                onPress={() => onChange({ ...filters, brands: toggle(filters.brands, b.value) })}
              />
            ))}
          </View>
        </>
      )}

      <Text style={s.group}>
        Price{facets?.price ? ` · ${inr(facets.price.min)} – ${inr(facets.price.max)}` : ''}
      </Text>
      <View style={s.range}>
        <View style={s.inputWrap}>
          <Text style={s.rupee}>₹</Text>
          <TextInput
            value={filters.minPrice != null ? String(filters.minPrice) : ''}
            onChangeText={(t) => setBound('minPrice', t)}
            placeholder={facets?.price ? String(facets.price.min) : 'Min'}
            placeholderTextColor={noir.textFaint}
            selectionColor={noir.gold}
            keyboardType="number-pad"
            style={s.input}
            accessibilityLabel="Minimum price"
          />
        </View>
        <Text style={s.dash}>to</Text>
        <View style={s.inputWrap}>
          <Text style={s.rupee}>₹</Text>
          <TextInput
            value={filters.maxPrice != null ? String(filters.maxPrice) : ''}
            onChangeText={(t) => setBound('maxPrice', t)}
            placeholder={facets?.price ? String(facets.price.max) : 'Max'}
            placeholderTextColor={noir.textFaint}
            selectionColor={noir.gold}
            keyboardType="number-pad"
            style={s.input}
            accessibilityLabel="Maximum price"
          />
        </View>
      </View>

      {!!facets?.ratings.length && (
        <>
          <Text style={s.group}>Customer rating</Text>
          <View style={s.choices}>
            {facets.ratings.map((r) => (
              <Choice
                key={r.value}
                label={`${r.value}★ & up`}
                count={r.count}
                on={filters.ratings.includes(r.value)}
                onPress={() => onChange({ ...filters, ratings: toggle(filters.ratings, r.value) })}
              />
            ))}
          </View>
        </>
      )}

      {!!inStockFacet && (
        <>
          <Text style={s.group}>Availability</Text>
          <Toggle
            label={`In stock only (${inStockFacet.count})`}
            on={filters.inStock}
            onPress={() => onChange({ ...filters, inStock: !filters.inStock })}
          />
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  count: { fontFamily: font.regular, fontSize: 13, color: noir.textMuted },
  countNum: { fontFamily: font.heading, color: noir.text },
  toolbarBtns: { flexDirection: 'row', gap: spacing.sm, flexShrink: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    maxWidth: 190,
    backgroundColor: noir.surface,
    borderRadius: radius.square,
    paddingHorizontal: spacing.md + 2,
    borderWidth: 1,
    borderColor: noir.hairlineStrong,
  },
  pillOn: { borderColor: noir.cta, backgroundColor: noir.cta },
  pillText: { flexShrink: 1, ...type.ctaLabel, fontSize: 11, letterSpacing: 1.4, color: noir.text },
  pillTextOn: { color: noir.ctaText },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: noir.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.bold, fontSize: 10, color: noir.text },

  loading: { paddingVertical: spacing.xl, alignItems: 'center' },
  group: {
    ...type.capsNoir,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.square,
    borderBottomWidth: 1,
    borderBottomColor: noir.hairline,
  },
  optionRowOn: { backgroundColor: noir.goldFaint },
  optionText: { flex: 1, fontFamily: font.regular, fontSize: 15, color: noir.textMuted },
  optionOn: { fontFamily: font.bold, color: noir.text },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: noir.textFaint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: noir.gold },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: noir.gold },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 44 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: noir.hairlineStrong, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: noir.green },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: noir.text },
  knobOn: { alignSelf: 'flex-end' },

  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    height: 38,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.square,
    borderWidth: 1,
    borderColor: noir.hairlineStrong,
    backgroundColor: noir.page,
  },
  choiceOn: { backgroundColor: noir.cta, borderColor: noir.cta },
  choiceText: { flexShrink: 1, fontFamily: font.medium, fontSize: 13.5, color: noir.textMuted },
  choiceTextOn: { fontFamily: font.bold, color: noir.ctaText },
  choiceCount: { fontFamily: font.regular, fontSize: 12, color: noir.textFaint },
  choiceCountOn: { color: noir.ctaText },

  range: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.square,
    borderWidth: 1,
    borderColor: noir.hairlineStrong,
    backgroundColor: noir.page,
  },
  rupee: { fontFamily: font.medium, fontSize: 15, color: noir.textFaint },
  input: { flex: 1, fontFamily: font.medium, fontSize: 15, color: noir.text, padding: 0 },
  dash: { fontFamily: font.regular, fontSize: 13, color: noir.textFaint },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  clear: { paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
  clearText: { ...type.ctaLabel, fontSize: 11, color: noir.text, textDecorationLine: 'underline' },
});
