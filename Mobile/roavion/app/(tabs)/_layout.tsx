/**
 * The five places a customer lives: Home, Categories, Garage, Cart, Account.
 *
 * Five is the most a thumb can reach comfortably. Four of them are the set every
 * Indian shopping app trains people to expect — home, a way into the catalogue,
 * the cart and the account — so nobody has to learn this bar. Garage is the one
 * that is ours: it is the whole reason a parts shop is not a general store.
 *
 * "Categories" rather than "Shop": a shopping app is entirely shopping, so
 * "Shop" names nothing. Categories says what the tab actually opens, which is
 * the department tree.
 *
 * The bar itself: a filled icon and a soft green chip mark the active tab, so
 * position is readable at a glance instead of by reading five labels. Colour
 * alone would not do it — the chip and the icon weight carry the state too.
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Text, View, StyleSheet, type ColorValue } from 'react-native';
import { colors, font, radius } from '../../src/theme';
import { useApp } from '../../src/store';

/** Outline when resting, solid when active — the standard mobile affordance. */
type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The tab's own label.
 *
 * The navigator's default label element is given a fixed height equal to the
 * font size, which crops the descenders of "Categories" and "Garage". Rendering
 * the Text here means the line box is ours and nothing can clip it.
 */
function TabLabel({ label, color }: { label: string; color: ColorValue }) {
  return <Text style={[s.tabLabel, { color: color as string }]}>{label}</Text>;
}

/**
 * One tab icon inside its active chip.
 *
 * The chip is drawn here rather than via `tabBarItemStyle` because it has to
 * hug the icon, not the whole item (which includes the label).
 */
function TabIcon({
  name,
  nameActive,
  color,
  focused,
  badge,
}: {
  name: IconName;
  nameActive: IconName;
  color: ColorValue;
  focused: boolean;
  badge?: number;
}) {
  return (
    <View style={[s.chip, focused && s.chipOn]}>
      <Ionicons name={focused ? nameActive : name} size={22} color={color as string} />
      {!!badge && badge > 0 && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabsLayout() {
  const { cart } = useApp();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          height: Platform.OS === 'ios' ? 92 : 70,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 30 : 10,
          // A hairline border alone reads as flat; the lift separates the bar
          // from a white product grid scrolling underneath it.
          elevation: 12,
          shadowColor: '#000000',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -3 },
        },
        tabBarItemStyle: { paddingVertical: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarLabel: ({ color }) => <TabLabel label="Home" color={color} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home-outline" nameActive="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          title: 'Categories',
          tabBarLabel: ({ color }) => <TabLabel label="Categories" color={color} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="grid-outline" nameActive="grid" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="garage"
        options={{
          title: 'Garage',
          tabBarLabel: ({ color }) => <TabLabel label="Garage" color={color} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="car-sport-outline" nameActive="car-sport" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarLabel: ({ color }) => <TabLabel label="Cart" color={color} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="cart-outline" nameActive="cart" color={color} focused={focused} badge={cart.totalItems} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarLabel: ({ color }) => <TabLabel label="Account" color={color} />,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="person-outline" nameActive="person" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const s = StyleSheet.create({
  tabLabel: { fontFamily: font.medium, fontSize: 11, lineHeight: 15, marginTop: 2, textAlign: 'center' },
  chip: {
    minWidth: 46,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.greenSoft },
  badge: {
    position: 'absolute',
    top: -4,
    right: 2,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.red,
    borderWidth: 1.5,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.bold, fontSize: 9.5, color: colors.white, lineHeight: 13 },
});
