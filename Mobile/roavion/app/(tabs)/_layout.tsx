/**
 * The five places a customer lives: Home, Shop, Reels, Garage, Account.
 *
 * Garage took the Cart's place in the bar (owner, 2026-11-28). The cart is still
 * a tab screen, so every existing link to it works and it keeps the bar under
 * it; it is reached from the cart icon in the headers instead.
 *
 * WhatsApp-style bar (owner, 2026-11-22): white, hairline top border, the
 * active tab in a soft green pill — see src/ui/FloatingTabBar.tsx for the
 * safe-area handling (iOS home indicator, Android gesture and 3-button nav).
 * The Reels tab is a white hub now; the full-screen player is the stack
 * route /reels/watch, which has no tab bar, so no tab needs a dark surround.
 */
import { Tabs, useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { FloatingTabBar } from '../../src/ui';

type IconName = keyof typeof Ionicons.glyphMap;
function icon(off: IconName, on: IconName) {
  return function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? on : off} size={size} color={color as string} />;
  };
}

function GarageIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
  return <MaterialCommunityIcons name={focused ? 'garage-open-variant' : 'garage-variant'} size={size + 2} color={color as string} />;
}

/** Screens that stay in the tab navigator but have no button in the bar. */
const HIDDEN = ['cart'];

export default function TabsLayout() {
  const router = useRouter();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} hiddenRoutes={HIDDEN} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="shop" options={{ title: 'Shop', tabBarIcon: icon('grid-outline', 'grid') }} />
      <Tabs.Screen name="reels" options={{ title: 'Reels', tabBarIcon: icon('play-circle-outline', 'play-circle') }} />
      <Tabs.Screen
        name="garage3d"
        options={{ title: 'Garage', tabBarIcon: GarageIcon, tabBarAccessibilityLabel: 'Garage, opens the 3D garage' }}
        listeners={{
          // The 3D garage is a full-screen page of its own, so open it on top
          // rather than switching to an (empty) tab.
          tabPress: (e) => {
            e.preventDefault();
            router.push('/showroom');
          },
        }}
      />
      <Tabs.Screen name="cart" options={{ title: 'Cart' }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
