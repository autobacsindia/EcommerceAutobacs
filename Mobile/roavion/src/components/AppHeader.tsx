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
 * Presentation only — every tap routes, nothing here fetches or decides.
 */
import { memo } from 'react';
import { Image as RNImage, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing } from '../theme';
import { useApp } from '../store';

const tap = () => Haptics.selectionAsync().catch(() => {});

/** White rounded search field; opens the search screen. */
export function SearchField({ style }: { style?: ViewStyle }) {
  const router = useRouter();
  const { garage } = useApp();
  const hint = garage ? `Search parts for your ${garage.model || garage.make}` : 'Search parts, brands or your car';
  return (
    <Pressable
      onPress={() => router.push('/search')}
      android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
      style={({ pressed }) => [s.search, style, pressed && { opacity: 0.9 }]}
      accessibilityRole="search"
      accessibilityLabel={hint}
    >
      <Ionicons name="search" size={18} color={colors.muted} />
      <Text style={s.searchText} numberOfLines={1}>{hint}</Text>
    </Pressable>
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
        <Pressable
          onPress={() => {
            tap();
            // No notification centre exists yet; order updates are the closest thing.
            router.push(customer ? '/orders' : '/login');
          }}
          hitSlop={8}
          style={s.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Order updates"
        >
          <Ionicons name="notifications-outline" size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => {
            tap();
            router.push('/(tabs)/cart');
          }}
          hitSlop={8}
          style={s.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={`Cart, ${cart.totalItems} items`}
        >
          <Ionicons name="bag-handle-outline" size={20} color={colors.ink} />
          {cart.totalItems > 0 && (
            <View style={s.cartCount}>
              <Text style={s.cartCountText}>{cart.totalItems > 9 ? '9+' : cart.totalItems}</Text>
            </View>
          )}
        </Pressable>
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
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCount: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCountText: { fontFamily: font.bold, fontSize: 9.5, color: colors.white, lineHeight: 12 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#0f1111',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  searchText: { flex: 1, fontFamily: font.regular, fontSize: 14.5, color: colors.muted },
});
