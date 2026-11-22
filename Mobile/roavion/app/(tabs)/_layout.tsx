/**
 * The five places a customer lives: Home, Shop, Reels, Cart, Account.
 *
 * Reels sits in the centre and is drawn as a raised brand-green button, so it
 * reads as the app's signature feature. The bar is a floating white pill
 * (design "Premium showroom", 2026-11-18). Garage moved off the bar: it is one tap
 * away from the top of Home and from Account.
 *
 * Safe area: the bar's height and bottom padding come from the device's real
 * inset. The old values were hard-coded per OS, which put the tabs underneath
 * Android's 3-button navigation (edge-to-edge is forced on Android) and wasted
 * space on iPhones without a home indicator.
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, View, StyleSheet, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../../src/theme';
import { useApp } from '../../src/store';

/** Height of the floating pill, and its gap from the screen edges. */
const PILL_H = 62;
const GAP = 8;

/**
 * The floating pill (design "Premium showroom"). The bar stays IN the layout —
 * screens end above it, so nothing is ever hidden behind it and no screen needs
 * extra bottom padding — and only its background is drawn as an inset pill on
 * the page colour. Below the pill sits the device's safe-area inset, so it
 * never overlaps the iPhone home indicator or Android's navigation buttons.
 */
function PillBackground({ page, bottom }: { page: string; bottom: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: page }]}>
      <View style={[s.pill, { bottom }]} />
    </View>
  );
}

/** The cart count, drawn on the tab icon. */
function CartIcon({ color, size, count }: { color: ColorValue; size: number; count: number }) {
  return (
    <View>
      <Ionicons name="cart-outline" size={size} color={color as string} />
      {count > 0 && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </View>
  );
}

/** The centre Reels button: a raised gradient disc that glows when active. */
function ReelsIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[s.reelsWrap, focused && s.reelsWrapOn]}>
      <LinearGradient
        colors={focused ? ['#13a05f', colors.green] : [colors.greenMid, colors.greenDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.reelsDisc}
      >
        <Ionicons name={focused ? 'play' : 'play-outline'} size={22} color={colors.white} style={{ marginLeft: 2 }} />
      </LinearGradient>
    </View>
  );
}

const tap = () => Haptics.selectionAsync().catch(() => {});

export default function TabsLayout() {
  const { cart } = useApp();
  const insets = useSafeAreaInsets();
  // Gap under the pill: the system inset when there is one, else a small margin.
  const bottom = insets.bottom > 0 ? insets.bottom : GAP;

  const barStyle = (page: string) => ({
    position: 'relative' as const,
    height: PILL_H + bottom,
    paddingTop: 4,
    paddingBottom: bottom + 2,
    paddingHorizontal: GAP + 6,
    backgroundColor: page,
    borderTopWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  });

  return (
    <Tabs
      screenListeners={{ tabPress: tap }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: barStyle(colors.bg),
        tabBarBackground: () => <PillBackground page={colors.bg} bottom={bottom} />,
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color as string} /> }}
      />
      <Tabs.Screen
        name="shop"
        options={{ title: 'Shop', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color as string} /> }}
      />
      <Tabs.Screen
        name="reels"
        options={{
          title: 'Reels',
          tabBarIcon: ({ focused }) => <ReelsIcon focused={focused} />,
          tabBarLabelStyle: { fontFamily: font.bold, fontSize: 11 },
          // Over video the pill floats on black instead of the page colour.
          tabBarStyle: barStyle(colors.black),
          tabBarBackground: () => <PillBackground page={colors.black} bottom={bottom} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarIcon: ({ color, size }) => <CartIcon color={color} size={size} count={cart.totalItems} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Account', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color as string} /> }}
      />
    </Tabs>
  );
}

const s = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.bold, fontSize: 10, color: colors.white, lineHeight: 14 },

  pill: {
    position: 'absolute',
    left: GAP,
    right: GAP,
    top: 0,
    borderRadius: 21,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    shadowColor: '#0f1111',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  reelsWrap: {
    marginTop: -14,
    borderRadius: 26,
    padding: 3,
    backgroundColor: colors.card,
    shadowColor: colors.green,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  reelsWrapOn: { shadowOpacity: 0.55 },
  reelsDisc: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
