import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, font } from '../../src/theme';

export default function AppTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: font.bold, fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen
        name="products"
        options={{ title: 'Products', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'cube' : 'cube-outline'} size={24} color={color as string} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'business' : 'business-outline'} size={24} color={color as string} /> }}
      />
    </Tabs>
  );
}
