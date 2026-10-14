/**
 * The filter screen — a full-height sheet with a group rail, the shape every
 * large Indian shopping app uses.
 *
 * ── Why it is not the old inline panel ──────────────────────────────────────
 * Filters used to expand in place, above the still-scrolling product grid. That
 * had three problems a customer feels immediately: the panel was only as tall
 * as whatever space happened to be free, so brands were a wall of chips you
 * scrolled past to find anything; the grid kept moving underneath, so the page
 * jumped as options were tapped; and with every group stacked vertically, the
 * fifth group was four screens of scrolling away.
 *
 * The rail fixes all three. Groups live on the left and their options on the
 * right, so the list of groups is always visible, each group's options get the
 * full height, and the grid behind is covered rather than competing.
 *
 * ── Everything here is facet-driven ─────────────────────────────────────────
 * Groups and options come from `/products/facets`, which takes the same query
 * as `/products` and answers for THAT result set. So every option exists in
 * what the customer is looking at, carries its true count, and a group with
 * nothing to offer is not drawn at all. No filter can lead to an empty grid.
 *
 * Nothing is applied until "Show results": tapping through options re-reads
 * facets, not the listing, so the grid is never rebuilt under a moving thumb.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Facets } from '../api/catalogue';
import { colors, font, radius, spacing } from '../theme';
import type { Filters } from './ListingControls';

type GroupKey = 'fitment' | 'vehicle' | 'brand' | 'price' | 'rating' | 'availability';

interface Group {
  key: GroupKey;
  label: string;
  /** How many choices are on in this group — drawn as a dot on the rail. */
  active: number;
}

/** ₹1,450 → ₹1.4K, ₹1,19,225 → ₹1.2L — short enough to sit beside a count. */
function compactInr(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `₹${n}`;
}

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/** One option row: label, count, and a checkbox on the right. */
function Option({
  label,
  count,
  on,
  onPress,
  radio,
}: {
  label: string;
  count?: number;
  on: boolean;
  onPress: () => void;
  /** Radio for single-choice groups (price band, vehicle), box for unions. */
  radio?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(10,92,51,0.08)' }}
      style={s.option}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={count != null ? `${label}, ${count} products` : label}
    >
      <Ionicons
        name={radio ? (on ? 'radio-button-on' : 'radio-button-off') : on ? 'checkbox' : 'square-outline'}
        size={20}
        color={on ? colors.green : colors.muted}
      />
      <Text style={[s.optionLabel, on && s.optionLabelOn]} numberOfLines={2}>{label}</Text>
      {count != null && <Text style={s.optionCount}>{count}</Text>}
    </Pressable>
  );
}

export default function FilterSheet({
  visible,
  filters,
  facets,
  carLabel,
  resultCount,
  onChange,
  onClear,
  onClose,
}: {
  visible: boolean;
  filters: Filters;
  /** Null while the first facet request is in flight. */
  facets: Facets | null;
  carLabel?: string | null;
  resultCount: number;
  onChange: (next: Filters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [group, setGroup] = useState<GroupKey>('brand');
  const [brandQuery, setBrandQuery] = useState('');

  const models = useMemo(
    () => (facets?.vehicleModels ?? []).filter((m) => !filters.vehicleMake || m.make === filters.vehicleMake),
    [facets?.vehicleModels, filters.vehicleMake],
  );

  // A group is only offered when the current result set has something in it.
  const groups: Group[] = useMemo(() => {
    const all: (Group & { show: boolean })[] = [
      { key: 'fitment', label: 'Fitment', active: filters.fitsMyCar ? 1 : 0, show: !!carLabel },
      {
        key: 'vehicle',
        label: 'Vehicle',
        active: (filters.vehicleMake ? 1 : 0) + (filters.vehicleModel ? 1 : 0),
        show: !!facets?.vehicleMakes.length,
      },
      { key: 'brand', label: 'Brand', active: filters.brands.length, show: !!facets?.brands.length },
      {
        key: 'price',
        label: 'Price',
        active: filters.minPrice != null || filters.maxPrice != null ? 1 : 0,
        show: !!facets?.price,
      },
      { key: 'rating', label: 'Rating', active: filters.ratings.length, show: !!facets?.ratings.length },
      {
        key: 'availability',
        label: 'Availability',
        active: filters.inStock ? 1 : 0,
        show: !!facets?.availability.length,
      },
    ];
    return all.filter((g) => g.show).map(({ show: _show, ...g }) => g);
  }, [facets, filters, carLabel]);

  const brands = useMemo(() => {
    const q = brandQuery.trim().toLowerCase();
    const list = facets?.brands ?? [];
    return q ? list.filter((b) => b.value.toLowerCase().includes(q)) : list;
  }, [facets?.brands, brandQuery]);

  const totalActive = groups.reduce((n, g) => n + g.active, 0);

  const setBound = (which: 'minPrice' | 'maxPrice', text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    onChange({ ...filters, [which]: digits ? Number(digits) : undefined });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Text style={s.title}>Filters</Text>
          {totalActive > 0 && (
            <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button">
              <Text style={s.clear}>Clear all</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} hitSlop={10} style={s.close} accessibilityRole="button" accessibilityLabel="Close filters">
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <View style={s.body}>
          {/* Left rail — the groups stay visible whatever is open. */}
          <View style={s.railWrap}>
            <ScrollView showsVerticalScrollIndicator={false}>
            {groups.map((g) => {
              const on = g.key === group;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGroup(g.key)}
                  style={[s.railItem, on && s.railItemOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  {on && <View style={s.railBar} />}
                  <Text style={[s.railLabel, on && s.railLabelOn]} numberOfLines={1}>{g.label}</Text>
                  {g.active > 0 && <View style={s.railDot} />}
                </Pressable>
              );
            })}
            </ScrollView>
          </View>

          {/* Right panel — the chosen group's options. */}
          <ScrollView
            style={s.panel}
            contentContainerStyle={s.panelContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {group === 'fitment' && !!carLabel && (
              <Option
                label={`Only parts that fit my ${carLabel}`}
                on={filters.fitsMyCar}
                onPress={() => onChange({ ...filters, fitsMyCar: !filters.fitsMyCar })}
              />
            )}

            {group === 'vehicle' && (
              <>
                <Text style={s.subhead}>Make</Text>
                {(facets?.vehicleMakes ?? []).map((m) => (
                  <Option
                    key={m.value}
                    label={m.value}
                    count={m.count}
                    radio
                    on={filters.vehicleMake === m.value}
                    onPress={() =>
                      onChange({
                        ...filters,
                        vehicleMake: filters.vehicleMake === m.value ? undefined : m.value,
                        // A model only means something under its own make.
                        vehicleModel: undefined,
                      })
                    }
                  />
                ))}
                {!!filters.vehicleMake && models.length > 0 && (
                  <>
                    <Text style={s.subhead}>Model</Text>
                    {models.map((m) => (
                      <Option
                        key={`${m.make}-${m.value}`}
                        label={m.value}
                        count={m.count}
                        radio
                        on={filters.vehicleModel === m.value}
                        onPress={() =>
                          onChange({
                            ...filters,
                            vehicleModel: filters.vehicleModel === m.value ? undefined : m.value,
                          })
                        }
                      />
                    ))}
                  </>
                )}
              </>
            )}

            {group === 'brand' && (
              <>
                {(facets?.brands.length ?? 0) > 10 && (
                  <View style={s.search}>
                    <Ionicons name="search" size={16} color={colors.muted} />
                    <TextInput
                      value={brandQuery}
                      onChangeText={setBrandQuery}
                      placeholder="Search brands"
                      placeholderTextColor={colors.muted}
                      style={s.searchInput}
                      accessibilityLabel="Search brands"
                    />
                    {!!brandQuery && (
                      <Pressable onPress={() => setBrandQuery('')} hitSlop={8} accessibilityRole="button">
                        <Ionicons name="close-circle" size={17} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>
                )}
                {brands.map((b) => (
                  <Option
                    key={b.value}
                    label={b.value}
                    count={b.count}
                    on={filters.brands.includes(b.value)}
                    onPress={() => onChange({ ...filters, brands: toggle(filters.brands, b.value) })}
                  />
                ))}
                {brands.length === 0 && <Text style={s.empty}>No brand matches “{brandQuery}”.</Text>}
              </>
            )}

            {group === 'price' && (
              <>
                {/* Bands first: they are one tap and carry counts, which two
                    empty number boxes never could. */}
                {(facets?.priceBands ?? []).map((band, i, all) => {
                  const on = filters.minPrice === band.from && filters.maxPrice === band.to;
                  const label =
                    i === 0
                      ? `Under ${compactInr(band.to)}`
                      : i === all.length - 1
                        ? `${compactInr(band.from)} and above`
                        : `${compactInr(band.from)} – ${compactInr(band.to)}`;
                  return (
                    <Option
                      key={`${band.from}-${band.to}`}
                      label={label}
                      count={band.count}
                      radio
                      on={on}
                      onPress={() =>
                        onChange(
                          on
                            ? { ...filters, minPrice: undefined, maxPrice: undefined }
                            : { ...filters, minPrice: band.from, maxPrice: band.to },
                        )
                      }
                    />
                  );
                })}
                <Text style={s.subhead}>Or set your own</Text>
                <View style={s.range}>
                  <TextInput
                    value={filters.minPrice != null ? String(filters.minPrice) : ''}
                    onChangeText={(v) => setBound('minPrice', v)}
                    placeholder={facets?.price ? String(facets.price.min) : 'Min'}
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={s.rangeInput}
                    accessibilityLabel="Minimum price"
                  />
                  <Text style={s.rangeDash}>to</Text>
                  <TextInput
                    value={filters.maxPrice != null ? String(filters.maxPrice) : ''}
                    onChangeText={(v) => setBound('maxPrice', v)}
                    placeholder={facets?.price ? String(facets.price.max) : 'Max'}
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={s.rangeInput}
                    accessibilityLabel="Maximum price"
                  />
                </View>
              </>
            )}

            {group === 'rating' &&
              (facets?.ratings ?? []).map((r) => (
                <Option
                  key={r.value}
                  label={`${r.value} stars and up`}
                  count={r.count}
                  on={filters.ratings.includes(r.value)}
                  onPress={() => onChange({ ...filters, ratings: toggle(filters.ratings, r.value) })}
                />
              ))}

            {group === 'availability' &&
              (facets?.availability ?? []).map((a) => (
                <Option
                  key={a.value}
                  label={a.label}
                  count={a.count}
                  on={filters.inStock}
                  onPress={() => onChange({ ...filters, inStock: !filters.inStock })}
                />
              ))}

            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </View>

        <View style={[s.foot, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable onPress={onClear} style={s.footClear} accessibilityRole="button">
            <Text style={s.footClearText}>Clear all</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            style={s.footApply}
            accessibilityRole="button"
          >
            <Text style={s.footApplyText}>
              Show {resultCount} result{resultCount === 1 ? '' : 's'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { flex: 1, fontFamily: font.heading, fontSize: 17, letterSpacing: -0.2, color: colors.ink },
  clear: { fontFamily: font.bold, fontSize: 12.5, color: colors.green },
  close: { padding: 2 },

  body: { flex: 1, flexDirection: 'row' },

  railWrap: { width: 128, flexGrow: 0, flexShrink: 0, backgroundColor: colors.bg },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 15,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  railItemOn: { backgroundColor: colors.card },
  railBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.green },
  railLabel: { flex: 1, fontFamily: font.medium, fontSize: 13, color: colors.ink2 },
  railLabelOn: { fontFamily: font.bold, color: colors.green },
  railDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },

  panel: { flex: 1 },
  panelContent: { paddingHorizontal: spacing.lg },
  subhead: {
    fontFamily: font.bold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: spacing.lg,
    marginBottom: 2,
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
  optionLabel: { flex: 1, fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  optionLabelOn: { fontFamily: font.medium, color: colors.ink },
  optionCount: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  empty: { fontFamily: font.regular, fontSize: 13, color: colors.muted, paddingVertical: spacing.lg },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.ink, padding: 0 },

  range: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  rangeInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.ink,
  },
  rangeDash: { fontFamily: font.regular, fontSize: 12.5, color: colors.muted },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
  footClear: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line },
  footClearText: { fontFamily: font.bold, fontSize: 14, color: colors.ink2 },
  footApply: {
    flex: 1.6,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    overflow: 'hidden',
  },
  footApplyText: { fontFamily: font.bold, fontSize: 14, color: colors.white },
});
