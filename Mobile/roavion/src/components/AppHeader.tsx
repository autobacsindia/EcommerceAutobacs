/**
 * The Autobacs app header — design "Premium showroom" (owner picked
 * 2026-11-18, on top of "A clean light + C car line").
 *
 *   - Off-white bar: the Autobacs logo on the left, a bell and the cart (with
 *     its count) on the right, in small white rounds.
 *   - `SearchField`: a white rounded-12 field that names the saved car. Home
 *     places it under its hero card; `compact` screens (Shop) get it right
 *     under the logo row.
 *
 * The car itself lives on Home's hero card ("Your Toyota Fortuner" pill).
 * It sits inside the scroll view as its first child, so it scrolls away with
 * the content.
 *
 * Premium pass (2026-11-22): shared IconButtons, press-scale search field
 * with a soft lift and a green search glyph.
 *
 * Presentation only — every tap routes, nothing here fetches or decides.
 */
import { memo } from 'react';
import { Image as RNImage, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, font, radius, spacing } from '../theme';
import { useApp } from '../store';
import { IconButton, PressScale } from '../ui';

/** White rounded search field; opens the search screen. */
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
      <Ionicons name="search" size={18} color={colors.green} />
      <Text style={s.searchText} numberOfLines={1}>{hint}</Text>
    </PressScale>
  );
}

function AppHeader({
  compact,
}: {
  /** Logo row + search — for a screen that has its own controls below. */
  compact?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer, cart } = useApp();

  return (
    <View style={[s.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <View style={s.topRow}>
        <RNImage
          source={require('../../assets/autobacs-logo.png')}
          style={s.logo}
          resizeMode="contain"
          accessibilityLabel="Autobacs"
        />
        <View style={{ flex: 1 }} />
        <IconButton
          icon="notifications-outline"
          label="Order updates"
          // No notification centre exists yet; order updates are the closest thing.
          onPress={() => router.push(customer ? '/orders' : '/login')}
          tone="light"
        />
        <IconButton
          icon="bag-handle-outline"
          label={`Cart, ${cart.totalItems} items`}
          onPress={() => router.push('/(tabs)/cart')}
          badge={cart.totalItems}
          tone="light"
        />
      </View>

      {compact && <SearchField style={{ marginHorizontal: spacing.lg, marginTop: spacing.xs }} />}
    </View>
  );
}

export default memo(AppHeader);

const s = StyleSheet.create({
  wrap: { backgroundColor: colors.bg, paddingBottom: spacing.sm },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  logo: { width: 128, height: 30 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...elevation.e1,
  },
  searchText: { flex: 1, fontFamily: font.regular, fontSize: 14.5, color: colors.muted },
});
