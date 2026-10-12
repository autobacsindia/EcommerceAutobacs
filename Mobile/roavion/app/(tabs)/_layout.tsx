/**
 * The five places a customer lives: Home, Shop, Garage, Cart, Account.
 *
 * Five is the most a thumb can reach comfortably, and it mirrors how the
 * website is organised, so someone who knows the site is never lost here.
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Text, View, StyleSheet, type ColorValue } from 'react-native';
import { colors, font } from '../../src/theme';
import { useApp } from '../../src/store';

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
          borderTopColor: colors.line,
          height: Platform.OS === 'ios' ? 86 : 64,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
        },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="shop"
        options={{ title: 'Shop', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="garage"
        options={{ title: 'Garage', tabBarIcon: ({ color, size }) => <Ionicons name="car-sport-outline" size={size} color={color} /> }}
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
        options={{ title: 'Account', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} /> }}
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
});
