import { Platform, Pressable, Text, View } from 'react-native';
import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEmployee } from '../../src/auth/session';
import { canApproveAnything, useCapabilities } from '../../src/auth/capabilities';
import { colors, font } from '../../src/theme';
import { Logo, type IconName } from '../../src/ui';

const TABS: { name: string; title: string; icon: IconName; approverOnly?: boolean }[] = [
  { name: 'index', title: 'Today', icon: 'time-outline' },
  { name: 'history', title: 'History', icon: 'calendar-outline' },
  { name: 'leave', title: 'Leave', icon: 'leaf-outline' },
  // Heads and HR only — and only when the server says so (GET /hr/me/app).
  { name: 'approvals', title: 'Approvals', icon: 'checkmark-done-outline', approverOnly: true },
  { name: 'payslips', title: 'Pay', icon: 'document-text-outline' },
  { name: 'me', title: 'Me', icon: 'person-circle-outline' },
];

function Header() {
  const insets = useSafeAreaInsets();
  const employee = useEmployee();
  const initials = employee.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingHorizontal: 18,
        paddingBottom: 10,
        backgroundColor: colors.bg,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Logo />
      <Pressable
        onPress={() => router.navigate('/me')}
        accessibilityRole="button"
        accessibilityLabel={`${employee.name}. My profile`}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: font.bold, fontSize: 12, color: colors.green }}>{initials}</Text>
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const approver = canApproveAnything(useCapabilities());
  return (
    <Tabs
      screenOptions={{
        header: () => <Header />,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.line,
          // Web previews have no safe-area inset under the bar; give the labels room.
          ...(Platform.OS === 'web' ? { height: 62, paddingBottom: 8 } : null),
        },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            // href null hides the tab and blocks navigating to it.
            ...(t.approverOnly && !approver ? { href: null } : null),
            tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} size={size - 2} color={color as string} />,
          }}
        />
      ))}
    </Tabs>
  );
}
