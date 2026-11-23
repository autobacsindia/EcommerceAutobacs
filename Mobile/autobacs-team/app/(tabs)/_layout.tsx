import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession, useEmployee } from '../../src/auth/session';
import { queue, challengePool } from '../../src/punch/PunchProvider';
import { colors, font } from '../../src/theme';
import { Logo, type IconName } from '../../src/ui';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Today', icon: 'time-outline' },
  { name: 'history', title: 'History', icon: 'calendar-outline' },
  { name: 'leave', title: 'Leave', icon: 'leaf-outline' },
  { name: 'payslips', title: 'Payslips', icon: 'document-text-outline' },
];

function Header() {
  const insets = useSafeAreaInsets();
  const employee = useEmployee();
  const { signOut } = useSession();
  const initials = employee.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const confirmSignOut = async () => {
    const waiting = await queue.pendingCount(employee.id);
    const drop = async () => {
      await queue.discardFor(employee.id);
      await challengePool.clear();
    };
    Alert.alert(
      'Sign out?',
      waiting
        ? `${waiting} clock ${waiting === 1 ? 'punch has' : 'punches have'} not been sent yet and will be lost. Ask HR to fix the day if you sign out now.`
        : `${employee.name} · ${employee.employeeCode}`,
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut(drop) },
      ],
    );
  };

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
        onPress={() => void confirmSignOut()}
        accessibilityRole="button"
        accessibilityLabel={`${employee.name}. Account and sign out`}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: font.bold, fontSize: 12, color: colors.green }}>{initials}</Text>
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
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
            tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} size={size - 2} color={color as string} />,
          }}
        />
      ))}
    </Tabs>
  );
}
