/**
 * The Autobacs app header — the website's store header, at phone width
 * (store.css `.sh-top`, `.sh-vehicle-btn`, `.sh-search`, `.sh-go`, `.sh-cart`).
 * Owner asked 2026-11-22: match autobacsindia.com's DEFAULT theme, logo visible.
 *
 *   - Carbon #121414 bar with the white Autobacs wordmark and the cart (badge).
 *   - "Parts for <car>" — the dashed green vehicle pill; opens Garage.
 *   - A white rounded search pill with a green "Go"; opens the search screen.
 *
 * While the screen showing it is focused the status bar is light, so the clock
 * and battery read on the dark bar; it reverts when the screen blurs.
 *
 * `SearchField` is still exported (old call sites) and now renders the same
 * website search pill.
 *
 * Presentation only — every tap routes, nothing here fetches or decides. The
 * cart badge shows the count the cart store already holds.
 */
import { memo, useCallback, useState } from 'react';
import { Image as RNImage, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, font, radius, spacing } from '../theme';
import { useApp } from '../store';
import { PressScale } from '../ui';

const LOGO = require('../../assets/autobacs-logo-white.png');

/** The website search pill: green glyph, hint, green "Go". Opens search. */
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
      <View style={s.go}>
        <Text style={s.goText}>Go</Text>
      </View>
    </PressScale>
  );
}

/** "Parts for <car>" — the website's dashed green vehicle pill. */
function VehiclePill() {
  const router = useRouter();
  const { garage } = useApp();
  const car = garage ? [garage.make, garage.model].filter(Boolean).join(' ') : null;
  return (
    <PressScale
      onPress={() => router.push('/garage')}
      haptic="selection"
      scaleTo={0.98}
      style={s.vehicle}
      accessibilityRole="button"
      accessibilityLabel={car ? `Parts for ${car}. Change car` : 'Add your car to see parts that fit'}
    >
      <View style={s.vehicleIco}>
        <Ionicons name="car-sport" size={18} color={colors.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.vehicleSmall}>{car ? 'Parts for' : 'Shop by vehicle'}</Text>
        <Text style={s.vehicleBig} numberOfLines={1}>{car ?? 'Add your car'}</Text>
      </View>
      <Text style={s.vehicleAction}>{car ? 'Change' : 'Add'}</Text>
      <Ionicons name="chevron-down" size={16} color={colors.headerMuted} />
    </PressScale>
  );
}

/** Light status bar only while this header's screen is on top. */
function LightStatusBar() {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused ? <StatusBar style="light" /> : null;
}

function AppHeader({
  compact,
}: {
  /** Leave out the vehicle pill (a screen that offers its own filters). */
  compact?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart } = useApp();

  return (
    <View style={[s.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <LightStatusBar />
      <View style={s.topRow}>
        <RNImage source={LOGO} style={s.logo} resizeMode="contain" accessibilityRole="image" accessibilityLabel="Autobacs India" />
        <View style={{ flex: 1 }} />
        <PressScale
          onPress={() => router.push('/(tabs)/cart')}
          haptic="selection"
          scaleTo={0.92}
          hitSlop={4}
          style={s.cart}
          accessibilityRole="button"
          accessibilityLabel={`Cart, ${cart.totalItems} items`}
        >
          <Ionicons name="cart-outline" size={22} color={colors.white} />
          {cart.totalItems > 0 && (
            <View style={s.cartCount}>
              <Text style={s.cartCountText}>{cart.totalItems > 99 ? '99+' : cart.totalItems}</Text>
            </View>
          )}
        </PressScale>
      </View>

      {!compact && <VehiclePill />}
      <SearchField style={{ marginTop: spacing.md }} />
    </View>
  );
}

export default memo(AppHeader);

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.header,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  // The wordmark is 960×226; 34pt tall keeps "Powered By Autobacs India" legible.
  logo: { width: 144, height: 34 },

  cart: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The website's `.sh-cart-count`: white pill, ink number, ringed in the bar colour.
  cartCount: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.header,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCountText: { fontFamily: font.bold, fontSize: 11, lineHeight: 14, color: colors.ink },

  vehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: spacing.md,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.vehicleBorder,
    backgroundColor: colors.vehicleFill,
  },
  vehicleIco: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.greenMid, alignItems: 'center', justifyContent: 'center' },
  vehicleSmall: { fontFamily: font.regular, fontSize: 11.5, lineHeight: 14, color: colors.headerMuted },
  vehicleBig: { fontFamily: font.bold, fontSize: 15, lineHeight: 19, color: colors.headerText },
  vehicleAction: { fontFamily: font.bold, fontSize: 12.5, color: colors.headerText },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    height: 48,
    paddingLeft: spacing.lg,
    paddingRight: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...elevation.e1,
  },
  searchText: { flex: 1, fontFamily: font.regular, fontSize: 14.5, color: colors.muted },
  go: { height: 40, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  goText: { fontFamily: font.bold, fontSize: 14.5, color: colors.white },
});
