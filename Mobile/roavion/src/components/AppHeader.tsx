/**
 * App bar + screen title — WhatsApp-style (owner, 2026-11-22; replaces the
 * dark website header from earlier the same day).
 *
 *   <AppHeader />                    // white bar: Autobacs logo left, search + cart icons right
 *   <ScreenTitle title="Shop" />     // large bold tab title, like WhatsApp's "Chats"
 *   <SearchField />                  // grey rounded search pill (opens search)
 *   <QuickChips chips={…} />         // "All / Fits my car / Offers / …" pill chips
 *
 * The bar is pinned by the screen (it does not scroll), white with a hairline
 * under it. The status bar stays dark (set in the root layout).
 *
 * Presentation only — every tap routes, nothing here fetches or decides. The
 * cart badge shows the count the cart store already holds (display only).
 */
import { memo } from 'react';
import { Image as RNImage, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing } from '../theme';
import { useApp } from '../store';
import { CountBubble, PressScale } from '../ui';

const LOGO = require('../../assets/autobacs-logo.png');

type IconName = keyof typeof Ionicons.glyphMap;

/** A plain line icon in the app bar, 44pt target. */
function BarIcon({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress: () => void; badge?: number }) {
  return (
    <PressScale onPress={onPress} haptic="selection" scaleTo={0.9} hitSlop={4} style={s.barIcon} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={24} color={colors.ink} />
      {!!badge && badge > 0 && <CountBubble count={badge} style={s.badge} />}
    </PressScale>
  );
}

/** Grey rounded search pill (WhatsApp's "Ask Meta AI or Search"). Opens search. */
export function SearchField({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { garage } = useApp();
  const hint = garage ? `Search parts for your ${garage.model || garage.make}` : 'Search parts, brands or your car';
  return (
    <PressScale
      onPress={() => router.push('/search')}
      haptic="selection"
      scaleTo={0.985}
      style={[s.search, style]}
      accessibilityRole="search"
      accessibilityLabel={hint}
    >
      <Ionicons name="search" size={19} color={colors.muted} />
      <Text style={s.searchText} numberOfLines={1}>{hint}</Text>
    </PressScale>
  );
}

/** Large bold tab title, like WhatsApp's "Chats". Optional right-side text action. */
export function ScreenTitle({ title, style }: { title: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.titleRow, style]}>
      <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
    </View>
  );
}

export interface QuickChip {
  key: string;
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress: () => void;
}

/** WhatsApp's "All / Unread / Favourites" chips: pill, tinted when selected. */
export function QuickChips({ chips, style }: { chips: QuickChip[]; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.chips, style]}>
      {chips.map((c) => (
        <PressScale
          key={c.key}
          onPress={c.onPress}
          haptic="selection"
          scaleTo={0.95}
          style={[s.chip, c.selected && s.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: !!c.selected }}
          accessibilityLabel={c.label}
        >
          {c.icon && <Ionicons name={c.icon} size={14} color={c.selected ? colors.green : colors.ink2} />}
          <Text style={[s.chipText, c.selected && s.chipTextOn]} numberOfLines={1}>{c.label}</Text>
        </PressScale>
      ))}
    </ScrollView>
  );
}

function AppHeader(_props: {
  /** @deprecated kept so old call sites compile; the bar has one shape now. */
  compact?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart } = useApp();

  return (
    <View style={[s.wrap, { paddingTop: insets.top }]}>
      <View style={s.bar}>
        <RNImage source={LOGO} style={s.logo} resizeMode="contain" accessibilityRole="image" accessibilityLabel="Autobacs India" />
        <View style={{ flex: 1 }} />
        <BarIcon icon="search-outline" label="Search" onPress={() => router.push('/search')} />
        <BarIcon icon="cart-outline" label={`Cart, ${cart.totalItems} items`} onPress={() => router.push('/(tabs)/cart')} badge={cart.totalItems} />
      </View>
    </View>
  );
}

export default memo(AppHeader);

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    zIndex: 2,
  },
  bar: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.lg, paddingRight: spacing.sm },
  // The wordmark is 960×226; 32pt tall keeps "Powered By Autobacs India" legible.
  logo: { width: 136, height: 32 },
  barIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2 },

  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontFamily: font.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.5, color: colors.ink },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.searchFill,
  },
  searchText: { flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.muted },

  chips: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.greenSoft, borderColor: colors.greenSoft },
  chipText: { fontFamily: font.medium, fontSize: 13.5, color: colors.ink2 },
  chipTextOn: { fontFamily: font.bold, color: colors.green },
});
