/**
 * The Roavion app chrome — a faithful port of the website's mobile header.
 *
 * ── Measured, not guessed ───────────────────────────────────────────────────
 * Every number here was read off autobacsindia.com at a 375dp viewport, so the
 * app and the site are the same header rather than two interpretations of one:
 *
 *   logo            105 × 28
 *   search pill     46 tall, white, fully rounded, 15px text
 *   "Go"            52 × 36, #0a5c33, fully rounded
 *   vehicle row     63 tall on #1d2121
 *   department bar  44 tall on #0a5c33, 15px white
 *   total           ~223
 *
 * ── It scrolls away, because the website's does ─────────────────────────────
 * The site's header is `position: static`: it leaves the screen entirely with
 * the content. An earlier version of this component pinned all four rows,
 * which spent a quarter of a phone screen on chrome the customer had already
 * read. A later one pinned a slim bar instead and shrank the search field to
 * fit — which broke the most important control on a shopping screen.
 *
 * So it now does what the site does: the whole header scrolls out of the way,
 * the search bar keeps its full size, and a floating button brings the
 * customer back to the top whenever they want it (see ScrollTopButton). The
 * header is an ordinary first child of the scroll view — no absolute
 * positioning, no padding to keep in sync, nothing to drift.
 *
 * Presentation only — every tap routes, nothing here fetches or decides.
 */
import { memo } from 'react';
import { Image as RNImage, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing } from '../theme';
import { useApp } from '../store';

export interface Department {
  label: string;
  onPress: () => void;
}

function AppHeader({
  departments = [],
  compact,
}: {
  departments?: Department[];
  /** Brand bar + search only — for a screen that has its own controls below. */
  compact?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer, garage, cart } = useApp();

  const firstName = customer?.name?.split(' ')[0];
  const car = garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : null;

  return (
    <View style={s.wrap}>
      {/* 1 — brand, who you are, cart */}
      <View style={[s.topRow, { paddingTop: insets.top + spacing.sm }]}>
        <RNImage
          source={require('../../assets/roavion-logo.png')}
          style={s.logo}
          resizeMode="contain"
          accessibilityLabel="Roavion"
        />
        <Pressable
          onPress={() => router.push(customer ? '/(tabs)/account' : '/login')}
          hitSlop={8}
          style={s.hello}
          accessibilityRole="button"
          accessibilityLabel={customer ? 'Your account' : 'Sign in'}
        >
          <Text style={s.helloText} numberOfLines={1}>
            {firstName ? `Hello, ${firstName}` : 'Hello, sign in'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/(tabs)/cart')}
          hitSlop={8}
          style={s.cart}
          accessibilityRole="button"
          accessibilityLabel={`Cart, ${cart.totalItems} items`}
        >
          <Ionicons name="cart" size={21} color={colors.white} />
          {cart.totalItems > 0 && (
            <View style={s.cartCount}>
              <Text style={s.cartCountText}>{cart.totalItems > 9 ? '9+' : cart.totalItems}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* 2 — the search field, full width, exactly as on the site */}
      <Pressable
        onPress={() => router.push('/search')}
        android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
        style={s.search}
        accessibilityRole="search"
        accessibilityLabel="Search parts, brands or your car"
      >
        <Ionicons name="search" size={19} color={colors.ink2} />
        <Text style={s.searchText} numberOfLines={1}>Search parts, brands or your car</Text>
        <View style={s.go}>
          <Text style={s.goText}>Go</Text>
        </View>
      </Pressable>

      {!compact && (
        <>
          {/* 3 — the fitment promise, one tap from anywhere */}
          <View style={s.vehicleRow}>
            <Pressable
              onPress={() => router.push('/(tabs)/garage')}
              android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
              style={s.vehicle}
              accessibilityRole="button"
              accessibilityLabel={car ? `Your car: ${car}` : 'Select your vehicle'}
            >
              <View style={s.vehicleIcon}>
                <Ionicons name="car-sport" size={17} color={colors.white} />
              </View>
              <Text style={s.vehicleText} numberOfLines={1}>{car ?? 'Select your vehicle'}</Text>
              <Ionicons name="chevron-down" size={18} color="rgba(255,255,255,0.75)" />
            </Pressable>
          </View>

          {/* 4 — departments, on the green bar */}
          {departments.length > 0 && (
            <View style={s.deptStrip}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.deptRow}
              >
                {departments.map((d) => (
                  <Pressable
                    key={d.label}
                    onPress={d.onPress}
                    android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
                    style={s.dept}
                    accessibilityRole="button"
                    accessibilityLabel={d.label}
                  >
                    <Text style={s.deptText}>{d.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default memo(AppHeader);

const s = StyleSheet.create({
  wrap: { backgroundColor: colors.header },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  logo: { width: 105, height: 28 },
  hello: { flex: 1, alignItems: 'flex-end' },
  helloText: { fontFamily: font.medium, fontSize: 13.5, color: 'rgba(255,255,255,0.9)' },
  cart: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCount: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.header,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartCountText: { fontFamily: font.bold, fontSize: 10, color: colors.green },

  // 46 tall, white, fully rounded — the site's exact search pill.
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  searchText: { flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.muted },
  go: {
    width: 52,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goText: { fontFamily: font.semibold, fontSize: 15, color: colors.white },

  // 63 tall on #1d2121, with the site's dashed green outline.
  vehicleRow: {
    height: 63,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.header2,
  },
  vehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 47,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(10,92,51,0.9)',
    overflow: 'hidden',
  },
  vehicleIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleText: { flex: 1, fontFamily: font.semibold, fontSize: 15, color: colors.white },

  // 44 tall on the brand green.
  deptStrip: { height: 44, backgroundColor: colors.green },
  deptRow: { paddingHorizontal: spacing.md, alignItems: 'center' },
  dept: { paddingHorizontal: spacing.md, height: 44, justifyContent: 'center' },
  deptText: { fontFamily: font.semibold, fontSize: 15, color: colors.white },
});
