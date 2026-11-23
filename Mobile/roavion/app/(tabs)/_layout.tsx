/**
 * The five places a customer lives: Home, Shop, Reels, Cart, Account.
 *
 * WhatsApp-style bar (owner, 2026-11-22): white, hairline top border, the
 * active tab in a soft green pill — see src/ui/FloatingTabBar.tsx for the
 * safe-area handling (iOS home indicator, Android gesture and 3-button nav).
 * The Reels tab is a white hub now; the full-screen player is the stack
 * route /reels/watch, which has no tab bar, so no tab needs a dark surround.
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { FloatingTabBar } from '../../src/ui';
import { useApp } from '../../src/store';

type IconName = keyof typeof Ionicons.glyphMap;
function icon(off: IconName, on: IconName) {
  return function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? on : off} size={size} color={color as string} />;
  };
}

export default function TabsLayout() {
  const { cart } = useApp();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="shop" options={{ title: 'Shop', tabBarIcon: icon('grid-outline', 'grid') }} />
      <Tabs.Screen name="reels" options={{ title: 'Reels', tabBarIcon: icon('play-circle-outline', 'play-circle') }} />
      <Tabs.Screen
        name="cart"
        // The count is display-only (cart badge may be optimistic per CLAUDE.md).
        options={{ title: 'Cart', tabBarIcon: icon('cart-outline', 'cart'), tabBarBadge: cart.totalItems || undefined }}
      />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
